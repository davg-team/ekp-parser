import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Dataset } from "../types";

/**
 * Всё состояние сервиса — один JSON (сотни мероприятий, килобайты).
 * Локально — файл, в облаке — объект в Object Storage.
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
    await writeFile(tmp, JSON.stringify(data));
    await rename(tmp, this.path);
  }
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

const METADATA_TOKEN_URL = "http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token";
let tokenCache: { token: string; exp: number } | null = null;

/** IAM-токен: YC_IAM_TOKEN (локально, `yc iam create-token`) или метаданные функции. */
export async function iamToken(): Promise<string> {
  if (process.env.YC_IAM_TOKEN) return process.env.YC_IAM_TOKEN;
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const res = await fetch(METADATA_TOKEN_URL, { headers: { "Metadata-Flavor": "Google" } });
  if (!res.ok) throw new Error(`metadata token: HTTP ${res.status}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

/** Yandex Object Storage: IAM-токен в X-YaCloud-SubjectToken, условная запись по ETag. */
export class ObjectStorageStore implements Store {
  constructor(
    private bucket: string,
    private key: string,
    private endpoint = "https://storage.yandexcloud.net",
  ) {}
  private url() {
    return `${this.endpoint}/${this.bucket}/${this.key.split("/").map(encodeURIComponent).join("/")}`;
  }
  async load() {
    const res = await fetch(this.url(), { headers: { "X-YaCloud-SubjectToken": await iamToken() } });
    if (res.status === 404) return { data: emptyDataset(), etag: null };
    if (!res.ok) throw new Error(`storage GET: HTTP ${res.status} ${await res.text()}`);
    return { data: normalize((await res.json()) as Partial<Dataset>), etag: res.headers.get("etag") };
  }
  async save(data: Dataset, ifMatch: string | null) {
    const headers: Record<string, string> = {
      "X-YaCloud-SubjectToken": await iamToken(),
      "content-type": "application/json",
    };
    if (ifMatch) headers["if-match"] = ifMatch;
    else headers["if-none-match"] = "*";
    const res = await fetch(this.url(), { method: "PUT", headers, body: JSON.stringify(data) });
    if (res.status === 412) throw new ConflictError("dataset changed concurrently");
    if (!res.ok) throw new Error(`storage PUT: HTTP ${res.status} ${await res.text()}`);
  }
}

let store: Store | null = null;
export function getStore(): Store {
  if (store) return store;
  const bucket = process.env.DATA_BUCKET;
  store = bucket
    ? new ObjectStorageStore(bucket, process.env.DATA_KEY ?? "data/dataset.json")
    : new FileStore(process.env.DATA_FILE ?? ".data/dataset.json");
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

// Кеш чтения для API: в тёплом контейнере не тянем JSON на каждый запрос.
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
