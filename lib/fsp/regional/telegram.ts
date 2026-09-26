import { parse } from "node-html-parser";
import { fetchText } from "../../http";
import type { SportEvent } from "../../types";
import { postsToEvents } from "./extract";
import { windowScope, type Post, type RegionAdapter } from "./types";

// Публичное превью канала t.me/s/<канал>: ~20 постов на страницу, листается ?before=<№ поста>.

const decode = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

export function parseTelegramPage(html: string): Post[] {
  const root = parse(html);
  const out: Post[] = [];
  for (const m of root.querySelectorAll(".tgme_widget_message[data-post]")) {
    const post = m.getAttribute("data-post")!;
    const seq = Number(post.split("/").pop());
    const text = m.querySelector(".tgme_widget_message_text");
    const dt = m.querySelector("time[datetime]")?.getAttribute("datetime");
    if (!text || !dt || !Number.isFinite(seq) || m.classList.contains("service_message")) continue;
    out.push({ key: String(seq), seq, url: `https://t.me/${post}`, date: dt.slice(0, 10), text: decode(text.innerHTML) });
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type TelegramOpts = { pages?: number; sinceDays?: number; now?: Date };

export function telegramAdapter(channel: string, region: number, opts: TelegramOpts = {}): RegionAdapter {
  const id = `tg-${channel.toLowerCase()}`;
  let scope: (e: SportEvent) => boolean = () => false;
  return {
    id,
    region,
    url: `https://t.me/s/${channel}`,
    inScope: (e) => scope(e),
    async fetch() {
      const pages = opts.pages ?? 4;
      const since = new Date((opts.now ?? new Date()).getTime() - (opts.sinceDays ?? 365) * 86_400_000).toISOString().slice(0, 10);
      const posts: Post[] = [];
      let before: number | null = null;
      for (let i = 0; i < pages; i++) {
        const html = await fetchText(`https://t.me/s/${channel}${before ? `?before=${before}` : ""}`);
        const page = parseTelegramPage(html);
        if (!page.length && i === 0 && !/tgme_channel_info/.test(html)) throw new Error(`t.me/s/${channel}: канал не найден или закрыт`);
        posts.push(...page.filter((p) => p.date >= since));
        const min = Math.min(...page.map((p) => p.seq));
        if (!page.length || page.some((p) => p.date < since) || min <= 1 || min === before) break;
        before = min;
        await sleep(1000);
      }
      scope = windowScope(id, posts);
      return postsToEvents(id, region, posts);
    },
  };
}
