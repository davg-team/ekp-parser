import type { EventLevel } from "../types";
import { findRegion, regionByCode } from "../regions";
import type { Line } from "./pdfExtract";

export type EkpRecord = {
  ekpId: string;
  squad: string | null;
  name: string;
  level: EventLevel;
  genderAge: string | null;
  disciplines: string[];
  note: string | null;
  dateFrom: string;
  dateTo: string;
  country: string | null;
  region: string | null;
  regionCode: number | null;
  federalDistrict: string | null;
  city: string | null;
  venue: string | null;
  isOnline: boolean;
  participants: number | null;
  /** сырой текст места проведения — для отладки и поиска */
  placeRaw: string;
  page: number;
};

type Block = { id: string; squad: string | null; lines: Line[] };

export function groupRecords(lines: Line[]): Block[] {
  const blocks: Block[] = [];
  let squad: string | null = null;
  let cur: Block | null = null;
  for (const l of lines) {
    if (!l.cells.id && /состав/i.test(l.text) && !l.cells.dates) {
      squad = l.text;
      cur = null;
      continue;
    }
    if (l.cells.id) {
      cur = { id: l.cells.id, squad, lines: [] };
      blocks.push(cur);
    }
    cur?.lines.push(l);
  }
  return blocks;
}

const LOWER_START = /^[а-яё0-9(]/;

function isoDate(s: string): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function joinWrapped(parts: string[]): string {
  // Перенос по дефису («ЛЫЖНАЯ ГОНКА-» / «МНОГОДНЕВНАЯ») склеиваем без пробела только если дефис прилип к слову.
  return parts.reduce((acc, p) => (!acc ? p : /[А-ЯЁA-Z]-$/i.test(acc) ? acc + p : `${acc} ${p}`), "").trim();
}

/** Делит «ДИСЦ1, ДИСЦ2, Онлайн этап Кубка России» на дисциплины (заглавными) и примечание. */
export function splitDisciplines(text: string): { disciplines: string[]; note: string | null } {
  const disciplines: string[] = [];
  const note: string[] = [];
  for (const part of text.split(/,\s*/).map((p) => p.trim()).filter(Boolean)) {
    if (!note.length && part === part.toUpperCase() && /[А-ЯЁA-Z]/.test(part)) disciplines.push(part);
    else note.push(part);
  }
  return { disciplines, note: note.length ? note.join(", ") : null };
}

const LEVEL_BY_CODE: Record<string, EventLevel> = {
  "0016": "Международные",
  "0017": "Чемпионат ФО",
  "0018": "Первенство ФО",
  "0019": "Чемпионат России",
  "0020": "Кубок России",
  "0021": "Всероссийские",
  "0022": "Первенство России",
  "0023": "Межрегиональные",
  "0024": "УТМ",
};

export function detectLevel(name: string, ekpId?: string): EventLevel {
  const n = name.toUpperCase();
  if (/УЧЕБНО-ТРЕНИРОВОЧН/.test(n)) return "УТМ";
  if (/МЕЖДУНАРОДН/.test(n)) return "Международные";
  if (/^КУБОК РОССИИ/.test(n)) return "Кубок России";
  if (/^ЧЕМПИОНАТ РОССИИ/.test(n)) return "Чемпионат России";
  if (/^ПЕРВЕНСТВО РОССИИ/.test(n)) return "Первенство России";
  if (/^ЧЕМПИОНАТ .*(ФЕДЕРАЛЬН|ОКРУГ)/.test(n)) return "Чемпионат ФО";
  if (/^ПЕРВЕНСТВО .*(ФЕДЕРАЛЬН|ОКРУГ)/.test(n)) return "Первенство ФО";
  if (/ВСЕРОССИЙСК/.test(n)) return "Всероссийские";
  if (/МЕЖРЕГИОНАЛЬН/.test(n)) return "Межрегиональные";
  if (ekpId && LEVEL_BY_CODE[ekpId.slice(8, 12)]) return LEVEL_BY_CODE[ekpId.slice(8, 12)];
  return "Прочее";
}

export function parsePlace(lines: string[], ekpId: string) {
  const raw = lines.join(" | ");
  const country = lines[0] ?? null;
  const rest = joinWrapped(lines.slice(1));
  const upper = rest.toUpperCase();
  const isOnline = /ПО МЕСТУ НАХОЖДЕНИЯ УЧАСТНИКОВ|ОНЛАЙН|ДИСТАНЦИОНН/.test(upper);
  const tbd = /ПО НАЗНАЧЕНИЮ/.test(upper);
  let region: string | null = null;
  let city: string | null = null;
  let venue: string | null = null;
  if (rest && !isOnline && !tbd) {
    const [head, ...tail] = rest.split(/,\s*/);
    region = head.trim();
    city = tail.shift()?.trim() ?? null;
    venue = tail.length ? tail.join(", ").trim() : null;
  }
  const codeFromId = Number(ekpId.slice(4, 6)) || null;
  const found = findRegion(region) ?? (region ? null : regionByCode(codeFromId));
  const regionName = found?.name ?? (region ? titleCase(region) : null);
  return {
    country: country ? titleCase(country) : null,
    federalDistrict: (found?.fo ?? null) as string | null,
    region: regionName,
    regionCode: found?.code ?? null,
    city: city ? cleanCity(city) : tbd ? "по назначению" : null,
    venue,
    isOnline,
    placeRaw: raw,
  };
}

function cleanCity(c: string): string {
  return c
    .replace(/^(г\.?|город|Г|Город)\s+/i, "")
    .replace(/\s+(село|деревня|поселок|посёлок|пгт|станица)$/i, (m) => m.toLowerCase())
    .trim();
}

export function titleCase(s: string): string {
  const lower = s.toLowerCase();
  return lower.replace(/(^|[\s(«"-])([а-яёa-z])/g, (_, p, ch) => p + ch.toUpperCase())
    .replace(/\b(Область|Край|Республика|Автономный Округ|Автономная Область|Народная)\b/g, (m) => m.toLowerCase())
    .replace(/^(\S)/, (m) => m.toUpperCase());
}

export function parseBlock(b: Block): EkpRecord {
  const name: string[] = [];
  const gender: string[] = [];
  const disc: string[] = [];
  for (const l of b.lines) {
    const t = l.cells.name;
    if (!t) continue;
    if (!gender.length && !disc.length && !LOWER_START.test(t)) name.push(t);
    else if (!disc.length && LOWER_START.test(t)) gender.push(t);
    else disc.push(t);
  }
  const dates = b.lines.map((l) => isoDate(l.cells.dates)).filter((d): d is string => !!d);
  const placeLines = b.lines.map((l) => l.cells.place).filter(Boolean);
  const count = b.lines.map((l) => l.cells.count).find((c) => /^\d+$/.test(c));
  const fullName = joinWrapped(name);
  const { disciplines, note } = splitDisciplines(joinWrapped(disc));
  const place = parsePlace(placeLines, b.id);
  // «ЧЕМПИОНАТ ФЕДЕРАЛЬНОГО ОКРУГА (ЮЖНЫЙ ФЕДЕРАЛЬНЫЙ ОКРУГ)» — округ берём из названия
  const fo = /\(([А-ЯЁ-]+) ФЕДЕРАЛЬНЫЙ ОКРУГ\)/.exec(fullName.toUpperCase());
  if (fo && !place.federalDistrict) place.federalDistrict = titleCase(fo[1]);
  return {
    ekpId: b.id,
    squad: b.squad,
    name: fullName,
    level: detectLevel(fullName, b.id),
    genderAge: gender.length ? joinWrapped(gender) : null,
    disciplines,
    note,
    dateFrom: dates[0] ?? "",
    dateTo: dates[1] ?? dates[0] ?? "",
    ...place,
    participants: count ? Number(count) : null,
    page: b.lines[0]?.page ?? 0,
  };
}

export function parseSection(lines: Line[]): EkpRecord[] {
  return groupRecords(lines).map(parseBlock);
}
