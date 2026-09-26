// Взят из kuznitsa-platform/web/server/yc-handler.mjs.
// Thin adapter: run the Next.js standalone server in-process and proxy
// Yandex Cloud Functions invocations to it over loopback HTTP.
//
// This file is deployed alongside the standalone build. Entry point is
// `server/yc-handler.handler`. The standalone server boots once per cold
// start and is reused across warm invocations.
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 8080);
const HOST = "127.0.0.1";

let bootPromise = null;

function boot() {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    process.env.PORT = String(PORT);
    process.env.HOSTNAME = HOST;
    const here = path.dirname(fileURLToPath(import.meta.url));
    // standalone server.js sits at the deployment root, one level up from server/
    await import(path.join(here, "..", "server.js"));
    await waitForListening();
  })();
  return bootPromise;
}

function waitForListening(retries = 100) {
  return new Promise((resolve, reject) => {
    const attempt = (left) => {
      const req = http.request({ host: HOST, port: PORT, path: "/", method: "HEAD" }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (left <= 0) return reject(new Error("Next standalone server did not start"));
        setTimeout(() => attempt(left - 1), 100);
      });
      req.end();
    };
    attempt(retries);
  });
}

// Reconstruct the incoming request headers. In API Gateway payload format
// 1.0, the full header set (including Cookie) lives in `multiValueHeaders`;
// `headers` can be a partial single-value view. Merge both so nothing — most
// importantly the Cookie header that carries the session — is dropped.
function collectRequestHeaders(event) {
  const out = {};
  const single = event.headers || {};
  for (const [k, v] of Object.entries(single)) {
    if (v != null) out[k.toLowerCase()] = String(v);
  }
  const multi = event.multiValueHeaders || {};
  for (const [k, vals] of Object.entries(multi)) {
    if (!Array.isArray(vals) || vals.length === 0) continue;
    const lk = k.toLowerCase();
    out[lk] = vals.join(lk === "cookie" ? "; " : ", ");
  }
  // This request always lands on the loopback Next server over plain HTTP,
  // never TLS. Next reads x-forwarded-proto to build its own internal
  // self-fetch URL for middleware (initURL in next-server.js) as
  // `${proto}://${loopbackHost}:${loopbackPort}` — if the Gateway's original
  // "https" survives here unchanged, Next tries to open TLS against the
  // plaintext loopback port and the self-fetch dies with
  // "EPROTO ... wrong version number". Downstream code (Set-Cookie secure
  // flag, canonical URLs) reads NODE_ENV instead, not this header, so
  // forcing it to "http" for the loopback hop is safe.
  out["x-forwarded-proto"] = "http";
  return out;
}

// Split Node's response headers for API Gateway v1.0: array-valued headers
// (notably Set-Cookie) must go into `multiValueHeaders`, otherwise the cookie
// is silently dropped and the session never persists.
function splitResponseHeaders(nodeHeaders) {
  const headers = {};
  const multiValueHeaders = {};
  for (const [k, v] of Object.entries(nodeHeaders)) {
    if (Array.isArray(v)) multiValueHeaders[k] = v;
    else if (v != null) headers[k] = v;
  }
  return { headers, multiValueHeaders };
}

function buildPath(event) {
  const raw = event.url || event.path || "/";
  const qs = event.multiValueQueryStringParameters || event.queryStringParameters;
  if (!qs || Object.keys(qs).length === 0) return raw;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(qs)) {
    if (Array.isArray(v)) for (const item of v) params.append(k, item);
    else params.append(k, v);
  }
  const sep = raw.includes("?") ? "&" : "?";
  return `${raw}${sep}${params.toString()}`;
}

// Timer-триггер присылает {messages:[{details:{payload}}]}; в payload лежит
// запрос в формате API Gateway (см. scripts/yc-bootstrap.sh).
function unwrapTrigger(event) {
  const payload = event?.messages?.[0]?.details?.payload;
  if (typeof payload !== "string") return event;
  try {
    return JSON.parse(payload);
  } catch {
    return event;
  }
}

export async function handler(rawEvent, context) {
  const event = unwrapTrigger(rawEvent);
  await boot();

  // Three places, because three shapes of invocation. `httpMethod` at the top
  // level is payload format 1.0; `requestContext.http.method` is 2.0. WebSocket
  // operations have neither: their method lives at `requestContext.httpMethod`,
  // and without that branch a client's message arrives here as a GET carrying a
  // body — which is malformed HTTP and asks to be broken by any stricter
  // handler downstream.
  const rc = event.requestContext || {};
  const method =
    event.httpMethod || (rc.http && rc.http.method) || rc.httpMethod || "GET";
  const reqPath = buildPath(event);
  const headers = collectRequestHeaders(event);
  const body = event.isBase64Encoded && event.body ? Buffer.from(event.body, "base64") : event.body;

  return await new Promise((resolve, reject) => {
    const proxyReq = http.request(
      { host: HOST, port: PORT, path: reqPath, method, headers },
      (proxyRes) => {
        const chunks = [];
        proxyRes.on("data", (c) => chunks.push(c));
        proxyRes.on("end", () => {
          const buf = Buffer.concat(chunks);
          const { headers: respHeaders, multiValueHeaders } = splitResponseHeaders(proxyRes.headers);
          resolve({
            statusCode: proxyRes.statusCode || 200,
            headers: respHeaders,
            multiValueHeaders,
            body: buf.toString("base64"),
            isBase64Encoded: true,
          });
        });
      },
    );
    proxyReq.on("error", reject);
    if (body) proxyReq.write(body);
    proxyReq.end();
  });
}
