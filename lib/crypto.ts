// Шифрование датасета для GitHub Pages: PBKDF2-SHA256 → AES-GCM (WebCrypto — и в Node, и в браузере).
// Защита от случайных глаз: сайт публичный, данные без пароля не прочитать.

export type Sealed = { v: 1; iter: number; salt: string; iv: string; ct: string };

const ITER = 250_000;
const enc = new TextEncoder();

const b64 = (b: Uint8Array) => {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function deriveKey(password: string, salt: Uint8Array, iter: number, extractable = false): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: iter }, base, { name: "AES-GCM", length: 256 }, extractable, ["encrypt", "decrypt"]);
}

export async function seal(plain: string, password: string): Promise<Sealed> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITER);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plain)));
  return { v: 1, iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}

export async function openWithKey(s: Sealed, key: CryptoKey): Promise<string> {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(s.iv) as BufferSource }, key, unb64(s.ct) as BufferSource);
  return new TextDecoder().decode(pt);
}

/** Ключ для сохранения в браузере (чтобы не вводить пароль на каждой странице). */
export async function exportKey(key: CryptoKey): Promise<string> {
  return b64(new Uint8Array(await crypto.subtle.exportKey("raw", key)));
}

export function importKey(raw: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", unb64(raw) as BufferSource, "AES-GCM", false, ["decrypt"]);
}

export const saltOf = (s: Sealed) => unb64(s.salt);
