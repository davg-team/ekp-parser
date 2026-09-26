import { parse } from "node-html-parser";
import { fetchText } from "../../http";
import type { SportEvent } from "../../types";
import { contestsToEvents, type Contest } from "./platform";
import type { RegionAdapter } from "./types";

// caplag.ru — CTF-платформа, на ней отделения ФСП проводят региональные соревнования по ИБ.
// Список на /competitions (все за всё время), на странице соревнования — JSON-LD schema.org/Event.

export const CAPLAG = "https://caplag.ru";
const IB = "ПРОГРАММИРОВАНИЕ СИСТЕМ ИНФОРМАЦИОННОЙ БЕЗОПАСНОСТИ";

export function parseCaplagList(html: string): string[] {
  const slugs = parse(html)
    .querySelectorAll("a[href^='/competitions/']")
    .map((a) => a.getAttribute("href")!.split("/")[2])
    .filter(Boolean);
  return [...new Set(slugs)];
}

/** Страница соревнования → контест. Субъект — по ссылке на группу отделения (vk/t.me) из справочника. */
export function parseCaplagPage(html: string, slug: string, groups: Map<string, number>): Contest | null {
  const root = parse(html);
  const ld = root.querySelectorAll("script[type='application/ld+json']").map((s) => {
    try {
      return JSON.parse(s.text);
    } catch {
      return null;
    }
  });
  const ev = ld.find((x) => x?.["@type"] === "Event");
  if (!ev?.startDate) return null;
  const links = root.querySelectorAll("a[href]").map((a) => a.getAttribute("href")!);
  const group = links.map((u) => u.match(/(?:vk\.(?:com|ru)|t\.me)\/([\w.]+)/i)?.[1]?.toLowerCase()).find((g) => g && groups.has(g));
  const text = root.text.replace(/\s+/g, " ");
  // число участников — последнее число в блоке перед ссылкой на таблицу лидеров
  const n = html.match(/<span class="r-16">(\d+)<\/span>(?:<\/div>|<\/section>)*<div class="_competition__results/)?.[1];
  return {
    key: slug,
    url: `${CAPLAG}/competitions/${slug}`,
    name: String(ev.name).trim(),
    dateFrom: String(ev.startDate).slice(0, 10),
    dateTo: String(ev.endDate ?? ev.startDate).slice(0, 10),
    description: String(ev.description ?? ""),
    isOnline: !/офлайн|очн(ый|ое) формат/i.test(text.split("Описание")[0] ?? ""),
    discipline: IB,
    participants: n ? Number(n) : null,
    regionCode: group ? groups.get(group) : null,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function caplagAdapter(groups: Map<string, number>): RegionAdapter {
  const id = "caplag";
  return {
    id,
    region: null,
    url: `${CAPLAG}/competitions`,
    // список полный — пропавшее с платформы снимаем
    inScope: (e: SportEvent) => e.id.startsWith(`region:${id}:`),
    async fetch() {
      const slugs = parseCaplagList(await fetchText(`${CAPLAG}/competitions`));
      if (!slugs.length) throw new Error("caplag: список соревнований пуст — вёрстка изменилась?");
      const contests: Contest[] = [];
      for (const s of slugs) {
        await sleep(1000);
        const c = parseCaplagPage(await fetchText(`${CAPLAG}/competitions/${s}`), s, groups);
        if (c) contests.push(c);
      }
      return contestsToEvents(id, contests);
    },
  };
}
