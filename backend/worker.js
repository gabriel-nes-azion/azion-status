import { METRICS_URL, QUERIES } from "./queries.js";
import { buildReport } from "./health.js";
import { platformStatus } from "./platform.js";

const SSO_ME_URL = "https://sso.azion.com/api/user/me";

const RANGES = {
  "1h": { ms: 60 * 60 * 1000, points: 60 },
  "24h": { ms: 24 * 60 * 60 * 1000, points: 96 },
  "7d": { ms: 7 * 24 * 60 * 60 * 1000, points: 168 },
};

export const STATICS = new Map();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function readCookie(req, name) {
  for (const c of (req.headers.get("cookie") || "").split(";")) {
    const eq = c.indexOf("=");
    if (eq > 0 && c.slice(0, eq).trim() === name) return c.slice(eq + 1).trim();
  }
  return null;
}

function pickCredentials(req) {
  const authorization = req.headers.get("authorization");
  if (authorization) return { source: "token", authorization };
  const header = req.headers.get("x-azsid");
  if (header) return { source: "azsid", azsid: header.trim() };
  const cookie = readCookie(req, "azsid");
  if (cookie) return { source: "cookie", azsid: cookie };
  return null;
}

function upstreamHeaders(creds) {
  const headers = new Headers({
    accept: "application/json",
    "content-type": "application/json",
    "user-agent": "status-page/1.0",
  });
  if (creds.authorization) {
    headers.set("authorization", creds.authorization);
  } else {
    headers.set("cookie", `azsid=${creds.azsid}`);
    headers.set("referer", "https://console.azion.com/");
  }
  return headers;
}

class AuthError extends Error {}

async function session(creds) {
  let res;
  try {
    res = await fetch(SSO_ME_URL, { headers: upstreamHeaders(creds), redirect: "manual" });
  } catch (err) {
    return json({ error: "upstream_unreachable", message: err.message }, 502);
  }
  if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) {
    return json({ error: "invalid_credentials" }, 401);
  }
  if (!res.ok) return json({ error: "upstream_error", status: res.status }, 502);
  const body = await res.json().catch(() => ({}));
  const me = body.results || body.data || body;
  return json({
    name: [me.first_name, me.last_name].filter(Boolean).join(" ").trim() || me.name || me.username || "",
    email: me.email || "",
    clientId: me.client_id || null,
    isOwner: !!me.is_account_owner,
    isTrial: !!me.is_trial,
    timezone: me.timezone || null,
    source: creds.source,
  });
}

async function runQuery(creds, query) {
  const res = await fetch(METRICS_URL, {
    method: "POST",
    headers: upstreamHeaders(creds),
    body: JSON.stringify({ query }),
  });
  if (res.status === 401 || res.status === 403) throw new AuthError(`metrics_${res.status}`);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`metrics_http_${res.status}`);
  }
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join("; "));
  return body.data;
}

// The resample argument is not available on every dataset or account, so a
// failed resampled query is retried once at native granularity.
async function runDataset(creds, build, window) {
  try {
    const { dataset, query } = build(window);
    return { rows: (await runQuery(creds, query))[dataset] || [] };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    try {
      const { dataset, query } = build({ ...window, points: null });
      return { rows: (await runQuery(creds, query))[dataset] || [] };
    } catch (retryErr) {
      if (retryErr instanceof AuthError) throw retryErr;
      return { error: retryErr.message };
    }
  }
}

const fmt = (d) => d.toISOString().slice(0, 19);

async function status(creds, url) {
  const range = RANGES[url.searchParams.get("range")] ? url.searchParams.get("range") : "1h";
  const { ms, points } = RANGES[range];
  const endDate = new Date();
  const window = { begin: fmt(new Date(endDate.getTime() - ms)), end: fmt(endDate), points };

  const keys = Object.keys(QUERIES);
  const settled = await Promise.allSettled(keys.map((k) => runDataset(creds, QUERIES[k], window)));
  if (settled.some((s) => s.status === "rejected" && s.reason instanceof AuthError)) {
    return json({ error: "invalid_credentials" }, 401);
  }
  const results = Object.fromEntries(
    keys.map((k, i) => [k, settled[i].status === "fulfilled" ? settled[i].value : { error: settled[i].reason.message }]),
  );
  return json(buildReport(results, { range, begin: window.begin, end: window.end }));
}

function staticResponse(pathname) {
  const key = pathname === "/" ? "/index.html" : pathname;
  const entry = STATICS.get(key);
  if (!entry) return null;
  return new Response(entry, {
    headers: {
      "content-type": MIME[key.slice(key.lastIndexOf("."))] || "application/octet-stream",
      "cache-control": "no-store",
    },
  });
}

export async function handle(request) {
  const url = new URL(request.url);

  if (url.pathname === "/health") return json({ ok: true, ts: Date.now() });

  if (url.pathname.startsWith("/api/")) {
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
    if (url.pathname === "/api/platform") {
      try {
        return json(await platformStatus());
      } catch (err) {
        return json({ error: "statuspage_unreachable", message: err.message }, 502);
      }
    }
    const creds = pickCredentials(request);
    if (!creds) return json({ error: "missing_credentials" }, 401);
    try {
      if (url.pathname === "/api/session") return await session(creds);
      if (url.pathname === "/api/status") return await status(creds, url);
    } catch (err) {
      return json({ error: "internal_error", message: err.message }, 500);
    }
    return json({ error: "not_found" }, 404);
  }

  if (request.method === "GET" || request.method === "HEAD") {
    const s = staticResponse(url.pathname);
    if (s) return s;
  }
  return json({ error: "not_found", path: url.pathname }, 404);
}

export default { fetch: handle };
