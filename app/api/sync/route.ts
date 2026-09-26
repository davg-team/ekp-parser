import type { NextRequest } from "next/server";
import { runSyncResponse } from "@/lib/server/sync-route";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

/** «Обновить сейчас» из интерфейса (под сессией). */
export async function POST(req: NextRequest) {
  return runSyncResponse(req.nextUrl);
}
