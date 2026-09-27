import { buildAdapters, type RegionAdapter } from "../fsp/regional";
import { coveredBy, isPlatformEvent } from "../fsp/regional/platform";
import { vkEnabled } from "../fsp/regional/vk";
import { mutate, readDataset } from "../store";
import type { SourceDoc } from "../types";
import { linkEvents } from "./link";
import { mergeSnapshot, type Incoming } from "./merge";

const ADAPTER_TIMEOUT = 60_000;
// Синк идёт в GitHub Actions (timeout-minutes: 30 в sync.yml); ЕКП и ФСП занимают ~1 мин.
// Первый прогон «Мой спорт» качает ~300 карточек (~4 мин), дальше — только новые.
const TOTAL_BUDGET = 20 * 60_000;

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
  const before = await readDataset();
  for (const a of list) a.prime?.(before.events, before.sources);
  const outcomes: Outcome[] = [];
  for (const a of list) {
    if (Date.now() - t0 > TOTAL_BUDGET) {
      outcomes.push({ adapter: a, events: null, error: "пропущен: исчерпан бюджет времени синка" });
      continue;
    }
    try {
      outcomes.push({ adapter: a, events: await withTimeout(a.fetch(), a.timeoutMs ?? ADAPTER_TIMEOUT, a.id), error: null });
    } catch (e) {
      outcomes.push({ adapter: a, events: null, error: (e as Error).message });
    }
  }

  const summary = await mutate((ds) => {
    const res: Record<string, unknown> = {};
    // платформы первыми (buildAdapters кладёт их в начало): посты о тех же мероприятиях дальше отсеиваются
    const platform = () => ds.events.filter((e) => isPlatformEvent(e.id) && !e.removedAt);
    for (const { adapter: a, events: raw, error } of outcomes) {
      // отсев «уже есть на платформе» — только для постов каналов и групп
      const covered = /^(tg|vk)-/.test(a.id) ? platform() : [];
      const events = raw?.filter((e) => !coveredBy(e, covered)) ?? null;
      const sourceId = `region:${a.id}`;
      const prev = ds.sources.find((s) => s.id === sourceId);
      ds.sources = ds.sources.filter((s) => s.id !== sourceId);
      const unchanged = !error && !events;
      const doc: SourceDoc = {
        id: sourceId,
        kind: "region",
        url: a.url,
        year: null,
        asOf: at.slice(0, 10),
        sha256: a.sha256 ?? null,
        fetchedAt: at,
        status: error ? "error" : "ok",
        error,
        eventsCount: unchanged ? (prev?.eventsCount ?? null) : (events?.length ?? null),
      };
      ds.sources.push(doc);
      if (unchanged) {
        res[a.id] = "без изменений";
        continue;
      }
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
