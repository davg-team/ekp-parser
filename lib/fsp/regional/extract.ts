import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Incoming } from "../../sync/merge";
import { regionByCode } from "../../regions";
import { findDates } from "./dates";
import { eventId, type Post } from "./types";

// Отбор постов: только про соревнования. \b в JS не работает с кириллицей — границы слов через lookaround.
const KEYWORDS = /соревновани|чемпионат|первенств|кубок|турнир|хакатон|олимпиад|контест|\bctf\b|лиг[аеиу](?![а-яё])/i;
// Всероссийские и международные анонсы, которые отделения репостят: они уже есть в ЕКП и календаре ФСП.
const FEDERAL = /(чемпионат\S*|первенств\S*|кубк?\S*)\s+(и\s+первенств\S*\s+)?росси|всероссийск|международн|кубк?\S*\s+федерации|федеральн\S+\s+округ|цифровой атом|рукод|российск\S*\s+хакатон|лидеры цифровой|чемпионат\S*\s+мира|национальн\S*\s+технологическ|межрегиональн/i;
// Признаки регионального мероприятия (ищем в названии).
const REGIONAL = /област|кра[яйе](?![а-яё])|республик|чуваш|татарстан|региональн|городск|города(?![а-яё])|муниципальн|открыт\S*\s+(турнир|кубок|чемпионат)|хакатон/i;
// Не спортивное программирование.
const OFFTOPIC = /dota|counter-strike|\bcs2?\b|киберспорт|шахмат|pinned «/i;

export const DISCIPLINES: [RegExp, string][] = [
  [/алгоритм/i, "ПРОГРАММИРОВАНИЕ АЛГОРИТМИЧЕСКОЕ"],
  [/продуктов|хакатон/i, "ПРОГРАММИРОВАНИЕ ПРОДУКТОВОЕ"],
  [/информационной безопасност|\bctf\b|кибербез/i, "ПРОГРАММИРОВАНИЕ СИСТЕМ ИНФОРМАЦИОННОЙ БЕЗОПАСНОСТИ"],
  [/беспилотн|(?<![а-яё])бас(?![а-яё])|дрон/i, "ПРОГРАММИРОВАНИЕ БЕСПИЛОТНЫХ АВИАЦИОННЫХ СИСТЕМ"],
  [/робот/i, "ПРОГРАММИРОВАНИЕ РОБОТОТЕХНИКИ"],
  [/искусственного интеллекта|(?<![а-яё])ии(?![а-яё])|машинн\S+ обучен/i, "ПРОГРАММИРОВАНИЕ СИСТЕМ ИСКУССТВЕННОГО ИНТЕЛЛЕКТА"],
];

export const disciplinesOf = (s: string) => DISCIPLINES.filter(([re]) => re.test(s)).map(([, d]) => d);

/** Мероприятие, извлечённое из поста (правилами или LLM). */
export type Extracted = {
  name: string;
  dateFrom: string;
  dateTo: string;
  city: string | null;
  venue: string | null;
  isOnline: boolean;
  disciplines: string[];
  organizer: string | null;
};

export function isCandidate(p: Post): boolean {
  return KEYWORDS.test(p.text) && findDates(p.text, p.date).length > 0;
}

/** Строка с ключевым словом среди первых трёх — название (без эмодзи и хвостовой пунктуации); нет такой — null. */
export function titleOf(text: string): string | null {
  const line = text
    .split("\n")
    .map((l) => l.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\u{FE0F}\u{200D}*]|(?<!\S)#\S+/gu, "").replace(/\s+/g, " ").trim())
    .filter((l) => l.length >= 8)
    // заголовок анонса — в первых строках; ключевое слово глубже в тексте — не анонс
    .slice(0, 3)
    .find((l) => KEYWORDS.test(l));
  return line ? line.slice(0, 200).replace(/[\s.:!,;—-]+$/, "") : null;
}

const within = (a: string, b: string, days: number) => Math.abs(Date.parse(a) - Date.parse(b)) <= days * 86_400_000;

/** Извлечение правилами: одно мероприятие на пост, первая дата в тексте. */
export function extractByRules(p: Post): Extracted[] {
  const name = titleOf(p.text);
  if (!name || OFFTOPIC.test(p.text)) return [];
  // всероссийское в названии — репост; в тексте — только если название не региональное
  if (FEDERAL.test(name) || (FEDERAL.test(p.text) && !REGIONAL.test(name))) return [];
  const d = findDates(p.text, p.date).find((x) => within(x.dateFrom, p.date, 400));
  if (!d) return [];
  return [
    {
      name,
      dateFrom: d.dateFrom,
      dateTo: d.dateTo,
      city: null,
      venue: null,
      isOnline: /онлайн|online|дистанционн/i.test(p.text),
      disciplines: disciplinesOf(p.text),
      organizer: null,
    },
  ];
}

// --- LLM ---

export const LLM_MODEL = "claude-haiku-4-5-20251001";

const Schema = z.object({
  events: z.array(
    z.object({
      name: z.string(),
      dateFrom: z.string().describe("YYYY-MM-DD"),
      dateTo: z.string().describe("YYYY-MM-DD"),
      city: z.string().nullable(),
      venue: z.string().nullable(),
      isOnline: z.boolean(),
      scope: z.enum(["regional", "federal", "other"]),
      disciplines: z.array(z.string()),
      organizer: z.string().nullable(),
    }),
  ),
});

