export const STATUS_RANK = { operational: 0, degraded: 1, outage: 2 };

const MAX_POINTS = 120;
const ORIGIN_STATUSES = new Set([502, 503, 504]);

const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const sum = (rows, f) => rows.reduce((acc, r) => acc + num(r[f]), 0);
const pct = (part, total) => (total > 0 ? (part / total) * 100 : 0);
const ts = (r) => (typeof r.ts === "number" ? r.ts : Date.parse(r.ts.endsWith("Z") ? r.ts : r.ts + "Z"));

function byThreshold(value, degradedAt, outageAt) {
  if (outageAt != null && value >= outageAt) return "outage";
  if (value >= degradedAt) return "degraded";
  return "operational";
}

function downsample(rows, fields) {
  if (rows.length <= MAX_POINTS) return rows.map((r) => ({ ...r, ts: ts(r) }));
  const size = Math.ceil(rows.length / MAX_POINTS);
  const out = [];
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const row = { ts: ts(chunk[0]) };
    for (const f of fields) row[f] = sum(chunk, f);
    out.push(row);
  }
  return out;
}

function emptyBucket() {
  return { total: 0, c4xx: 0, c5xx: 0, origin: 0 };
}

function addStatus(bucket, status, count) {
  const code = num(status);
  bucket.total += count;
  if (code >= 400 && code < 500) bucket.c4xx += count;
  if (code >= 500 && code < 600) bucket.c5xx += count;
  if (ORIGIN_STATUSES.has(code)) bucket.origin += count;
}

function summarizeStatuses(rows) {
  const bucket = emptyBucket();
  for (const r of rows) addStatus(bucket, r.status, num(r.sum));
  return bucket;
}

function bucketStatusesByTs(rows) {
  const buckets = new Map();
  for (const r of rows) {
    const t = ts(r);
    if (!buckets.has(t)) buckets.set(t, { ts: t, ...emptyBucket() });
    addStatus(buckets.get(t), r.status, num(r.sum));
  }
  return [...buckets.values()].sort((a, b) => a.ts - b.ts);
}

const ratioSeries = (buckets, field) => buckets.map((b) => [b.ts, +pct(b[field], b.total).toFixed(3)]);

// The most recent buckets are skipped because metrics land a few minutes late
// and would otherwise always look like a drop.
function recentVsBaseline(values) {
  const settled = values.slice(0, -1);
  if (settled.length < 6) return null;
  const tail = settled.slice(-3);
  const head = settled.slice(0, -3).sort((a, b) => a - b);
  const baseline = head[Math.floor(head.length / 2)];
  const recent = tail.reduce((a, b) => a + b, 0) / tail.length;
  return { recent, baseline };
}

function unavailable(key, label, error) {
  return { key, label, value: null, unit: "", status: "unknown", error: String(error), series: [] };
}

function guard(sources, key, label, build) {
  const failed = sources.find((s) => s.error);
  return failed ? unavailable(key, label, failed.error) : build();
}

const infoStatus = (value) => (value ? "info" : "no_data");

function groupStatus(indicators) {
  let worst = null;
  for (const i of indicators) {
    if (i.status in STATUS_RANK && (worst == null || STATUS_RANK[i.status] > STATUS_RANK[worst])) worst = i.status;
  }
  if (worst) return worst;
  if (indicators.some((i) => i.status === "info")) return "info";
  if (indicators.every((i) => i.status === "unknown")) return "unknown";
  return "no_data";
}

