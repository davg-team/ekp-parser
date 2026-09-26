import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cardToEvent, parseCalendarPage, parseEventDetail } from "../lib/fsp/calendar";
import { parseFederations } from "../lib/fsp/regions";

const html = (n: string) => readFileSync(`fixtures/${n}`, "utf8");

describe("ФСП", () => {
  it("справочник отделений: все субъекты распознаны", () => {
    const f = parseFederations(html("fsp-regions.html"));
    expect(f.length).toBeGreaterThanOrEqual(85);
    expect(f.find((x) => x.regionCode === 77)?.email).toBe("fspmsk@mail.ru");
    expect(f.every((x) => x.regionCode)).toBe(true);
    expect(new Set(f.map((x) => x.regionCode)).size).toBe(f.length);
    const altai = f.find((x) => x.regionCode === 4)!;
    expect(altai.email).toBe("altai@fsp-russia.ru");
    expect(altai.head).toBe("Шило Светлана Анатольевна");
  });

  it("календарь и карточка мероприятия", () => {
    const cards = parseCalendarPage(html("fsp-calendar-2026-09.html"));
    expect(cards).toHaveLength(3);
    const detail = parseEventDetail(html("fsp-event-detail.html"));
    expect(detail).toEqual({ dateFrom: "2026-09-11", dateTo: "2026-09-17", format: "Оффлайн", city: "Екатеринбург" });
    const ev = cardToEvent(cards.find((c) => c.slug === "mezhdunarodnye-sportivnye-sorevnovaniya")!, detail)!;
    expect(ev).toMatchObject({ regionCode: 66, city: "Екатеринбург", isOnline: false, dateTo: "2026-09-17", level: "Международные" });
    const online = cardToEvent(cards.find((c) => c.location === "по месту нахождения участников")!, null)!;
    expect(online.isOnline).toBe(true);
    expect(online.region).toBeNull();
  });
});
