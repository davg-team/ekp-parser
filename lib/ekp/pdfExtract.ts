import type { TextItem } from "pdfjs-dist/types/src/display/api";

export type Cells = { id: string; name: string; dates: string; place: string; count: string; lead: string };
export type Line = { page: number; y: number; cells: Cells; text: string };

/** Левая граница каждой колонки (pt). Макет ЕКП стабилен из года в год; уточняем по первой записи страницы. */
type Columns = { name: number; dates: number; place: number; count: number };
const DEFAULT_COLUMNS: Columns = { name: 100, dates: 405, place: 475, count: 740 };

const DATE_RE = /^\d{2}\.\d{2}\.\d{4}$/;
const ID_RE = /^\d{16}$/;

type Item = { s: string; x: number; y: number };

function detectColumns(items: Item[]): Columns {
  const idItem = items.find((i) => ID_RE.test(i.s.trim()));
  if (!idItem) return DEFAULT_COLUMNS;
  const row = items.filter((i) => Math.abs(i.y - idItem.y) < 1.5 && i.s.trim());
  const date = row.find((i) => DATE_RE.test(i.s.trim()));
  if (!date) return DEFAULT_COLUMNS;
  const after = row.filter((i) => i.x > date.x + 5).sort((a, b) => a.x - b.x);
  const count = [...after].reverse().find((i) => /^\d+$/.test(i.s.trim()));
  const place = after[0];
  if (!place || !count || place === count) return DEFAULT_COLUMNS;
  return { name: idItem.x + 60, dates: date.x - 8, place: place.x - 5, count: count.x - 30 };
}

function column(x: number, c: Columns): keyof Cells {
  if (x < c.name) return "lead";
  if (x < c.dates) return "name";
  if (x < c.place) return "dates";
  if (x < c.count) return "place";
  return "count";
}

/** Разбивает страницу на строки таблицы с текстом по колонкам. */
export function pageLines(page: number, raw: TextItem[]): Line[] {
  const items: Item[] = raw
    .filter((i) => i.str !== "")
    .map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5] }));
  const cols = detectColumns(items);
  const rows = new Map<number, Item[]>();
  for (const it of items) {
    // строки в ЕКП идут с шагом ~11pt — округления до 2pt хватает
    const key = Math.round(it.y / 2) * 2;
    const k = [key, key - 2, key + 2].find((kk) => rows.has(kk)) ?? key;
    if (!rows.has(k)) rows.set(k, []);
    rows.get(k)!.push(it);
  }
  const lines: Line[] = [];
  for (const [y, its] of [...rows.entries()].sort((a, b) => b[0] - a[0])) {
    its.sort((a, b) => a.x - b.x);
    const cells: Cells = { id: "", name: "", dates: "", place: "", count: "", lead: "" };
    for (const it of its) cells[column(it.x, cols)] += it.s;
    for (const k of Object.keys(cells) as (keyof Cells)[]) cells[k] = cells[k].replace(/\s+/g, " ").trim();
    const lead = cells.lead;
    if (ID_RE.test(lead)) {
      cells.id = lead;
      cells.lead = "";
    }
    if (/^Стр\.\s*\d+\s*из\s*\d+$/.test([cells.lead, cells.name, cells.dates, cells.place, cells.count].join(" ").trim())) continue;
    if (!Object.values(cells).some(Boolean)) continue;
    lines.push({ page, y, cells, text: its.map((i) => i.s).join("").replace(/\s+/g, " ").trim() });
  }
  return lines;
}

export type SectionScan = { lines: Line[]; pages: [number, number] | null; totalPages: number };

/**
 * Проходит PDF по страницам и возвращает строки раздела вида спорта
 * (от заголовка `sport` до заголовка следующего вида спорта).
 */
export async function extractSection(data: Uint8Array, sport: string): Promise<SectionScan> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data, useSystemFonts: false, disableFontFace: true });
  const doc = await task.promise;
  const totalPages = doc.numPages;
  const target = sport.toUpperCase();
  const out: Line[] = [];
  let first = 0;
  let last = 0;
  try {
    outer: for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const tc = await page.getTextContent();
      page.cleanup();
      const items = tc.items.filter((i): i is TextItem => "str" in i);
      if (!first) {
        if (!items.map((i) => i.str).join("").replace(/\s+/g, " ").toUpperCase().includes(target)) continue;
        first = n;
      }
      const lines = pageLines(n, items);
      let started = n > first;
      for (const l of lines) {
        if (!started) {
          if (isSportHeader(l) && l.text.toUpperCase() === target) started = true;
          continue;
        }
        if (isSportHeader(l)) break outer;
        out.push(l);
      }
      last = n;
    }
  } finally {
    await task.destroy();
  }
  return { lines: out, pages: first ? [first, last || first] : null, totalPages };
}

/** Заголовок вида спорта: только левая колонка, заглавными, не «состав». */
export function isSportHeader(l: Line): boolean {
  const c = l.cells;
  return (
    !c.id &&
    !!c.lead &&
    !c.dates &&
    !c.count &&
    !c.place &&
    l.text === l.text.toUpperCase() &&
    /[А-ЯЁ]{3}/.test(l.text) &&
    !/СОСТАВ/i.test(l.text)
  );
}
