"use client";

import { RangeDatePicker } from "@gravity-ui/date-components";
import { dateTimeParse } from "@gravity-ui/date-utils";
import { ArrowDownToLine, ArrowRotateRight, BarsDescendingAlignLeft, Bookmark, Funnel, TrashBin, Xmark } from "@gravity-ui/icons";
import {
  Button,
  Card,
  Dialog,
  DropdownMenu,
  Icon,
  Pagination,
  SegmentedRadioGroup,
  Select,
  Text,
  TextInput,
  useToaster,
} from "@gravity-ui/uikit";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { decodeFilter, decodeSort, encodeFilter, encodeSort, type Group, type SortKey } from "@/lib/filters/ast";
import { FIELD_BY_KEY } from "@/lib/filters/fields";
import { fmtDateTime, plural, shortDiscipline } from "@/lib/client/format";
import { composeFilter, DEFAULT_STATUS, readQuick, writeQuick, type Quick } from "@/lib/client/quick";
import { getJson } from "@/lib/client/fetch";
import type { EventsResponse, MetaResponse } from "@/lib/client/types";
import type { SavedView } from "@/lib/types";
import { EventsTable } from "./EventsTable";
import { countRules, FilterBuilder } from "./FilterBuilder";

const PAGE_SIZE_KEY = "ekp_page_size";
const moscowToday = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" });

function MultiSelect({ label, value, options, onUpdate, width = 200, render }: { label: string; value: string[]; options: string[]; onUpdate: (v: string[]) => void; width?: number; render?: (v: string) => string }) {
  return (
    <Select
      label={label}
      multiple
      filterable={options.length > 8}
      hasClear
      width={width}
      value={value}
      onUpdate={onUpdate}
      placeholder="все"
      options={options.map((o) => ({ value: o, content: render ? render(o) : o }))}
    />
  );
}

