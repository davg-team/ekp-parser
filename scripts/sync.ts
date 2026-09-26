// Локальная синхронизация: pnpm sync [ekp|fsp|all] [--force]
import { runSync } from "../lib/sync/run";

const args = process.argv.slice(2);
const job = (args.find((a) => !a.startsWith("-")) ?? "all") as "ekp" | "fsp" | "all";
const res = await runSync(job, { force: args.includes("--force") });
console.log(JSON.stringify(res, null, 2));
process.exit(res.every((r) => r.ok) ? 0 : 1);
