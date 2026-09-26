import { NextResponse } from "next/server";
import { mutate } from "@/lib/store";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await mutate((ds) => {
    ds.views = ds.views.filter((v) => v.id !== id);
  });
  return NextResponse.json({ ok: true });
}
