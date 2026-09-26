export async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (r.status === 401) {
    location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
    throw new Error("unauthorized");
  }
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}
