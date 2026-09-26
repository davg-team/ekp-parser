import { NextResponse } from "next/server";
import { readDataset } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await ctx.params).id);
  const ds = await readDataset();
  const event = ds.events.find((e) => e.id === id);
  if (!event) return NextResponse.json({ error: "not found" }, { status: 404 });
  const related = ds.events.filter((e) => e.linkedId === id || e.id === event.linkedId);
  return NextResponse.json({
    event,
    revisions: ds.revisions.filter((r) => r.eventId === id).sort((a, b) => b.at.localeCompare(a.at)),
    federation: ds.federations.find((f) => f.regionCode && f.regionCode === event.regionCode) ?? null,
    source: ds.sources.find((s) => s.id === event.sourceId) ?? null,
    related,
  });
}
