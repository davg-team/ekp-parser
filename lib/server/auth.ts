// Простой вход по общему паролю: внутренний инструмент на несколько человек.
export const SESSION_COOKIE = "ekp_session";
const MAX_AGE_S = 30 * 24 * 3600;

export const authEnabled = () => !!process.env.APP_PASSWORD;

async function hmac(data: string): Promise<string> {
  const secret = process.env.SESSION_SECRET || process.env.APP_PASSWORD || "dev";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Buffer.from(sig).toString("base64url");
}

export async function issueSession(): Promise<{ value: string; maxAge: number }> {
  const exp = String(Math.floor(Date.now() / 1000) + MAX_AGE_S);
  return { value: `${exp}.${await hmac(exp)}`, maxAge: MAX_AGE_S };
}

export async function verifySession(value: string | undefined): Promise<boolean> {
  if (!authEnabled()) return true;
  if (!value) return false;
  const [exp, sig] = value.split(".");
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return timingSafeEqual(sig, await hmac(exp));
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
