import type { Group, Rule } from "../filters/ast";

/** Быстрые фильтры над таблицей — живут в URL отдельными параметрами и превращаются в правила AST. */
export type Quick = {
  status: string[];
  year: string[];
  level: string[];
  region: string[];
  federalDistrict: string[];
  disciplines: string[];
  source: string[];
  format: "" | "online" | "offline";
  from: string;
  to: string;
};

export const QUICK_PARAMS: Record<keyof Quick, string> = {
  status: "st",
  year: "y",
  level: "lv",
  region: "rg",
  federalDistrict: "fo",
  disciplines: "dc",
  source: "src",
  format: "fmt",
  from: "from",
  to: "to",
};

export const DEFAULT_STATUS = ["Предстоит", "Идёт"];

const listParam = (p: URLSearchParams, k: string) => (p.get(k) ? p.get(k)!.split("|").filter(Boolean) : []);

export function readQuick(p: URLSearchParams): Quick {
  return {
    status: p.has("st") ? listParam(p, "st") : DEFAULT_STATUS,
    year: listParam(p, "y"),
    level: listParam(p, "lv"),
    region: listParam(p, "rg"),
    federalDistrict: listParam(p, "fo"),
    disciplines: listParam(p, "dc"),
    source: listParam(p, "src"),
    format: (p.get("fmt") as Quick["format"]) ?? "",
    from: p.get("from") ?? "",
    to: p.get("to") ?? "",
  };
}

export function writeQuick(p: URLSearchParams, q: Quick) {
  for (const [key, param] of Object.entries(QUICK_PARAMS) as [keyof Quick, string][]) {
    const v = q[key];
    p.delete(param);
    if (key === "status") {
      if (JSON.stringify(v) !== JSON.stringify(DEFAULT_STATUS)) p.set(param, (v as string[]).join("|"));
    } else if (Array.isArray(v)) {
      if (v.length) p.set(param, v.join("|"));
    } else if (v) p.set(param, v);
  }
}

export function quickRules(q: Quick): Rule[] {
  const r: Rule[] = [];
  const inList = (field: string, v: string[]) => v.length && r.push({ type: "rule", field, op: "in", value: v });
  inList("status", q.status);
  if (q.year.length) r.push({ type: "rule", field: "year", op: "eq", value: Number(q.year[0]) });
  inList("level", q.level);
  inList("region", q.region);
  inList("federalDistrict", q.federalDistrict);
  inList("source", q.source);
  if (q.disciplines.length) r.push({ type: "rule", field: "disciplines", op: "any", value: q.disciplines });
  if (q.format) r.push({ type: "rule", field: "isOnline", op: q.format === "online" ? "isTrue" : "isFalse" });
  // период: мероприятие пересекается с [from, to]
  if (q.from) r.push({ type: "rule", field: "dateTo", op: "between", value: [q.from, ""] });
  if (q.to) r.push({ type: "rule", field: "dateFrom", op: "between", value: ["", q.to] });
  return r;
}

export function composeFilter(q: Quick, advanced: Group, years: string[]): Group {
  const rules = quickRules(q);
  // несколько лет — ИЛИ по году
  if (q.year.length > 1) {
    rules.splice(rules.findIndex((x) => x.field === "year"), 1);
    const g: Group = { type: "group", op: "or", children: years.filter((y) => q.year.includes(y)).map((y) => ({ type: "rule", field: "year", op: "eq", value: Number(y) })) };
    return { type: "group", op: "and", children: [...rules, g, ...(advanced.children.length ? [advanced] : [])] };
  }
  return { type: "group", op: "and", children: [...rules, ...(advanced.children.length ? [advanced] : [])] };
}
