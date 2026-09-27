import { createHash } from "node:crypto";
import { regionByCode } from "../../regions";
import type { Incoming } from "../../sync/merge";
import { disciplinesOf } from "./extract";

// Разбор календарного плана субъекта из текста (pdftotext -layout или OCR).
// Таблица: «№ | наименование | сроки | место | участники | количество»; столбцы выровнены пробелами,
// ячейка переносится на следующие строки. Строка таблицы начинается с номера «12.».

const MONTHS = ["январ", "феврал", "март", "апрел", "ма[йя]", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр"];
const MONTH_RE = new RegExp(`(?<![а-яё])(${MONTHS.join("|")})[а-яё]*`, "gi");
const MONTH_ONE = new RegExp(MONTH_RE.source, "i");
const monthIndex = (w: string) => MONTHS.findIndex((m) => new RegExp(`^${m}`, "i").test(w));
const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

// Строка таблицы — строка с номером: «12.», «12», «395   1» (сквозной и в разделе).
const ROW_NO = /^\s{0,8}(\d{1,4})\.?(?:\s+(\d{1,3})\.?)?(?=\s{1,}\S)/;
// Колонка наименования: её левый край — типичное начало «Чемпионат…», «Первенство…» в документе;
// ячейка правее края больше чем на NAME_WIDTH — уже следующая колонка (сроки, место, участники).
const NAME_START = /^(Чемпионат|Первенств|Кубок|Областн|Открыт|Республиканск|Краев|Городск|Соревнован|Турнир|Фестивал)/;
const NAME_WIDTH = 22;
const NATIONAL = /всероссийск|международн|(чемпионат|первенств|кубо?к)\S*\s+(и\s+\S+\s+)?росси|кубк?\S*\s+федерации/i;
const OUR_SECTION = /^спортивное\s+программирование$/i;

export type PlanRow = { no: number; lines: string[]; name: string };

const cellsOf = (line: string) => [...line.matchAll(/\S+(?:\s{1,2}\S+)*/g)].map((m) => ({ at: m.index!, text: m[0] }));

/**
 * Строки таблицы, относящиеся к спортивному программированию: весь раздел вида спорта
 * или строки со словом «программирование» в наименовании.
 * Ячейки переносятся на соседние строки и бывают выровнены по центру — строку текста относим к ближайшему номеру.
 */
export function planRows(text: string): PlanRow[] {
  // \f — разрыв страницы (pdftotext)
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\f/g, ""))
    .filter((l) => l.trim());
  // заголовок раздела: одна ячейка; ЗАГЛАВНЫМИ или сразу перед строкой «1.»
  const isHeader = (i: number) => {
    const c = cellsOf(lines[i]);
    if (c.length !== 1 || c[0].text.length > 80 || !/^[А-ЯЁ]/.test(c[0].text) || ROW_NO.test(lines[i])) return false;
    if (/^[А-ЯЁ\s,()-]{6,}$/.test(c[0].text)) return true;
    const next = lines[i + 1] && ROW_NO.exec(lines[i + 1]);
    return !!next && (next[2] ?? next[1]) === "1";
  };
  // разбиваем на разделы, в каждом — строки по номерам
  type Sec = { ours: boolean; lines: string[] };
  const secs: Sec[] = [{ ours: false, lines: [] }];
  lines.forEach((l, i) => (isHeader(i) ? secs.push({ ours: OUR_SECTION.test(l.trim()), lines: [] }) : secs[secs.length - 1].lines.push(l)));
  const noNums = (l: string) => l.replace(ROW_NO, (x) => " ".repeat(x.length));
  const starts = lines.flatMap((l) => cellsOf(noNums(l)).filter((c) => NAME_START.test(c.text)).map((c) => c.at)).sort((a, b) => a - b);
  const nameCol = (starts[Math.floor(starts.length / 2)] ?? 12) + NAME_WIDTH;
  const nameCell = (l: string) => {
    const c = cellsOf(noNums(l));
    return c[0] && c[0].at <= nameCol ? c[0].text : "";
  };
  // макет: наименование начинается в строке с номером (Саратов) или центрировано по вертикали (Дагестан)
  const numbered = lines.filter((l) => ROW_NO.test(l));
  const topAligned = numbered.filter((l) => nameCell(l)).length * 2 > numbered.length;
  const out: PlanRow[] = [];
  for (const sec of secs) {
    const nums = sec.lines.flatMap((l, i) => {
      const m = ROW_NO.exec(l);
      return m ? [{ i, no: Number(m[2] ?? m[1]) }] : [];
    });
    for (const [k, n] of nums.entries()) {
      // границы: от номера до следующего номера или середины между соседними номерами
      const last = sec.lines.length - 1;
      const from = topAligned ? n.i : k ? Math.floor((nums[k - 1].i + n.i) / 2) + 1 : 0;
      const to = k < nums.length - 1 ? (topAligned ? nums[k + 1].i - 1 : Math.floor((n.i + nums[k + 1].i) / 2)) : last;
      const rowLines = sec.lines.slice(from, to + 1);
      const name = rowLines
        .map(nameCell)
        .join(" ")
        .replace(/\s+/g, " ")
        .replace(/(\S)- (\S)/g, "$1$2")
        .replace(/["«]\s*([^"«»]*?)\s*["»]/g, "«$1»")
        .trim();
      if (sec.ours || /программирован/i.test(name)) out.push({ no: n.no, lines: rowLines, name });
    }
  }
  return out;
}

