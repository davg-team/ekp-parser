import type { Federation, SportEvent } from "../types";

export type EventRow = SportEvent & { federation: Federation | null };
export type EventsResponse = { total: number; all: number; items: EventRow[] };
export type MetaResponse = {
  options: Record<string, string[]>;
  counts: { events: number; federations: number };
  lastSync: string | null;
  lastError: { at: string; job: string; message: string } | null;
};
