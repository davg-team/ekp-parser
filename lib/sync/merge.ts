import type { Dataset, Revision, SportEvent } from "../types";

/** Поля, изменения которых пишем в историю. */
export const TRACKED: (keyof Incoming & keyof SportEvent)[] = [
  "name",
  "level",
  "squad",
  "genderAge",
  "disciplines",
  "note",
  "dateFrom",
  "dateTo",
  "country",
  "region",
  "city",
  "venue",
  "isOnline",
  "participants",
  "organizer",
  "url",
];

export type Incoming = Omit<SportEvent, "firstSeenAt" | "lastSeenAt" | "removedAt" | "linkedId" | "sourceId">;

export type MergeStats = { added: number; changed: number; removed: number; restored: number; total: number };

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Сливает свежий снимок источника с базой.
 * `inScope` — какие существующие записи покрывает снимок (например, ЕКП за 2026 год):
 * те из них, что пропали из снимка, помечаются удалёнными.
 */
export function mergeSnapshot(
  ds: Dataset,
  incoming: Incoming[],
  inScope: (e: SportEvent) => boolean,
  sourceId: string | null,
  now = new Date().toISOString(),
): MergeStats {
  const stats: MergeStats = { added: 0, changed: 0, removed: 0, restored: 0, total: incoming.length };
  const byId = new Map(ds.events.map((e) => [e.id, e]));
  const seen = new Set<string>();
  const revs: Revision[] = [];

  for (const inc of incoming) {
    if (seen.has(inc.id)) continue;
    seen.add(inc.id);
    const cur = byId.get(inc.id);
    if (!cur) {
      const ev: SportEvent = { ...inc, firstSeenAt: now, lastSeenAt: now, removedAt: null, linkedId: null, sourceId };
      ds.events.push(ev);
      byId.set(ev.id, ev);
      revs.push({ eventId: ev.id, at: now, sourceId, kind: "added", changes: {} });
      stats.added++;
      continue;
    }
    const changes: Revision["changes"] = {};
    for (const k of TRACKED) {
      if (!same(cur[k], inc[k])) changes[k] = { from: cur[k], to: inc[k] };
    }
    const wasRemoved = !!cur.removedAt;
    Object.assign(cur, inc, { lastSeenAt: now, removedAt: null, sourceId });
    if (wasRemoved) {
      revs.push({ eventId: cur.id, at: now, sourceId, kind: "restored", changes });
      stats.restored++;
    } else if (Object.keys(changes).length) {
      revs.push({ eventId: cur.id, at: now, sourceId, kind: "changed", changes });
      stats.changed++;
    }
  }

  for (const e of ds.events) {
    if (e.removedAt || seen.has(e.id) || !inScope(e)) continue;
    e.removedAt = now;
    revs.push({ eventId: e.id, at: now, sourceId, kind: "removed", changes: {} });
    stats.removed++;
  }

  ds.revisions.push(...revs);
  return stats;
}
