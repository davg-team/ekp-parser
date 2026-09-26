// storage.minsport.gov.ru отвечает 403 на запросы без User-Agent.
export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

export async function fetchOk(url: string, init: RequestInit = {}, timeoutMs = 60_000): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { "user-agent": UA, accept: "*/*", ...(init.headers ?? {}) },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

export async function fetchText(url: string): Promise<string> {
  return (await fetchOk(url)).text();
}

export async function fetchBytes(url: string, timeoutMs = 300_000): Promise<Uint8Array> {
  return new Uint8Array(await (await fetchOk(url, {}, timeoutMs)).arrayBuffer());
}
