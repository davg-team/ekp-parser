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
import { regionInText } from "../lib/regions";
import { contestsToEvents, coveredBy, stageBase } from "../lib/fsp/regional/platform";
import { foncodeAdapter, parseFoncodePage } from "../lib/fsp/regional/foncode";
import { caplagAdapter, parseCaplagList, parseCaplagPage } from "../lib/fsp/regional/caplag";
import { moisportAdapter, msToIncoming, splitLocation, type MsEvent } from "../lib/fsp/regional/moisport";
import { linkEvents } from "../lib/sync/link";
import { ocrLayout, planDates, planRows, planToEvents } from "../lib/fsp/regional/plan-parse";
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

  it("правила отбрасывают репосты соседей и анонсы платформ", () => {
    const post = (text: string) => ({ key: "1", seq: 1, url: "", date: "2026-09-10", text });
    expect(extractByRules(post("Кубок Пермского края по ИБ\n📍 18 апреля"), 16)).toEqual([]);
    expect(extractByRules(post("Кубок Пермского края по ИБ\n📍 18 апреля"), 59)).toHaveLength(1);
    expect(extractByRules(post("Новое CTF на Caplag «Сердце Сысолы»\n8 августа"), 16)).toEqual([]);
  });

  it("адаптер: fetch без сети, окно просмотренных постов", async () => {
    const html = file("tg-fspchuv.html");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(html)));
    const a = telegramAdapter("fspchuv", 21, { pages: 1, now: new Date("2026-09-26") });
    const ev = (await a.fetch())!;
    // 213 — повтор анонса 211 (те же даты)
    expect(ev.map((e) => e.id)).toEqual(["region:tg-fspchuv:211"]);
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
    const ev = (await a.fetch())!;
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
    expect(buildAdapters(src, []).map((a) => a.id)).toEqual(["moisport", "foncode", "caplag", "tg-a"]);
    vi.stubEnv("VK_SERVICE_TOKEN", "t");
    expect(buildAdapters(src, []).map((a) => a.id)).toEqual(["moisport", "foncode", "caplag", "tg-a", "vk-b"]);
  });
});

describe("субъект в тексте", () => {
  it("падежи, сокращения, опечатки", () => {
    const c = (t: string) => regionInText(t)?.code ?? null;
    expect(c("Чемпионат Рязанской области")).toBe(62);
    expect(c("Соревнования Республики Коми")).toBe(11);
    expect(c("Комитет по спорту")).toBeNull();
    expect(c("Открытый турнир СЗАО г. Москвы")).toBe(77);
    expect(c("Кубок Московской области")).toBe(50);
    expect(c("Кубок Донецкой Народной Республики")).toBe(80);
    expect(c("Чемпионат Ханты-Мансийского автономного округа – Югры")).toBe(86);
    expect(c("Отборочные соревнования Республики Дагенстан")).toBe(5);
    expect(c("Сахалинская область")).toBe(65);
    expect(c("Кубок Дальнего Востока")).toBeNull();
    expect(c("Кубок Московского Политеха")).toBeNull();
    expect(c("Чемпионат Хабаровского края")).toBe(27);
    expect(c("Краевые соревнования Краснодарского края")).toBe(23);
  });
});

