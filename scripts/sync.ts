// Локальная синхронизация: pnpm sync [ekp|fsp|regional|all] [--force]
import { runSync, type Job } from "../lib/sync/run";

const args = process.argv.slice(2);
const job = (args.find((a) => !a.startsWith("-")) ?? "all") as Job;
const res = await runSync(job, { force: args.includes("--force") });
console.log(JSON.stringify(res, null, 2));
process.exit(res.every((r) => r.ok) ? 0 : 1);
