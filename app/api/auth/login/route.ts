import { NextResponse } from "next/server";
import { authEnabled, issueSession, SESSION_COOKIE, timingSafeEqual } from "@/lib/server/auth";

export async function POST(req: Request) {
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (authEnabled() && !timingSafeEqual(password ?? "", process.env.APP_PASSWORD!)) {
    await new Promise((r) => setTimeout(r, 500));
    return NextResponse.json({ error: "Неверный пароль" }, { status: 401 });
  }
  const s = await issueSession();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, s.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: s.maxAge,
    path: "/",
  });
  return res;
}
