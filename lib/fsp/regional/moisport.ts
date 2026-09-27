import { fetchOk } from "../../http";
import { findRegion, regionByCode, regionInText } from "../../regions";
import type { Incoming } from "../../sync/merge";
import type { EventLevel, SportEvent } from "../../types";
import { disciplinesOf } from "./extract";
import type { RegionAdapter } from "./types";

// АИС «Мой спорт» (org.moisport.ru): публичный единый календарный план субъектов.
// Список — /api/v1/public-events-schedule с фильтром по виду спорта, карточка — /api/v1/public-events-schedule/<id>.

export const MOISPORT = "https://org.moisport.ru";
/** «Спортивное программирование» в /api/v1/sport-types */
export const SPORT_PROGRAMMING = 278;

export type MsListItem = {
  id: string;
  name: string;
  locationRegion: string | null;
  startDate: string;
  endDate: string;
  sportType: string;
  officialStatus: string | null;
  scheduleStatus: string | null;
  /** Complex — этап комплексного мероприятия, карточка по /complex/stages/<id> */
  structureType?: string;
};

export type MsEvent = MsListItem & {
  federation: string | null;
  type: string | null;
  /** уровень: «Спортивное соревнование субъекта РФ», «… муниципального образования» и т. п. */
  status: string | null;
  responsibleStaff: string[] | null;
  location: string | null;
  organizerPhoneNumber: string | null;
  organizerEmail: string | null;
  additionalInfo: string | null;
  description: string | null;
  cancellationReason: string | null;
};

// Всероссийские и международные — уже в ЕКП Минспорта; межрегиональные, которые проводит отделение, оставляем.
const NATIONAL = /всероссийск|международн|(чемпионат|первенств|кубо?к)\S*\s+(и\s+\S+\s+)?росси|кубк?\S*\s+федерации|чемпионат\S*\s+мира/i;
// Учебно-тренировочные мероприятия — не соревнования.
const TRAINING = /учебно-тренировочн|(?<![а-яё])утм(?![а-яё])/i;

export const eventUrl = (id: string | number) => `${MOISPORT}/public-events-schedule/${id}`;

function levelOf(e: MsEvent): EventLevel {
  const s = `${e.status ?? ""} ${e.name}`;
  return /межрегиональн/i.test(s) ? "Межрегиональные" : /муниципальн/i.test(e.status ?? "") ? "Прочее" : "Региональные";
}

// Заглушки, которые операторы АИС оставляют в полях.
const PLACEHOLDER = /^(админ|admin|тест|test|по назначению|уточняется|-+)(\s+(админ|admin))?$/i;
const real = (s: string | null | undefined) => (s && !PLACEHOLDER.test(s.trim()) ? s.trim() : null);

/** «Спортивный комплекс ЧГУ, г. Чебоксары, ул. …» → город и площадка; «г. Липецк» → город. */
export function splitLocation(loc: string | null | undefined): { city: string | null; venue: string | null } {
  const s = real(loc);
  if (!s) return { city: null, venue: null };
  const city = s.match(/(?:^|[\s,])г(?:ород|\.)\s*([А-ЯЁ][а-яё]+(?:[- ][А-ЯЁ][а-яё]+)*)/)?.[1];
  if (!/[,;]|ул\.|пр(оспект|-т)|д\.\s*\d/i.test(s)) return { city: city ?? s.replace(/^г\.\s*/, ""), venue: null };
  return { city: city ?? null, venue: s };
}

