import { NextResponse } from "next/server";
import { fieldOptions } from "@/lib/server/meta";
import { readDataset } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const ds = await readDataset();
  const last = [...ds.syncLog].reverse();
  return NextResponse.json({
    options: fieldOptions(ds),
    counts: { events: ds.events.length, federations: ds.federations.length },
    lastSync: last.find((l) => l.ok)?.at ?? null,
    lastError: last.find((l) => !l.ok) ?? null,
  });
}
