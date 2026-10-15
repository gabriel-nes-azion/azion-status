# status-page

Personal status page for an Azion account. It aggregates metrics for the whole account, across every domain, and reports whether services are operational, degraded or down.

Plain HTML, CSS and JS front-end. A single Azion Function serves both the static files and the API.

Demo available in: https://status.azion.app

## Layout

| Path | Role |
|---|---|
| `index.html`, `styles.css`, `app.js` | Front-end, built from `DESIGN.md` |
| `backend/worker.js` | Function entry: routing, auth, `/api/*` |
| `backend/queries.js` | GraphQL queries for `https://api.azion.com/v4/metrics/graphql` |
| `backend/health.js` | Indicators, thresholds and overall status |
| `backend/dev.js` | Local Node server |
| `backend/platform.js` | `status.azion.com` incidents, maintenances and 90-day history |
| `scripts/bundle.mjs` | Inlines the backend modules and static files into `./index.js` |

## API

| Endpoint | Response |
|---|---|
| `GET /api/session` | `{ name, email, account, source }` from `sso.azion.com/api/user/me`, or `401` |
| `GET /api/status?range=1h\|24h\|7d` | `{ overall, range, window, updatedAt, indicators[], breakdown[] }` |
| `GET /api/platform` | Azion platform status from `status.azion.com` (no auth): current indicator, open incidents, active and next 7 days maintenances, affected components, 90-day history per component group |
| `GET /health` | `{ ok, ts }` |

Credentials are checked in this order:

1. `Authorization: Token <personal token>`
2. `X-Azsid: <value>`
3. The request's own `azsid` cookie

The cookie is only sent when the app is served from a subdomain of `azion.com`. On `*.azionedge.net` / `*.azion.app`, paste the cookie value into the login dialog instead. Credentials pasted into the dialog stay in the browser's `localStorage`. The function forwards them to Azion and never stores them.

## Indicators

Indicators are grouped by product. Datasets come from `https://api.azion.com/v4/metrics/graphql`.

| Product | Indicator | Source | Status |
|---|---|---|---|
| Applications | Requests | `workloadMetrics` `sum: requests` | degraded when recent traffic falls below 30% of the period median |
| Applications | Average latency | `sum: requestTime` / `sum: requests` | degraded at 500 ms, outage at 1500 ms |
| Applications | 5xx error rate | `sum: requests` grouped by `status` | degraded at 1%, outage at 5% |
| Applications | 4xx error rate | `sum: requests` grouped by `status` | degraded at 15% |
| Firewalls | WAF allowed | `wafRequestsAllowed` | info |
| Firewalls | WAF blocked threats | `wafRequestsBlocked`, `wafRequestsThreat` | degraded on a 5x spike |
| Cache | Data transferred | `dataTransferredTotal`, `savedData` | info |
| Cache | Cache hit ratio | `savedRequests / (savedRequests + missedRequests)` | info |
| Cache | Tiered Cache data transferred | `tieredCacheMetrics.dataTransferredTotal` | info |
| Cache | Tiered Cache hit ratio | `tieredCacheMetrics` `sum: requests` grouped by `upstreamCacheStatus` | info |
| Functions | Invocations (Firewalls) | `functionsMetrics` `sum: invocations`, `initiatorType` 2 | info |
| Functions | Invocations (Applications) | `functionsMetrics` `sum: invocations`, `initiatorType` 1 | info |
| Image Processor | Requests | `imagesProcessedMetrics` `sum: requests` | info |
| Image Processor | Bandwidth | `imagesProcessedMetrics` `sum: bytesSent` | info |
| Image Processor | Saved bandwidth | `workloadMetrics.bandwidthImagesProcessedSavedData` | info |
| Connector | Origin error rate | 502, 503 and 504 over all requests | degraded at 0.5%, outage at 3% |

The `requestsStatusCode<N>xx` fields undercount on real accounts, so status classes come from the per-status `requests` aggregation. `requestTime` is the summed duration (seconds) of each pre-aggregated row, so it is divided by the request count rather than averaged. `resample` returns nulls for pre-computed fields such as `requestsTotal`, so it is only applied to aggregate queries.

Each product gets the worst status of its indicators. The overall status is the worst among products. If one query fails, only its indicators show as `Unavailable`.

## Azion platform

`/api/platform` reads the public Statuspage API at `status.azion.com` (`summary.json`, `incidents.json`, `scheduled-maintenances.json`).

- Open incidents, active or upcoming maintenances, and non-operational components show as alerts at the top of the page.
- A PoP in an `Edge Network` group with `partial_outage` is treated as re-routed, which is routine traffic steering, the same way the custom script on status.azion.com shows it. It is listed as a note on the platform card, not as an alert. When nothing else is degraded and no incident is open, a `minor` page indicator is reported as `All Systems Operational`.
- The 90-day bars mark each UTC day touched by an incident with the worst impact of that day. Green means none, yellow minor, red major or critical, blue maintenance. Component groups are derived from the incident components.

## Run locally

```sh
npm run dev   # http://localhost:8787
```

## Deploy

```sh
npm run deploy
```

