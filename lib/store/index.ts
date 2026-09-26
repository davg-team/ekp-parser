import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Dataset } from "../types";

/**
 * Всё состояние — один JSON в репозитории (data/dataset.json): его обновляет
 * синк в GitHub Actions, сайт на GitHub Pages собирается из него.
 */
export interface Store {
  load(): Promise<{ data: Dataset; etag: string | null }>;
  /** ifMatch — etag прочитанной версии; при расхождении бросает ConflictError. */
  save(data: Dataset, ifMatch: string | null): Promise<void>;
}

export class ConflictError extends Error {}

export function emptyDataset(): Dataset {
  return { schemaVersion: 1, events: [], sources: [], revisions: [], federations: [], views: [], syncLog: [] };
}

function normalize(d: Partial<Dataset>): Dataset {
  return { ...emptyDataset(), ...d, schemaVersion: 1 };
}

export class FileStore implements Store {
  constructor(private path: string) {}
  async load() {
    try {
      const text = await readFile(this.path, "utf8");
      return { data: normalize(JSON.parse(text)), etag: String(text.length) + ":" + hash(text) };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return { data: emptyDataset(), etag: null };
      throw e;
    }
  }
  async save(data: Dataset, ifMatch: string | null) {
    const cur = await this.load();
    if (cur.etag !== ifMatch) throw new ConflictError("dataset changed concurrently");
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    // с переносами строк — чтобы коммиты синка давали читаемый дифф
    await writeFile(tmp, JSON.stringify(data, null, 1) + "\n");
    await rename(tmp, this.path);
  }
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

let store: Store | null = null;
export function getStore(): Store {
  if (store) return store;
  store = new FileStore(process.env.DATA_FILE ?? "data/dataset.json");
  return store;
}

/** Читает, применяет изменение и пишет; при гонке перечитывает (до 3 раз). */
export async function mutate<T>(fn: (d: Dataset) => T | Promise<T>): Promise<T> {
  const s = getStore();
  for (let attempt = 0; ; attempt++) {
    const { data, etag } = await s.load();
    const result = await fn(data);
    try {
      await s.save(data, etag);
      invalidate();
      return result;
    } catch (e) {
      if (!(e instanceof ConflictError) || attempt >= 2) throw e;
    }
  }
}

let cached: { data: Dataset; at: number } | null = null;
const TTL_MS = 30_000;
export async function readDataset(): Promise<Dataset> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data;
  const { data } = await getStore().load();
  cached = { data, at: Date.now() };
  return data;
}
export function invalidate() {
  cached = null;
}
