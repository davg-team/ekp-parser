"use client";

import { fromSearchParams } from "../filters/ast";
import { applyQuery } from "../filters/evaluate";
import { FIELDS, SOURCE_LABEL } from "../filters/fields";
import type { Dataset, Federation, SavedView, SportEvent } from "../types";
import { getDataset } from "./data";

// Бывшие API-роуты: те же ответы, но считаются в браузере из загруженного датасета.

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" });

export function queryEvents(ds: Dataset, params: URLSearchParams): SportEvent[] {
  const q = fromSearchParams(params);
  return applyQuery(ds.events, q.filter, q.q, q.sort, today());
}

/** Варианты значений для enum/array-полей — из фиксированного списка или из данных. */
export function fieldOptions(ds: Dataset): Record<string, string[]> {
  const t = today();
  const out: Record<string, string[]> = {};
  for (const f of FIELDS) {
    if (f.type !== "enum" && f.type !== "array") continue;
    if (f.options) {
      out[f.key] = f.options;
      continue;
    }
    const set = new Set<string>();
    for (const e of ds.events) {
      const v = f.get(e, t);
      for (const x of Array.isArray(v) ? v : [v]) if (x != null && x !== "") set.add(String(x));
    }
    out[f.key] = [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }
  return out;
}

const ROUTES: [RegExp, (ds: Dataset, m: RegExpMatchArray, p: URLSearchParams) => unknown][] = [
  [
    /^\/api\/meta$/,
    (ds) => {
      const last = [...ds.syncLog].reverse();
      return {
        options: fieldOptions(ds),
        counts: { events: ds.events.length, federations: ds.federations.length },
        lastSync: last.find((l) => l.ok)?.at ?? null,
        lastError: last.find((l) => !l.ok) ?? null,
      };
    },
  ],
  [
    /^\/api\/events$/,
    (ds, _m, p) => {
      const items = queryEvents(ds, p);
      const fed = new Map(ds.federations.map((f) => [f.regionCode, f]));
      return { total: items.length, all: ds.events.length, items: items.map((e) => ({ ...e, federation: e.regionCode ? (fed.get(e.regionCode) ?? null) : null })) };
    },
  ],
  [
    /^\/api\/events\/(.+)$/,
    (ds, m) => {
      const id = decodeURIComponent(m[1]);
      const event = ds.events.find((e) => e.id === id);
      if (!event) throw new Error("not found");
      return {
        event,
        revisions: ds.revisions.filter((r) => r.eventId === id).sort((a, b) => b.at.localeCompare(a.at)),
        federation: ds.federations.find((f) => f.regionCode && f.regionCode === event.regionCode) ?? null,
        source: ds.sources.find((s) => s.id === event.sourceId) ?? null,
        related: ds.events.filter((e) => e.linkedId === id || e.id === event.linkedId),
      };
    },
  ],
  [
    /^\/api\/federations$/,
    (ds) => {
      const t = today();
      return ds.federations.map((f) => {
        const evs = ds.events.filter((e) => e.regionCode === f.regionCode && !e.removedAt);
        return { ...f, eventsTotal: evs.length, eventsUpcoming: evs.filter((e) => e.dateTo >= t).length };
      });
    },
  ],
  [
    /^\/api\/sources$/,
    (ds) => ({
      sources: [...ds.sources].sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt)),
      syncLog: [...ds.syncLog].reverse().slice(0, 50),
      recentRevisions: [...ds.revisions]
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 100)
        .map((r) => ({ ...r, name: ds.events.find((e) => e.id === r.eventId)?.name ?? r.eventId })),
    }),
  ],
  [/^\/api\/views$/, () => listViews()],
];

export async function localApi<T>(url: string): Promise<T> {
  const u = new URL(url, "http://local");
  for (const [re, fn] of ROUTES) {
    const m = u.pathname.match(re);
    if (m) return fn(await getDataset(), m, u.searchParams) as T;
  }
  throw new Error(`${url}: неизвестный запрос`);
}

// --- представления: в localStorage браузера ---

const VIEWS = "ekp_views";

export function listViews(): SavedView[] {
  try {
    return JSON.parse(localStorage.getItem(VIEWS) ?? "[]");
  } catch {
    return [];
  }
}

export function saveView(name: string, query: string): SavedView {
  const view = { id: crypto.randomUUID(), name: name.trim().slice(0, 100), query, createdAt: new Date().toISOString() };
  localStorage.setItem(VIEWS, JSON.stringify([...listViews().filter((v) => v.name !== view.name), view]));
  return view;
}

export function deleteView(id: string) {
  localStorage.setItem(VIEWS, JSON.stringify(listViews().filter((v) => v.id !== id)));
}

// --- выгрузка CSV ---

const COLS: [string, (e: SportEvent, fed?: Federation) => unknown][] = [
  ["Источник", (e) => SOURCE_LABEL[e.source]],
  ["№ СМ в ЕКП", (e) => e.ekpId],
  ["Название", (e) => e.name],
  ["Уровень", (e) => e.level],
  ["Начало", (e) => e.dateFrom],
  ["Окончание", (e) => e.dateTo],
  ["Субъект РФ", (e) => e.region],
  ["Фед. округ", (e) => e.federalDistrict],
  ["Город", (e) => e.city],
  ["Онлайн", (e) => (e.isOnline ? "да" : "нет")],
  ["Дисциплины", (e) => e.disciplines.join("; ")],
  ["Пол / возраст", (e) => e.genderAge],
  ["Участников", (e) => e.participants],
  ["Примечание", (e) => e.note],
  ["Ссылка", (e) => e.url],
  ["Руководитель отделения ФСП", (_e, f) => f?.head],
  ["E-mail отделения ФСП", (_e, f) => f?.email],
  ["Исключено из источника", (e) => e.removedAt?.slice(0, 10)],
];

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function downloadCsv(params: URLSearchParams) {
  const ds = await getDataset();
  const fed = new Map(ds.federations.map((f) => [f.regionCode, f]));
  const items = queryEvents(ds, params);
  const rows = [COLS.map(([h]) => h), ...items.map((e) => COLS.map(([, g]) => g(e, e.regionCode ? fed.get(e.regionCode) : undefined)))];
  // BOM + «;» — чтобы Excel открыл кириллицу без мастера импорта
  const csv = "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `ekp-events-${today()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
