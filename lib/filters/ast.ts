import { z } from "zod";

export type Rule = { type: "rule"; field: string; op: string; value?: unknown };
export type Group = { type: "group"; op: "and" | "or"; not?: boolean; children: Node[] };
export type Node = Rule | Group;

const value = z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.union([z.string(), z.number()]))]);
export const RuleSchema = z.object({ type: z.literal("rule"), field: z.string().max(64), op: z.string().max(32), value: value.optional() });
export const NodeSchema: z.ZodType<Node> = z.lazy(() =>
  z.union([
    RuleSchema,
    z.object({ type: z.literal("group"), op: z.enum(["and", "or"]), not: z.boolean().optional(), children: z.array(NodeSchema).max(100) }),
  ]),
) as z.ZodType<Node>;

export const emptyGroup = (): Group => ({ type: "group", op: "and", children: [] });

export type SortKey = { field: string; dir: "asc" | "desc" };

export type Query = { filter: Group; sort: SortKey[]; q: string };

/** Фильтр в URL: base64url(JSON) — ссылкой можно поделиться, в закладки влезает. */
export function encodeFilter(g: Group): string {
  if (!g.children.length && !g.not) return "";
  const json = JSON.stringify(g);
  const b64 = typeof btoa === "function" ? btoa(unescape(encodeURIComponent(json))) : Buffer.from(json).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeFilter(s: string | null | undefined): Group {
  if (!s) return emptyGroup();
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const json =
      typeof atob === "function" ? decodeURIComponent(escape(atob(b64))) : Buffer.from(b64, "base64").toString("utf8");
    const node = NodeSchema.parse(JSON.parse(json));
    return node.type === "group" ? node : { type: "group", op: "and", children: [node] };
  } catch {
    return emptyGroup();
  }
}

export function encodeSort(s: SortKey[]): string {
  return s.map((k) => `${k.field}:${k.dir}`).join(",");
}

export function decodeSort(s: string | null | undefined): SortKey[] {
  if (!s) return [];
  return s
    .split(",")
    .map((p) => p.split(":"))
    .filter(([f]) => f)
    .map(([field, dir]) => ({ field, dir: dir === "desc" ? "desc" : "asc" }));
}

export function toSearchParams(q: Query): URLSearchParams {
  const p = new URLSearchParams();
  const f = encodeFilter(q.filter);
  if (f) p.set("f", f);
  if (q.sort.length) p.set("s", encodeSort(q.sort));
  if (q.q) p.set("q", q.q);
  return p;
}

export function fromSearchParams(p: URLSearchParams): Query {
  return { filter: decodeFilter(p.get("f")), sort: decodeSort(p.get("s")), q: p.get("q") ?? "" };
}
