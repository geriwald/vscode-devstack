// DevStack web dashboard — Layout B. Renders the top deck (services / ports /
// wiring) from `snapshot` events and tiles one live-log panel per running
// service from `log` events, all over a single EventSource. Vanilla, no build.

const $ = (sel) => document.querySelector(sel);
const enc = encodeURIComponent;

const els = {
  project: $("#project"),
  summary: $("#summary"),
  services: $("#services"),
  ports: $("#ports"),
  wiring: $("#wiring"),
  logs: $("#logs"),
  logsEmpty: $("#logsEmpty"),
};

// id → { panel, body, head, lines, seenSeq:Set, pulseTimer }
const panels = new Map();
let lastSeq = 0;
let lastSnapshot = null;

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

async function action(id, verb) {
  try {
    await fetch(`/api/services/${enc(id)}/${verb}`, {
      method: "POST",
      headers: { "X-DevStack": "1" },
    });
  } catch (e) {
    /* the next snapshot reflects the real state regardless */
  }
}

/* ---------- top deck ---------- */

function renderSummary(snap) {
  const running = snap.services.filter((s) => s.status === "running").length;
  const conflicts = snap.ports.filter((p) => p.ownership === "conflict").length;
  const unhealthy = snap.services.filter(
    (s) => s.health && s.health.state !== "healthy"
  ).length;
  const pills = [
    `<span class="pill"><b>${running}</b> running</span>`,
    `<span class="pill"><b>${snap.services.length}</b> services</span>`,
  ];
  if (unhealthy) pills.push(`<span class="pill alert"><b>${unhealthy}</b> unhealthy</span>`);
  if (conflicts) pills.push(`<span class="pill alert"><b>${conflicts}</b> port conflict${conflicts > 1 ? "s" : ""}</span>`);
  els.summary.innerHTML = pills.join("");
}

// Is this service's port up but owned by a process the dashboard didn't start?
function externalPort(snap, svc) {
  if (!svc.port) return null;
  return snap.ports.find(
    (p) => p.port === svc.port && p.ownership === "managed" && /outside the dashboard/.test(p.note)
  );
}

function serviceCard(snap, s) {
  const tags = [];
  if (s.manager === "systemd") tags.push(`<span class="tag prod">prod</span>`);
  else if (s.modeLabel) tags.push(`<span class="tag">${esc(s.modeLabel)}</span>`);
  const mock = s.env && (s.env.IMAGE_ENGINE === "mock" || s.env.TEXT_ENGINE === "mock");
  if (mock) tags.push(`<span class="tag mock">mock</span>`);
  if (s.health) tags.push(`<span class="tag health-${s.health.state}">${esc(s.health.state)}${s.health.latencyMs != null ? " " + s.health.latencyMs + "ms" : ""}</span>`);
  const ext = s.status !== "running" && externalPort(snap, s);
  if (ext) tags.push(`<span class="tag ext">up · external</span>`);

  const meta = [];
  if (s.port) meta.push(`<span class="kv"><b>:</b>${s.port}</span>`);
  if (s.venv) meta.push(`<span class="kv" title="${esc(s.venv)}"><b>venv</b> ${esc(shorten(s.venv))}</span>`);
  if (s.envFile) meta.push(`<span class="kv" title="${esc(s.envFile)}"><b>env</b> ${esc(shorten(s.envFile))}</span>`);
  const wired = (s.wiring || []).map(
    (w) => `<span class="kv" title="${esc(w.label)} → ${w.targetHost || ""}:${w.targetPort}">↳ ${esc(w.resolved || (":" + w.targetPort))}${w.up ? "" : " ✕"}</span>`
  );

  const canStop = s.status === "running" || s.status === "starting";
  return `<div class="svc">
    <div class="svc-head">
      <span class="dot ${esc(s.status)}"></span>
      <span class="svc-name" title="${esc(s.command)}">${esc(s.name)}</span>
      ${tags.join("")}
    </div>
    <div class="svc-meta">${meta.join("")}${wired.join("")}</div>
    <div class="svc-actions">
      <button class="btn" data-id="${esc(s.id)}" data-verb="${canStop ? "restart" : "start"}">${canStop ? "↻ restart" : "▶ start"}</button>
      <button class="btn" data-id="${esc(s.id)}" data-verb="stop" ${canStop ? "" : "disabled"}>■ stop</button>
    </div>
  </div>`;
}

function shorten(p) {
  const parts = p.split("/");
  return parts.length > 2 ? "…/" + parts.slice(-2).join("/") : p;
}

function renderServices(snap) {
  els.services.innerHTML = snap.services.map((s) => serviceCard(snap, s)).join("");
}

