import type { Dataset, SportEvent } from "../types";

/**
 * Связывает мероприятия ФСП и региональные с записями ЕКП, региональные без пары — с календарём субъекта. Нужна пересекающаяся дата;
 * дальше выбираем кандидата с наибольшим баллом (субъект, точные даты, дисциплина, онлайн).
 */
export function linkEvents(ds: Dataset): void {
  const ekp = ds.events.filter((e) => e.source === "ekp" && !e.removedAt);
  for (const e of ds.events) {
    if (e.source === "ekp") continue;
    let best: SportEvent | null = null;
    let bestScore = 0;
    for (const k of ekp) {
      const s = score(k, e);
      if (s > bestScore) {
        best = k;
        bestScore = s;
      }
    }
    e.linkedId = best && bestScore >= 5 ? best.id : null;
  }
  // региональные записи без пары в ЕКП — к записи календаря субъекта («Мой спорт»); нужен тот же субъект
  const plan = ds.events.filter((e) => e.id.startsWith("region:moisport:") && !e.removedAt);
  for (const e of ds.events) {
    if (e.source !== "region" || e.linkedId || e.id.startsWith("region:moisport:")) continue;
    let best: SportEvent | null = null;
    let bestScore = 0;
    for (const k of plan) {
      if (k.regionCode !== e.regionCode) continue;
      const s = score(k, e);
      if (s > bestScore) {
        best = k;
        bestScore = s;
      }
    }
    e.linkedId = best && bestScore >= 5 ? best.id : null;
  }
}

export function score(k: SportEvent, e: SportEvent): number {
  if (!(k.dateFrom <= e.dateTo && e.dateFrom <= k.dateTo)) return 0;
  let s = 1;
  if (k.dateFrom === e.dateFrom) s += 2;
  if (k.dateTo === e.dateTo) s += 1;
  if (k.regionCode && k.regionCode === e.regionCode) s += 3;
  else if (k.regionCode && e.regionCode) s -= 3;
  if (k.isOnline && e.isOnline) s += 1;
  if (e.disciplines.length && k.disciplines.some((d) => e.disciplines.includes(d))) s += 2;
  if (k.level !== "Прочее" && k.level === e.level) s += 1;
  return s;
}
