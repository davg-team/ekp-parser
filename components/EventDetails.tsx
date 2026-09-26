"use client";

import { ArrowLeft } from "@gravity-ui/icons";
import { Button, Card, Icon, Label, Link, Text } from "@gravity-ui/uikit";
import { useQuery } from "@tanstack/react-query";
import { AppLink } from "./AppLink";
import { useRouter } from "next/navigation";
import { FIELD_BY_KEY, status } from "@/lib/filters/fields";
import { getJson } from "@/lib/client/fetch";
import { fmtDate, fmtDateTime, fmtPeriod } from "@/lib/client/format";
import type { Federation, Revision, SourceDoc, SportEvent } from "@/lib/types";

type Resp = { event: SportEvent; revisions: Revision[]; federation: Federation | null; source: SourceDoc | null; related: SportEvent[] };

const KIND = { added: "Добавлено", changed: "Изменено", removed: "Исключено из источника", restored: "Возвращено" } as const;

const show = (v: unknown) => (v == null || v === "" ? "—" : Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "да" : "нет") : String(v));

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <>
      <Text color="secondary">{k}</Text>
      <div>{children}</div>
    </>
  );
}

export function EventDetails({ id }: { id: string }) {
  const router = useRouter();
  const q = useQuery({ queryKey: ["event", id], queryFn: () => getJson<Resp>(`/api/events/${encodeURIComponent(id)}`) });
  if (q.isLoading) return <Text>Загрузка…</Text>;
  if (q.error || !q.data) return <Text color="danger">Мероприятие не найдено</Text>;
  const { event: e, revisions, federation: f, source, related } = q.data;
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1000 }}>
      <div>
        <Button view="flat" onClick={() => (history.length > 1 ? router.back() : router.push("/"))}>
          <Icon data={ArrowLeft} /> К списку
        </Button>
      </div>
      <div>
        <Text variant="header-1">{e.name}</Text>
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <Label theme="info">{status(e, today)}</Label>
          <Label theme="utility">{e.level}</Label>
          <Label>{e.source === "ekp" ? "ЕКП Минспорта" : "Календарь ФСП"}</Label>
          {e.isOnline && <Label theme="info">Онлайн</Label>}
        </div>
      </div>

      <Card view="outlined" style={{ padding: 16 }}>
        <div className="kv">
          <Row k="Даты">{fmtPeriod(e.dateFrom, e.dateTo)}</Row>
          <Row k="Место">{e.isOnline ? "по месту нахождения участников" : [e.region, e.city, e.venue].filter(Boolean).join(", ") || "—"}</Row>
          <Row k="Федеральный округ">{e.federalDistrict ?? "—"}</Row>
          <Row k="Дисциплины">{e.disciplines.join(", ") || "—"}</Row>
          <Row k="Пол / возраст">{e.genderAge ?? "—"}</Row>
          <Row k="Состав">{e.squad ?? "—"}</Row>
          <Row k="Участников">{e.participants ?? "—"}</Row>
          <Row k="Примечание">{e.note ?? "—"}</Row>
          {e.ekpId && <Row k="№ СМ в ЕКП">{e.ekpId}</Row>}
          {e.url && (
            <Row k="Страница">
              <Link href={e.url} target="_blank">{e.url}</Link>
            </Row>
          )}
          <Row k="Источник">
            {source ? (
              <>
                <Link href={source.url} target="_blank">{source.kind === "ekp-part2" ? `ЕКП ${source.year}, часть II` : "Календарь ФСП"}</Link>
                {source.asOf && <span className="muted"> · по состоянию на {fmtDate(source.asOf)}</span>}
              </>
            ) : "—"}
          </Row>
          <Row k="Впервые найдено">{fmtDateTime(e.firstSeenAt)}</Row>
          <Row k="Последняя проверка">{fmtDateTime(e.lastSeenAt)}</Row>
          {e.removedAt && <Row k="Исключено">{fmtDateTime(e.removedAt)}</Row>}
        </div>
      </Card>

      <Card view="outlined" style={{ padding: 16 }}>
        <Text variant="subheader-2" as="div" style={{ marginBottom: 8 }}>Региональное отделение ФСП</Text>
        {f ? (
          <div className="kv">
            <Row k="Субъект">{f.region}</Row>
            <Row k="Руководитель">{f.head ?? "—"}</Row>
            <Row k="E-mail">{f.email ? <Link href={`mailto:${f.email}`}>{f.email}</Link> : "—"}</Row>
            {f.phone && <Row k="Телефон">{f.phone}</Row>}
            {f.url && <Row k="Страница"><Link href={f.url} target="_blank">{f.url}</Link></Row>}
          </div>
        ) : (
          <Text color="secondary">
            {e.isOnline || !e.regionCode ? "Место не привязано к субъекту — отделение не определено." : "Отделение не найдено в справочнике."}
          </Text>
        )}
      </Card>

      {related.length > 0 && (
        <Card view="outlined" style={{ padding: 16 }}>
          <Text variant="subheader-2" as="div" style={{ marginBottom: 8 }}>
            {e.source === "ekp" ? "То же мероприятие в календаре ФСП" : "То же мероприятие в ЕКП"}
          </Text>
          {related.map((r) => (
            <div key={r.id}>
              <AppLink href={`/events/${encodeURIComponent(r.id)}`}>{r.name}</AppLink>{" "}
              <span className="muted">· {fmtPeriod(r.dateFrom, r.dateTo)}</span>
            </div>
          ))}
        </Card>
      )}

      <Card view="outlined" style={{ padding: 16 }}>
        <Text variant="subheader-2" as="div" style={{ marginBottom: 8 }}>История изменений</Text>
        {revisions.length === 0 && <Text color="secondary">Нет записей</Text>}
        {revisions.map((r, i) => (
          <div key={i} style={{ marginBottom: 10 }}>
            <Text variant="body-2">{KIND[r.kind]}</Text> <span className="muted">· {fmtDateTime(r.at)}</span>
            {Object.entries(r.changes).map(([k, v]) => (
              <div key={k} style={{ marginLeft: 12 }}>
                <span className="muted">{FIELD_BY_KEY.get(k)?.label ?? k}:</span> <span className="diff-from">{show(v.from)}</span> →{" "}
                <span className="diff-to">{show(v.to)}</span>
              </div>
            ))}
          </div>
        ))}
      </Card>
    </div>
  );
}
