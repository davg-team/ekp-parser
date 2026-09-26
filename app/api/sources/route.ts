import { NextResponse } from "next/server";
import { readDataset } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const ds = await readDataset();
  return NextResponse.json({
    sources: [...ds.sources].sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt)),
    syncLog: [...ds.syncLog].reverse().slice(0, 50),
    recentRevisions: [...ds.revisions]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 100)
      .map((r) => ({ ...r, name: ds.events.find((e) => e.id === r.eventId)?.name ?? r.eventId })),
  });
}
