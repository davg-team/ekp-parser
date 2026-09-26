import sources from "../../../data/regional-sources.json";
import type { Federation } from "../../types";
import { caplagAdapter } from "./caplag";
import { foncodeAdapter } from "./foncode";
import { telegramAdapter } from "./telegram";
import type { RegionAdapter } from "./types";
import { vkAdapter, vkEnabled } from "./vk";

/** Ручной справочник ресурсов отделений (см. docs/regional-sources.md). */
export type RegionalSource = { regionCode: number; site: string | null; telegram: string[]; vk: string[]; inactive?: string[] };

export const REGIONAL_SOURCES = sources as RegionalSource[];

/** Сайт и соцсети отделений из справочника → Federation. */
export function withSources(feds: Federation[], list = REGIONAL_SOURCES): Federation[] {
  const by = new Map(list.map((s) => [s.regionCode, s]));
  return feds.map((f) => {
    const s = f.regionCode != null ? by.get(f.regionCode) : undefined;
    if (!s) return f;
    const socials = [...s.telegram.map((c) => `https://t.me/${c}`), ...s.vk.map((v) => `https://vk.com/${v}`)];
    return { ...f, site: f.site ?? s.site, socials: [...new Set([...f.socials, ...socials])] };
  });
}

/** Имя канала или группы отделения → код субъекта. */
export function groupRegions(list = REGIONAL_SOURCES): Map<string, number> {
  return new Map(list.flatMap((s) => [...s.telegram, ...s.vk].map((g): [string, number] => [g.toLowerCase(), s.regionCode])));
}

/** Адаптеры: сначала платформы (foncode, caplag), затем Telegram, VK — при наличии VK_SERVICE_TOKEN. */
export function buildAdapters(list = REGIONAL_SOURCES): RegionAdapter[] {
  const out: RegionAdapter[] = [foncodeAdapter(), caplagAdapter(groupRegions(list))];
  for (const s of list) {
    for (const c of s.telegram) out.push(telegramAdapter(c, s.regionCode));
    if (vkEnabled()) for (const v of s.vk) out.push(vkAdapter(v, s.regionCode));
  }
  return out;
}

export type { RegionAdapter } from "./types";
