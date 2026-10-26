(function () {
  "use strict";

  const RANGE_KEY = "statuspage.range";
  const LEGACY_KEYS = ["statuspage.authMethod", "statuspage.token", "statuspage.azsid", "statuspage.theme"];
  const REFRESH_MS = 60000;

  const state = { range: "1h", timer: null, loading: false, signedIn: false, report: null, platform: null };

  const $ = (id) => document.getElementById(id);
  const els = {
    banner: $("banner"),
    bannerIcon: $("bannerIcon"),
    bannerTitle: $("bannerTitle"),
    bannerSub: $("bannerSub"),
    groups: $("groups"),
    platformAlert: $("platformAlert"),
    platformTag: $("platformTag"),
    platformHistory: $("platformHistory"),
    dayTip: $("dayTip"),
    refreshBtn: $("refreshBtn"),
    crumbClient: $("crumbClient"),
  };

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage unavailable */ } },
  };

  const ICON_PATHS = {
    operational: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    degraded: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
    outage: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
    no_data: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
    unknown: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
  };

  const STATUS_TEXT = {
    operational: "Operational",
    degraded: "Degraded",
    outage: "Outage",
    info: "Info",
    no_data: "No data",
    unknown: "Unavailable",
    loading: "Loading",
  };

  const TAG_CLASS = {
    operational: "azc-tag--success",
    degraded: "azc-tag--warning",
    outage: "azc-tag--danger",
    info: "azc-tag--info",
  };

  const BANNER_TEXT = {
    operational: "All services operational",
    degraded: "Some services are degraded",
    outage: "Major issues detected",
    no_data: "No traffic in this period",
    unknown: "Metrics unavailable",
  };

  function h(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value == null || value === false) continue;
      if (key === "text") node.textContent = value;
      else node.setAttribute(key, value === true ? "" : value);
    }
    for (const child of [].concat(children ?? [])) if (child != null && child !== false) node.append(child);
    return node;
  }

  function svg(tag, attrs) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  }

  function statusIcon(status) {
    if (status === "loading") return h("span", { class: "azc-spinner" });
    if (!ICON_PATHS[status]) return null;
    const template = document.createElement("template");
    template.innerHTML = `<svg class="azc-icon" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[status]}</svg>`;
    return template.content.firstChild;
  }

  function setTag(el, status, label) {
    el.className = ["azc-tag", TAG_CLASS[status]].filter(Boolean).join(" ");
    el.replaceChildren(...[statusIcon(status), label ?? STATUS_TEXT[status] ?? status].filter(Boolean));
    return el;
  }

  const tag = (status, label) => setTag(h("span"), status, label);

  function toast(message, severity = "info") {
    AzionCommunity.toast(message, { severity });
  }

  class AuthFailure extends Error {}

  async function apiFetch(path) {
    const res = await fetch(path, { headers: { accept: "application/json" } });
    if (res.status === 401) throw new AuthFailure("unauthenticated");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`);
    return body;
  }

  function onSession(session) {
    if (session.authenticated) {
      const clientId = session.user && session.user.clientId;
      els.crumbClient.textContent = clientId ? ` ${clientId}` : "";
      if (state.signedIn) return;
      state.signedIn = true;
      renderSkeleton();
      refresh();
      schedule();
    } else {
      state.signedIn = false;
      state.report = null;
      stopSchedule();
      els.crumbClient.textContent = "";
      renderSignedOut();
    }
  }

  function renderSignedOut() {
    setBanner("unknown", "Sign in to see your account status", "Waiting for credentials");
    const button = h("button", { class: "azc-btn azc-btn--primary azc-btn--small", type: "button", text: "Sign in" });
    button.addEventListener("click", () => AzionCommunity.openLogin());
    els.groups.replaceChildren(
      h("div", { class: "azc-card azc-empty" }, [
        h("span", { text: "Sign in with your Azion account to see the health of every application in it." }),
        button,
      ]),
    );
  }

  function schedule() {
    stopSchedule();
    if (!document.hidden) state.timer = setInterval(refresh, REFRESH_MS);
  }

  function stopSchedule() {
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
  }

  async function refresh() {
    if (state.loading || !state.signedIn) return;
    loadPlatform();
    state.loading = true;
    els.refreshBtn.classList.add("is-loading");
    try {
      const report = await apiFetch(`/api/status?range=${encodeURIComponent(state.range)}`);
      if (!state.signedIn) return;
      state.report = report;
      render(report);
    } catch (err) {
      if (err instanceof AuthFailure) {
        const session = await AzionCommunity.refreshSession();
        if (session.authenticated) {
          setBanner("unknown", BANNER_TEXT.unknown, "Azion rejected the metrics request for this session");
          toast("Azion rejected the metrics request. Check the permissions of this account.", "danger");
        }
        return;
      }
      toast(`Failed to load metrics: ${err.message}`, "danger");
      if (!state.report) setBanner("unknown", BANNER_TEXT.unknown, err.message);
    } finally {
      state.loading = false;
      els.refreshBtn.classList.remove("is-loading");
    }
  }

  function setBanner(status, title, sub) {
    els.banner.dataset.status = status;
    els.bannerIcon.replaceChildren(statusIcon(status) || statusIcon("unknown"));
    els.bannerTitle.textContent = title;
    els.bannerSub.textContent = sub;
  }

  function render(report) {
    const affected = report.groups.flatMap((g) =>
      g.indicators.filter((i) => i.status === "degraded" || i.status === "outage").map((i) => `${g.label}: ${i.label}`),
    );
    const time = new Date(report.updatedAt).toLocaleTimeString();
    const sub = affected.length ? `${affected.join(", ")} · updated ${time}` : `Last ${report.range} · updated ${time}`;
    setBanner(report.overall, BANNER_TEXT[report.overall] || report.overall, sub);
    els.groups.replaceChildren(...report.groups.map(renderGroup));
  }

  function renderGroup(g) {
    const id = `group-${g.key}`;
    return h("section", { class: "group", "aria-labelledby": id }, [
      h("div", { class: "group-head" }, [h("h2", { id, text: g.label }), tag(g.status)]),
      h("div", { class: "azc-grid" }, g.indicators.map(renderIndicator)),
    ]);
  }

  function renderSkeleton() {
    setBanner("loading", "Checking your services", "Loading metrics");
    const cards = Array.from({ length: 4 }, () => h("div", { class: "azc-card azc-card--compact skeleton skeleton-card" }));
    els.groups.replaceChildren(
      h("section", { class: "group" }, [
        h("div", { class: "group-head" }, h("div", { class: "skeleton skeleton-title" })),
        h("div", { class: "azc-grid" }, cards),
      ]),
    );
  }

  function formatValue(value, unit) {
    if (value == null) return { text: "n/a", unit: "" };
    if (unit === "%") return { text: value < 1 && value > 0 ? value.toFixed(2) : value.toFixed(1), unit: "%" };
    if (unit === "ms") return value >= 1000 ? { text: (value / 1000).toFixed(2), unit: "s" } : { text: Math.round(value).toString(), unit: "ms" };
    if (unit === "bytes") {
      const units = ["B", "KB", "MB", "GB", "TB", "PB"];
      let i = 0;
      let v = value;
      while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
      return { text: v.toFixed(i ? 1 : 0), unit: units[i] };
    }
    return { text: compact(value), unit: unit === "req" ? "" : unit };
  }

  function compact(n) {
    if (Math.abs(n) < 1000) return Number.isInteger(n) ? String(n) : n.toFixed(1);
    return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  }

  function renderIndicator(i) {
    const v = formatValue(i.value, i.unit);
    const extra = i.extra && i.extra.value != null
      ? h("div", { class: "azc-meta", text: `${i.extra.label}: ${i.extra.unit === "%" ? i.extra.value.toFixed(1) + "%" : compact(i.extra.value)}` })
      : null;
    const desc = i.error ? `Query failed: ${i.error}` : i.description || "";
    return h("article", { class: "azc-card azc-card--compact indicator", "data-status": i.status }, [
      h("div", { class: "indicator-head" }, [h("span", { class: "indicator-label", text: i.label }), tag(i.status)]),
      h("div", { class: "azc-metric" }, [v.text, h("small", { text: v.unit })]),
      extra,
      sparkline(i.series),
      h("div", { class: "indicator-desc", title: desc, text: truncate(desc, 90) }),
    ]);
  }

  function truncate(s, n) {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function sparkline(series) {
    if (!series || series.length < 2) return svg("svg", { class: "spark", "aria-hidden": "true" });
    const w = 200;
    const h = 40;
    const xs = series.map((p) => p[0]);
    const ys = series.map((p) => p[1]);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs) || x0 + 1;
    const yMax = Math.max(...ys) || 1;
    const pts = series.map(([x, y]) => [((x - x0) / (x1 - x0 || 1)) * w, h - 2 - (y / yMax) * (h - 4)]);
    const line = pts.map((p, idx) => `${idx ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
    const chart = svg("svg", { class: "spark", viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: "none", "aria-hidden": "true" });
    chart.append(
      svg("path", { d: `${line}L${w},${h}L0,${h}Z`, fill: "currentColor", "fill-opacity": "0.12", stroke: "none" }),
      svg("path", { d: line, fill: "none", stroke: "currentColor", "stroke-width": "1.5", "vector-effect": "non-scaling-stroke" }),
    );
    return chart;
  }

  const INDICATOR_STATUS = { none: "operational", minor: "degraded", major: "outage", critical: "outage", maintenance: "info" };
  const IMPACT_STATUS = { none: "info", maintenance: "info", minor: "degraded", major: "outage", critical: "outage" };
  const COMPONENT_STATUS = {
    degraded_performance: "Degraded performance",
    partial_outage: "Partial outage",
    major_outage: "Major outage",
    under_maintenance: "Under maintenance",
  };
  const IMPACT_TEXT = { none: "No incidents", maintenance: "Maintenance", minor: "Minor incident", major: "Major incident", critical: "Critical incident" };

  function safeUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" ? parsed.href : "https://status.azion.com";
    } catch (e) {
      return "https://status.azion.com";
    }
  }

  async function loadPlatform() {
    try {
      const res = await fetch("/api/platform", { headers: { accept: "application/json" } });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`);
      state.platform = body;
      renderPlatform(body);
    } catch (err) {
      setTag(els.platformTag, "unknown");
      if (!state.platform) {
        els.platformHistory.replaceChildren(h("div", { class: "azc-description", text: `Could not load status.azion.com: ${err.message}` }));
      }
    }
  }

  function componentTags(names, max) {
    return h("div", { class: "azc-row alert-components" }, [
      ...names.slice(0, max).map((name) => h("span", { class: "azc-tag", text: name })),
      names.length > max ? h("span", { class: "azc-tag", text: `+${names.length - max}` }) : null,
    ]);
  }

  function renderPlatform(p) {
    setTag(els.platformTag, INDICATOR_STATUS[p.indicator] || "unknown", p.description);
    renderPlatformAlert(p);
    const nodes = renderHistory(p.history);
    if (p.rerouted && p.rerouted.length) {
      const count = p.rerouted.length;
      nodes.unshift(
        h("div", { class: "reroute-note" }, [
          h("span", { class: "reroute-icon" }, statusIcon("info")),
          h("div", null, [
            h("div", { text: `Traffic re-routed away from ${count} location${count > 1 ? "s" : ""}. This is routine CDN traffic steering, not an outage.` }),
            componentTags(p.rerouted.map((c) => c.name), Infinity),
          ]),
        ]),
      );
    }
    els.platformHistory.replaceChildren(...nodes);
  }

  function formatDateTime(iso) {
    return iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
  }

  function renderPlatformAlert(p) {
    const items = [];
    for (const i of p.incidents) {
      items.push({
        status: IMPACT_STATUS[i.impact] || "degraded",
        kind: "Incident",
        title: i.name,
        meta: `${i.status.replace(/_/g, " ")} · since ${formatDateTime(i.startedAt)}`,
        body: i.update ? i.update.body : "",
        components: i.components,
        url: i.url,
      });
    }
    for (const m of p.maintenances) {
      items.push({
        status: "info",
        kind: m.status === "scheduled" ? "Scheduled maintenance" : "Maintenance in progress",
        title: m.name,
        meta: `${formatDateTime(m.startedAt)}${m.scheduledUntil ? ` to ${formatDateTime(m.scheduledUntil)}` : ""}`,
        body: m.update ? m.update.body : "",
        components: m.components,
        url: m.url,
      });
    }
    if (!items.length && p.affected.length) {
      const worst = p.affected.some((c) => c.status === "major_outage") ? "outage" : "degraded";
      const byStatus = {};
      for (const c of p.affected) (byStatus[c.status] = byStatus[c.status] || []).push(c.name);
      items.push({
        status: worst,
        kind: "Azion platform",
        title: p.description,
        meta: Object.entries(byStatus).map(([st, names]) => `${COMPONENT_STATUS[st] || st}: ${names.length}`).join(" · "),
        body: "",
        components: p.affected.map((c) => c.name),
        url: p.url,
      });
    }

    els.platformAlert.hidden = !items.length;
    els.platformAlert.replaceChildren(
      ...items.map((it) =>
        h("div", { class: "alert", "data-status": it.status, role: it.status === "outage" ? "alert" : "status" }, [
          h("span", { class: "alert-icon" }, statusIcon(it.status) || statusIcon("info")),
          h("div", { class: "alert-body" }, [
            h("div", { class: "alert-kind", text: it.kind }),
            h("div", { class: "alert-title", text: it.title }),
            h("div", { class: "azc-meta", text: it.meta }),
            it.body ? h("p", { class: "alert-text", text: truncate(it.body, 280) }) : null,
            it.components.length ? componentTags(it.components, 8) : null,
          ]),
          h("a", { class: "alert-link", href: safeUrl(it.url), target: "_blank", rel: "noopener", text: "Details" }),
        ]),
      ),
    );
  }

  function historyRow(name, days, rowIdx, prominent) {
    const incidentDays = days.filter((d) => d.impact !== "none" && d.impact !== "maintenance").length;
    const bars = days.map((d, idx) =>
      h("span", {
        class: "day",
        "data-impact": d.impact,
        "data-row": rowIdx,
        "data-idx": idx,
        "aria-label": `${d.date}: ${IMPACT_TEXT[d.impact] || d.impact}`,
      }),
    );
    return h("div", { class: prominent ? "history-row history-row-main" : "history-row" }, [
      h("div", { class: "history-head" }, [
        h("span", { class: "history-name", text: name }),
        h("span", { class: "azc-meta", text: incidentDays ? `${incidentDays} day${incidentDays > 1 ? "s" : ""} with incidents` : "No incidents" }),
      ]),
      h("div", { class: "days", role: "img", "aria-label": `${name}: ${incidentDays} days with incidents in the last ${days.length} days` }, bars),
    ]);
  }

  function renderHistory(history) {
    const legend = [
      ["none", "No incidents"],
      ["minor", "Minor"],
      ["major", "Major or critical"],
      ["maintenance", "Maintenance"],
    ];
    return [
      historyRow("All components", history.overall, -1, true),
      h("div", { class: "history-axis azc-meta" }, [h("span", { text: `${history.days} days ago` }), h("span", { text: "Today" })]),
      h("details", { class: "history-groups" }, [
        h("summary", { text: `Components (${history.groups.length})` }),
        ...history.groups.map((g, idx) => historyRow(g.name, g.days, idx, false)),
      ]),
      h("div", { class: "history-legend" }, legend.map(([impact, label]) => h("span", null, [h("i", { "data-impact": impact }), label]))),
    ];
  }

  function showDayTip(target) {
    const history = state.platform && state.platform.history;
    if (!history) return;
    const row = Number(target.dataset.row);
    const day = (row < 0 ? history.overall : history.groups[row].days)[Number(target.dataset.idx)];
    const date = new Date(`${day.date}T00:00:00Z`).toLocaleDateString([], { dateStyle: "medium", timeZone: "UTC" });
    const events = day.events.length
      ? day.events.map((e) => h("li", { "data-impact": e.impact, text: e.name }))
      : [h("li", { text: "No incidents reported" })];
    els.dayTip.replaceChildren(h("div", { class: "day-tip-date", text: date }), h("ul", null, events));
    els.dayTip.hidden = false;
    const rect = target.getBoundingClientRect();
    const tip = els.dayTip.getBoundingClientRect();
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - tip.width / 2), window.innerWidth - tip.width - 8);
    const top = rect.top - tip.height - 8 < 8 ? rect.bottom + 8 : rect.top - tip.height - 8;
    els.dayTip.style.left = `${left}px`;
    els.dayTip.style.top = `${top}px`;
  }

  function setRange(range) {
    state.range = range;
    store.set(RANGE_KEY, range);
    document.querySelectorAll("[data-range]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.range === range)));
  }

  function bind() {
    document.querySelectorAll("[data-range]").forEach((b) =>
      b.addEventListener("click", () => {
        if (b.dataset.range === state.range) return;
        setRange(b.dataset.range);
        if (state.signedIn) {
          renderSkeleton();
          refresh();
        }
      }),
    );

    els.refreshBtn.addEventListener("click", refresh);

    els.platformHistory.addEventListener("mouseover", (e) => {
      if (e.target.classList.contains("day")) showDayTip(e.target);
    });
    els.platformHistory.addEventListener("mouseleave", () => (els.dayTip.hidden = true));
    window.addEventListener("scroll", () => (els.dayTip.hidden = true), { passive: true });

    document.addEventListener("visibilitychange", () => {
      if (!state.signedIn) return;
      if (document.hidden) stopSchedule();
      else {
        refresh();
        schedule();
      }
    });
  }

  LEGACY_KEYS.forEach(store.del);
  const savedRange = store.get(RANGE_KEY);
  if (savedRange && ["1h", "24h", "7d"].includes(savedRange)) setRange(savedRange);
  bind();
  setBanner("loading", "Checking your services", "Loading session");
  loadPlatform();

  AzionCommunity.init({
    appName: "Account Status",
    nav: [],
    menu: [],
    footer: { repository: null },
    onSession,
  });
})();