describe("платформы", () => {
  const ALG = "ПРОГРАММИРОВАНИЕ АЛГОРИТМИЧЕСКОЕ";
  it("этапы → база названия", () => {
    expect(stageBase("Чемпионат Рязанской области в дисциплине алгоритмическое программирование - Отборочный этап")).toBe(
      "Чемпионат Рязанской области в дисциплине алгоритмическое программирование",
    );
    expect(stageBase("Финал Кубка Владимирской области")).toBe("Кубок Владимирской области");
    expect(stageBase("Отборочный этап Чемпионата Республики Татарстан")).toBe("Чемпионат Республики Татарстан");
    expect(stageBase("Отборочный этап Первенства Республики Татарстан")).toBe("Первенство Республики Татарстан");
    expect(stageBase("Открытые соревнования Республики Коми &quot;Код Севера&quot; (студенты)")).toBe("Открытые соревнования Республики Коми Код Севера");
  });

  it("foncode: страница списка → региональные мероприятия, этапы склеены", () => {
    const cs = parseFoncodePage(file("foncode-contests-p3.html"), ALG);
    expect(cs.length).toBe(15);
    expect(cs[0]).toMatchObject({ key: expect.stringMatching(/^\d+$/), dateFrom: expect.stringMatching(/^\d{4}-\d\d-\d\d$/) });
    const ev = contestsToEvents("foncode", cs);
    const names = ev.map((e) => `${e.regionCode} ${e.dateFrom}..${e.dateTo} ${e.name}`);
    // всероссийские («Кубка России») и вузовские без субъекта отброшены
    expect(names.join("\n")).not.toMatch(/России|Bauman/);
    const vl = ev.find((e) => e.regionCode === 33)!;
    expect(vl).toMatchObject({ name: "Кубок Владимирской области", dateFrom: "2026-03-07", dateTo: "2026-03-21", note: "Этапов на foncode: 2", disciplines: [ALG], organizer: "ФСП — Владимирская область" });
    expect(ev.map((e) => e.regionCode)).toEqual([52, 63, 80, 33, 62]);
    expect(ev.filter((e) => e.regionCode === 80)).toHaveLength(1);
  });

  it("foncode: адаптер листает до начала окна", async () => {
    const html = file("foncode-contests-p3.html");
    const f = vi.fn(async () => new Response(html));
    vi.stubGlobal("fetch", f);
    vi.stubGlobal("setTimeout", ((cb: () => void) => (cb(), 0)) as unknown as typeof setTimeout);
    const a = foncodeAdapter({ now: new Date("2026-06-01"), sinceDays: 60 });
    const ev = (await a.fetch())!;
    // на странице есть контесты старше окна — дальше не листаем ни в одном разделе
    expect(f).toHaveBeenCalledTimes(2);
    expect(ev.every((e) => e.dateFrom >= "2026-04-02")).toBe(true);
    expect(a.inScope({ id: "region:foncode:1", dateFrom: "2026-05-01" } as SportEvent)).toBe(true);
    expect(a.inScope({ id: "region:foncode:1", dateFrom: "2026-01-01" } as SportEvent)).toBe(false);
  });

  it("caplag: список и страница (JSON-LD, субъект по ссылке на группу)", async () => {
    const slugs = parseCaplagList(file("caplag-competitions.html"));
    expect(slugs).toContain("the-heart-of-sysola");
    expect(slugs.length).toBe(7);
    const c = parseCaplagPage(file("caplag-the-heart-of-sysola.html"), "the-heart-of-sysola", new Map([["fspkomi", 11]]))!;
    expect(c).toMatchObject({ name: "Сердце Сысолы", dateFrom: "2026-08-08", dateTo: "2026-08-08", participants: 137, regionCode: 11 });
    const [e] = contestsToEvents("caplag", [c]);
    expect(e).toMatchObject({ id: "region:caplag:the-heart-of-sysola", region: "Республика Коми", disciplines: ["ПРОГРАММИРОВАНИЕ СИСТЕМ ИНФОРМАЦИОННОЙ БЕЗОПАСНОСТИ"] });
    // без известной группы и без субъекта в названии — не региональное
    expect(contestsToEvents("caplag", [{ ...c, regionCode: null }])).toEqual([]);
  });

  it("пост покрыт мероприятием платформы: субъект, ±14 дней, дисциплина", () => {
    const p = [{ regionCode: 63, dateFrom: "2026-04-12", dateTo: "2026-04-12", disciplines: [ALG] }];
    const e = (x: object) => ({ regionCode: 63, dateFrom: "2026-04-05", dateTo: "2026-04-05", disciplines: [], ...x }) as never;
    expect(coveredBy(e({}), p)).toBe(true);
    expect(coveredBy(e({ regionCode: 64 }), p)).toBe(false);
    expect(coveredBy(e({ dateFrom: "2026-05-05" }), p)).toBe(false);
    expect(coveredBy(e({ dateFrom: "2026-03-01", dateTo: "2026-04-12" }), p)).toBe(true);
    expect(coveredBy(e({ disciplines: ["ПРОГРАММИРОВАНИЕ ПРОДУКТОВОЕ"] }), p)).toBe(false);
  });

  it("посты Самары, покрытые foncode, отсеиваются", () => {
    const tg = postsToEvents("tg-fspsamara", 63, parseTelegramPage(file("tg-fspsamara.html")));
    const plat = contestsToEvents("foncode", [
      { key: "1", url: "u", name: "Чемпионат Самарской области по спортивному программированию", dateFrom: "2026-04-12", dateTo: "2026-04-12", description: "", isOnline: true, discipline: ALG },
    ]);
    expect(tg.filter((e) => !coveredBy(e, plat)).map((e) => e.id)).toEqual(["region:tg-fspsamara:591", "region:tg-fspsamara:604"]);
  });
});

