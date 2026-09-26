import { NextResponse, type NextRequest } from "next/server";
import { queryEvents } from "@/lib/server/query";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { ds, items } = await queryEvents(req.nextUrl.searchParams);
  const fedByCode = new Map(ds.federations.map((f) => [f.regionCode, f]));
  return NextResponse.json({
    total: items.length,
    all: ds.events.length,
    items: items.map((e) => ({ ...e, federation: e.regionCode ? (fedByCode.get(e.regionCode) ?? null) : null })),
  });
}
