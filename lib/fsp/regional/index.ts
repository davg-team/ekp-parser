import sources from "../../../data/regional-sources.json";
import type { Federation } from "../../types";
import type { ExtractOpts } from "./extract";
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

/** Адаптеры: Telegram — всегда, VK — при наличии VK_SERVICE_TOKEN. */
export function buildAdapters(opts: ExtractOpts = {}, list = REGIONAL_SOURCES): RegionAdapter[] {
  const out: RegionAdapter[] = [];
  for (const s of list) {
    for (const c of s.telegram) out.push(telegramAdapter(c, s.regionCode, opts));
    if (vkEnabled()) for (const v of s.vk) out.push(vkAdapter(v, s.regionCode, opts));
  }
  return out;
}

export type { RegionAdapter } from "./types";
