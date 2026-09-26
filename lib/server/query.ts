import { fromSearchParams } from "../filters/ast";
import { applyQuery } from "../filters/evaluate";
import { readDataset } from "../store";

export const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" });

export async function queryEvents(params: URLSearchParams) {
  const ds = await readDataset();
  const q = fromSearchParams(params);
  const items = applyQuery(ds.events, q.filter, q.q, q.sort, today());
  return { ds, items, query: q };
}
