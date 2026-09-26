import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveKey, exportKey, importKey, openWithKey, saltOf, seal } from "../lib/crypto";
import { encodeFilter } from "../lib/filters/ast";
import { emptyDataset } from "../lib/store";
import type { Dataset, SportEvent } from "../lib/types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("шифрование данных", () => {
  it("пароль → ключ → расшифровка; чужой пароль не подходит", async () => {
    const s = await seal('{"a":1}', "secret");
    const key = await deriveKey("secret", saltOf(s), s.iter, true);
    expect(await openWithKey(s, key)).toBe('{"a":1}');
    // ключ, сохранённый в браузере, тоже открывает
    expect(await openWithKey(s, await importKey(await exportKey(key)))).toBe('{"a":1}');
    await expect(openWithKey(s, await deriveKey("wrong", saltOf(s), s.iter))).rejects.toThrow();
  });
});

const ev = (id: string, source: SportEvent["source"], regionCode: number): SportEvent =>
  ({ id, source, name: id, level: "Прочее", disciplines: [], dateFrom: "2030-01-01", dateTo: "2030-01-02", regionCode, region: "Самарская область", linkedId: null, removedAt: null, year: 2030 }) as unknown as SportEvent;

function dataset(): Dataset {
  const ds = emptyDataset();
  ds.events = [ev("ekp:1", "ekp", 63), ev("region:tg-x:5", "region", 63)];
  ds.federations = [{ regionCode: 63, region: "Самарская область" } as Dataset["federations"][number]];
  return ds;
}

async function api(ds: Dataset | "sealed", password?: string) {
  const files: Record<string, unknown> = {};
  if (ds === "sealed") files["/data.enc"] = await seal(JSON.stringify(dataset()), "pw");
  else files["/data.json"] = ds;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = files[url];
      if (!body) return new Response("", { status: 404 });
      return new Response(init?.method === "HEAD" ? null : JSON.stringify(body));
    }),
  );
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
  const data = await import("../lib/client/data");
  const mod = await import("../lib/client/api");
  if (password) await data.login(password);
  return { ...mod, ...data };
}

describe("API в браузере", () => {
  it("мероприятия, фильтр по источнику, карточка, отделения", async () => {
    const { localApi } = await api(dataset());
    const all = await localApi<{ total: number }>("/api/events?s=");
    expect(all.total).toBe(2);
    const f = encodeFilter({ type: "group", op: "and", children: [{ type: "rule", field: "source", op: "in", value: ["Регион"] }] });
    const reg = await localApi<{ total: number; items: { id: string; federation: unknown }[] }>(`/api/events?f=${f}`);
    expect(reg.items.map((e) => e.id)).toEqual(["region:tg-x:5"]);
    expect(reg.items[0].federation).toMatchObject({ regionCode: 63 });
    const one = await localApi<{ event: { id: string } }>(`/api/events/${encodeURIComponent("region:tg-x:5")}`);
    expect(one.event.id).toBe("region:tg-x:5");
    const feds = await localApi<{ eventsTotal: number }[]>("/api/federations");
    expect(feds[0].eventsTotal).toBe(2);
    const meta = await localApi<{ options: Record<string, string[]> }>("/api/meta");
    expect(meta.options.source).toEqual(["ЕКП", "ФСП", "Регион"]);
  });

  it("зашифрованные данные: без пароля — NeedPassword, с неверным — отказ, с верным — данные", async () => {
    const a = await api("sealed");
    await expect(a.localApi("/api/meta")).rejects.toBeInstanceOf(a.NeedPassword);
    expect(await a.login("nope")).toBe(false);
    expect(await a.login("pw")).toBe(true);
    expect((await a.localApi<{ counts: { events: number } }>("/api/meta")).counts.events).toBe(2);
  });

  it("представления — в localStorage", async () => {
    const { saveView, listViews, deleteView } = await api(dataset());
    const v = saveView("Регионы", "src=Регион");
    saveView("Регионы", "src=ЕКП");
    expect(listViews()).toHaveLength(1);
    expect(listViews()[0].query).toBe("src=ЕКП");
    deleteView(listViews()[0].id);
    expect(listViews()).toEqual([]);
    expect(v.name).toBe("Регионы");
  });
});
