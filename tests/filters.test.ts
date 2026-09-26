import { describe, expect, it } from "vitest";
import { decodeFilter, encodeFilter, type Group } from "../lib/filters/ast";
import { applyQuery } from "../lib/filters/evaluate";
import type { SportEvent } from "../lib/types";

const base: SportEvent = {
  id: "x", source: "ekp", ekpId: "1", year: 2026, name: "КУБОК РОССИИ", level: "Кубок России", squad: null, genderAge: "женщины, мужчины",
  disciplines: ["ПРОГРАММИРОВАНИЕ ПРОДУКТОВОЕ"], note: null, dateFrom: "2026-10-10", dateTo: "2026-10-12", country: "Россия",
  region: "г. Москва", regionCode: 77, federalDistrict: "Центральный", city: "Москва", venue: null, isOnline: false, participants: 100,
  organizer: null, url: null, linkedId: null, firstSeenAt: "2026-09-01T00:00:00Z", lastSeenAt: "", sourceId: null, removedAt: null,
};
const E = (id: string, o: Partial<SportEvent>) => ({ ...base, id, ...o });
const events = [
  E("msk", {}),
  E("spb", { region: "г. Санкт-Петербург", federalDistrict: "Северо-Западный", dateFrom: "2026-12-01", dateTo: "2026-12-02", participants: 300 }),
  E("online", { region: null, isOnline: true, dateFrom: "2026-10-01", dateTo: "2026-10-30", disciplines: ["ПРОГРАММИРОВАНИЕ АЛГОРИТМИЧЕСКОЕ"] }),
  E("old", { dateFrom: "2025-05-01", dateTo: "2025-05-02", year: 2025 }),
];
const today = "2026-09-26";
const ids = (g: Group, q = "") => applyQuery(events, g, q, [{ field: "dateFrom", dir: "asc" }], today).map((e) => e.id);

describe("фильтры", () => {
  it("(Москва ИЛИ СПб) И в ближайшие 90 дней И НЕ онлайн", () => {
    const g: Group = { type: "group", op: "and", children: [
      { type: "group", op: "or", children: [
        { type: "rule", field: "region", op: "in", value: ["г. Москва"] },
        { type: "rule", field: "federalDistrict", op: "in", value: ["Северо-Западный"] },
      ] },
      { type: "rule", field: "dateFrom", op: "nextDays", value: 90 },
      { type: "group", op: "and", not: true, children: [{ type: "rule", field: "isOnline", op: "isTrue" }] },
    ] };
    expect(ids(g)).toEqual(["msk", "spb"]);
  });

  it("числа, массивы, статус, поиск", () => {
    expect(ids({ type: "group", op: "and", children: [{ type: "rule", field: "participants", op: "gte", value: 200 }] })).toEqual(["spb"]);
    expect(ids({ type: "group", op: "and", children: [{ type: "rule", field: "disciplines", op: "none", value: ["ПРОГРАММИРОВАНИЕ ПРОДУКТОВОЕ"] }] })).toEqual(["online"]);
    expect(ids({ type: "group", op: "and", children: [{ type: "rule", field: "status", op: "in", value: ["Прошло"] }] })).toEqual(["old"]);
    expect(ids({ type: "group", op: "and", children: [] }, "петербург")).toEqual(["spb"]);
    expect(ids({ type: "group", op: "and", children: [{ type: "rule", field: "duration", op: "gt", value: 10 }] })).toEqual(["online"]);
  });

  it("сортировка по нескольким полям, пустые в конце", () => {
    const r = applyQuery(events, { type: "group", op: "and", children: [] }, "", [{ field: "region", dir: "desc" }, { field: "dateFrom", dir: "desc" }], today);
    expect(r.map((e) => e.id)).toEqual(["spb", "msk", "old", "online"]);
  });

  it("кодирование в URL туда-обратно", () => {
    const g: Group = { type: "group", op: "or", not: true, children: [{ type: "rule", field: "name", op: "contains", value: "Кубок «Ёж»" }] };
    expect(decodeFilter(encodeFilter(g))).toEqual(g);
    expect(decodeFilter("мусор")).toEqual({ type: "group", op: "and", children: [] });
  });
});
