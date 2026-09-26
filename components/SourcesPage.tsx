"use client";

import { Card, Label, Link, Table, Text } from "@gravity-ui/uikit";
import { useQuery } from "@tanstack/react-query";
import { AppLink } from "./AppLink";
import { getJson } from "@/lib/client/fetch";
import { fmtDate, fmtDateTime } from "@/lib/client/format";
import type { Revision, SourceDoc, SyncLogEntry } from "@/lib/types";

type Resp = { sources: SourceDoc[]; syncLog: SyncLogEntry[]; recentRevisions: (Revision & { name: string })[] };
const KIND = { added: ["Добавлено", "success"], changed: ["Изменено", "warning"], removed: ["Исключено", "danger"], restored: ["Возвращено", "info"] } as const;
const SRC = { "ekp-part2": "ЕКП, часть II", "fsp-calendar": "Календарь ФСП", "fsp-regions": "Отделения ФСП", region: "Отделение" } as const;

export function SourcesPage() {
  const q = useQuery({ queryKey: ["sources"], queryFn: () => getJson<Resp>("/api/sources") });
  const d = q.data;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Text variant="header-1">Источники и история</Text>
      <Card view="outlined" style={{ padding: 16 }}>
        <Text variant="subheader-2" as="div" style={{ marginBottom: 8 }}>Загруженные документы</Text>
        <div className="events-table">
          <Table
            data={d?.sources ?? []}
            columns={[
              { id: "kind", name: "Источник", template: (s) => (s.kind === "region" ? <Link href={s.url} target="_blank">{s.url.replace(/^https?:\/\//, "")}</Link> : `${SRC[s.kind]}${s.year ? ` ${s.year}` : ""}`) },
              { id: "asOf", name: "По состоянию на", template: (s) => fmtDate(s.asOf) },
              { id: "eventsCount", name: "Записей", align: "end", template: (s) => s.eventsCount ?? "—" },
              { id: "fetchedAt", name: "Загружено", template: (s) => fmtDateTime(s.fetchedAt) },
              { id: "status", name: "Статус", template: (s) => (s.status === "ok" ? <Label theme="success">ok</Label> : <Label theme="danger" title={s.error ?? ""}>ошибка</Label>) },
              { id: "url", name: "Ссылка", template: (s) => <Link href={s.url} target="_blank">открыть</Link> },
              { id: "error", name: "", template: (s) => (s.error ? <Text color="danger">{s.error}</Text> : null) },
            ]}
          />
        </div>
      </Card>
      <Card view="outlined" style={{ padding: 16 }}>
        <Text variant="subheader-2" as="div" style={{ marginBottom: 8 }}>Последние изменения мероприятий</Text>
        {(d?.recentRevisions ?? []).map((r, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 4 }}>
            <span className="muted" style={{ minWidth: 120 }}>{fmtDateTime(r.at)}</span>
            <Label size="xs" theme={KIND[r.kind][1]}>{KIND[r.kind][0]}</Label>
            <AppLink href={`/event/?id=${encodeURIComponent(r.eventId)}`}>{r.name}</AppLink>
            {r.kind === "changed" && <span className="muted">({Object.keys(r.changes).join(", ")})</span>}
          </div>
        ))}
      </Card>
      <Card view="outlined" style={{ padding: 16 }}>
        <Text variant="subheader-2" as="div" style={{ marginBottom: 8 }}>Журнал обновлений</Text>
        {(d?.syncLog ?? []).map((l, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 4 }}>
            <span className="muted" style={{ minWidth: 120 }}>{fmtDateTime(l.at)}</span>
            <Label size="xs" theme={l.ok ? "success" : "danger"}>{l.job}</Label>
            <span className="muted">{Math.round(l.durationMs / 1000)} с</span>
            <Text ellipsis title={l.message} style={{ maxWidth: 700 }}>{l.message}</Text>
          </div>
        ))}
      </Card>
    </div>
  );
}