export function buildReport(results, { range, begin, end }) {
  const R = results;
  const buckets = bucketStatusesByTs(R.statusSeries.rows || []);
  const summary = summarizeStatuses(R.statusTotals.rows || []);
  const total = summary.total;
  const workload = downsample(R.workload.rows || [], [
    "wafRequestsAllowed",
    "wafRequestsBlocked",
    "wafRequestsThreat",
    "savedRequests",
    "missedRequests",
    "dataTransferredTotal",
    "savedData",
    "bandwidthImagesProcessedSavedData",
  ]);
  const seconds = Math.max(1, (Date.parse(end + "Z") - Date.parse(begin + "Z")) / 1000);

  const applications = [
    guard([R.statusTotals, R.statusSeries], "requests", "Requests", () => {
      const cmp = recentVsBaseline(buckets.map((b) => b.total));
      const dropped = cmp && cmp.baseline >= 50 && cmp.recent < cmp.baseline * 0.3;
      return {
        key: "requests",
        label: "Requests",
        description: dropped ? "Traffic dropped sharply in the last minutes" : "Total requests served by applications",
        value: total,
        unit: "req",
        extra: { label: "avg req/s", value: total / seconds },
        status: !total ? "no_data" : dropped ? "degraded" : "operational",
        series: buckets.map((b) => [b.ts, b.total]),
      };
    }),
    guard([R.latency, R.statusTotals], "latency", "Average latency", () => {
      const requestsByTs = new Map(buckets.map((b) => [b.ts, b.total]));
      const value = total ? (sum(R.latency.rows, "sum") / total) * 1000 : 0;
      return {
        key: "latency",
        label: "Average latency",
        description: "Mean request time, weighted by requests",
        value,
        unit: "ms",
        status: total ? byThreshold(value, 500, 1500) : "no_data",
        series: R.latency.rows
          .map((r) => {
            const reqs = requestsByTs.get(ts(r)) || 0;
            return [ts(r), reqs ? +((num(r.sum) / reqs) * 1000).toFixed(1) : null];
          })
          .filter(([, v]) => v != null),
      };
    }),
    guard([R.statusTotals], "errors5xx", "5xx error rate", () => {
      const value = pct(summary.c5xx, total);
      return {
        key: "errors5xx",
        label: "5xx error rate",
        description: "Server errors over all requests",
        value,
        unit: "%",
        extra: { label: "5xx responses", value: summary.c5xx },
        status: total ? byThreshold(value, 1, 5) : "no_data",
        series: ratioSeries(buckets, "c5xx"),
      };
    }),
    guard([R.statusTotals], "errors4xx", "4xx error rate", () => {
      const value = pct(summary.c4xx, total);
      return {
        key: "errors4xx",
        label: "4xx error rate",
        description: "Client errors over all requests",
        value,
        unit: "%",
        extra: { label: "4xx responses", value: summary.c4xx },
        status: total ? byThreshold(value, 15) : "no_data",
        series: ratioSeries(buckets, "c4xx"),
      };
    }),
  ];

  const firewalls = [
    guard([R.workload], "wafAllowed", "WAF allowed", () => {
      const value = sum(workload, "wafRequestsAllowed");
      return {
        key: "wafAllowed",
        label: "WAF allowed",
        description: "Requests inspected and allowed by WAF",
        value,
        unit: "req",
        status: infoStatus(value),
        series: workload.map((r) => [r.ts, num(r.wafRequestsAllowed)]),
      };
    }),
    guard([R.workload], "wafBlocked", "WAF blocked threats", () => {
      const value = sum(workload, "wafRequestsBlocked");
      const cmp = recentVsBaseline(workload.map((r) => num(r.wafRequestsBlocked)));
      const spike = cmp && cmp.recent >= 100 && cmp.recent > Math.max(cmp.baseline, 1) * 5;
      return {
        key: "wafBlocked",
        label: "WAF blocked threats",
        description: spike ? "Spike of blocked requests in the last minutes" : "Requests blocked by WAF",
        value,
        unit: "req",
        extra: { label: "threats detected", value: sum(workload, "wafRequestsThreat") },
        status: spike ? "degraded" : infoStatus(value),
        series: workload.map((r) => [r.ts, num(r.wafRequestsBlocked)]),
      };
    }),
  ];

  const tiered = downsample(R.tieredData.rows || [], ["dataTransferredTotal"]);
  const tieredStatus = R.tieredStatus.rows || [];
  const tieredTotal = sum(tieredStatus, "sum");
  const tieredHits = sum(
    tieredStatus.filter((r) => /^(HIT|STALE|UPDATING|REVALIDATED)$/i.test(r.upstreamCacheStatus)),
    "sum",
  );

  const cache = [
    guard([R.workload], "dataTransferred", "Data transferred", () => {
      const value = sum(workload, "dataTransferredTotal");
      return {
        key: "dataTransferred",
        label: "Data transferred",
        description: "Bytes in and out of the edge cache",
        value,
        unit: "bytes",
        extra: { label: "served from cache", value: pct(sum(workload, "savedData"), value), unit: "%" },
        status: infoStatus(value),
        series: workload.map((r) => [r.ts, num(r.dataTransferredTotal)]),
      };
    }),
    guard([R.workload], "cacheHit", "Cache hit ratio", () => {
      const saved = sum(workload, "savedRequests");
      const missed = sum(workload, "missedRequests");
      return {
        key: "cacheHit",
        label: "Cache hit ratio",
        description: "Requests served from the edge cache",
        value: pct(saved, saved + missed),
        unit: "%",
        status: infoStatus(saved + missed),
        series: workload.map((r) => {
          const s = num(r.savedRequests);
          return [r.ts, +pct(s, s + num(r.missedRequests)).toFixed(2)];
        }),
      };
    }),
    guard([R.tieredData], "tieredData", "Tiered Cache data transferred", () => {
      const value = sum(tiered, "dataTransferredTotal");
      return {
        key: "tieredData",
        label: "Tiered Cache data transferred",
        description: "Bytes in and out of the tiered cache layer",
        value,
        unit: "bytes",
        status: infoStatus(value),
        series: tiered.map((r) => [r.ts, num(r.dataTransferredTotal)]),
      };
    }),
    guard([R.tieredStatus], "tieredHit", "Tiered Cache hit ratio", () => ({
      key: "tieredHit",
      label: "Tiered Cache hit ratio",
      description: "Requests served by the tiered cache layer",
      value: pct(tieredHits, tieredTotal),
      unit: "%",
      extra: { label: "tiered requests", value: tieredTotal },
      status: infoStatus(tieredTotal),
      series: [],
    })),
  ];

  const fnRows = R.functions.rows || [];
  const fnSeries = (initiator) => {
    const byTs = new Map();
    for (const r of fnRows) {
      const t = ts(r);
      const prev = byTs.get(t) || 0;
      byTs.set(t, String(r.initiatorType) === initiator ? prev + num(r.sum) : prev);
    }
    return [...byTs.entries()].sort((a, b) => a[0] - b[0]);
  };
  const fnIndicator = (key, label, initiator, description) =>
    guard([R.functions], key, label, () => {
      const series = fnSeries(initiator);
      const value = series.reduce((a, [, v]) => a + v, 0);
      return { key, label, description, value, unit: "req", status: infoStatus(value), series };
    });
  // initiatorType 1 is an application rule and 2 is a firewall rule.
  const functions = [
    fnIndicator("fnFirewall", "Function invocations (Firewalls)", "2", "Functions executed by firewall rules"),
    fnIndicator("fnApplication", "Function invocations (Applications)", "1", "Functions executed by application rules"),
  ];

  const imageRequests = R.imageRequests.rows || [];
  const imageBytes = R.imageBytes.rows || [];
  const images = [
    guard([R.imageRequests], "imgRequests", "Requests", () => {
      const value = sum(imageRequests, "sum");
      return {
        key: "imgRequests",
        label: "Requests",
        description: "Images processed",
        value,
        unit: "req",
        status: infoStatus(value),
        series: imageRequests.map((r) => [ts(r), num(r.sum)]),
      };
    }),
    guard([R.imageBytes], "imgBandwidth", "Bandwidth", () => {
      const value = sum(imageBytes, "sum");
      return {
        key: "imgBandwidth",
        label: "Bandwidth",
        description: "Bytes sent for processed images",
        value,
        unit: "bytes",
        status: infoStatus(value),
        series: imageBytes.map((r) => [ts(r), num(r.sum)]),
      };
    }),
    guard([R.workload], "imgSaved", "Saved bandwidth", () => {
      const value = sum(workload, "bandwidthImagesProcessedSavedData");
      return {
        key: "imgSaved",
        label: "Saved bandwidth",
        description: "Bytes saved by image optimization",
        value,
        unit: "bytes",
        status: infoStatus(value),
        series: workload.map((r) => [r.ts, num(r.bandwidthImagesProcessedSavedData)]),
      };
    }),
  ];

  const connector = [
    guard([R.statusTotals], "originErrors", "Origin error rate", () => {
      const value = pct(summary.origin, total);
      return {
        key: "originErrors",
        label: "Origin error rate",
        description: "502, 503 and 504 responses over all requests",
        value,
        unit: "%",
        extra: { label: "origin failures", value: summary.origin },
        status: total ? byThreshold(value, 0.5, 3) : "no_data",
        series: ratioSeries(buckets, "origin"),
      };
    }),
  ];

  const groups = [
    { key: "applications", label: "Applications", indicators: applications },
    { key: "firewalls", label: "Firewalls", indicators: firewalls },
    { key: "cache", label: "Cache", indicators: cache },
    { key: "functions", label: "Functions", indicators: functions },
    { key: "images", label: "Image Processor", indicators: images },
    { key: "connector", label: "Connector", indicators: connector },
  ].map((g) => ({ ...g, status: groupStatus(g.indicators) }));

  let overall;
  if (R.statusTotals.error) overall = "unknown";
  else if (!total) overall = "no_data";
  else {
    overall = "operational";
    for (const g of groups) {
      if (STATUS_RANK[g.status] > STATUS_RANK[overall]) overall = g.status;
    }
  }

  return {
    overall,
    range,
    window: { begin: begin + "Z", end: end + "Z" },
    updatedAt: new Date().toISOString(),
    groups,
  };
}
