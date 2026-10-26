import { METRICS_URL, QUERIES } from "./queries.js";
import { buildReport } from "./health.js";

const RANGES = {
  "1h": { ms: 60 * 60 * 1000, points: 60 },
  "24h": { ms: 24 * 60 * 60 * 1000, points: 96 },
  "7d": { ms: 7 * 24 * 60 * 60 * 1000, points: 168 },
};

export class AuthError extends Error {}

async function runQuery(creds, query) {
  const res = await fetch(METRICS_URL, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "user-agent": "status-page/1", ...creds },
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

/** Builds the account report for range, authenticating each metrics query with creds. Throws AuthError when Azion rejects them. */
export async function statusReport(creds, requestedRange) {
  const range = RANGES[requestedRange] ? requestedRange : "1h";
  const { ms, points } = RANGES[range];
  const endDate = new Date();
  const window = { begin: fmt(new Date(endDate.getTime() - ms)), end: fmt(endDate), points };

  const keys = Object.keys(QUERIES);
  const settled = await Promise.allSettled(keys.map((k) => runDataset(creds, QUERIES[k], window)));
  const authFailure = settled.find((s) => s.status === "rejected" && s.reason instanceof AuthError);
  if (authFailure) throw authFailure.reason;
  const results = Object.fromEntries(
    keys.map((k, i) => [k, settled[i].status === "fulfilled" ? settled[i].value : { error: settled[i].reason.message }]),
  );
  return buildReport(results, { range, begin: window.begin, end: window.end });
}
