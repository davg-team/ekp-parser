"use client";

import { Link, Table, Text, TextInput, withTableSorting, type TableColumnConfig } from "@gravity-ui/uikit";
import { useQuery } from "@tanstack/react-query";
import { AppLink } from "./AppLink";
import { useMemo, useState } from "react";
import { encodeFilter } from "@/lib/filters/ast";
import { getJson } from "@/lib/client/fetch";
import type { Federation } from "@/lib/types";

type Row = Federation & { eventsTotal: number; eventsUpcoming: number };
const SortTable = withTableSorting<Row>(Table);

export function FederationsPage() {
  const q = useQuery({ queryKey: ["federations"], queryFn: () => getJson<Row[]>("/api/federations") });
  const [search, setSearch] = useState("");
  const rows = useMemo(() => {
    const s = search.toLowerCase();
    return (q.data ?? []).filter((f) => !s || [f.region, f.head, f.email, f.federalDistrict].join(" ").toLowerCase().includes(s));
  }, [q.data, search]);
  const columns: TableColumnConfig<Row>[] = [
    { id: "region", name: "Субъект РФ", meta: { sort: (a: Row, b: Row) => a.region.localeCompare(b.region, "ru") } },
    { id: "federalDistrict", name: "Фед. округ", meta: { sort: (a: Row, b: Row) => (a.federalDistrict ?? "").localeCompare(b.federalDistrict ?? "", "ru") } },
    { id: "head", name: "Руководитель", template: (f) => f.head ?? "—" },
    { id: "email", name: "E-mail", template: (f) => (f.email ? <Link href={`mailto:${f.email}`}>{f.email}</Link> : "—") },
    {
      id: "eventsUpcoming",
      name: "Предстоит",
      align: "end",
      meta: { sort: (a: Row, b: Row) => a.eventsUpcoming - b.eventsUpcoming },
      template: (f) =>
        f.eventsTotal ? (
          <AppLink href={`/?rg=${encodeURIComponent(f.region)}`}>{f.eventsUpcoming}</AppLink>
        ) : "0",
    },
    {
      id: "eventsTotal",
      name: "Всего",
      align: "end",
      meta: { sort: (a: Row, b: Row) => a.eventsTotal - b.eventsTotal },
      template: (f) =>
        f.eventsTotal ? (
          <AppLink href={`/?st=&f=${encodeFilter({ type: "group", op: "and", children: [{ type: "rule", field: "region", op: "in", value: [f.region] }] })}`}>{f.eventsTotal}</AppLink>
        ) : "0",
    },
    { id: "url", name: "", template: (f) => (f.url ? <Link href={f.url} target="_blank">fsp-russia.ru</Link> : null) },
  ];
  return (
    <div>
      <div className="page-head">
        <div>
          <Text variant="header-1">Региональные отделения ФСП</Text>
          <div><Text color="secondary">{q.data ? `${q.data.length} отделений · источник: fsp-russia.ru/region/regions` : "Загрузка…"}</Text></div>
        </div>
        <TextInput placeholder="Поиск" value={search} onUpdate={setSearch} hasClear style={{ width: 260 }} />
      </div>
      <div className="events-table">
        <SortTable data={rows} columns={columns} defaultSortState={[{ column: "region", order: "asc" }]} emptyMessage="Нет данных — запустите обновление" />
      </div>
    </div>
  );
}
