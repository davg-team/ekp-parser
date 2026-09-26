import type { Incoming } from "../../sync/merge";
import { regionByCode, regionInText } from "../../regions";
import { findDates } from "./dates";
import { eventId, type Post } from "./types";

// Отбор постов: только про соревнования. \b в JS не работает с кириллицей — границы слов через lookaround.
const KEYWORDS = /соревновани|чемпионат|первенств|кубок|турнир|хакатон|олимпиад|контест|\bctf\b|лиг[аеиу](?![а-яё])/i;
// Всероссийские и международные анонсы, которые отделения репостят: они уже есть в ЕКП и календаре ФСП.
export const FEDERAL = /(чемпионат\S*|первенств\S*|кубк?\S*)\s+(и\s+первенств\S*\s+)?росси|всероссийск|международн|кубк?\S*\s+федерации|федеральн\S+\s+округ|цифровой атом|рукод|российск\S*\s+хакатон|лидеры цифровой|чемпионат\S*\s+мира|национальн\S*\s+технологическ|межрегиональн/i;
// Признаки регионального мероприятия (ищем в названии).
const REGIONAL = /област|кра[яйе](?![а-яё])|республик|чуваш|татарстан|региональн|городск|города(?![а-яё])|муниципальн|открыт\S*\s+(турнир|кубок|чемпионат)|хакатон/i;
// Соревнования на платформах берём из их адаптеров (foncode.ts, caplag.ts), посты о них — анонсы и репосты.
const PLATFORM = /caplag|foncode/i;
// Пост с итогами уже прошедшего мероприятия.
const RESULTS = /^(результат|итог|определены|подвели|поздравляем|завершил|прош[её]л|состоял)/i;
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

/** Мероприятие, извлечённое из поста. */
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
    // заголовок анонса — в первых строках; ключевое слово глубже в тексте или в конце длинного абзаца — не анонс
    .slice(0, 3)
    .find((l) => {
      const i = l.search(KEYWORDS);
      return i >= 0 && i < 120;
    });
  return line ? line.slice(0, 200).replace(/[\s.:!,;—-]+$/, "") : null;
}

const within = (a: string, b: string, days: number) => Math.abs(Date.parse(a) - Date.parse(b)) <= days * 86_400_000;

/** Извлечение правилами: одно мероприятие на пост, первая дата в тексте. regionCode — субъект канала. */
export function extractByRules(p: Post, regionCode?: number): Extracted[] {
  const name = titleOf(p.text);
  if (!name || OFFTOPIC.test(p.text) || PLATFORM.test(p.text)) return [];
  // в названии другой субъект — репост соседей
  const named = regionInText(name);
  if (regionCode && named && named.code !== regionCode) return [];
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

/** Посты → записи. Повторы внутри источника (анонс, итоги) склеиваются по датам и дисциплинам. */
export function postsToEvents(adapter: string, regionCode: number, posts: Post[]): Incoming[] {
  const out: Incoming[] = [];
  // старые посты первыми: запись привязывается к первому анонсу
  for (const p of [...posts].sort((a, b) => a.seq - b.seq)) {
    extractByRules(p, regionCode).forEach((e, i) => {
      // итоги — не новое мероприятие; повтор анонса — начало в пределах 3 дней при тех же дисциплинах
      if (RESULTS.test(e.name)) return;
      const dup = out.some(
        (x) => within(x.dateFrom, e.dateFrom, 3) && (!x.disciplines.length || !e.disciplines.length || x.disciplines.some((d) => e.disciplines.includes(d))),
      );
      if (dup) return;
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