describe("«Мой спорт»", () => {
  const card = JSON.parse(file("moisport-event-182519.json")) as MsEvent;
  it("карточка → запись с организатором и ответственным", () => {
    expect(msToIncoming({ ...card, id: "182519" })).toMatchObject({
      id: "region:moisport:182519",
      level: "Региональные",
      region: "Калининградская область",
      regionCode: 39,
      city: "Калининград",
      dateFrom: "2026-06-01",
      dateTo: "2026-12-31",
      organizer: expect.stringMatching(/Федерация спортивного программирования» по Калининградской области/),
      note: "Спортивное соревнование субъекта РФ. Ответственный: Дубинин Иван Витальевич",
      url: "https://org.moisport.ru/public-events-schedule/182519",
    });
  });
  it("место и заглушки", () => {
    expect(splitLocation("Спортивный комплекс ЧГУ, г. Чебоксары, ул. Университетская 38.")).toEqual({ city: "Чебоксары", venue: "Спортивный комплекс ЧГУ, г. Чебоксары, ул. Университетская 38." });
    expect(splitLocation("г. Липецк")).toEqual({ city: "Липецк", venue: null });
    expect(splitLocation("По назначению")).toEqual({ city: null, venue: null });
    expect(msToIncoming({ ...card, id: "1", responsibleStaff: ["админ админ"] })!.note).toBe("Спортивное соревнование субъекта РФ");
  });
  it("УТМ и всероссийские отбрасываются", () => {
    expect(msToIncoming({ ...card, id: "1", name: "УТМ (КМО)" })).toBeNull();
    expect(msToIncoming({ ...card, id: "1", name: "Кубок Федерации спортивного программирования России (отборочный этап)" })).toBeNull();
  });
  it("адаптер: список, карточки только новых", async () => {
    const list = file("moisport-list.json");
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes("?")) return new Response(list);
      const id = url.split("/").pop()!;
      const item = JSON.parse(list).items.find((x: { id: string }) => x.id === id);
      return new Response(JSON.stringify({ ...card, ...item, id: Number(id) }));
    }));
    const a = moisportAdapter({ now: new Date("2026-09-26"), pauseMs: 0 });
    const ev = (await a.fetch())!;
    const details = calls.filter((u) => !u.includes("?")).length;
    expect(details).toBe(12);
    // УТМ (2) и Кубок ФСП отброшены
    expect(ev).toHaveLength(9);
    // второй прогон с датасетом: карточки не качаются
    const now = "2026-09-26T00:00:00Z";
    a.prime!(ev.map((e) => ({ ...e, firstSeenAt: now, lastSeenAt: now, removedAt: null, linkedId: null, sourceId: null })));
    calls.length = 0;
    expect(await a.fetch()).toHaveLength(9);
    expect(calls.filter((u) => !u.includes("?")).length).toBe(3);
  });
  it("пост отделения связывается с записью плана субъекта", () => {
    const ds = emptyDataset();
    const base = { source: "region", removedAt: null, linkedId: null, regionCode: 39, level: "Региональные", disciplines: [], isOnline: false } as unknown as SportEvent;
    ds.events.push(
      { ...base, id: "region:moisport:1", dateFrom: "2026-06-01", dateTo: "2026-12-31" },
      { ...base, id: "region:tg-fsp_kld:5", dateFrom: "2026-10-10", dateTo: "2026-10-11" },
      { ...base, id: "region:tg-other:5", regionCode: 63, dateFrom: "2026-10-10", dateTo: "2026-10-11" },
    );
    linkEvents(ds);
    expect(ds.events.map((e) => e.linkedId)).toEqual([null, "region:moisport:1", null]);
  });
});

