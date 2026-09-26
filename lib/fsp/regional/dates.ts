// Даты из свободного текста постов: «11–13 сентября», «с 10 по 14 ноября 2025», «17.09.2026», «19-20.09.2026».

const MONTHS: [RegExp, number][] = [
  [/^январ/, 1], [/^феврал/, 2], [/^март/, 3], [/^апрел/, 4], [/^ма[йя]/, 5], [/^июн/, 6],
  [/^июл/, 7], [/^август/, 8], [/^сентябр/, 9], [/^октябр/, 10], [/^ноябр/, 11], [/^декабр/, 12],
];

export type DateRange = { dateFrom: string; dateTo: string; index: number };

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function month(word: string): number | null {
  const w = word.toLowerCase();
  for (const [re, n] of MONTHS) if (re.test(w)) return n;
  return null;
}

/** Год не указан — берём ближайший к дате поста (анонс на январь в декабрьском посте — следующий год). */
function inferYear(m: number, posted: string): number {
  const py = Number(posted.slice(0, 4));
  const pm = Number(posted.slice(5, 7));
  if (m < pm - 6) return py + 1;
  if (m > pm + 6) return py - 1;
  return py;
}

function valid(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return false;
  return new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d;
}

const MON = "(январ\\S*|феврал\\S*|март\\S*|апрел\\S*|ма[йя]\\S*|июн\\S*|июл\\S*|август\\S*|сентябр\\S*|октябр\\S*|ноябр\\S*|декабр\\S*)";
const DASH = "\\s*(?:[-–—]|по|до)\\s*";

// «с 10 по 14 ноября 2025», «11–13 сентября», «27-29 ноября»
const RE_WORD_RANGE = new RegExp(`(?:с\\s+)?(\\d{1,2})${DASH}(\\d{1,2})\\s+${MON}(?:\\s+(\\d{4}))?`, "gi");
// «4 декабря 2025», «6 июня»; «30 сентября – 2 октября»
const RE_WORD_CROSS = new RegExp(`(\\d{1,2})\\s+${MON}${DASH}(\\d{1,2})\\s+${MON}(?:\\s+(\\d{4}))?`, "gi");
const RE_WORD_ONE = new RegExp(`(\\d{1,2})\\s+${MON}(?:\\s+(\\d{4}))?`, "gi");
// «19-20.09.2026», «17.09.2026», «17.09.2026 – 19.09.2026»
const RE_NUM_RANGE = /(\d{1,2})\s*[-–—]\s*(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})\b/g;
const RE_NUM_CROSS = /(\d{1,2})\.(\d{1,2})\.(\d{4})\s*[-–—]\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/g;
const RE_NUM_ONE = /(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})\b/g;

const year4 = (s: string) => (s.length === 2 ? 2000 + Number(s) : Number(s));

/** Все диапазоны дат в тексте по порядку появления (без пересечений). */
export function findDates(text: string, posted: string): DateRange[] {
  const out: DateRange[] = [];
  const taken: [number, number][] = [];
  const free = (a: number, b: number) => taken.every(([x, y]) => b <= x || a >= y);
  const push = (i: number, len: number, y1: number, m1: number, d1: number, y2: number, m2: number, d2: number) => {
    if (!free(i, i + len) || !valid(y1, m1, d1) || !valid(y2, m2, d2)) return;
    const a = iso(y1, m1, d1);
    const b = iso(y2, m2, d2);
    if (b < a) return;
    taken.push([i, i + len]);
    out.push({ dateFrom: a, dateTo: b, index: i });
  };

  for (const m of text.matchAll(RE_NUM_CROSS)) {
    push(m.index, m[0].length, +m[3], +m[2], +m[1], +m[6], +m[5], +m[4]);
  }
  for (const m of text.matchAll(RE_NUM_RANGE)) {
    const y = year4(m[4]);
    push(m.index, m[0].length, y, +m[3], +m[1], y, +m[3], +m[2]);
  }
  for (const m of text.matchAll(RE_NUM_ONE)) {
    const y = year4(m[3]);
    push(m.index, m[0].length, y, +m[2], +m[1], y, +m[2], +m[1]);
  }
  for (const m of text.matchAll(RE_WORD_CROSS)) {
    const m1 = month(m[2])!;
    const m2 = month(m[4])!;
    const y2 = m[5] ? +m[5] : inferYear(m2, posted);
    const y1 = m1 > m2 ? y2 - 1 : y2;
    push(m.index, m[0].length, y1, m1, +m[1], y2, m2, +m[3]);
  }
  for (const m of text.matchAll(RE_WORD_RANGE)) {
    const mm = month(m[3])!;
    const y = m[4] ? +m[4] : inferYear(mm, posted);
    push(m.index, m[0].length, y, mm, +m[1], y, mm, +m[2]);
  }
  for (const m of text.matchAll(RE_WORD_ONE)) {
    const mm = month(m[2])!;
    const y = m[3] ? +m[3] : inferYear(mm, posted);
    push(m.index, m[0].length, y, mm, +m[1], y, mm, +m[1]);
  }
  return out.sort((a, b) => a.index - b.index);
}
