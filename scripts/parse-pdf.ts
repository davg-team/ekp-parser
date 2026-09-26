// Отладка: pnpm tsx scripts/parse-pdf.ts <file.pdf> [ВИД СПОРТА]
import { readFileSync } from "node:fs";
import { extractSection } from "../lib/ekp/pdfExtract";
import { parseSection } from "../lib/ekp/parseSection";

const [file, sport = "СПОРТИВНОЕ ПРОГРАММИРОВАНИЕ"] = process.argv.slice(2);
const t0 = Date.now();
const scan = await extractSection(new Uint8Array(readFileSync(file)), sport);
const recs = parseSection(scan.lines);
console.error(`pages ${scan.pages?.join("-")} of ${scan.totalPages}, ${recs.length} records, ${Date.now() - t0}ms`);
console.log(JSON.stringify(recs, null, 2));
