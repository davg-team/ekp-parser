"use client";

import { deriveKey, exportKey, importKey, openWithKey, saltOf, type Sealed } from "../crypto";
import type { Dataset } from "../types";

// Датасет грузится в браузер целиком (сотни записей) — фильтры и сортировка считаются на клиенте.

export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const KEY = "ekp_data_key";

export class NeedPassword extends Error {}

let loaded: Promise<Dataset> | null = null;

async function fetchSealed(): Promise<Sealed | null> {
  const r = await fetch(`${BASE_PATH}/data.enc`, { cache: "no-cache" });
  return r.ok ? r.json() : null;
}

async function load(): Promise<Dataset> {
  const sealed = await fetchSealed();
  if (!sealed) {
    const r = await fetch(`${BASE_PATH}/data.json`, { cache: "no-cache" });
    if (!r.ok) throw new Error(`данные не найдены: HTTP ${r.status}`);
    return r.json();
  }
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {}
  if (!raw) throw new NeedPassword();
  try {
    return JSON.parse(await openWithKey(sealed, await importKey(raw)));
  } catch {
    // пароль сменили — ключ устарел
    logout();
    throw new NeedPassword();
  }
}

export function getDataset(): Promise<Dataset> {
  loaded ??= load().catch((e) => {
    loaded = null;
    throw e;
  });
  return loaded;
}

/** Проверяет пароль расшифровкой; при успехе запоминает ключ в браузере. */
export async function login(password: string): Promise<boolean> {
  const sealed = await fetchSealed();
  if (!sealed) return true;
  const key = await deriveKey(password, saltOf(sealed), sealed.iter, true);
  try {
    await openWithKey(sealed, key);
  } catch {
    return false;
  }
  try {
    localStorage.setItem(KEY, await exportKey(key));
  } catch {}
  loaded = null;
  return true;
}

export function logout() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
  loaded = null;
}

export async function isProtected(): Promise<boolean> {
  return (await fetch(`${BASE_PATH}/data.enc`, { method: "HEAD", cache: "no-cache" })).ok;
}
