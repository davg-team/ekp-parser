import { fetchFspCalendar } from "../fsp/calendar";
import { withSources } from "../fsp/regional";
import { fetchFederations, FSP_REGIONS_URL } from "../fsp/regions";
import { mutate } from "../store";
import { linkEvents } from "./link";
import { mergeSnapshot } from "./merge";

const WINDOW_BACK = -12;
const WINDOW_FWD = 12;

/** Справочник отделений и календарь ФСП — независимо: ошибка одного не отменяет другое. */
export async function syncFsp(now = new Date()) {
  const at = now.toISOString();
  const result: Record<string, unknown> = {};

  try {
    const feds = withSources(await fetchFederations());
    if (feds.length < 50) throw new Error(`в справочнике всего ${feds.length} отделений — вёрстка сайта изменилась?`);
    await mutate((ds) => {
      ds.federations = feds;
      ds.sources = ds.sources.filter((s) => s.kind !== "fsp-regions");
      ds.sources.push({ id: "fsp-regions", kind: "fsp-regions", url: FSP_REGIONS_URL, year: null, asOf: at.slice(0, 10), sha256: null, fetchedAt: at, status: "ok", error: null, eventsCount: feds.length });
    });
    result.federations = feds.length;
  } catch (e) {
    result.federations = { error: (e as Error).message };
  }

  try {
    const events = await fetchFspCalendar(WINDOW_BACK, WINDOW_FWD, now);
    const from = new Date(now.getFullYear(), now.getMonth() + WINDOW_BACK, 1).toISOString().slice(0, 10);
    const to = new Date(now.getFullYear(), now.getMonth() + WINDOW_FWD + 1, 0).toISOString().slice(0, 10);
    const sourceId = `fsp-calendar:${at.slice(0, 10)}`;
    result.calendar = await mutate((ds) => {
      // пропавшим считаем только то, что попадает в просмотренное окно месяцев
      const st = mergeSnapshot(ds, events, (e) => e.source === "fsp" && e.dateFrom >= from && e.dateFrom <= to, sourceId, at);
      ds.sources = ds.sources.filter((s) => s.kind !== "fsp-calendar");
      ds.sources.push({ id: sourceId, kind: "fsp-calendar", url: "https://fsp-russia.ru/calendar/", year: null, asOf: at.slice(0, 10), sha256: null, fetchedAt: at, status: "ok", error: null, eventsCount: events.length });
      linkEvents(ds);
      return st;
    });
  } catch (e) {
    result.calendar = { error: (e as Error).message };
  }
  return result;
}
