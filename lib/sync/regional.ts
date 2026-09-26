import { buildAdapters, type RegionAdapter } from "../fsp/regional";
import { vkEnabled } from "../fsp/regional/vk";
import { mutate } from "../store";
import type { SourceDoc } from "../types";
import { linkEvents } from "./link";
import { mergeSnapshot, type Incoming } from "./merge";

const ADAPTER_TIMEOUT = 60_000;
// Синк идёт в GitHub Actions (timeout-minutes: 30 в sync.yml); ЕКП и ФСП занимают ~1 мин.
const TOTAL_BUDGET = 15 * 60_000;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([p, new Promise<T>((_, rej) => (t = setTimeout(() => rej(new Error(`${what}: таймаут ${ms / 1000} с`)), ms)))]).finally(() => clearTimeout(t));
}

type Outcome = { adapter: RegionAdapter; events: Incoming[] | null; error: string | null };

/** Адаптеры по очереди (вежливо, без параллельного обхода); ошибка адаптера не мешает остальным. */
export async function syncRegional(now = new Date(), adapters?: RegionAdapter[]) {
  const at = now.toISOString();
  const t0 = Date.now();
  const list = adapters ?? buildAdapters();
  const outcomes: Outcome[] = [];
  for (const a of list) {
    if (Date.now() - t0 > TOTAL_BUDGET) {
      outcomes.push({ adapter: a, events: null, error: "пропущен: исчерпан бюджет времени синка" });
      continue;
    }
    try {
      outcomes.push({ adapter: a, events: await withTimeout(a.fetch(), ADAPTER_TIMEOUT, a.id), error: null });
    } catch (e) {
      outcomes.push({ adapter: a, events: null, error: (e as Error).message });
    }
  }

  const summary = await mutate((ds) => {
    const res: Record<string, unknown> = {};
    for (const { adapter: a, events, error } of outcomes) {
      const sourceId = `region:${a.id}`;
      ds.sources = ds.sources.filter((s) => s.id !== sourceId);
      const doc: SourceDoc = { id: sourceId, kind: "region", url: a.url, year: null, asOf: at.slice(0, 10), sha256: null, fetchedAt: at, status: error ? "error" : "ok", error, eventsCount: events?.length ?? null };
      ds.sources.push(doc);
      if (!events) {
        res[a.id] = { failed: error };
        continue;
      }
      const st = mergeSnapshot(ds, events, (e) => e.source === "region" && a.inScope(e), sourceId, at);
      res[a.id] = st.total ? st : 0;
    }
    delete ds.extractCache;
    linkEvents(ds);
    const failed = outcomes.filter((o) => o.error).length;
    return {
      adapters: outcomes.length,
      failed,
      events: outcomes.reduce((n, o) => n + (o.events?.length ?? 0), 0),
      ...(vkEnabled() ? {} : { vk: "VK_SERVICE_TOKEN не задан — группы VK пропущены" }),
      details: res,
    };
  });
  if (summary.adapters && summary.failed === summary.adapters) throw new Error(`все ${summary.adapters} адаптеров упали: ${outcomes[0]?.error}`);
  return summary;
}
