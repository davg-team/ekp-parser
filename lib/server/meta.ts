import { FIELDS } from "../filters/fields";
import type { Dataset } from "../types";

/** Варианты значений для enum/array-полей — из фиксированного списка или из данных. */
export function fieldOptions(ds: Dataset): Record<string, string[]> {
  const today = new Date().toISOString().slice(0, 10);
  const out: Record<string, string[]> = {};
  for (const f of FIELDS) {
    if (f.type !== "enum" && f.type !== "array") continue;
    if (f.options) {
      out[f.key] = f.options;
      continue;
    }
    const set = new Set<string>();
    for (const e of ds.events) {
      const v = f.get(e, today);
      for (const x of Array.isArray(v) ? v : [v]) if (x != null && x !== "") set.add(String(x));
    }
    out[f.key] = [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }
  return out;
}