const SYSTEM = `Ты извлекаешь спортивные мероприятия из постов регионального отделения Федерации спортивного программирования.
Верни мероприятия (соревнования, хакатоны, олимпиады, турниры, лиги), у которых в посте есть конкретные даты проведения.
scope:
- "regional" — проводит или соорганизует региональное отделение, либо мероприятие уровня субъекта, города, вуза в этом регионе (чемпионат области, кубок края, городской хакатон, открытый турнир);
- "federal" — всероссийские и международные мероприятия, Чемпионаты/Кубки/Первенства России, чемпионаты федеральных округов, Кубок Федерации, их отборочные этапы;
- "other" — не соревнование (лекция, поздравление, итоги без дат, реклама).
Даты — даты проведения, а не регистрации. Год не указан — выбери ближайший к дате поста.
Дисциплины — из списка: ${DISCIPLINES.map(([, d]) => d).join("; ")}.
Название — короткое официальное название мероприятия, без эмодзи. Нет мероприятий — пустой массив.`;

let client: Anthropic | null = null;

export const llmEnabled = () => !!process.env.ANTHROPIC_API_KEY;

/** Извлечение через Claude; оставляем только региональные мероприятия. */
export async function extractByLlm(p: Post, regionName: string): Promise<Extracted[]> {
  client ??= new Anthropic({ timeout: 30_000, maxRetries: 1 });
  const res = await client.messages.parse({
    model: LLM_MODEL,
    max_tokens: 2000,
    system: SYSTEM,
    messages: [{ role: "user", content: `Регион отделения: ${regionName}\nДата поста: ${p.date}\n\n${p.text}` }],
    output_config: { format: zodOutputFormat(Schema) },
  });
  const events = res.parsed_output?.events ?? [];
  const known = new Set(DISCIPLINES.map(([, d]) => d));
  return events
    .filter((e) => e.scope === "regional" && /^\d{4}-\d{2}-\d{2}$/.test(e.dateFrom) && /^\d{4}-\d{2}-\d{2}$/.test(e.dateTo))
    .map(({ scope: _s, ...e }) => ({
      ...e,
      dateTo: e.dateTo < e.dateFrom ? e.dateFrom : e.dateTo,
      disciplines: e.disciplines.map((d) => d.toUpperCase()).filter((d) => known.has(d)),
    }));
}

/** Кэш извлечения: ключ поста → хэш текста и результат (чтобы не звать LLM на каждый синк). */
export type ExtractCache = Record<string, { h: string; by: "llm"; events: Extracted[] }>;

export function textHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

export type ExtractOpts = { cache?: ExtractCache; llm?: boolean; maxLlmCalls?: number };

/** Посты → записи. LLM — если есть ключ; ошибка LLM по посту — откат к правилам. */
export async function postsToEvents(adapter: string, regionCode: number, posts: Post[], opts: ExtractOpts = {}): Promise<Incoming[]> {
  const region = regionByCode(regionCode);
  const useLlm = opts.llm ?? llmEnabled();
  let calls = opts.maxLlmCalls ?? 40;
  const out: Incoming[] = [];
  const seenDates = new Set<string>();
  // старые посты первыми: запись привязывается к первому анонсу, итоги и повторы склеиваются
  for (const p of [...posts].sort((a, b) => a.seq - b.seq)) {
    if (!isCandidate(p)) continue;
    const ck = `${adapter}:${p.key}`;
    const h = textHash(p.text);
    const cached = opts.cache?.[ck];
    let evs: Extracted[];
    let by: "llm" | "rules" = "rules";
    // результат правил не кэшируем: они дешёвые и меняются вместе с кодом
    if (cached && cached.h === h && cached.by === "llm") {
      evs = cached.events;
      by = cached.by;
    } else if (useLlm && calls > 0) {
      calls--;
      try {
        evs = await extractByLlm(p, region?.name ?? String(regionCode));
        by = "llm";
      } catch {
        evs = extractByRules(p);
      }
    } else {
      evs = extractByRules(p);
    }
    if (opts.cache && by === "llm") opts.cache[ck] = { h, by, events: evs };
    evs.forEach((e, i) => {
      const k = `${e.dateFrom}/${e.dateTo}`;
      if (seenDates.has(k)) return;
      seenDates.add(k);
      out.push(toIncoming(adapter, regionCode, p, e, i));
    });
  }
  return out;
}

export function toIncoming(adapter: string, regionCode: number, p: Post, e: Extracted, n: number): Incoming {
  const region = regionByCode(regionCode);
  return {
    id: eventId(adapter, p.key, n),
    source: "region",
    ekpId: null,
    year: Number(e.dateFrom.slice(0, 4)),
    name: e.name,
    level: "Региональные",
    squad: null,
    genderAge: null,
    disciplines: e.disciplines,
    note: null,
    dateFrom: e.dateFrom,
    dateTo: e.dateTo,
    country: "Россия",
    region: region?.name ?? null,
    regionCode,
    federalDistrict: region?.fo ?? null,
    city: e.city,
    venue: e.venue,
    isOnline: e.isOnline,
    participants: null,
    organizer: e.organizer ?? `ФСП — ${region?.name ?? regionCode}`,
    url: p.url,
  };
}
