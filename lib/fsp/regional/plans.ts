import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import plans from "../../../data/regional-plans.json";
import { fetchBytes } from "../../http";
import type { SourceDoc } from "../../types";
import { ocrLayout, planToEvents } from "./plan-parse";
import type { RegionAdapter } from "./types";

// Календарные планы субъектов в PDF (справочник data/regional-plans.json).
// Текст — pdftotext -layout; нет текстового слоя (скан) — OCR tesseract (rus).
// Нужны poppler-utils и tesseract-ocr-rus (в sync.yml ставятся через apt).

export type RegionalPlan = { regionCode: number; year: number; url: string; note?: string };
export const REGIONAL_PLANS = plans as RegionalPlan[];

const run = promisify(execFile);
const BIG = { maxBuffer: 256 * 1024 * 1024 };

/** Текст PDF; для сканов — OCR постранично. ocr: true — текстового слоя не было. */
export async function pdfText(pdf: Uint8Array): Promise<{ text: string; pages: number; ocr: boolean }> {
  const dir = await mkdtemp(join(tmpdir(), "plan-"));
  try {
    const file = join(dir, "plan.pdf");
    await writeFile(file, pdf);
    const pages = Number((await run("pdfinfo", [file])).stdout.match(/Pages:\s+(\d+)/)?.[1] ?? 0);
    const { stdout } = await run("pdftotext", ["-layout", file, "-"], BIG);
    // в среднем меньше 100 букв на страницу — это скан (у текстового плана тысячи)
    if ((stdout.match(/[а-яё]/gi)?.length ?? 0) >= 100 * Math.max(1, pages)) return { text: stdout, pages, ocr: false };
    await run("pdftoppm", ["-r", "300", "-gray", "-png", file, join(dir, "p")], BIG);
    const imgs = (await readdir(dir)).filter((f) => f.endsWith(".png")).sort();
    const parts: string[] = [];
    for (const img of imgs) {
      // psm 6 — единый блок: строки таблицы не рвутся; TSV — слова с координатами для раскладки по колонкам
      const base = join(dir, img.replace(/\.png$/, ""));
      await run("tesseract", [join(dir, img), base, "-l", "rus", "--psm", "6", "-c", "tessedit_create_tsv=1"], BIG);
      parts.push(ocrLayout(await readFile(`${base}.tsv`, "utf8")));
    }
    return { text: parts.join("\f"), pages, ocr: true };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Адаптер одного документа. Документ не изменился (sha256 как в прошлый раз) — записи не трогаем. */
export function planAdapter(p: RegionalPlan): RegionAdapter {
  const id = `plan-${p.regionCode}-${p.year}`;
  let prevSha: string | null = null;
  return {
    id,
    region: p.regionCode,
    url: p.url,
    // OCR сотни страниц — несколько минут; только при смене документа
    timeoutMs: 15 * 60_000,
    prime: (_events, sources?: SourceDoc[]) => {
      prevSha = sources?.find((s) => s.id === `region:${id}` && s.status === "ok")?.sha256 ?? null;
    },
    inScope: (e) => e.id.startsWith(`region:${id}:`),
    async fetch() {
      const pdf = await fetchBytes(p.url);
      const sha = createHash("sha256").update(pdf).digest("hex");
      this.sha256 = sha;
      if (sha === prevSha) return null;
      const { text } = await pdfText(pdf);
      return planToEvents(text, { regionCode: p.regionCode, year: p.year, url: p.url, key: id });
    },
  };
}
