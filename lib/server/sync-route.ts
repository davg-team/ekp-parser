import { NextResponse } from "next/server";
import { runSync, type Job } from "../sync/run";
import { invalidate } from "../store";

export async function runSyncResponse(url: URL) {
  const job = (url.searchParams.get("job") ?? "all") as Job;
  if (!["all", "ekp", "fsp", "regional"].includes(job)) return NextResponse.json({ error: "unknown job" }, { status: 400 });
  const res = await runSync(job, { force: url.searchParams.get("force") === "1" });
  invalidate();
  return NextResponse.json(res, { status: res.every((r) => r.ok) ? 200 : 500 });
}
