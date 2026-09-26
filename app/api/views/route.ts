import { NextResponse } from "next/server";
import { z } from "zod";
import { mutate, readDataset } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json((await readDataset()).views);
}

const Body = z.object({ name: z.string().trim().min(1).max(100), query: z.string().max(8000) });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const view = { id: crypto.randomUUID(), ...parsed.data, createdAt: new Date().toISOString() };
  await mutate((ds) => {
    ds.views = [...ds.views.filter((v) => v.name !== view.name), view];
  });
  return NextResponse.json(view);
}
