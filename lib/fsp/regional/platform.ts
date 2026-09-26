import type { Incoming } from "../../sync/merge";
import { regionByCode, regionInText } from "../../regions";
import { disciplinesOf, FEDERAL } from "./extract";

/** Контест на платформе (foncode, caplag): уже с полями, без разбора текста. */
export type Contest = {
  /** id или slug на платформе */
  key: string;
  url: string;
  name: string;
  dateFrom: string;
  dateTo: string;
  description: string;
  isOnline: boolean;
  /** дисциплина раздела платформы, если в названии и описании её нет */
  discipline: string;
  participants?: number | null;
  /** субъект, если известен не из названия (например, по ссылке на группу отделения) */
  regionCode?: number | null;
};

// Тестовые и служебные контесты платформ.
const JUNK = /(?<![а-яё])тест|\btest\b|^\d+$/i;

const NOMINATIVE: Record<string, string> = { Кубка: "Кубок", Чемпионата: "Чемпионат", Первенства: "Первенство" };

/** Этапы одного мероприятия: «… - Отборочный этап», «Финал …», «(студенты)», «среди юношей …». */
export function stageBase(name: string): string {
  return name
    .replace(/&quot;|[«»"“”„]/g, "")
    .replace(/^(отборочный|тренировочный|финальный)\s+(этап|тур)\s+|^(финал|раунд \d+)\s+/i, "")
    .split(/\s+[-–—.]\s+(?=отбор|финал|пробн|тренир|раунд|[IV]+ тур|второй|первый|мужчины|юниоры|юноши|студенты|школьники)|\s*\((студенты|школьники)\)|\s+среди\s+(мужчин|юношей|студентов|школьников)|\s+в возрастной/i)[0]
    .replace(/^(Кубка|Чемпионата|Первенства)(?= )/, (w) => NOMINATIVE[w])
    .replace(/\s+/g, " ")
    .replace(/[\s.:,;—-]+$/, "")
    .trim();
}

const kindKey = (s: string) => stageBase(s).toLowerCase().replace(/кубка/g, "кубок").replace(/чемпионата/g, "чемпионат").replace(/первенства/g, "первенство");

/**
 * Контесты → региональные мероприятия. Отсев всероссийских и тестовых,
 * субъект — из названия (иначе из regionCode контеста), этапы склеиваются в одно мероприятие по (субъект, база названия, год).
 */
export function contestsToEvents(platform: string, contests: Contest[]): Incoming[] {
  const groups = new Map<string, { c: Contest[]; region: number }>();
  for (const c of contests) {
    if (JUNK.test(c.name) || FEDERAL.test(c.name)) continue;
    const region = regionInText(c.name)?.code ?? c.regionCode ?? null;
    if (!region) continue;
    const k = `${region}|${kindKey(c.name)}|${c.dateFrom.slice(0, 4)}`;
    const g = groups.get(k) ?? { c: [], region };
    g.c.push(c);
    groups.set(k, g);
  }
  return [...groups.values()].map(({ c, region }) => {
    const first = [...c].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom) || a.key.localeCompare(b.key))[0];
    const r = regionByCode(region);
    const text = c.map((x) => `${x.name}\n${x.description}`).join("\n");
    const dis = disciplinesOf(c.map((x) => x.name).join("\n"));
    const ds = dis.length ? dis : disciplinesOf(text).length ? disciplinesOf(text) : [first.discipline];
    const parts = c.map((x) => x.participants).filter((n): n is number => n != null);
    return {
      id: `region:${platform}:${first.key}`,
      source: "region",
      ekpId: null,
      year: Number(first.dateFrom.slice(0, 4)),
      name: stageBase(first.name),
      level: "Региональные",
      squad: null,
      genderAge: null,
      disciplines: ds,
      note: c.length > 1 ? `Этапов на ${platform}: ${c.length}` : null,
      dateFrom: c.reduce((m, x) => (x.dateFrom < m ? x.dateFrom : m), first.dateFrom),
      dateTo: c.reduce((m, x) => (x.dateTo > m ? x.dateTo : m), first.dateTo),
      country: "Россия",
      region: r?.name ?? null,
      regionCode: region,
      federalDistrict: r?.fo ?? null,
      city: null,
      venue: null,
      isOnline: c.every((x) => x.isOnline),
      participants: parts.length ? Math.max(...parts) : null,
      organizer: `ФСП — ${r?.name ?? region}`,
      url: first.url,
    } satisfies Incoming;
  });
}

const DAY = 86_400_000;

/**
 * Запись из поста уже покрыта мероприятием с платформы: тот же субъект, начало в пределах ±14 дней или пересечение дат
 * и нет расхождения по дисциплинам (хакатон рядом с CTF — разные мероприятия).
 */
export function coveredBy(e: Incoming, platform: Pick<Incoming, "regionCode" | "dateFrom" | "dateTo" | "disciplines">[]): boolean {
  return platform.some(
    (p) =>
      p.regionCode === e.regionCode &&
      (Math.abs(Date.parse(p.dateFrom) - Date.parse(e.dateFrom)) <= 14 * DAY || (p.dateFrom <= e.dateTo && e.dateFrom <= p.dateTo)) &&
      (!e.disciplines.length || e.disciplines.some((d) => p.disciplines.includes(d))),
  );
}

/** Адаптер платформы (а не канала или группы отделения). */
export const isPlatformEvent = (id: string) => /^region:(foncode|caplag):/.test(id);