type Dates = { dateFrom: string; dateTo: string } | null;

/** «12-14 марта», «15.03.2026», «март», «тур 1 – март … тур 3 – апрель» → диапазон. */
export function planDates(s: string, year: number): Dates {
  const dm = [...s.matchAll(/(?<!\d)(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?(?!\d)/g)]
    .map((m) => ({ d: Number(m[1]), m: Number(m[2]) - 1, y: m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : year }))
    .filter((x) => x.d >= 1 && x.d <= 31 && x.m >= 0 && x.m < 12);
  if (dm.length) {
    const iso = (x: (typeof dm)[0]) => `${x.y}-${pad(x.m + 1)}-${pad(x.d)}`;
    const all = dm.map(iso).sort();
    return { dateFrom: all[0], dateTo: all[all.length - 1] };
  }
  const months = [...s.matchAll(MONTH_RE)].map((m) => ({ m: monthIndex(m[1]), at: m.index! }));
  if (!months.length) return null;
  // «12-14 марта», «12 марта»
  const first = months[0];
  const before = s.slice(Math.max(0, first.at - 8), first.at);
  const days = before.match(/(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?\s*$/);
  const lo = Math.min(...months.map((x) => x.m));
  const hi = Math.max(...months.map((x) => x.m));
  if (days && months.length === 1) {
    const a = Number(days[1]);
    const b = Number(days[2] ?? days[1]);
    return { dateFrom: `${year}-${pad(lo + 1)}-${pad(a)}`, dateTo: `${year}-${pad(lo + 1)}-${pad(b)}` };
  }
  return { dateFrom: `${year}-${pad(lo + 1)}-01`, dateTo: `${year}-${pad(hi + 1)}-${pad(lastDay(year, hi))}` };
}

export type PlanDoc = { regionCode: number; year: number; url: string; key: string };

/** Текст плана → записи. key — стабильная часть id (plan-<код>), строки различаются хешем наименования и сроков. */
export function planToEvents(text: string, doc: PlanDoc): Incoming[] {
  const r = regionByCode(doc.regionCode);
  const out = new Map<string, Incoming>();
  for (const row of planRows(text)) {
    const all = row.lines.join("\n");
    const flat = all.replace(/\s+/g, " ");
    const name = row.name;
    if (!name || NATIONAL.test(name)) continue;
    const dates = planDates(flat.slice(name.length), doc.year) ?? planDates(flat, doc.year);
    if (!dates) continue;
    const numLine = row.lines.find((l) => ROW_NO.test(l)) ?? row.lines[0];
    // город: «г. Саратов» или отдельная ячейка сразу после срока («сентябрь    Махачкала»)
    const cells = cellsOf(numLine).map((c) => c.text);
    const m = cells.findIndex((c) => MONTH_ONE.test(c));
    const afterMonth = m >= 0 ? cells[m + 1] : undefined;
    const city =
      flat.match(/(?:^|[\s,])г\.\s*([А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?)/)?.[1] ??
      (afterMonth && /^[А-ЯЁ][а-яё]+(?:[- ][А-ЯЁ][а-яё]+)?$/.test(afterMonth) ? afterMonth : null);
    // количество участников — последнее отдельное число первой строки
    const count = numLine.match(/\s(\d{2,5})(?:\s*чел\.?)?\s*$/)?.[1];
    const hash = createHash("sha1").update(`${name}|${dates.dateFrom}`).digest("hex").slice(0, 8);
    const id = `region:${doc.key}:${doc.year}-${hash}`;
    out.set(id, {
      id,
      source: "region",
      ekpId: null,
      year: Number(dates.dateFrom.slice(0, 4)),
      name,
      level: /межрегиональн/i.test(name) ? "Межрегиональные" : "Региональные",
      squad: null,
      genderAge: null,
      // в «плоском» тексте в название вклиниваются соседние колонки — дисциплину берём из названия
      disciplines: disciplinesOf(name).length ? disciplinesOf(name) : disciplinesOf(flat),
      note: `Календарный план субъекта, строка ${row.no}`,
      dateFrom: dates.dateFrom,
      dateTo: dates.dateTo,
      country: "Россия",
      region: r?.name ?? null,
      regionCode: doc.regionCode,
      federalDistrict: r?.fo ?? null,
      city,
      venue: null,
      isOnline: /онлайн|дистанцион/i.test(flat),
      participants: count ? Number(count) : null,
      organizer: r ? `ФСП — ${r.name}` : null,
      url: doc.url,
    });
  }
  return [...out.values()];
}

/**
 * TSV Tesseract (слова с координатами) → текст с колонками, как у pdftotext -layout:
 * слово ставится в позицию left / ширина символа, слова одной высоты — в одну строку.
 * Номер строки таблицы OCR часто читает как «,» «я» «Э,» — короткое слово в колонке номеров заменяем на «0.».
 */
export function ocrLayout(tsv: string): string {
  type W = { key: string; left: number; top: number; width: number; height: number; text: string };
  const words: W[] = tsv
    .split("\n")
    .slice(1)
    .map((l) => l.split("\t"))
    .filter((c) => c[0] === "5" && c[11]?.trim())
    .map((c) => ({ key: `${c[2]}/${c[3]}/${c[4]}`, left: +c[6], top: +c[7], width: +c[8], height: +c[9], text: c[11].trim() }));
  if (!words.length) return "";
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const charW = median(words.filter((w) => w.text.length > 3).map((w) => w.width / w.text.length)) || 20;
  const lineH = median(words.map((w) => w.height)) || 30;
  const minLeft = Math.min(...words.map((w) => w.left));
  // строки Tesseract → визуальные строки (разные блоки на одной высоте — одна строка)
  const byKey = new Map<string, W[]>();
  for (const w of words) byKey.set(w.key, [...(byKey.get(w.key) ?? []), w]);
  const lines = [...byKey.values()].map((ws) => ({ top: median(ws.map((w) => w.top)), ws })).sort((a, b) => a.top - b.top);
  const rows: W[][] = [];
  let lastTop = -Infinity;
  for (const l of lines) {
    if (l.top - lastTop < lineH * 0.6) rows[rows.length - 1].push(...l.ws);
    else rows.push([...l.ws]);
    lastTop = l.top;
  }
  return rows
    .map((ws) => {
      let s = "";
      ws.sort((a, b) => a.left - b.left).forEach((w, i) => {
        const col = Math.round((w.left - minLeft) / charW);
        let text = w.text;
        // колонка номеров: первое слово у левого края
        if (i === 0 && col <= 2 && text.length <= 3 && !/^[А-ЯЁа-яё]{2,}/.test(text)) text = /^\d+\.?$/.test(text) ? text.replace(/\.?$/, ".") : "0.";
        // номер не распознан вовсе, а строка начинается с «Чемпионат…», «Областные соревнования…» — новая строка таблицы
        else if (i === 0 && col > 2 && NAME_START.test(text)) s = "0.";
        s = s.length < col ? s.padEnd(col) : s ? `${s} ` : s;
        s += text;
      });
      return s;
    })
    .join("\n");
}
