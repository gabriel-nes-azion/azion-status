import { createCommunityAuth, UpstreamError } from "./community-auth.js";
import { AuthError, statusReport } from "./status.js";
import { platformStatus } from "./platform.js";

const auth = createCommunityAuth({ userAgent: "status-page/1" });

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function route(request) {
  const url = new URL(request.url);
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  if (url.pathname === "/api/health") return json({ ok: true, ts: Date.now() });

  if (url.pathname === "/api/platform") {
    try {
      return json(await platformStatus());
    } catch (err) {
      return json({ error: "statuspage_unreachable", message: err.message }, 502);
    }
  }

  if (url.pathname === "/api/status") {
    const creds = await auth.credentials(request);
    if (!creds) return json({ error: "unauthenticated", message: "Sign in to continue." }, 401);
    try {
      return json(await statusReport(creds, url.searchParams.get("range")));
    } catch (err) {
      if (err instanceof AuthError) return json({ error: "unauthenticated", message: "Azion rejected the session." }, 401);
      throw err;
    }
  }

  return null;
}

export async function handle(request) {
  try {
    return (await auth.handle(request)) ?? (await route(request)) ?? json({ error: "not_found" }, 404);
  } catch (err) {
    if (err instanceof UpstreamError) return json({ error: "upstream_error", message: "Azion API is unavailable. Try again in a moment." }, 502);
    console.error(err);
    return json({ error: "internal_error" }, 500);
  }
}

// Azion Functions register a fetch listener, while scripts/dev.mjs imports handle directly.
globalThis.addEventListener?.("fetch", (event) => event.respondWith(handle(event.request)));
