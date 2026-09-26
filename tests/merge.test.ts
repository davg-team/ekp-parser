import { describe, expect, it } from "vitest";
import { emptyDataset } from "../lib/store";
import { linkEvents } from "../lib/sync/link";
import { mergeSnapshot, type Incoming } from "../lib/sync/merge";

const ev = (id: string, over: Partial<Incoming> = {}): Incoming => ({
  id, source: "ekp", ekpId: id, year: 2026, name: "КУБОК РОССИИ", level: "Кубок России", squad: null, genderAge: null,
  disciplines: ["ПРОГРАММИРОВАНИЕ ПРОДУКТОВОЕ"], note: null, dateFrom: "2026-05-01", dateTo: "2026-05-03", country: "Россия",
  region: "Смоленская область", regionCode: 67, federalDistrict: "Центральный", city: "Смоленск", venue: null, isOnline: false,
  participants: 100, organizer: null, url: null, ...over,
});

describe("слияние снимков", () => {
  it("добавление, изменение, исключение, возврат", () => {
    const ds = emptyDataset();
    const all = () => true;
    expect(mergeSnapshot(ds, [ev("a"), ev("b")], all, "s1", "t1")).toMatchObject({ added: 2 });
    expect(mergeSnapshot(ds, [ev("a"), ev("b")], all, "s2", "t2")).toMatchObject({ added: 0, changed: 0, removed: 0 });
    const st = mergeSnapshot(ds, [ev("a", { dateFrom: "2026-06-01", dateTo: "2026-06-03" })], all, "s3", "t3");
    expect(st).toMatchObject({ changed: 1, removed: 1 });
    expect(ds.events.find((e) => e.id === "b")!.removedAt).toBe("t3");
    const rev = ds.revisions.find((r) => r.kind === "changed")!;
    expect(rev.changes.dateFrom).toEqual({ from: "2026-05-01", to: "2026-06-01" });
    expect(mergeSnapshot(ds, [ev("a", { dateFrom: "2026-06-01", dateTo: "2026-06-03" }), ev("b")], all, "s4", "t4")).toMatchObject({ restored: 1 });
    expect(ds.events.find((e) => e.id === "a")!.firstSeenAt).toBe("t1");
  });

  it("вне области снимка не исключает", () => {
    const ds = emptyDataset();
    mergeSnapshot(ds, [ev("a", { year: 2025 })], () => true, "s1");
    mergeSnapshot(ds, [ev("b")], (e) => e.year === 2026, "s2");
    expect(ds.events.every((e) => !e.removedAt)).toBe(true);
  });

  it("связь ФСП ↔ ЕКП выбирает лучший вариант", () => {
    const ds = emptyDataset();
    mergeSnapshot(ds, [ev("ekp:msk", { regionCode: 77, region: "г. Москва", dateFrom: "2026-10-16", dateTo: "2026-10-30" }),
      ev("ekp:fo", { regionCode: null, region: null, isOnline: true, dateFrom: "2026-10-03", dateTo: "2026-10-18" })], () => true, "s");
    mergeSnapshot(ds, [ev("fsp:x", { source: "fsp", ekpId: null, regionCode: 77, isOnline: true, dateFrom: "2026-10-16", dateTo: "2026-10-30", disciplines: [] })], (e) => e.source === "fsp", "f");
    linkEvents(ds);
    expect(ds.events.find((e) => e.id === "fsp:x")!.linkedId).toBe("ekp:msk");
  });
});
