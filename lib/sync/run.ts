import { mutate } from "../store";
import type { SyncLogEntry } from "../types";
import { syncEkp } from "./ekp";

export type Job = "ekp" | "fsp" | "all";

const JOBS: Record<Exclude<Job, "all">, (o: { force?: boolean }) => Promise<unknown>> = {
  ekp: (o) => syncEkp(o),
  fsp: async () => {
    const { syncFsp } = await import("./fsp");
    return syncFsp();
  },
};

/** Запускает задачи по очереди; падение одной не мешает остальным. */
export async function runSync(job: Job, opts: { force?: boolean } = {}) {
  const names = job === "all" ? (Object.keys(JOBS) as (keyof typeof JOBS)[]) : [job];
  const out: (SyncLogEntry & { result?: unknown })[] = [];
  for (const name of names) {
    const t0 = Date.now();
    let entry: SyncLogEntry & { result?: unknown };
    try {
      const result = await JOBS[name](opts);
      const failed = JSON.stringify(result).includes('"error"');
      entry = { at: new Date().toISOString(), job: name, ok: !failed, message: summarize(result), durationMs: Date.now() - t0, result };
    } catch (e) {
      entry = { at: new Date().toISOString(), job: name, ok: false, message: (e as Error).message, durationMs: Date.now() - t0 };
    }
    out.push(entry);
    const { result: _r, ...log } = entry;
    await mutate((ds) => {
      ds.syncLog.push(log);
      ds.syncLog = ds.syncLog.slice(-200);
    });
  }
  return out;
}

function summarize(r: unknown): string {
  return JSON.stringify(r).slice(0, 500);
}
