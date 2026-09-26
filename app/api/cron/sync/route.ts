import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "@/lib/server/auth";
import { runSyncResponse } from "@/lib/server/sync-route";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

/** Вызывается timer-триггером Cloud Functions с заголовком x-cron-secret. */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !timingSafeEqual(req.headers.get("x-cron-secret") ?? "", secret)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return runSyncResponse(req.nextUrl);
}
