import type { SportEvent } from "../types";
import type { Group, Node, Rule, SortKey } from "./ast";
import { FIELD_BY_KEY } from "./fields";

const norm = (v: unknown) => String(v ?? "").toLocaleLowerCase("ru").replace(/ё/g, "е");
const isEmpty = (v: unknown) => v == null || v === "" || (Array.isArray(v) && v.length === 0);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v == null || v === "" ? [] : [String(v)]);

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function monthRange(today: string, offset: number): [string, string] {
  const d = new Date(`${today}T00:00:00Z`);
  const a = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
  const b = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset + 1, 0));
  return [a.toISOString().slice(0, 10), b.toISOString().slice(0, 10)];
}

export function evalRule(r: Rule, e: SportEvent, today: string): boolean {
  const f = FIELD_BY_KEY.get(r.field);
  if (!f) return true; // неизвестное поле не режет выборку
  const v = f.get(e, today);
  const val = r.value;
  if (r.op === "empty") return isEmpty(v);
  if (r.op === "notEmpty") return !isEmpty(v);
  switch (f.type) {
    case "text": {
      const s = norm(v);
      const q = norm(val);
      if (r.op === "contains") return s.includes(q);
      if (r.op === "notContains") return !s.includes(q);
      if (r.op === "eq") return s === q;
      if (r.op === "startsWith") return s.startsWith(q);
      return true;
    }
    case "enum": {
      const vals = list(val);
      if (r.op === "in") return !vals.length || vals.includes(String(v ?? ""));
      if (r.op === "notIn") return !vals.includes(String(v ?? ""));
      return true;
    }
    case "array": {
      const have = (v as string[]) ?? [];
      const want = list(val);
      if (!want.length) return true;
      if (r.op === "any") return want.some((w) => have.includes(w));
      if (r.op === "all") return want.every((w) => have.includes(w));
      if (r.op === "none") return !want.some((w) => have.includes(w));
      return true;
    }
    case "date": {
      const d = v as string | null;
      if (!d) return false;
      const [a, b] = list(val);
      const n = Number(a);
      switch (r.op) {
        case "eq": return d === a;
        case "before": return d < a;
        case "after": return d > a;
        case "between": return (!a || d >= a) && (!b || d <= b);
        case "nextDays": return d >= today && d <= addDays(today, n || 0);
        case "lastDays": return d <= today && d >= addDays(today, -(n || 0));
        case "thisMonth": { const [x, y] = monthRange(today, 0); return d >= x && d <= y; }
        case "nextMonth": { const [x, y] = monthRange(today, 1); return d >= x && d <= y; }
        case "thisQuarter": {
          const m = Number(today.slice(5, 7)) - 1;
          const [x] = monthRange(today, -(m % 3));
          const [, y] = monthRange(today, 2 - (m % 3));
          return d >= x && d <= y;
        }
        case "thisYear": return d.slice(0, 4) === today.slice(0, 4);
      }
      return true;
    }
    case "number": {
      if (v == null) return false;
      const x = Number(v);
      const [a, b] = list(val).map(Number);
      switch (r.op) {
        case "eq": return x === a;
        case "neq": return x !== a;
        case "lt": return x < a;
        case "lte": return x <= a;
        case "gt": return x > a;
        case "gte": return x >= a;
        case "between": return (Number.isNaN(a) || x >= a) && (Number.isNaN(b) || x <= b);
      }
      return true;
    }
    case "bool":
      return r.op === "isTrue" ? !!v : !v;
  }
}

export function evalNode(n: Node, e: SportEvent, today: string): boolean {
  if (n.type === "rule") return evalRule(n, e, today);
  const kids = n.children;
  const res = !kids.length ? true : n.op === "and" ? kids.every((k) => evalNode(k, e, today)) : kids.some((k) => evalNode(k, e, today));
  return n.not ? !res : res;
}

export function matchesSearch(e: SportEvent, q: string): boolean {
  if (!q.trim()) return true;
  const hay = norm([e.name, e.region, e.city, e.venue, e.note, e.genderAge, e.organizer, e.ekpId, ...e.disciplines].join(" "));
  return norm(q).split(/\s+/).every((t) => hay.includes(t));
}

export function sortEvents(list: SportEvent[], sort: SortKey[], today: string): SportEvent[] {
  const keys = sort.length ? sort : [{ field: "dateFrom", dir: "asc" as const }];
  const getters = keys.map((k) => ({ f: FIELD_BY_KEY.get(k.field), dir: k.dir === "desc" ? -1 : 1 }));
  return [...list].sort((a, b) => {
    for (const { f, dir } of getters) {
      if (!f) continue;
      const x = f.get(a, today);
      const y = f.get(b, today);
      // пустые — всегда в конце
      if (isEmpty(x) && isEmpty(y)) continue;
      if (isEmpty(x)) return 1;
      if (isEmpty(y)) return -1;
      const c =
        typeof x === "number" && typeof y === "number"
          ? x - y
          : typeof x === "boolean"
            ? Number(x) - Number(y)
            : String(Array.isArray(x) ? x.join(",") : x).localeCompare(String(Array.isArray(y) ? y.join(",") : y), "ru");
      if (c) return c * dir;
    }
    return a.id.localeCompare(b.id);
  });
}

export function applyQuery(events: SportEvent[], filter: Group, q: string, sort: SortKey[], today: string) {
  return sortEvents(
    events.filter((e) => matchesSearch(e, q) && evalNode(filter, e, today)),
    sort,
    today,
  );
}
