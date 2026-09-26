import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAdapters, withSources } from "../lib/fsp/regional";
import { findDates } from "../lib/fsp/regional/dates";
import { extractByRules, postsToEvents } from "../lib/fsp/regional/extract";
import { parseTelegramPage, telegramAdapter } from "../lib/fsp/regional/telegram";
import { windowScope } from "../lib/fsp/regional/types";
import { isFspGroup, parseVkWall, vkAdapter } from "../lib/fsp/regional/vk";
import { emptyDataset } from "../lib/store";
import { mergeSnapshot } from "../lib/sync/merge";
import type { Federation, SportEvent } from "../lib/types";

const file = (n: string) => readFileSync(`fixtures/${n}`, "utf8");
// fixtures/vk-fspsamara.json — синтетический ответ VK API: тексты постов взяты из канала ФСП Самары.
const vkFixture = JSON.parse(file("vk-fspsamara.json"));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("даты в тексте", () => {
  const d = (t: string, posted = "2026-09-07") => findDates(t, posted).map((x) => [x.dateFrom, x.dateTo]);
  it("словами и числами", () => {
    expect(d("📅 11–13 сентября — отборочный этап")).toEqual([["2026-09-11", "2026-09-13"]]);
    expect(d("с 10 по 14 ноября 2025 года")).toEqual([["2025-11-10", "2025-11-14"]]);
    expect(d("Дата проведения: 17.09.2026 г.; 19-20.09.2026 г.")).toEqual([
      ["2026-09-17", "2026-09-17"],
      ["2026-09-19", "2026-09-20"],
    ]);
    expect(d("30 сентября – 2 октября")).toEqual([["2026-09-30", "2026-10-02"]]);
  });
  it("год без указания — ближайший к посту", () => {
    expect(d("финал 27-29 января", "2025-12-10")).toEqual([["2026-01-27", "2026-01-29"]]);
    expect(d("прошёл 4 декабря", "2026-01-15")).toEqual([["2025-12-04", "2025-12-04"]]);
  });
  it("не дата", () => {
    expect(d("версия 1.2.3, 45 участников, 31.02.2026")).toEqual([]);
  });
});

describe("Telegram", () => {
  it("разбор страницы t.me/s", () => {
    const posts = parseTelegramPage(file("tg-fspchuv.html"));
    expect(posts.length).toBe(16);
    const p = posts.find((x) => x.key === "211")!;
    expect(p).toMatchObject({ seq: 211, url: "https://t.me/fspchuv/211", date: "2026-09-11" });
    expect(p.text).toMatch(/ЧЕМПИОНАТ ЧУВАШИИ/);
    expect(p.text).not.toMatch(/<|&#/);
  });

  it("правила: региональные анонсы, без репостов всероссийских", async () => {
    const posts = parseTelegramPage(file("tg-fspsamara.html"));
    const ev = postsToEvents("tg-fspsamara", 63, posts);
    expect(ev.map((e) => [e.id, e.dateFrom, e.dateTo])).toEqual([
      ["region:tg-fspsamara:591", "2026-02-22", "2026-02-22"],
      ["region:tg-fspsamara:600", "2026-04-12", "2026-04-12"],
      ["region:tg-fspsamara:604", "2026-06-04", "2026-06-06"],
    ]);
    expect(ev[2]).toMatchObject({
      source: "region",
      level: "Региональные",
      region: "Самарская область",
      federalDistrict: "Приволжский",
      name: "Чемпионат Самарской области по Продуктовому Программированию",
      disciplines: ["ПРОГРАММИРОВАНИЕ ПРОДУКТОВОЕ"],
      url: "https://t.me/fspsamara/604",
    });
  });

  it("правила отбрасывают федеральное и офтоп", () => {
    const post = (text: string) => ({ key: "1", seq: 1, url: "", date: "2026-09-10", text });
    expect(extractByRules(post("Стартует регистрация на Чемпионат и Первенство России\n11–13 сентября — отбор"))).toEqual([]);
    expect(extractByRules(post("Турниры по Counter-Strike 2\n12 сентября"))).toEqual([]);
    expect(extractByRules(post("Итоги года\nСпасибо всем!\nМы росли\n\nА ещё 5 октября был турнир"))).toEqual([]);
    expect(extractByRules(post("Кубок Пермского края по ИБ\n📍 18 апреля, технопарк"))).toHaveLength(1);
  });

  it("адаптер: fetch без сети, окно просмотренных постов", async () => {
    const html = file("tg-fspchuv.html");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(html)));
    const a = telegramAdapter("fspchuv", 21, { pages: 1, now: new Date("2026-09-26") });
    const ev = await a.fetch();
    expect(ev.map((e) => e.id)).toEqual(["region:tg-fspchuv:211", "region:tg-fspchuv:213"]);
    expect(a.inScope({ id: "region:tg-fspchuv:200", source: "region" } as SportEvent)).toBe(true);
    expect(a.inScope({ id: "region:tg-fspchuv:12", source: "region" } as SportEvent)).toBe(false);
    expect(a.inScope({ id: "region:tg-other:200", source: "region" } as SportEvent)).toBe(false);
  });
});

