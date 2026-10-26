export const METRICS_URL = "https://api.azion.com/v4/metrics/graphql";

// Resample is only applied to aggregate queries: on pre-computed fields such
// as requestsTotal or applicationInvocations it returns nulls.
function metrics(dataset, { begin, end, points, fields, aggregate, groupBy = ["ts"] }) {
  const series = groupBy.includes("ts");
  const resample = series && aggregate && points ? `resample: { function: sum, points: ${points} }` : "";
  const agg = aggregate ? `aggregate: { ${aggregate} }` : "";
  const order = series ? "orderBy: [ts_ASC]" : "";
  return `query {
  ${dataset}(
    limit: 10000
    ${resample}
    filter: { tsRange: { begin: "${begin}", end: "${end}" } }
    ${agg}
    groupBy: [${groupBy.join(", ")}]
    ${order}
  ) { ${groupBy.join(" ")} ${fields.join(" ")} }
}`;
}

const q = (dataset, opts) => ({ dataset, query: metrics(dataset, opts) });

// The requestsStatusCode<N>xx fields undercount on real accounts, so status
// classes are derived from the per-status `requests` aggregation instead.
// requestTime is the summed duration of each pre-aggregated row, in seconds.
export const QUERIES = {
  statusTotals: (w) => q("workloadMetrics", { ...w, aggregate: "sum: requests", groupBy: ["status"], fields: ["sum"] }),
  statusSeries: (w) => q("workloadMetrics", { ...w, aggregate: "sum: requests", groupBy: ["ts", "status"], fields: ["sum"] }),
  latency: (w) => q("workloadMetrics", { ...w, aggregate: "sum: requestTime", fields: ["sum"] }),
  workload: (w) =>
    q("workloadMetrics", {
      ...w,
      fields: [
        "wafRequestsAllowed",
        "wafRequestsBlocked",
        "wafRequestsThreat",
        "savedRequests",
        "missedRequests",
        "dataTransferredTotal",
        "savedData",
        "bandwidthImagesProcessedSavedData",
      ],
    }),
  tieredData: (w) => q("tieredCacheMetrics", { ...w, fields: ["dataTransferredTotal"] }),
  tieredStatus: (w) =>
    q("tieredCacheMetrics", { ...w, aggregate: "sum: requests", groupBy: ["upstreamCacheStatus"], fields: ["sum"] }),
  functions: (w) =>
    q("functionsMetrics", { ...w, aggregate: "sum: invocations", groupBy: ["ts", "initiatorType"], fields: ["sum"] }),
  imageRequests: (w) => q("imagesProcessedMetrics", { ...w, aggregate: "sum: requests", fields: ["sum"] }),
  imageBytes: (w) => q("imagesProcessedMetrics", { ...w, aggregate: "sum: bytesSent", fields: ["sum"] }),
};