describe("календарный план субъекта (текст PDF)", () => {
  it("даты: месяц, диапазон дней, числами, туры", () => {
    expect(planDates("март", 2026)).toEqual({ dateFrom: "2026-03-01", dateTo: "2026-03-31" });
    expect(planDates("12-14 марта", 2026)).toEqual({ dateFrom: "2026-03-12", dateTo: "2026-03-14" });
    expect(planDates("15.03.2026 - 17.03.2026", 2026)).toEqual({ dateFrom: "2026-03-15", dateTo: "2026-03-17" });
    expect(planDates("тур 1 – март тур 3 – апрель", 2026)).toEqual({ dateFrom: "2026-03-01", dateTo: "2026-04-30" });
    expect(planDates("по назначению", 2026)).toBeNull();
  });

  it("Саратов: раздел вида спорта, перенос ячеек, разрыв страницы, всероссийские отброшены", () => {
    const t = file("plan-saratov-2026.txt");
    expect(planRows(t).map((r) => r.no)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const ev = planToEvents(t, { regionCode: 64, year: 2026, url: "u", key: "plan-64-2026" });
    expect(ev).toHaveLength(6);
    expect(ev.map((e) => e.name)).not.toContain(expect.stringMatching(/Всероссийск/));
    expect(ev.find((e) => /алгоритмическое/.test(e.name))).toMatchObject({
      name: "Чемпионат Саратовской области в дисциплине «алгоритмическое программирование»",
      dateFrom: "2026-03-01",
      dateTo: "2026-03-31",
      city: "Саратов",
      participants: 70,
      region: "Саратовская область",
      disciplines: ["ПРОГРАММИРОВАНИЕ АЛГОРИТМИЧЕСКОЕ"],
      id: expect.stringMatching(/^region:plan-64-2026:2026-[0-9a-f]{8}$/),
    });
    // соседний раздел (спортивный туризм) не захвачен
    expect(ev.some((e) => /пешеходн/.test(e.name))).toBe(false);
  });

  it("скан: TSV Tesseract → колонки → те же мероприятия, что в текстовом PDF", () => {
    const text = [file("ocr-saratov-p61.tsv"), file("ocr-saratov-p62.tsv")].map(ocrLayout).join("\f");
    const ocr = planToEvents(text, { regionCode: 64, year: 2026, url: "u", key: "plan-64-2026" });
    const pdf = planToEvents(file("plan-saratov-2026.txt"), { regionCode: 64, year: 2026, url: "u", key: "plan-64-2026" });
    const pick = (e: { name: string; dateFrom: string; dateTo: string; city: string | null }) => [e.name, e.dateFrom, e.dateTo, e.city];
    expect(ocr.map(pick)).toEqual(pdf.map(pick));
    // id по названию и сроку — совпадают, скан и текст дают одни записи
    expect(ocr.map((e) => e.id)).toEqual(pdf.map((e) => e.id));
  });

  it("Дагестан: номер «395 1», наименование центрировано по вертикали, город отдельной ячейкой", () => {
    const ev = planToEvents(file("plan-dagestan-2026.txt"), { regionCode: 5, year: 2026, url: "u", key: "plan-5-2026" });
    // три чемпионата России в разделе отброшены
    expect(ev.map((e) => e.name)).toEqual([
      "Чемпионат Республики Дагестан в дисциплине «программирование алгоритмическое»",
      "Чемпионат Республики Дагестан в дисциплине «программирование систем информационной безопасности»",
      "Чемпионат Республики Дагестан в дисциплине «программирование продуктовое»",
      "Первенстко Республики Дагестан в дисциплине «программирование систем информационной безопасности»",
      "Первенстко Республики Дагестан в дисциплине «программирование алгоритмическое»",
    ]);
    expect(ev[0]).toMatchObject({ city: "Махачкала", participants: 50, dateFrom: "2026-09-01", dateTo: "2026-09-30" });
  });
});