/** Контакты организатора для продаж: в note, пока у события нет отдельных полей. */
function noteOf(e: MsEvent): string | null {
  const staff = (e.responsibleStaff ?? []).map(real).filter((x): x is string => !!x);
  const parts = [
    e.status,
    staff.length ? `Ответственный: ${staff.join(", ")}` : null,
    real(e.organizerPhoneNumber) && `Тел.: ${real(e.organizerPhoneNumber)}`,
    real(e.organizerEmail) && `E-mail: ${real(e.organizerEmail)}`,
    e.officialStatus && e.officialStatus !== "Approved" ? "В плане не утверждено" : null,
    e.scheduleStatus === "Cancelled" ? `Отменено${e.cancellationReason ? `: ${e.cancellationReason}` : ""}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(". ") : null;
}

/** Карточка → запись. null — не региональное соревнование (всероссийское, УТМ). */
export function msToIncoming(e: MsEvent): Incoming | null {
  if (TRAINING.test(`${e.name} ${e.type ?? ""}`) || NATIONAL.test(e.name) || /всероссийск|международн/i.test(e.status ?? "")) return null;
  const r = findRegion(e.locationRegion) ?? regionInText(e.locationRegion) ?? regionInText(e.name);
  const text = `${e.name}\n${e.additionalInfo ?? ""}\n${e.description ?? ""}`;
  const { city, venue } = splitLocation(e.location);
  return {
    id: `region:moisport:${e.id}`,
    source: "region",
    ekpId: null,
    year: Number(e.startDate.slice(0, 4)),
    name: e.name.replace(/\s+/g, " ").trim(),
    level: levelOf(e),
    squad: null,
    genderAge: null,
    disciplines: disciplinesOf(text),
    note: noteOf(e),
    dateFrom: e.startDate,
    dateTo: e.endDate,
    country: "Россия",
    region: r?.name ?? e.locationRegion,
    regionCode: r?.code ?? null,
    federalDistrict: r?.fo ?? null,
    city,
    venue,
    isOnline: /онлайн|дистанцион/i.test(text),
    participants: null,
    organizer: e.federation?.trim() || (r ? `ФСП — ${regionByCode(r.code)?.name}` : null),
    url: eventUrl(e.id),
  };
}

function msToIncomingFromPrev(prev: SportEvent): Incoming {
  const { firstSeenAt: _a, lastSeenAt: _b, removedAt: _c, linkedId: _d, sourceId: _e, ...inc } = prev;
  return inc;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const getJson = async <T>(path: string): Promise<T> => (await (await fetchOk(`${MOISPORT}${path}`, { headers: { accept: "application/json" } }, 30_000)).json()) as T;

export type MoisportOpts = { sinceDays?: number; now?: Date; pauseMs?: number };

/**
 * Список за окно [сейчас − sinceDays, …), карточки — только новые и изменившиеся:
 * остальные записи берутся из датасета (prime), чтобы не перекачивать сотни карточек каждый синк.
 */
export function moisportAdapter(opts: MoisportOpts = {}): RegionAdapter {
  const id = "moisport";
  let since = "9999";
  let known = new Map<string, SportEvent>();
  return {
    id,
    region: null,
    url: `${MOISPORT}/public-events-schedule`,
    timeoutMs: 10 * 60_000,
    prime: (events) => {
      known = new Map(events.filter((e) => e.id.startsWith(`region:${id}:`)).map((e) => [e.id, e]));
    },
    inScope: (e) => e.id.startsWith(`region:${id}:`) && e.dateFrom >= since,
    async fetch() {
      const from = new Date((opts.now ?? new Date()).getTime() - (opts.sinceDays ?? 400) * 86_400_000).toISOString().slice(0, 10);
      const list: MsListItem[] = [];
      for (let p = 1; ; p++) {
        const page = await getJson<{ items: MsListItem[]; totalPageCount: number }>(
          `/api/v1/public-events-schedule?pageSize=100&pageNumber=${p}&searchSportTypeId=${SPORT_PROGRAMMING}&searchDateFrom=${from}`,
        );
        list.push(...page.items);
        if (p >= page.totalPageCount || !page.items.length) break;
        await sleep(opts.pauseMs ?? 1000);
      }
      if (!list.length) throw new Error("moisport: список пуст — изменился API?");
      const out: Incoming[] = [];
      const errors: string[] = [];
      for (const item of list) {
        const prev = known.get(`region:${id}:${item.id}`);
        // не изменилось с прошлого синка — карточку не качаем
        if (prev && prev.name === item.name.replace(/\s+/g, " ").trim() && prev.dateFrom === item.startDate && prev.dateTo === item.endDate) {
          out.push(msToIncomingFromPrev(prev));
          continue;
        }
        await sleep(opts.pauseMs ?? 500);
        const path = item.structureType === "Complex" ? `complex/stages/${item.id}` : item.id;
        try {
          const inc = msToIncoming({ ...item, ...(await getJson<MsEvent>(`/api/v1/public-events-schedule/${path}`)), id: String(item.id), name: item.name });
          if (inc) out.push(inc);
        } catch (e) {
          // битая карточка не валит источник: остаётся прошлая версия записи
          errors.push((e as Error).message);
          if (prev) out.push(msToIncomingFromPrev(prev));
        }
      }
      if (errors.length && errors.length === list.length) throw new Error(`moisport: все карточки с ошибкой: ${errors[0]}`);
      since = from;
      return out;
    },
  };
}
