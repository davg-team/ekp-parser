const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

export function fmtPeriod(a: string, b: string): string {
  if (!a) return "—";
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = (b || a).split("-").map(Number);
  if (a === b || !b) return `${da} ${MONTHS[ma - 1]} ${ya}`;
  if (ya === yb && ma === mb) return `${da}–${db} ${MONTHS[ma - 1]} ${ya}`;
  if (ya === yb) return `${da} ${MONTHS[ma - 1]} – ${db} ${MONTHS[mb - 1]} ${ya}`;
  return `${fmtDate(a)} – ${fmtDate(b)}`;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow" });
}

/** «ПРОГРАММИРОВАНИЕ СИСТЕМ ИНФОРМАЦИОННОЙ БЕЗОПАСНОСТИ» → «Системы ИБ» и т.п. — коротко для таблицы. */
const SHORT: Record<string, string> = {
  "ПРОГРАММИРОВАНИЕ АЛГОРИТМИЧЕСКОЕ": "Алгоритмическое",
  "ПРОГРАММИРОВАНИЕ ПРОДУКТОВОЕ": "Продуктовое",
  "ПРОГРАММИРОВАНИЕ СИСТЕМ ИНФОРМАЦИОННОЙ БЕЗОПАСНОСТИ": "Инфобез",
  "ПРОГРАММИРОВАНИЕ БЕСПИЛОТНЫХ АВИАЦИОННЫХ СИСТЕМ": "БАС",
  "ПРОГРАММИРОВАНИЕ РОБОТОТЕХНИКИ": "Робототехника",
  "ПРОГРАММИРОВАНИЕ СИСТЕМ ИСКУССТВЕННОГО ИНТЕЛЛЕКТА": "ИИ",
};
export function shortDiscipline(d: string): string {
  if (SHORT[d]) return SHORT[d];
  const s = d.replace(/^ПРОГРАММИРОВАНИЕ\s+/, "").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
