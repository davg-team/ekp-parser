import { NextResponse } from "next/server";
import { readDataset } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const ds = await readDataset();
  const today = new Date().toISOString().slice(0, 10);
  return NextResponse.json(
    ds.federations.map((f) => {
      const evs = ds.events.filter((e) => e.regionCode === f.regionCode && !e.removedAt);
      return { ...f, eventsTotal: evs.length, eventsUpcoming: evs.filter((e) => e.dateTo >= today).length };
    }),
  );
}
