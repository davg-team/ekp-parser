import { fetchText } from "../http";

export const EKP_PAGE = "https://www.minsport.gov.ru/activity/government-regulation/edinyj-kalendarnyj-plan/";

export type Part2Doc = { url: string; year: number; asOf: string | null };

/**
 * Имена файлов части II: `II_chast_EKP_2026_15_09_26_<hash>.pdf` — год плана и дата актуализации (дд_мм_гг).
 */
export function parsePart2Links(html: string): Part2Doc[] {
  const urls = new Set<string>();
  for (const m of html.matchAll(/https?:\/\/storage\.minsport\.gov\.ru\/[^"'\s<>]+?\.pdf/gi)) {
    urls.add(m[0].replace(/^http:/, "https:"));
  }
  const docs: Part2Doc[] = [];
  for (const url of urls) {
    const name = decodeURIComponent(url.split("/").pop() ?? "");
    const m = /(?:^|_)II_chast_EKP_(\d{4})(?:_(\d{1,2})_(\d{1,2})_(\d{2,4}))?/i.exec(name);
    if (!m) continue;
    const year = Number(m[1]);
    let asOf: string | null = null;
    if (m[2]) {
      const yy = m[4].length === 2 ? `20${m[4]}` : m[4];
      asOf = `${yy}-${m[3].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    }
    docs.push({ url, year, asOf });
  }
  return docs;
}

/** Самая свежая версия части II на каждый год. */
export function latestPerYear(docs: Part2Doc[]): Part2Doc[] {
  const best = new Map<number, Part2Doc>();
  for (const d of docs) {
    const cur = best.get(d.year);
    if (!cur || (d.asOf ?? "") > (cur.asOf ?? "")) best.set(d.year, d);
  }
  return [...best.values()].sort((a, b) => b.year - a.year);
}

export async function fetchPart2Index(): Promise<Part2Doc[]> {
  return latestPerYear(parsePart2Links(await fetchText(EKP_PAGE)));
}
