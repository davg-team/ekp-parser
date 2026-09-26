import type { ExtractCache } from "./fsp/regional/extract";

export type EventSource = "ekp" | "fsp" | "region";

export type EventLevel =
  | "Чемпионат России"
  | "Кубок России"
  | "Первенство России"
  | "Всероссийские"
  | "Межрегиональные"
  | "Чемпионат ФО"
  | "Первенство ФО"
  | "Международные"
  | "УТМ"
  | "Региональные"
  | "Прочее";

export type SportEvent = {
  /** ekp:<№ СМ>, fsp:<id на сайте ФСП> или region:<адаптер>:<ключ поста> */
  id: string;
  source: EventSource;
  ekpId: string | null;
  year: number;
  name: string;
  level: EventLevel;
  squad: string | null;
  genderAge: string | null;
  disciplines: string[];
  note: string | null;
  dateFrom: string; // YYYY-MM-DD
  dateTo: string;
  country: string | null;
  region: string | null;
  regionCode: number | null;
  federalDistrict: string | null;
  city: string | null;
  venue: string | null;
  isOnline: boolean;
  participants: number | null;
  organizer: string | null;
  url: string | null;
  /** ekp:<id> события ЕКП, с которым совпадает региональное */
  linkedId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  sourceId: string | null;
  removedAt: string | null;
};

export type SourceDoc = {
  id: string;
  kind: "ekp-part2" | "fsp-calendar" | "fsp-regions" | "region";
  url: string;
  year: number | null;
  /** дата актуализации документа (из имени файла) */
  asOf: string | null;
  sha256: string | null;
  fetchedAt: string;
  status: "ok" | "error";
  error: string | null;
  eventsCount: number | null;
};

export type Revision = {
  eventId: string;
  at: string;
  sourceId: string | null;
  kind: "added" | "changed" | "removed" | "restored";
  changes: Record<string, { from: unknown; to: unknown }>;
};

export type Federation = {
  regionCode: number | null;
  region: string;
  federalDistrict: string | null;
  name: string;
  head: string | null;
  phone: string | null;
  email: string | null;
  site: string | null;
  socials: string[];
  address: string | null;
  url: string | null;
  updatedAt: string;
};

export type SavedView = {
  id: string;
  name: string;
  query: string;
  createdAt: string;
};

export type SyncLogEntry = {
  at: string;
  job: string;
  ok: boolean;
  message: string;
  durationMs: number;
};

export type Dataset = {
  schemaVersion: 1;
  events: SportEvent[];
  sources: SourceDoc[];
  revisions: Revision[];
  federations: Federation[];
  views: SavedView[];
  syncLog: SyncLogEntry[];
  /** кэш извлечения мероприятий из постов отделений */
  extractCache?: ExtractCache;
};
