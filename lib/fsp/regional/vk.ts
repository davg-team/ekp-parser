import { fetchOk } from "../../http";
import type { SportEvent } from "../../types";
import { postsToEvents, type ExtractOpts } from "./extract";
import { windowScope, type Post, type RegionAdapter } from "./types";

// VK API: сервисный ключ приложения (VK_SERVICE_TOKEN) читает стены открытых групп.
const API = "https://api.vk.com/method";
const V = "5.199";

export const vkEnabled = () => !!process.env.VK_SERVICE_TOKEN;

type VkGroup = { id: number; name: string; screen_name: string; is_closed: number };
type VkPost = { id: number; date: number; text: string; is_pinned?: number; copy_history?: { text: string }[] };

async function call<T>(method: string, params: Record<string, string>): Promise<T> {
  const q = new URLSearchParams({ ...params, access_token: process.env.VK_SERVICE_TOKEN ?? "", v: V, lang: "ru" });
  const json = (await (await fetchOk(`${API}/${method}?${q}`, {}, 30_000)).json()) as { response?: T; error?: { error_msg: string } };
  if (json.error) throw new Error(`VK ${method}: ${json.error.error_msg}`);
  return json.response as T;
}

// Имена групп-кандидатов подобраны перебором — проверяем, что это действительно ФСП.
export const isFspGroup = (name: string) => /программир|(?<![а-яё])фсп(?![а-яё])|\bfsp\b/i.test(name);

const mskDate = (unix: number) => new Date((unix + 3 * 3600) * 1000).toISOString().slice(0, 10);

export function parseVkWall(groupId: number, items: VkPost[]): Post[] {
  return items
    .filter((p) => !p.is_pinned)
    .map((p) => ({
      key: String(p.id),
      seq: p.id,
      url: `https://vk.com/wall-${groupId}_${p.id}`,
      date: mskDate(p.date),
      // чистый репост — берём текст оригинала
      text: (p.text || p.copy_history?.[0]?.text || "").trim(),
    }))
    .filter((p) => p.text);
}

export function vkAdapter(screenName: string, region: number, opts: ExtractOpts & { count?: number } = {}): RegionAdapter {
  const id = `vk-${screenName.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;
  let scope: (e: SportEvent) => boolean = () => false;
  return {
    id,
    region,
    url: `https://vk.com/${screenName}`,
    inScope: (e) => scope(e),
    async fetch() {
      if (!vkEnabled()) throw new Error("не задан VK_SERVICE_TOKEN");
      const res = await call<{ groups: VkGroup[] } | VkGroup[]>("groups.getById", { group_id: screenName });
      const g = Array.isArray(res) ? res[0] : res.groups[0];
      if (!g) throw new Error(`vk.com/${screenName}: группа не найдена`);
      if (!isFspGroup(g.name)) throw new Error(`vk.com/${screenName}: «${g.name}» — не группа ФСП`);
      if (g.is_closed) throw new Error(`vk.com/${screenName}: закрытая группа`);
      const wall = await call<{ items: VkPost[] }>("wall.get", { owner_id: String(-g.id), count: String(opts.count ?? 100) });
      const posts = parseVkWall(g.id, wall.items);
      scope = windowScope(id, posts);
      return postsToEvents(id, region, posts, opts);
    },
  };
}