describe("VK", () => {
  const stubVk = () =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const method = new URL(url).pathname.split("/").pop()!;
        return new Response(JSON.stringify(vkFixture[method]));
      }),
    );

  it("разбор стены: без закреплённых, репост — текстом оригинала", () => {
    const posts = parseVkWall(212345678, vkFixture["wall.get"].response.items);
    expect(posts.some((p) => p.key === "1")).toBe(false);
    expect(posts.find((p) => p.key === "150")?.text).toMatch(/Всероссийский хакатон/);
    expect(posts[0].url).toMatch(/^https:\/\/vk\.com\/wall-212345678_\d+$/);
  });

  it("проверка группы по названию", () => {
    expect(isFspGroup("Федерация спортивного программирования – Самара")).toBe(true);
    expect(isFspGroup("ФСП Тверь")).toBe(true);
    expect(isFspGroup("Федерация синхронного плавания")).toBe(false);
  });

  it("адаптер: wall.get → записи со ссылкой на пост", async () => {
    vi.stubEnv("VK_SERVICE_TOKEN", "test");
    stubVk();
    const a = vkAdapter("fspsamara", 63);
    const ev = await a.fetch();
    expect(ev.map((e) => [e.id, e.dateFrom])).toEqual([
      ["region:vk-fspsamara:191", "2026-02-22"],
      ["region:vk-fspsamara:200", "2026-04-12"],
      ["region:vk-fspsamara:204", "2026-06-04"],
    ]);
    expect(ev[0].url).toBe("https://vk.com/wall-212345678_191");
  });

  it("чужая группа и отсутствие токена — ошибка адаптера", async () => {
    await expect(vkAdapter("fspsamara", 63).fetch()).rejects.toThrow(/VK_SERVICE_TOKEN/);
    vi.stubEnv("VK_SERVICE_TOKEN", "test");
    vkFixture["groups.getById"].response.groups[0].name = "Федерация синхронного плавания";
    stubVk();
    await expect(vkAdapter("fspsamara", 63).fetch()).rejects.toThrow(/не группа ФСП/);
    vkFixture["groups.getById"].response.groups[0].name = "Федерация спортивного программирования – Самара";
  });
});

describe("интеграция", () => {
  it("слияние: пропавшее вне окна не исключается", async () => {
    const posts = parseTelegramPage(file("tg-fspsamara.html"));
    const ds = emptyDataset();
    const old = { id: "region:tg-fspsamara:100", source: "region" } as SportEvent;
    const out = { id: "region:tg-fspsamara:595", source: "region" } as SportEvent;
    ds.events.push({ ...old, removedAt: null } as SportEvent, { ...out, removedAt: null } as SportEvent);
    const ev = postsToEvents("tg-fspsamara", 63, posts);
    const scope = windowScope("tg-fspsamara", posts);
    const st = mergeSnapshot(ds, ev, scope, "region:tg-fspsamara");
    expect(st).toMatchObject({ added: 3, removed: 1 });
    expect(ds.events.find((e) => e.id === old.id)?.removedAt).toBeNull();
    expect(ds.events.find((e) => e.id === out.id)?.removedAt).not.toBeNull();
  });

  it("справочник: сайт и соцсети отделений, VK только с токеном", () => {
    const f = { regionCode: 63, region: "Самарская область", site: null, socials: [] } as unknown as Federation;
    const [x] = withSources([f], [{ regionCode: 63, site: "https://x.ru", telegram: ["fspsamara"], vk: ["fspsamara"] }]);
    expect(x.site).toBe("https://x.ru");
    expect(x.socials).toEqual(["https://t.me/fspsamara", "https://vk.com/fspsamara"]);
    const src = [{ regionCode: 63, site: null, telegram: ["a"], vk: ["b"] }];
    expect(buildAdapters(src).map((a) => a.id)).toEqual(["tg-a"]);
    vi.stubEnv("VK_SERVICE_TOKEN", "t");
    expect(buildAdapters(src).map((a) => a.id)).toEqual(["tg-a", "vk-b"]);
  });
});
