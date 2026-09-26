import type { NextRequest } from "next/server";
import { queryEvents } from "@/lib/server/query";

export const dynamic = "force-dynamic";

const COLS: [string, (e: import("@/lib/types").SportEvent, fed?: import("@/lib/types").Federation) => unknown][] = [
  ["Источник", (e) => (e.source === "ekp" ? "ЕКП" : "ФСП")],
  ["№ СМ в ЕКП", (e) => e.ekpId],
  ["Название", (e) => e.name],
  ["Уровень", (e) => e.level],
  ["Начало", (e) => e.dateFrom],
  ["Окончание", (e) => e.dateTo],
  ["Субъект РФ", (e) => e.region],
  ["Фед. округ", (e) => e.federalDistrict],
  ["Город", (e) => e.city],
  ["Онлайн", (e) => (e.isOnline ? "да" : "нет")],
  ["Дисциплины", (e) => e.disciplines.join("; ")],
  ["Пол / возраст", (e) => e.genderAge],
  ["Участников", (e) => e.participants],
  ["Примечание", (e) => e.note],
  ["Ссылка", (e) => e.url],
  ["Руководитель отделения ФСП", (_e, f) => f?.head],
  ["E-mail отделения ФСП", (_e, f) => f?.email],
  ["Исключено из источника", (e) => e.removedAt?.slice(0, 10)],
];

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: NextRequest) {
  const { ds, items } = await queryEvents(req.nextUrl.searchParams);
  const fed = new Map(ds.federations.map((f) => [f.regionCode, f]));
  const rows = [COLS.map(([h]) => h), ...items.map((e) => COLS.map(([, g]) => g(e, e.regionCode ? fed.get(e.regionCode) : undefined)))];
  // BOM + «;» — чтобы Excel открыл кириллицу без мастера импорта
  const csv = "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n");
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="ekp-events-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
