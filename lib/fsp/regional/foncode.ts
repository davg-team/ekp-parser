import { parse } from "node-html-parser";
import { fetchText } from "../../http";
import type { SportEvent } from "../../types";
import { contestsToEvents, type Contest } from "./platform";
import type { RegionAdapter } from "./types";

// foncode.ru — платформа, на которой отделения ФСП проводят региональные соревнования по алгоритмике и ИБ.
// Список контестов отдаётся сервером, ~13 на страницу, новые сверху; листается ?page=N.

export const FONCODE = "https://foncode.ru";
const SECTIONS: [string, string][] = [
  ["contests", "ПРОГРАММИРОВАНИЕ АЛГОРИТМИЧЕСКОЕ"],
  ["securities", "ПРОГРАММИРОВАНИЕ СИСТЕМ ИНФОРМАЦИОННОЙ БЕЗОПАСНОСТИ"],
];

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

export function parseFoncodePage(html: string, discipline: string): Contest[] {
  const out: Contest[] = [];
  for (const b of parse(html).querySelectorAll(".contests__tab-block")) {
    const a = b.querySelector(".contests__tab-block-top a[href*='/contests/']");
    const key = a?.getAttribute("href")?.match(/\/contests\/(\d+)/)?.[1];
    const cells = b.querySelectorAll(".contests__tab-block-top > .contests__tab-block-cell");
    const d = cells[1]?.text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (!a || !key || !d) continue;
    const date = `${d[3]}-${d[2]}-${d[1]}`;
    out.push({
      key,
      url: `${FONCODE}/contests/${key}`,
      name: clean(a.text),
      dateFrom: date,
      dateTo: date,
      description: clean(b.querySelector(".contests__tab-block-bottom")?.text ?? ""),
      isOnline: true,
      discipline,
    });
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type FoncodeOpts = { sinceDays?: number; maxPages?: number; now?: Date };

/** Все разделы за последний год (по умолчанию); записи раньше просмотренного окна не трогаем. */
export function foncodeAdapter(opts: FoncodeOpts = {}): RegionAdapter {
  const id = "foncode";
  let since = "9999";
  return {
    id,
    region: null,
    url: `${FONCODE}/contests`,
    inScope: (e: SportEvent) => e.id.startsWith(`region:${id}:`) && e.dateFrom >= since,
    async fetch() {
      const from = new Date((opts.now ?? new Date()).getTime() - (opts.sinceDays ?? 400) * 86_400_000).toISOString().slice(0, 10);
      const all: Contest[] = [];
      for (const [path, discipline] of SECTIONS) {
        for (let p = 1; p <= (opts.maxPages ?? 15); p++) {
          const page = parseFoncodePage(await fetchText(`${FONCODE}/${path}?page=${p}`), discipline);
          if (p === 1 && path === "contests" && !page.length) throw new Error("foncode: на первой странице нет контестов — вёрстка изменилась?");
          all.push(...page.filter((c) => c.dateFrom >= from));
          await sleep(1000);
          if (!page.length || page.some((c) => c.dateFrom < from)) break;
        }
      }
      since = from;
      return contestsToEvents(id, all);
    },
  };
}
