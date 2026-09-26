import { createHash } from "node:crypto";
import { extractSection } from "../ekp/pdfExtract";
import { fetchPart2Index, type Part2Doc } from "../ekp/fetchIndex";
import { parseSection, type EkpRecord } from "../ekp/parseSection";
import { fetchBytes } from "../http";
import { mutate } from "../store";
import type { SourceDoc } from "../types";
import { linkEvents } from "./link";
import { mergeSnapshot, type Incoming, type MergeStats } from "./merge";

export const SPORT = "СПОРТИВНОЕ ПРОГРАММИРОВАНИЕ";

export function recordToEvent(r: EkpRecord, year: number): Incoming {
  return {
    id: `ekp:${r.ekpId}`,
    source: "ekp",
    ekpId: r.ekpId,
    year,
    name: r.name,
    level: r.level,
    squad: r.squad,
    genderAge: r.genderAge,
    disciplines: r.disciplines,
    note: r.note,
    dateFrom: r.dateFrom,
    dateTo: r.dateTo,
    country: r.country,
    region: r.region,
    regionCode: r.regionCode,
    federalDistrict: r.federalDistrict,
    city: r.city,
    venue: r.venue,
    isOnline: r.isOnline,
    participants: r.participants,
    organizer: null,
    url: null,
  };
}

export async function parsePart2(data: Uint8Array) {
  const scan = await extractSection(data, SPORT);
  if (!scan.pages) throw new Error(`раздел «${SPORT}» не найден (${scan.totalPages} стр.)`);
  const records = parseSection(scan.lines);
  if (!records.length) throw new Error(`раздел найден на стр. ${scan.pages.join("–")}, но записей нет`);
  const bad = records.filter((r) => !r.dateFrom || !r.name);
  if (bad.length) throw new Error(`не разобраны даты/названия: ${bad.map((r) => r.ekpId).join(", ")}`);
  return { records, pages: scan.pages };
}

export type EkpSyncResult = { doc: Part2Doc; skipped: boolean; stats?: MergeStats; error?: string };

/**
 * Проверяет страницу ЕКП; новые версии части II (по URL) скачивает, парсит и сливает.
 * minYear — не трогать старые годы.
 */
export async function syncEkp(opts: { force?: boolean; minYear?: number } = {}): Promise<EkpSyncResult[]> {
  const minYear = opts.minYear ?? new Date().getFullYear() - 2;
  const docs = (await fetchPart2Index()).filter((d) => d.year >= minYear);
  if (!docs.length) throw new Error("на странице ЕКП не найдено ни одной части II");
  const results: EkpSyncResult[] = [];
  const known = await mutate((ds) => new Set(ds.sources.filter((s) => s.status === "ok").map((s) => s.url)));

  for (const doc of docs) {
    if (!opts.force && known.has(doc.url)) {
      results.push({ doc, skipped: true });
      continue;
    }
    const fetchedAt = new Date().toISOString();
    const source: SourceDoc = {
      id: `ekp-part2:${doc.year}:${doc.asOf ?? fetchedAt}`,
      kind: "ekp-part2",
      url: doc.url,
      year: doc.year,
      asOf: doc.asOf,
      sha256: null,
      fetchedAt,
      status: "ok",
      error: null,
      eventsCount: null,
    };
    try {
      const bytes = await fetchBytes(doc.url);
      source.sha256 = createHash("sha256").update(bytes).digest("hex");
      const { records } = await parsePart2(bytes);
      source.eventsCount = records.length;
      const incoming = records.map((r) => recordToEvent(r, doc.year));
      const stats = await mutate((ds) => {
        const st = mergeSnapshot(ds, incoming, (e) => e.source === "ekp" && e.year === doc.year, source.id, fetchedAt);
        ds.sources = ds.sources.filter((s) => s.id !== source.id);
        ds.sources.push(source);
        linkEvents(ds);
        return st;
      });
      results.push({ doc, skipped: false, stats });
    } catch (e) {
      source.status = "error";
      source.error = (e as Error).message;
      await mutate((ds) => {
        ds.sources = ds.sources.filter((s) => s.id !== source.id);
        ds.sources.push(source);
      });
      results.push({ doc, skipped: false, error: source.error });
    }
  }
  return results;
}