function renderPorts(snap) {
  const rank = { conflict: 0, managed: 1, project: 2, foreign: 3 };
  const sorted = [...snap.ports].sort(
    (a, b) => (rank[a.ownership] - rank[b.ownership]) || (a.port - b.port)
  );
  els.ports.innerHTML = sorted
    .map(
      (p) => `<div class="port ${esc(p.ownership)}" title="${esc(p.cmdline || "")}\n${esc(p.cwd || "")}">
        <span class="pnum">:${p.port}</span>
        <span class="pown">${esc(p.ownership)}</span>
        <span class="pmeta">${esc(p.comm || "?")}${p.service ? " · " + esc(p.service) : ""}${p.note ? " · " + esc(p.note) : ""}</span>
      </div>`
    )
    .join("");
}

function renderWiring(snap) {
  const rows = [];
  for (const s of snap.services) {
    for (const w of s.wiring || []) {
      rows.push(`<div class="wire ${w.up ? "up" : "down"}">
        <span class="src">${esc(s.name)}</span>
        <span class="arrow">──${esc(w.label)}──▶</span>
        <span class="target">${esc(w.resolved || (w.targetHost || "") + ":" + w.targetPort)}</span>
      </div>`);
    }
  }
  els.wiring.innerHTML = rows.length ? rows.join("") : `<span class="kv">no edges detected</span>`;
}

/* ---------- log panels ---------- */

function ensurePanel(id, snap) {
  let p = panels.get(id);
  if (p) return p;
  const svc = snap && snap.services.find((s) => s.id === id);
  const isScript = id.startsWith("script::");
  const title = svc ? svc.name : isScript ? "▶ " + id.split("::")[1] : id;
  const port = svc && svc.port ? ":" + svc.port : "";

  const panel = document.createElement("div");
  panel.className = "panel";
  panel.dataset.id = id;
  panel.innerHTML = `<div class="panel-head"><span class="dot"></span><span class="ptitle">${esc(title)}</span><span class="pport">${esc(port)}</span></div><div class="panel-body"></div>`;
  els.logs.appendChild(panel);
  p = {
    panel,
    head: panel.querySelector(".panel-head"),
    dot: panel.querySelector(".dot"),
    body: panel.querySelector(".panel-body"),
    pulseTimer: null,
  };
  panels.set(id, p);
  relayout();
  return p;
}

function appendLine(id, l) {
  if (l.seq <= lastSeq) return; // dedupe replayed/duplicate lines
  lastSeq = l.seq;
  const p = ensurePanel(id, lastSnapshot);
  const body = p.body;
  const nearBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 24;

  const div = document.createElement("div");
  div.className = "line " + (l.stream === "err" ? "err" : l.stream === "sys" ? "sys" : "");
  div.textContent = l.line;
  body.appendChild(div);
  // restart the fade even if the class was already present
  void div.offsetWidth;
  div.classList.add("fresh");

  while (body.children.length > 500) body.removeChild(body.firstChild);
  if (nearBottom) body.scrollTop = body.scrollHeight;

  // pulse the header so the eye finds which panel just moved
  p.head.classList.remove("pulse");
  void p.head.offsetWidth;
  p.head.classList.add("pulse");
}

// Reconcile panels with the set of running services (+ keep live script channels).
function reconcilePanels(snap) {
  const want = new Set(snap.services.filter((s) => s.status === "running").map((s) => s.id));
  for (const [id, p] of panels) {
    const isScript = id.startsWith("script::");
    if (!want.has(id) && !isScript) {
      p.panel.remove();
      panels.delete(id);
    } else {
      const svc = snap.services.find((s) => s.id === id);
      if (svc) p.dot.className = "dot " + svc.status;
    }
  }
  for (const id of want) ensurePanel(id, snap);
  relayout();
}

// Near-square tiling so every panel is visible at once.
function relayout() {
  const n = panels.size;
  els.logsEmpty.style.display = n ? "none" : "grid";
  if (!n) return;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  els.logs.style.setProperty("--cols", cols);
  els.logs.style.setProperty("--rows", rows);
}

/* ---------- wire up ---------- */

function applySnapshot(snap) {
  lastSnapshot = snap;
  els.project.textContent = snap.project.name;
  document.title = `DevStack · ${snap.project.name}`;
  renderSummary(snap);
  renderServices(snap);
  renderPorts(snap);
  renderWiring(snap);
  reconcilePanels(snap);
}

const es = new EventSource("/api/events");
es.addEventListener("snapshot", (e) => applySnapshot(JSON.parse(e.data)));
es.addEventListener("log", (e) => {
  const l = JSON.parse(e.data);
  appendLine(l.id, l);
});

document.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-verb]");
  if (b && b.dataset.id) return action(b.dataset.id, b.dataset.verb);
  if (e.target.id === "stopAll") return stopAll();
  if (e.target.id === "startAllDev") return startAllDev();
  if (e.target.id === "toggleDeck") document.body.classList.toggle("deck-collapsed");
});

function startAllDev() {
  if (!lastSnapshot) return;
  lastSnapshot.services
    .filter((s) => s.manager === "process" && s.status !== "running")
    .forEach((s) => action(s.id, "start"));
}
function stopAll() {
  if (!lastSnapshot) return;
  lastSnapshot.services
    .filter((s) => s.status === "running" || s.status === "starting")
    .forEach((s) => action(s.id, "stop"));
}
