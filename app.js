(function () {
  "use strict";

  const KEYS = {
    method: "statuspage.authMethod",
    token: "statuspage.token",
    azsid: "statuspage.azsid",
    theme: "statuspage.theme",
    range: "statuspage.range",
  };
  const REFRESH_MS = 60000;

  const auth = { method: null, value: null, source: null };
  const state = { range: "1h", timer: null, loading: false, report: null, platform: null };

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
    footerDot: $("footerDot"),
    footerText: $("footerText"),
    refreshBtn: $("refreshBtn"),
    themeBtn: $("themeBtn"),
    avatarBtn: $("avatarBtn"),
    avatarMenu: $("avatarMenu"),
    userName: $("userName"),
    userEmail: $("userEmail"),
    userSource: $("userSource"),
    userClient: $("userClient"),
    userChip: $("userChip"),
    chipName: $("chipName"),
    chipClient: $("chipClient"),
    crumbClient: $("crumbClient"),
    signOutBtn: $("signOutBtn"),
    loginModal: $("loginModal"),
    loginForm: $("loginForm"),
    loginSubmit: $("loginSubmit"),
    tabToken: $("tabToken"),
    tabCookie: $("tabCookie"),
    panelToken: $("panelToken"),
    panelCookie: $("panelCookie"),
    tokenInput: $("tokenInput"),
    azsidInput: $("azsidInput"),
    tokenError: $("tokenError"),
    azsidError: $("azsidError"),
    toasts: $("toasts"),
  };

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage unavailable */ } },
  };

  const ICONS = {
    operational: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>',
    degraded: '<svg viewBox="0 0 24 24"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/></svg>',
    outage: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>',
    no_data: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>',
    unknown: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/></svg>',
    loading: '<span class="spinner"></span>',
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

  const BANNER_TEXT = {
    operational: "All services operational",
    degraded: "Some services are degraded",
    outage: "Major issues detected",
    no_data: "No traffic in this period",
    unknown: "Metrics unavailable",
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function toast(message, severity = "info") {
    const el = document.createElement("div");
    el.className = "toast";
    el.dataset.severity = severity;
    el.setAttribute("role", severity === "error" ? "alert" : "status");
    el.textContent = message;
    els.toasts.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  function applyTheme(theme) {
    const root = document.documentElement;
    root.classList.remove("theme-light", "theme-dark");
    root.classList.add(`theme-${theme}`);
  }

  function currentTheme() {
    return document.documentElement.classList.contains("theme-dark") ? "dark" : "light";
  }

  function loadStoredAuth() {
    const method = store.get(KEYS.method);
    const value = method === "token" ? store.get(KEYS.token) : method === "azsid" ? store.get(KEYS.azsid) : null;
    if (!value) return false;
    auth.method = method;
    auth.value = value;
    return true;
  }

  function persistAuth(method, value) {
    store.set(KEYS.method, method);
    store.set(method === "token" ? KEYS.token : KEYS.azsid, value);
    store.del(method === "token" ? KEYS.azsid : KEYS.token);
    auth.method = method;
    auth.value = value;
  }

  function clearAuth() {
    store.del(KEYS.method);
    store.del(KEYS.token);
    store.del(KEYS.azsid);
    auth.method = null;
    auth.value = null;
    auth.source = null;
  }

  function authHeaders() {
    if (auth.method === "token") return { authorization: `Token ${auth.value}` };
    if (auth.method === "azsid") return { "x-azsid": auth.value };
    return {};
  }

  class AuthFailure extends Error {}

  async function apiFetch(path) {
    const res = await fetch(path, { headers: { accept: "application/json", ...authHeaders() }, credentials: "same-origin" });
    if (res.status === 401 || res.status === 403) throw new AuthFailure("unauthorized");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`);
    return body;
  }

  async function trySession() {
    try {
      return await apiFetch("/api/session");
    } catch (err) {
      if (err instanceof AuthFailure) return null;
      throw err;
    }
  }

  async function boot() {
    renderSkeleton();
    loadPlatform();
    try {
      let me = await trySession();
      if (me) {
        auth.source = "cookie";
      } else if (loadStoredAuth()) {
        me = await trySession();
        if (!me) {
          clearAuth();
          toast("Saved credentials are no longer valid", "warn");
        }
      }
      if (!me) return openLogin();
      onSignedIn(me);
    } catch (err) {
      setBanner("unknown", "Could not reach the server", err.message);
      toast(`Connection error: ${err.message}`, "error");
    }
  }

  function onSignedIn(me) {
    const name = me.name || me.email || "User";
    const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
    els.avatarBtn.textContent = initials || "?";
    els.avatarBtn.hidden = false;
    const client = me.clientId ? `Client ID ${me.clientId}` : "";
    const role = [me.isOwner ? "Account owner" : "", me.isTrial ? "Trial" : ""].filter(Boolean).join(" · ");
    els.userName.textContent = name;
    els.userEmail.textContent = me.email || "";
    els.userClient.textContent = [client, role].filter(Boolean).join(" · ");
    els.userSource.textContent = `Signed in via ${me.source === "token" ? "personal token" : me.source === "cookie" ? "azsid cookie (browser)" : "azsid cookie"}`;
    els.chipName.textContent = name;
    els.chipClient.textContent = me.clientId || "";
    els.userChip.hidden = false;
    els.crumbClient.textContent = me.clientId ? ` ${me.clientId}` : "";
    els.avatarBtn.title = `${name}${me.email ? ` (${me.email})` : ""}`;
    refresh();
    schedule();
  }

  function handleAuthFailure() {
    clearAuth();
    stopSchedule();
    els.avatarBtn.hidden = true;
    els.userChip.hidden = true;
    toast("Session invalid or expired. Sign in again.", "warn");
    openLogin();
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
    if (state.loading) return;
    loadPlatform();
    state.loading = true;
    els.refreshBtn.classList.add("spinning");
    try {
      const report = await apiFetch(`/api/status?range=${encodeURIComponent(state.range)}`);
      state.report = report;
      render(report);
    } catch (err) {
      if (err instanceof AuthFailure) return handleAuthFailure();
      toast(`Failed to load metrics: ${err.message}`, "error");
      if (!state.report) setBanner("unknown", BANNER_TEXT.unknown, err.message);
    } finally {
      state.loading = false;
      els.refreshBtn.classList.remove("spinning");
    }
  }

  function setBanner(status, title, sub) {
    els.banner.dataset.status = status;
    els.bannerIcon.innerHTML = ICONS[status] || ICONS.unknown;
    els.bannerTitle.textContent = title;
    els.bannerSub.textContent = sub;
    els.footerDot.dataset.status = status;
    els.footerText.textContent = STATUS_TEXT[status] || status;
  }

  function render(report) {
    const affected = report.groups.flatMap((g) =>
      g.indicators.filter((i) => i.status === "degraded" || i.status === "outage").map((i) => `${g.label}: ${i.label}`),
    );
    const time = new Date(report.updatedAt).toLocaleTimeString();
    const sub = affected.length ? `${affected.join(", ")} · updated ${time}` : `Last ${report.range} · updated ${time}`;
    setBanner(report.overall, BANNER_TEXT[report.overall] || report.overall, sub);
    els.groups.innerHTML = report.groups.map(renderGroup).join("");
  }

  function renderGroup(g) {
    const id = `group-${escapeHtml(g.key)}`;
    return `
      <section class="group" aria-labelledby="${id}">
        <div class="group-head">
          <h2 class="section-title" id="${id}">${escapeHtml(g.label)}</h2>
          <span class="tag" data-status="${escapeHtml(g.status)}">${ICONS[g.status] || ""}${escapeHtml(STATUS_TEXT[g.status] || g.status)}</span>
        </div>
        <div class="grid">${g.indicators.map(renderIndicator).join("")}</div>
      </section>`;
  }

  function renderSkeleton() {
    setBanner("loading", "Checking your services", "Loading metrics");
    const cards = Array.from({ length: 4 }, () => '<div class="card skeleton skeleton-card"></div>').join("");
    els.groups.innerHTML = `<section class="group"><div class="group-head"><div class="skeleton skeleton-title"></div></div><div class="grid">${cards}</div></section>`;
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
    const extra = i.extra
      ? `<div class="indicator-extra">${escapeHtml(i.extra.label)}: ${escapeHtml(i.extra.unit === "%" ? i.extra.value.toFixed(1) + "%" : compact(i.extra.value))}</div>`
      : "";
    const desc = i.error ? `Query failed: ${i.error}` : i.description || "";
    return `
      <article class="card indicator" data-status="${escapeHtml(i.status)}">
        <div class="indicator-head">
          <span class="indicator-label">${escapeHtml(i.label)}</span>
          <span class="tag" data-status="${escapeHtml(i.status)}">${ICONS[i.status] || ""}${escapeHtml(STATUS_TEXT[i.status] || i.status)}</span>
        </div>
        <div class="indicator-value">${escapeHtml(v.text)}<small>${escapeHtml(v.unit)}</small></div>
        ${extra}
        ${sparkline(i.series)}
        <div class="indicator-desc" title="${escapeHtml(desc)}">${escapeHtml(truncate(desc, 90))}</div>
      </article>`;
  }

  function truncate(s, n) {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function sparkline(series) {
    if (!series || series.length < 2) return '<svg class="spark" aria-hidden="true"></svg>';
    const w = 200;
    const h = 40;
    const xs = series.map((p) => p[0]);
    const ys = series.map((p) => p[1]);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs) || x0 + 1;
    const yMax = Math.max(...ys) || 1;
    const pts = series.map(([x, y]) => [((x - x0) / (x1 - x0 || 1)) * w, h - 2 - (y / yMax) * (h - 4)]);
    const line = pts.map((p, idx) => `${idx ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
    const area = `${line}L${w},${h}L0,${h}Z`;
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <path d="${area}" fill="currentColor" fill-opacity="0.12" stroke="none"/>
      <path d="${line}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
    </svg>`;
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

  async function loadPlatform() {
    try {
      const res = await fetch("/api/platform", { headers: { accept: "application/json" } });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`);
      state.platform = body;
      renderPlatform(body);
    } catch (err) {
      els.platformTag.dataset.status = "unknown";
      els.platformTag.innerHTML = `${ICONS.unknown}Unavailable`;
      if (!state.platform) els.platformHistory.innerHTML = `<div class="history-empty">Could not load status.azion.com: ${escapeHtml(err.message)}</div>`;
    }
  }

  function renderPlatform(p) {
    const status = INDICATOR_STATUS[p.indicator] || "unknown";
    els.platformTag.dataset.status = status;
    els.platformTag.innerHTML = `${ICONS[status] || ""}${escapeHtml(p.description)}`;
    renderPlatformAlert(p);
    renderHistory(p.history);
    if (p.rerouted && p.rerouted.length) {
      const names = p.rerouted.map((c) => `<span class="chip">${escapeHtml(c.name)}</span>`).join("");
      els.platformHistory.insertAdjacentHTML(
        "afterbegin",
        `<div class="reroute-note">
          <span class="reroute-icon">${ICONS.info}</span>
          <div>
            <div>Traffic re-routed away from ${p.rerouted.length} location${p.rerouted.length > 1 ? "s" : ""}. This is routine CDN traffic steering, not an outage.</div>
            <div class="alert-components">${names}</div>
          </div>
        </div>`,
      );
    }
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
      const period = `${formatDateTime(m.startedAt)}${m.scheduledUntil ? ` to ${formatDateTime(m.scheduledUntil)}` : ""}`;
      items.push({
        status: "info",
        kind: m.status === "scheduled" ? "Scheduled maintenance" : "Maintenance in progress",
        title: m.name,
        meta: period,
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
    els.platformAlert.innerHTML = items
      .map(
        (it) => `
      <div class="alert" data-status="${it.status}" role="${it.status === "outage" ? "alert" : "status"}">
        <span class="alert-icon">${ICONS[it.status] || ICONS.info}</span>
        <div class="alert-body">
          <div class="alert-kind">${escapeHtml(it.kind)}</div>
          <div class="alert-title">${escapeHtml(it.title)}</div>
          <div class="alert-meta mono">${escapeHtml(it.meta)}</div>
          ${it.body ? `<p class="alert-text">${escapeHtml(truncate(it.body, 280))}</p>` : ""}
          ${it.components.length ? `<div class="alert-components">${it.components.slice(0, 8).map((c) => `<span class="chip">${escapeHtml(c)}</span>`).join("")}${it.components.length > 8 ? `<span class="chip">+${it.components.length - 8}</span>` : ""}</div>` : ""}
        </div>
        <a class="alert-link" href="${escapeHtml(it.url)}" target="_blank" rel="noopener">Details</a>
      </div>`,
      )
      .join("");
  }

  function historyRow(name, days, rowIdx, prominent) {
    const incidentDays = days.filter((d) => d.impact !== "none" && d.impact !== "maintenance").length;
    const bars = days
      .map(
        (d, idx) =>
          `<span class="day" data-impact="${d.impact}" data-row="${rowIdx}" data-idx="${idx}" aria-label="${d.date}: ${escapeHtml(IMPACT_TEXT[d.impact] || d.impact)}"></span>`,
      )
      .join("");
    return `
      <div class="history-row${prominent ? " history-row-main" : ""}">
        <div class="history-head">
          <span class="history-name">${escapeHtml(name)}</span>
          <span class="history-meta mono">${incidentDays ? `${incidentDays} day${incidentDays > 1 ? "s" : ""} with incidents` : "No incidents"}</span>
        </div>
        <div class="days" role="img" aria-label="${escapeHtml(name)}: ${incidentDays} days with incidents in the last ${days.length} days">${bars}</div>
      </div>`;
  }

  function renderHistory(h) {
    const rows = [historyRow("All components", h.overall, -1, true), ...h.groups.map((g, idx) => historyRow(g.name, g.days, idx, false))];
    els.platformHistory.innerHTML = `
      ${rows[0]}
      <div class="history-axis mono"><span>${h.days} days ago</span><span>Today</span></div>
      <details class="history-groups">
        <summary>Components (${h.groups.length})</summary>
        ${rows.slice(1).join("")}
      </details>
      <div class="history-legend">
        <span><i data-impact="none"></i>No incidents</span>
        <span><i data-impact="minor"></i>Minor</span>
        <span><i data-impact="major"></i>Major or critical</span>
        <span><i data-impact="maintenance"></i>Maintenance</span>
      </div>`;
  }

  function showDayTip(target) {
    const h = state.platform && state.platform.history;
    if (!h) return;
    const row = Number(target.dataset.row);
    const day = (row < 0 ? h.overall : h.groups[row].days)[Number(target.dataset.idx)];
    const date = new Date(`${day.date}T00:00:00Z`).toLocaleDateString([], { dateStyle: "medium", timeZone: "UTC" });
    const events = day.events.length
      ? day.events.map((e) => `<li data-impact="${e.impact}">${escapeHtml(e.name)}</li>`).join("")
      : "<li>No incidents reported</li>";
    els.dayTip.innerHTML = `<div class="day-tip-date">${escapeHtml(date)}</div><ul>${events}</ul>`;
    els.dayTip.hidden = false;
    const rect = target.getBoundingClientRect();
    const tip = els.dayTip.getBoundingClientRect();
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - tip.width / 2), window.innerWidth - tip.width - 8);
    const top = rect.top - tip.height - 8 < 8 ? rect.bottom + 8 : rect.top - tip.height - 8;
    els.dayTip.style.left = `${left}px`;
    els.dayTip.style.top = `${top}px`;
  }

  function openLogin() {
    stopSchedule();
    setBanner("unknown", "Sign in to see your account status", "Waiting for credentials");
    els.groups.innerHTML = "";
    els.loginModal.hidden = false;
    setTab(store.get(KEYS.method) === "azsid" ? "azsid" : "token");
  }

  function closeLogin() {
    els.loginModal.hidden = true;
    els.tokenInput.value = "";
    els.azsidInput.value = "";
  }

  function activeMethod() {
    return els.tabToken.getAttribute("aria-selected") === "true" ? "token" : "azsid";
  }

  function setTab(method) {
    const isToken = method === "token";
    els.tabToken.setAttribute("aria-selected", String(isToken));
    els.tabCookie.setAttribute("aria-selected", String(!isToken));
    els.panelToken.hidden = !isToken;
    els.panelCookie.hidden = isToken;
    (isToken ? els.tokenInput : els.azsidInput).focus();
  }

  function validate(input, errorEl) {
    const v = input.value.trim();
    let msg = "";
    if (!v) msg = "This field is required";
    else if (/\s/.test(v)) msg = "Value must not contain spaces";
    errorEl.textContent = msg;
    errorEl.hidden = !msg;
    input.setAttribute("aria-invalid", String(!!msg));
    return !msg;
  }

  function setSubmitting(on) {
    els.loginSubmit.disabled = on;
    els.loginSubmit.querySelector(".spinner").hidden = !on;
  }

  async function submitLogin(e) {
    e.preventDefault();
    const method = activeMethod();
    const input = method === "token" ? els.tokenInput : els.azsidInput;
    const errorEl = method === "token" ? els.tokenError : els.azsidError;
    if (!validate(input, errorEl)) return input.focus();

    setSubmitting(true);
    auth.method = method;
    auth.value = input.value.trim();
    try {
      const me = await trySession();
      if (!me) {
        auth.method = null;
        auth.value = null;
        errorEl.textContent = "Azion rejected these credentials";
        errorEl.hidden = false;
        input.setAttribute("aria-invalid", "true");
        return;
      }
      persistAuth(method, auth.value);
      closeLogin();
      renderSkeleton();
      toast(`Signed in as ${me.name || me.email}`, "success");
      onSignedIn(me);
    } catch (err) {
      toast(`Connection error: ${err.message}`, "error");
    } finally {
      setSubmitting(false);
    }
  }

  function setRange(range) {
    state.range = range;
    store.set(KEYS.range, range);
    document.querySelectorAll(".range-btn").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.range === range)));
  }

  function toggleMenu(open) {
    els.avatarMenu.hidden = !open;
    els.avatarBtn.setAttribute("aria-expanded", String(open));
  }

  function bind() {
    els.loginForm.addEventListener("submit", submitLogin);
    els.tabToken.addEventListener("click", () => setTab("token"));
    els.tabCookie.addEventListener("click", () => setTab("azsid"));
    els.tokenInput.addEventListener("blur", () => validate(els.tokenInput, els.tokenError));
    els.azsidInput.addEventListener("blur", () => validate(els.azsidInput, els.azsidError));

    document.querySelectorAll(".range-btn").forEach((b) =>
      b.addEventListener("click", () => {
        if (b.dataset.range === state.range) return;
        setRange(b.dataset.range);
        if (auth.source || auth.value) {
          renderSkeleton();
          refresh();
        }
      }),
    );

    els.refreshBtn.addEventListener("click", () => (auth.source || auth.value) && refresh());

    els.themeBtn.addEventListener("click", () => {
      const next = currentTheme() === "dark" ? "light" : "dark";
      store.set(KEYS.theme, next);
      applyTheme(next);
    });

    els.avatarBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMenu(els.avatarMenu.hidden);
    });
    document.addEventListener("click", (e) => {
      if (!els.avatarMenu.hidden && !els.avatarMenu.contains(e.target)) toggleMenu(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") toggleMenu(false);
    });

    els.signOutBtn.addEventListener("click", () => {
      toggleMenu(false);
      const viaBrowserCookie = auth.source === "cookie";
      clearAuth();
      els.avatarBtn.hidden = true;
      els.userChip.hidden = true;
      els.crumbClient.textContent = "";
      state.report = null;
      if (viaBrowserCookie) toast("Signed out locally. Your console session cookie is still active in this browser.", "warn");
      openLogin();
    });

    els.platformHistory.addEventListener("mouseover", (e) => {
      if (e.target.classList.contains("day")) showDayTip(e.target);
    });
    els.platformHistory.addEventListener("mouseleave", () => (els.dayTip.hidden = true));
    window.addEventListener("scroll", () => (els.dayTip.hidden = true), { passive: true });

    document.addEventListener("visibilitychange", () => {
      if (!(auth.source || auth.value)) return;
      if (document.hidden) stopSchedule();
      else {
        refresh();
        schedule();
      }
    });

    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
      if (!store.get(KEYS.theme)) applyTheme(e.matches ? "dark" : "light");
    });
  }

  const savedRange = store.get(KEYS.range);
  if (savedRange && ["1h", "24h", "7d"].includes(savedRange)) setRange(savedRange);
  bind();
  boot();
})();
