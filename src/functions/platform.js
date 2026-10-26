const STATUSPAGE = "https://status.azion.com";
const HISTORY_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const IMPACT_RANK = { none: 0, maintenance: 1, minor: 2, major: 3, critical: 4 };

// Mirrors the custom script on status.azion.com: a PoP in an Edge Network
// group reported as partial_outage is shown as "Re-routed", which is routine
// traffic steering in a CDN and not a service degradation.
const isRerouted = (component, groupName) =>
  component.status === "partial_outage" && (groupName || component.name).startsWith("Edge Network");

async function getJson(path) {
  const res = await fetch(`${STATUSPAGE}${path}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`statuspage_http_${res.status}`);
  return res.json();
}

const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

function daysBetween(startIso, endIso) {
  const start = Date.parse(startIso);
  const end = endIso ? Date.parse(endIso) : Date.now();
  const keys = [];
  for (let t = Date.UTC(...dayParts(start)); t <= end; t += DAY_MS) keys.push(dayKey(t));
  return keys;
}

function dayParts(ms) {
  const d = new Date(ms);
  return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];
}

function latestUpdate(item) {
  const u = (item.incident_updates || [])[0];
  return u ? { status: u.status, body: u.body, at: u.display_at || u.created_at } : null;
}

function brief(item) {
  return {
    id: item.id,
    name: item.name,
    status: item.status,
    impact: item.impact,
    url: item.shortlink || `${STATUSPAGE}/incidents/${item.id}`,
    startedAt: item.started_at || item.scheduled_for || item.created_at,
    scheduledUntil: item.scheduled_until || null,
    components: (item.components || []).map((c) => c.name),
    update: latestUpdate(item),
  };
}

function buildHistory(incidents, maintenances, groupOf, groupNames) {
  const today = Date.UTC(...dayParts(Date.now()));
  const days = [];
  for (let i = HISTORY_DAYS - 1; i >= 0; i--) days.push(dayKey(today - i * DAY_MS));
  const daySet = new Set(days);

  const blank = () => Object.fromEntries(days.map((d) => [d, { impact: "none", events: [] }]));
  const overall = blank();
  const groups = Object.fromEntries(groupNames.map((g) => [g, blank()]));

  const mark = (bucket, day, impact, event) => {
    const cell = bucket[day];
    if (IMPACT_RANK[impact] > IMPACT_RANK[cell.impact]) cell.impact = impact;
    if (!cell.events.some((e) => e.id === event.id)) cell.events.push(event);
  };

  const apply = (item, impact, start, end) => {
    const event = { id: item.id, name: item.name, impact, url: item.shortlink || `${STATUSPAGE}/incidents/${item.id}` };
    const touched = new Set((item.components || []).map((c) => groupOf.get(c.id)).filter(Boolean));
    for (const day of daysBetween(start, end)) {
      if (!daySet.has(day)) continue;
      mark(overall, day, impact, event);
      for (const g of touched) mark(groups[g], day, impact, event);
    }
  };

  for (const i of incidents) {
    apply(i, IMPACT_RANK[i.impact] != null ? i.impact : "none", i.started_at || i.created_at, i.resolved_at);
  }
  for (const m of maintenances) {
    if (m.status === "scheduled") continue;
    apply(m, "maintenance", m.started_at || m.scheduled_for, m.resolved_at || m.scheduled_until);
  }

  const toList = (bucket) => days.map((d) => ({ date: d, ...bucket[d] }));
  return {
    days: HISTORY_DAYS,
    overall: toList(overall),
    groups: groupNames.map((name) => ({ name, days: toList(groups[name]) })),
  };
}

export async function platformStatus() {
  const [summary, incidents, maintenances] = await Promise.all([
    getJson("/api/v2/summary.json"),
    getJson("/api/v2/incidents.json"),
    getJson("/api/v2/scheduled-maintenances.json"),
  ]);

  const groupComponents = summary.components.filter((c) => c.group);
  const groupNames = groupComponents.sort((a, b) => a.position - b.position).map((c) => c.name);
  const groupById = new Map(groupComponents.map((c) => [c.id, c.name]));
  const groupOf = new Map(
    summary.components.map((c) => [c.id, c.group ? c.name : groupById.get(c.group_id) || null]),
  );

  const affected = [];
  const rerouted = [];
  for (const c of summary.components) {
    if (c.status === "operational") continue;
    const group = groupById.get(c.group_id) || null;
    if (isRerouted(c, group)) {
      if (!c.group) rerouted.push({ name: c.name, group });
    } else if (!c.group) {
      affected.push({ name: c.name, group, status: c.status });
    }
  }

  let { indicator, description } = summary.status;
  if (indicator === "minor" && !affected.length && !summary.incidents.length) {
    indicator = "none";
    description = "All Systems Operational";
  }

  const upcomingLimit = Date.now() + 7 * DAY_MS;
  const maintenanceList = maintenances.scheduled_maintenances || [];

  return {
    url: STATUSPAGE,
    indicator,
    description,
    updatedAt: summary.page.updated_at,
    incidents: summary.incidents.map(brief),
    maintenances: maintenanceList
      .filter(
        (m) =>
          m.status === "in_progress" ||
          m.status === "verifying" ||
          (m.status === "scheduled" && Date.parse(m.scheduled_for) <= upcomingLimit),
      )
      .map(brief),
    affected,
    rerouted,
    history: buildHistory(incidents.incidents || [], maintenanceList, groupOf, groupNames),
  };
}
