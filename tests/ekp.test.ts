import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { latestPerYear, parsePart2Links } from "../lib/ekp/fetchIndex";
import { detectLevel, splitDisciplines } from "../lib/ekp/parseSection";
import { parsePart2 } from "../lib/sync/ekp";

const fx = (n: string) => new Uint8Array(readFileSync(`fixtures/${n}`));
const strip = <T extends { page: number }>(r: T[]) => r.map(({ page: _p, ...x }) => x);

describe("часть II ЕКП", () => {
  for (const [year, count] of [[2024, 22], [2025, 38], [2026, 41]] as const) {
    it(`${year}: ${count} мероприятий, совпадает с эталоном`, async () => {
      const { records } = await parsePart2(fx(`ekp-part2-${year}.pdf`));
      expect(records).toHaveLength(count);
      const expected = JSON.parse(readFileSync(`fixtures/ekp-part2-${year}.expected.json`, "utf8"));
      expect(strip(records)).toEqual(strip(expected));
      for (const r of records) {
        expect(r.ekpId).toMatch(/^2101\d{12}$/);
        expect(r.dateFrom <= r.dateTo).toBe(true);
        expect(r.dateFrom.startsWith(String(year))).toBe(true);
        expect(r.disciplines.length).toBeGreaterThan(0);
        expect(r.participants).toBeGreaterThan(0);
      }
    });
  }

  it("2026: многострочные поля, онлайн, перенос через страницу", async () => {
    const { records } = await parsePart2(fx("ekp-part2-2026.pdf"));
    const byId = new Map(records.map((r) => [r.ekpId, r]));
    const utm = byId.get("2101260024056626")!;
    expect(utm.disciplines).toHaveLength(6);
    expect(utm.city).toBe("Кисловодск");
    expect(utm.genderAge).toBe("юноши, девушки до 19 лет, женщины, мужчины от 16 лет и старше");
    const online = byId.get("2101000020046569")!;
    expect(online.isOnline).toBe(true);
    expect(online.note).toBe("Онлайн этап Кубка России");
    const fe = byId.get("2101250023058912")!;
    expect(fe.name).toBe('МЕЖРЕГИОНАЛЬНЫЕ СОРЕВНОВАНИЯ "КУБОК ДАЛЬНЕГО ВОСТОКА"');
    expect(fe.federalDistrict).toBe("Дальневосточный");
    // первая запись после «Стр. 1851 из 2684»
    expect(byId.get("2101000020046573")!.dateFrom).toBe("2026-03-26");
    expect(records.filter((r) => r.squad?.startsWith("Молодежный"))).toHaveLength(13);
  });

  it("ссылки на часть II со страницы Минспорта", () => {
    const docs = latestPerYear(parsePart2Links(readFileSync("fixtures/minsport-ekp-page.html", "utf8")));
    expect(docs.map((d) => [d.year, d.asOf])).toEqual([
      [2026, "2026-09-15"],
      [2025, "2025-12-30"],
      [2024, "2024-12-28"],
    ]);
  });

  it("дисциплины и примечание", () => {
    expect(splitDisciplines("ПРОГРАММИРОВАНИЕ ПРОДУКТОВОЕ, Отборочный этап Кубка России")).toEqual({
      disciplines: ["ПРОГРАММИРОВАНИЕ ПРОДУКТОВОЕ"],
      note: "Отборочный этап Кубка России",
    });
  });

  it("уровень мероприятия", () => {
    expect(detectLevel("КУБОК РОССИИ_1 ЭТАП")).toBe("Кубок России");
    expect(detectLevel("ПЕРВЕНСТВО ФЕДЕРАЛЬНОГО ОКРУГА (ЮЖНЫЙ ФЕДЕРАЛЬНЫЙ ОКРУГ)")).toBe("Первенство ФО");
    expect(detectLevel("Всероссийское физкультурное мероприятие")).toBe("Всероссийские");
  });
});