export function EventsPage() {
  const params = useSearchParams() ?? new URLSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const toaster = useToaster();
  const qc = useQueryClient();
  const today = moscowToday();

  const quick = useMemo(() => readQuick(new URLSearchParams(params.toString())), [params]);
  const advanced = useMemo(() => decodeFilter(params.get("f")), [params]);
  const sort = useMemo<SortKey[]>(() => {
    const s = decodeSort(params.get("s"));
    return s.length ? s : [{ field: "dateFrom", dir: "asc" }];
  }, [params]);
  const search = params.get("q") ?? "";
  const page = Number(params.get("p") ?? 1);
  const [pageSize, setPageSize] = useState(50);
  useEffect(() => {
    try {
      const v = Number(localStorage.getItem(PAGE_SIZE_KEY));
      if (v) setPageSize(v);
    } catch {}
  }, []);

  const [builderOpen, setBuilderOpen] = useState(advanced.children.length > 0);
  const [draft, setDraft] = useState<Group>(advanced);
  useEffect(() => setDraft(advanced), [advanced]);
  const [searchDraft, setSearchDraft] = useState(search);
  useEffect(() => setSearchDraft(search), [search]);

  const update = (fn: (p: URLSearchParams) => void, resetPage = true) => {
    const p = new URLSearchParams(params.toString());
    fn(p);
    if (resetPage) p.delete("p");
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };
  const setQuick = (patch: Partial<Quick>) => update((p) => writeQuick(p, { ...quick, ...patch }));
  const setSort = (s: SortKey[]) => update((p) => (s.length ? p.set("s", encodeSort(s)) : p.delete("s")), false);
  const applyAdvanced = (g: Group) => update((p) => (encodeFilter(g) ? p.set("f", encodeFilter(g)) : p.delete("f")));

  // поиск — с задержкой, чтобы не дёргать URL на каждый символ
  useEffect(() => {
    if (searchDraft === search) return;
    const t = setTimeout(() => update((p) => (searchDraft ? p.set("q", searchDraft) : p.delete("q"))), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  const meta = useQuery({ queryKey: ["meta"], queryFn: () => getJson<MetaResponse>("/api/meta") });
  const options = meta.data?.options ?? {};
  const yearOptions = useMemo(() => {
    const all = new Set<string>();
    const cur = new Date().getFullYear();
    for (let y = cur + 1; y >= cur - 3; y--) all.add(String(y));
    return [...all];
  }, []);

  const apiParams = useMemo(() => {
    const p = new URLSearchParams();
    const f = encodeFilter(composeFilter(quick, advanced, yearOptions));
    if (f) p.set("f", f);
    p.set("s", encodeSort(sort));
    if (search) p.set("q", search);
    return p.toString();
  }, [quick, advanced, sort, search, yearOptions]);

  const events = useQuery({ queryKey: ["events", apiParams], queryFn: () => getJson<EventsResponse>(`/api/events?${apiParams}`), placeholderData: (prev) => prev });
  const views = useQuery({ queryKey: ["views"], queryFn: () => getJson<SavedView[]>("/api/views") });

  const sync = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/sync?job=all", { method: "POST" });
      const body = await r.json().catch(() => []);
      if (!r.ok) throw new Error((body as { message?: string }[]).filter((x) => x.message).map((x) => x.message).join("; ") || `HTTP ${r.status}`);
      return body;
    },
    onSuccess: () => {
      toaster.add({ name: "sync", title: "Данные обновлены", theme: "success", autoHiding: 4000 });
      qc.invalidateQueries();
    },
    onError: (e) => toaster.add({ name: "sync", title: "Обновление с ошибками", content: String((e as Error).message).slice(0, 300), theme: "danger" }),
  });

  const [saveOpen, setSaveOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const saveView = useMutation({
    mutationFn: async () => {
      const p = new URLSearchParams(params.toString());
      p.delete("p");
      const r = await fetch("/api/views", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: viewName, query: p.toString() }) });
      if (!r.ok) throw new Error("save failed");
    },
    onSuccess: () => {
      setSaveOpen(false);
      setViewName("");
      qc.invalidateQueries({ queryKey: ["views"] });
      toaster.add({ name: "view", title: "Представление сохранено", theme: "success", autoHiding: 3000 });
    },
  });
  const deleteView = useMutation({
    mutationFn: (id: string) => fetch(`/api/views/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["views"] }),
  });

  const items = events.data?.items ?? [];
  const pageItems = items.slice((page - 1) * pageSize, page * pageSize);
  const advancedCount = countRules(advanced);
  const hasAnyFilter =
    advancedCount > 0 || !!search || JSON.stringify(quick) !== JSON.stringify(readQuick(new URLSearchParams()));

  return (
    <div>
      <div className="page-head">
        <div>
          <Text variant="header-1">Мероприятия</Text>
          <div>
            <Text color="secondary">
              {events.data ? `${events.data.total} ${plural(events.data.total, "мероприятие", "мероприятия", "мероприятий")} из ${events.data.all}` : "Загрузка…"}
              {meta.data?.lastSync && ` · обновлено ${fmtDateTime(meta.data.lastSync)}`}
            </Text>
          </div>
        </div>
        <div className="toolbar">
          <DropdownMenu
            renderSwitcher={(props) => (
              <Button {...props}>
                <Icon data={Bookmark} /> Представления{views.data?.length ? ` (${views.data.length})` : ""}
              </Button>
            )}
            items={[
              ...(views.data ?? []).map((v) => ({
                text: v.name,
                action: () => router.replace(`${pathname}?${v.query}`),
                items: undefined,
                iconEnd: (
                  <span
                    title="Удалить"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteView.mutate(v.id);
                    }}
                  >
                    <Icon data={TrashBin} size={14} />
                  </span>
                ),
              })),
              { text: "Сохранить текущие фильтры…", action: () => setSaveOpen(true) },
            ]}
          />
          <Button href={`/api/events/export?${apiParams}`} target="_blank">
            <Icon data={ArrowDownToLine} /> CSV
          </Button>
          <Button view="outlined" loading={sync.isPending} onClick={() => sync.mutate()} title="Скачать свежие ЕКП и календарь ФСП">
            <Icon data={ArrowRotateRight} /> Обновить
          </Button>
        </div>
      </div>

      <div className="quick-filters">
        <TextInput label="Поиск" placeholder="название, город, дисциплина…" value={searchDraft} onUpdate={setSearchDraft} hasClear style={{ width: 260 }} />
        <MultiSelect label="Статус" value={quick.status} options={options.status ?? DEFAULT_STATUS} onUpdate={(status) => setQuick({ status })} width={220} />
        <MultiSelect label="Год" value={quick.year} options={yearOptions} onUpdate={(year) => setQuick({ year })} width={140} />
        <MultiSelect label="Уровень" value={quick.level} options={options.level ?? []} onUpdate={(level) => setQuick({ level })} width={220} />
        <MultiSelect label="Дисциплины" value={quick.disciplines} options={options.disciplines ?? []} onUpdate={(disciplines) => setQuick({ disciplines })} render={shortDiscipline} width={220} />
        <MultiSelect label="Фед. округ" value={quick.federalDistrict} options={options.federalDistrict ?? []} onUpdate={(federalDistrict) => setQuick({ federalDistrict })} />
        <MultiSelect label="Субъект" value={quick.region} options={options.region ?? []} onUpdate={(region) => setQuick({ region })} width={240} />
        <MultiSelect label="Источник" value={quick.source} options={options.source ?? []} onUpdate={(source) => setQuick({ source })} width={170} />
        <SegmentedRadioGroup
          value={quick.format || "all"}
          onUpdate={(v) => setQuick({ format: v === "all" ? "" : (v as Quick["format"]) })}
          options={[
            { value: "all", content: "Все" },
            { value: "offline", content: "Очно" },
            { value: "online", content: "Онлайн" },
          ]}
        />
        <RangeDatePicker
          label="Период"
          format="DD.MM.YYYY"
          hasClear
          style={{ width: 280 }}
          value={quick.from || quick.to ? { start: dateTimeParse(quick.from || quick.to)!, end: dateTimeParse(quick.to || quick.from)! } : null}
          onUpdate={(r) => setQuick({ from: r?.start?.format("YYYY-MM-DD") ?? "", to: r?.end?.format("YYYY-MM-DD") ?? "" })}
        />
        <Button view={advancedCount ? "normal" : "outlined"} selected={builderOpen} onClick={() => setBuilderOpen((v) => !v)}>
          <Icon data={Funnel} /> Сложный фильтр{advancedCount ? ` (${advancedCount})` : ""}
        </Button>
        {hasAnyFilter && (
          <Button view="flat" onClick={() => router.replace(pathname)}>
            <Icon data={Xmark} /> Сбросить
          </Button>
        )}
      </div>

      {builderOpen && (
        <Card view="outlined" style={{ padding: 12, marginBottom: 12 }}>
          <Text variant="subheader-1">Условия</Text>
          <Text color="secondary" as="div" style={{ marginBottom: 8 }}>
            Складываются с быстрыми фильтрами через «И». Группы можно вкладывать и инвертировать.
          </Text>
          <FilterBuilder value={draft} onChange={setDraft} options={options} />
          <div className="toolbar" style={{ marginTop: 12 }}>
            <Button view="action" onClick={() => applyAdvanced(draft)}>Применить</Button>
            <Button view="flat" onClick={() => { setDraft({ type: "group", op: "and", children: [] }); applyAdvanced({ type: "group", op: "and", children: [] }); }}>
              Очистить
            </Button>
          </div>
        </Card>
      )}

      <div className="toolbar" style={{ marginBottom: 8 }}>
        <Icon data={BarsDescendingAlignLeft} className="muted" />
        <Text color="secondary">
          Сортировка: {sort.map((s) => `${FIELD_BY_KEY.get(s.field)?.label ?? s.field} ${s.dir === "asc" ? "↑" : "↓"}`).join(", ")}
          {" · "}⌘/Ctrl + клик по заголовку — добавить уровень
        </Text>
      </div>

      {events.error ? (
        <Text color="danger">Не удалось загрузить: {String(events.error)}</Text>
      ) : (
        <EventsTable items={pageItems} sort={sort} onSort={setSort} today={today} />
      )}

      {items.length > pageSize && (
        <div style={{ marginTop: 12 }}>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={items.length}
            pageSizeOptions={[25, 50, 100, 500]}
            onUpdate={(p, size) => {
              if (size !== pageSize) {
                setPageSize(size);
                try {
                  localStorage.setItem(PAGE_SIZE_KEY, String(size));
                } catch {}
              }
              update((q) => (p > 1 ? q.set("p", String(p)) : q.delete("p")), false);
            }}
          />
        </div>
      )}

      <Dialog open={saveOpen} onClose={() => setSaveOpen(false)} size="s">
        <Dialog.Header caption="Сохранить представление" />
        <Dialog.Body>
          <TextInput autoFocus placeholder="Например: «Очные в ЦФО на квартал»" value={viewName} onUpdate={setViewName} />
        </Dialog.Body>
        <Dialog.Footer
          textButtonApply="Сохранить"
          textButtonCancel="Отмена"
          propsButtonApply={{ disabled: !viewName.trim(), loading: saveView.isPending }}
          onClickButtonApply={() => saveView.mutate()}
          onClickButtonCancel={() => setSaveOpen(false)}
        />
      </Dialog>
    </div>
  );
}
