"use client";

import { SOURCE_LABEL } from "@/lib/filters/fields";
import {
  Label,
  Link,
  Table,
  Text,
  withTableSettings,
  withTableSorting,
  type TableColumnConfig,
  type TableSettingsData,
  type TableSortState,
  type WithTableSortingProps,
} from "@gravity-ui/uikit";
import { AppLink } from "./AppLink";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SortKey } from "@/lib/filters/ast";
import { status } from "@/lib/filters/fields";
import { fmtPeriod, shortDiscipline } from "@/lib/client/format";
import type { EventRow } from "@/lib/client/types";

const SortableTable = withTableSettings<EventRow, WithTableSortingProps>({ sortable: true })(withTableSorting<EventRow>(Table));

const STATUS_THEME = { Предстоит: "info", Идёт: "success", Прошло: "normal", Исключено: "danger" } as const;

function useColumnSettings(key: string, ids: string[], hidden: string[]) {
  const def = useMemo(() => ids.map((id) => ({ id, isSelected: !hidden.includes(id) })), [ids, hidden]);
  const [settings, setSettings] = useState<TableSettingsData>(def);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null") as TableSettingsData | null;
      if (Array.isArray(saved)) {
        const known = saved.filter((s) => ids.includes(s.id));
        for (const id of ids) if (!known.some((s) => s.id === id)) known.push({ id, isSelected: !hidden.includes(id) });
        setSettings(known);
      }
    } catch {}
  }, [key, ids, hidden]);
  const update = useCallback(
    (s: TableSettingsData) => {
      setSettings(s);
      try {
        localStorage.setItem(key, JSON.stringify(s));
      } catch {}
    },
    [key],
  );
  return { settings, update, def };
}

const HIDDEN_BY_DEFAULT = ["genderAge", "squad", "ekpId", "firstSeenAt", "federation", "year"];

export function EventsTable({ items, sort, onSort, today }: { items: EventRow[]; sort: SortKey[]; onSort: (s: SortKey[]) => void; today: string }) {
  const columns: TableColumnConfig<EventRow>[] = useMemo(
    () => [
      {
        id: "dateFrom",
        name: "Даты",
        meta: { sort: true },
        template: (e) => (
          <div style={{ whiteSpace: "nowrap" }}>
            <div>{fmtPeriod(e.dateFrom, e.dateTo)}</div>
            <Label size="xs" theme={STATUS_THEME[status(e, today) as keyof typeof STATUS_THEME]}>
              {status(e, today)}
            </Label>
          </div>
        ),
      },
      {
        id: "name",
        name: "Мероприятие",
        width: 400,
        meta: { sort: true },
        template: (e) => (
          <div className="cell-name">
            <AppLink href={`/event/?id=${encodeURIComponent(e.id)}`} view="primary">{e.name}</AppLink>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
              <Label size="xs" theme="utility">{e.level}</Label>
              <Label size="xs" theme={e.source === "ekp" ? "clear" : e.source === "fsp" ? "warning" : "info"}>{SOURCE_LABEL[e.source]}</Label>
              {e.linkedId && <Label size="xs" theme="clear">ЕКП+ФСП</Label>}
            </div>
            {e.note && <Text variant="caption-2" color="secondary">{e.note}</Text>}
          </div>
        ),
      },
      {
        id: "region",
        name: "Место",
        meta: { sort: true },
        template: (e) =>
          e.isOnline ? (
            <Label size="xs" theme="info">Онлайн</Label>
          ) : (
            <div>
              <div>{e.city ?? "—"}</div>
              <Text variant="caption-2" color="secondary">{e.region}</Text>
            </div>
          ),
      },
      { id: "federalDistrict", name: "Фед. округ", meta: { sort: true }, template: (e) => e.federalDistrict ?? "—" },
      {
        id: "disciplines",
        name: "Дисциплины",
        template: (e) => (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", maxWidth: 260 }}>
            {e.disciplines.map((d) => (
              <Label key={d} size="xs" theme="normal" title={d}>{shortDiscipline(d)}</Label>
            ))}
          </div>
        ),
      },
      { id: "participants", name: "Участников", align: "end", meta: { sort: true }, template: (e) => e.participants ?? "—" },
      { id: "daysLeft", name: "Дней до старта", align: "end", meta: { sort: true }, template: (e) => {
        const d = Math.round((Date.parse(e.dateFrom) - Date.parse(today)) / 86_400_000);
        return d >= 0 ? d : "—";
      } },
      {
        id: "federation",
        name: "Отделение ФСП",
        template: (e) =>
          e.federation ? (
            <div style={{ maxWidth: 220 }}>
              <div>{e.federation.head ?? "—"}</div>
              {e.federation.email && <Link href={`mailto:${e.federation.email}`}>{e.federation.email}</Link>}
            </div>
          ) : "—",
      },
      { id: "genderAge", name: "Пол / возраст", meta: { sort: true }, template: (e) => e.genderAge ?? "—" },
      { id: "squad", name: "Состав", meta: { sort: true }, template: (e) => e.squad ?? "—" },
      { id: "year", name: "Год", meta: { sort: true }, template: (e) => e.year },
      { id: "ekpId", name: "№ СМ в ЕКП", meta: { sort: true }, template: (e) => e.ekpId ?? "—" },
      { id: "firstSeenAt", name: "Найдено", meta: { sort: true }, template: (e) => e.firstSeenAt.slice(0, 10) },
    ],
    [today],
  );
  const ids = useMemo(() => columns.map((c) => c.id), [columns]);
  const { settings, update, def } = useColumnSettings("ekp_table_columns_v1", ids, HIDDEN_BY_DEFAULT);
  const sortState: TableSortState = sort.map((s) => ({ column: s.field, order: s.dir }));

  return (
    <div className="events-table">
      <SortableTable
        data={items}
        columns={columns}
        getRowDescriptor={(e) => ({ id: e.id, classNames: [e.removedAt ? "row-removed" : e.dateTo < today ? "row-past" : ""].filter(Boolean) })}
        sortState={sortState}
        onSortStateChange={(s) => onSort(s.map((x) => ({ field: x.column, dir: x.order })))}
        disableDataSorting
        settings={settings}
        updateSettings={update}
        defaultSettings={def}
        showResetButton
        emptyMessage="Ничего не найдено — ослабьте фильтры"
        wordWrap
      />
    </div>
  );
}
