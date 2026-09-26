import { parse, type HTMLElement } from "node-html-parser";
import { detectLevel } from "../ekp/parseSection";
import { fetchText } from "../http";
import { findRegion } from "../regions";
import type { Incoming } from "../sync/merge";
import { FSP_BASE } from "./regions";

export type FspCard = {
  slug: string;
  url: string;
  title: string;
  date: string | null; // YYYY-MM-DD
  format: string | null; // Онлайн / Оффлайн
  location: string | null;
  disciplines: string[];
  participants: string | null;
};

export type FspDetail = { dateFrom: string | null; dateTo: string | null; format: string | null; city: string | null };

const clean = (s: string | undefined | null) => (s ?? "").replace(/\s+/g, " ").trim();
const iso = (d: string) => {
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(d);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

/** Карточки мероприятий на странице месяца календаря. Одно мероприятие может встречаться в нескольких днях. */
export function parseCalendarPage(html: string): FspCard[] {
  const root = parse(html);
  const cards = new Map<string, FspCard>();
  for (const a of root.querySelectorAll(".button a")) {
    const href = a.getAttribute("href") ?? "";
    const m = /^\/calendar\/([^/?#]+)\/?$/.exec(href);
    if (!m || m[1] === "archive" || cards.has(m[1])) continue;
    // поднимаемся до контейнера карточки — первого предка, где есть блок .discipline
    let card: HTMLElement | null = a.parentNode;
    while (card && !card.querySelector(".discipline")) card = card.parentNode;
    if (!card) continue;
    const texts = (sel: string) => card!.querySelectorAll(sel).map((n) => clean(n.text));
    const title =
      clean(card.querySelector(".title p, .title h3, .title h4, h3, h4")?.text) ||
      texts("p").find((t) => t.length > 15 && !/\d{2}\.\d{2}\.\d{4}/.test(t)) ||
      m[1];
    const dateText = texts("p").find((t) => /^\d{2}\.\d{2}\.\d{4}$/.test(t));
    const dis: Record<string, string> = {};
    for (const d of card.querySelectorAll(".discipline .dis")) {
      dis[clean(d.querySelector(".name")?.text)] = clean(d.querySelector(".info")?.text);
    }
    cards.set(m[1], {
      slug: m[1],
      url: new URL(href, FSP_BASE).toString(),
      title,
      date: dateText ? iso(dateText) : null,
      format: clean(card.querySelector(".online p")?.text) || null,
      location: clean(card.querySelector(".location p")?.text) || null,
      disciplines: (dis["Дисциплина"] ?? dis["Дисциплины"] ?? "")
        .split(/,\s*/)
        .map((s) => s.trim())
        .filter(Boolean),
      participants: dis["Участники"] || null,
    });
  }
  return [...cards.values()];
}

/** Страница мероприятия: «11.09.2026-17.09.2026», формат, город. */
export function parseEventDetail(html: string): FspDetail {
  const root = parse(html);
  const detail = root.querySelector(".row.detail") ?? root;
  const dateText = clean(detail.querySelector(".item_cal.date")?.text);
  const [a, b] = dateText.split(/\s*-\s*/);
  const format = clean(detail.querySelector(".item_cal.hybrid, .item_cal.online")?.text) || null;
  const city = clean(detail.querySelector(".item_cal.city")?.text) || null;
  return { dateFrom: a ? iso(a) : null, dateTo: iso(b ?? a ?? ""), format, city };
}

export function calendarUrl(year: number, month: number) {
  return `${FSP_BASE}/calendar/?month=${String(month).padStart(2, "0")}&year=${year}`;
}

export function cardToEvent(c: FspCard, d: FspDetail | null): Incoming | null {
  const dateFrom = d?.dateFrom ?? c.date;
  if (!dateFrom) return null;
  const dateTo = d?.dateTo ?? dateFrom;
  const format = (d?.format ?? c.format ?? "").toLowerCase();
  const loc = c.location ?? "";
  const isOnline = /онлайн/.test(format) || /по месту нахождения/i.test(loc);
  const region = findRegion(loc) ?? findRegion(d?.city);
  const vague = /по месту нахождения|по всей росси|определяется|по назначению/i;
  const city = d?.city && !/по месту нахождения|по всей россии|определяется/i.test(d.city) ? d.city.replace(/^г\.\s*/, "") : null;
  return {
    id: `fsp:${c.slug}`,
    source: "fsp",
    ekpId: null,
    year: Number(dateFrom.slice(0, 4)),
    name: c.title,
    level: detectLevel(c.title) === "Прочее" ? "Прочее" : detectLevel(c.title),
    squad: null,
    genderAge: c.participants,
    disciplines: c.disciplines.map((s) => s.toUpperCase()),
    note: /гибрид/.test(format) ? "Гибридный формат" : null,
    dateFrom,
    dateTo,
    country: "Россия",
    region: region?.name ?? (loc && !isOnline && !vague.test(loc) ? loc : null),
    regionCode: region?.code ?? null,
    federalDistrict: region?.fo ?? null,
    city,
    venue: null,
    isOnline,
    participants: null,
    organizer: "ФСП России",
    url: c.url,
  };
}

/** Пробегает месяцы [from, to] и собирает мероприятия с деталями. */
export async function fetchFspCalendar(fromMonths = -12, toMonths = 12, now = new Date()): Promise<Incoming[]> {
  const cards = new Map<string, FspCard>();
  for (let k = fromMonths; k <= toMonths; k++) {
    const d = new Date(now.getFullYear(), now.getMonth() + k, 1);
    const html = await fetchText(calendarUrl(d.getFullYear(), d.getMonth() + 1));
    for (const c of parseCalendarPage(html)) if (!cards.has(c.slug)) cards.set(c.slug, c);
  }
  const out: Incoming[] = [];
  for (const c of cards.values()) {
    let detail: FspDetail | null = null;
    try {
      detail = parseEventDetail(await fetchText(c.url));
    } catch {
      // без деталей — берём дату из карточки
    }
    const ev = cardToEvent(c, detail);
    if (ev) out.push(ev);
  }
  return out;
}
