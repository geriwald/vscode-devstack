/**
 * Diagnostic page served when no SPA is present at media/dashboard/index.html.
 * Deliberately minimal: it proves the API + SSE work end to end. The real,
 * designed dashboard replaces it the moment media/dashboard/ is populated.
 */
export function fallbackPage(projectName: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>DevStack · ${escapeHtml(projectName)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font: 14px system-ui, sans-serif; background:#0e1116; color:#e6edf3; }
  header { padding: 12px 16px; background:#161b22; border-bottom:1px solid #232a33; }
  header b { color:#a371f7; }
  main { display:grid; grid-template-columns: 1fr 1fr; gap:12px; padding:12px; }
  section { background:#161b22; border:1px solid #232a33; border-radius:8px; padding:10px; }
  h2 { font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:#8b949e; margin:0 0 8px; }
  .svc { display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid #1c222b; }
  .dot { width:9px; height:9px; border-radius:50%; background:#6e7681; flex:0 0 auto; }
  .running { background:#3fb950; } .error { background:#f85149; } .starting{ background:#d29922; }
  .name { flex:1; } .muted { color:#8b949e; font-size:12px; }
  button { background:#1c222b; color:#e6edf3; border:1px solid #232a33; border-radius:6px; padding:3px 8px; cursor:pointer; }
  button:hover { border-color:#a371f7; }
  .conflict { color:#f85149; } .foreign { color:#8b949e; } .managed { color:#3fb950; } .project{ color:#d29922; }
  #log { grid-column: 1 / -1; background:#0b0e13; border:1px solid #232a33; border-radius:8px; padding:10px; height:32vh; overflow:auto; font-family: ui-monospace, monospace; font-size:12px; }
  .line.fresh { background:#a371f733; }
  .line { transition: background 3s ease-out; padding:1px 4px; white-space:pre-wrap; }
  .note { color:#8b949e; font-size:11px; }
</style>
</head>
<body>
<header><b>DevStack</b> dashboard · ${escapeHtml(projectName)} <span class="muted">— diagnostic fallback (no media/dashboard/ SPA yet)</span></header>
<main>
  <section id="services"><h2>Services</h2></section>
  <section id="ports"><h2>Ports</h2></section>
  <div id="log"></div>
</main>
<script type="module">
const $ = (s) => document.querySelector(s);
let lastSeq = 0;

function renderServices(list) {
  $("#services").innerHTML = "<h2>Services</h2>" + list.map((s) => {
    const cls = s.status === "running" ? "running" : s.status === "error" ? "error" : (s.status==="starting"||s.status==="stopping") ? "starting" : "";
    const h = s.health ? " · " + s.health.state + (s.health.latencyMs!=null?(" "+s.health.latencyMs+"ms"):"") : "";
    const venv = s.venv ? " · venv " + s.venv.split("/").slice(-2).join("/") : "";
    const ef = s.envFile ? " · env " + s.envFile : "";
    const wires = (s.wiring||[]).map(w => " ↳ "+w.label+"→:"+w.targetPort+" "+(w.resolved||"?")+(w.up?" up":" DOWN")).join("");
    return '<div class="svc"><span class="dot '+cls+'"></span><span class="name">'+esc(s.name)+
      ' <span class="muted">'+(s.modeLabel||s.manager)+(s.port?(" :"+s.port):"")+h+venv+ef+'</span>'+
      (wires?'<div class="note">'+esc(wires)+'</div>':'')+'</span>'+
      '<button data-a="start" data-id="'+enc(s.id)+'">start</button>'+
      '<button data-a="stop" data-id="'+enc(s.id)+'">stop</button></div>';
  }).join("");
}

function renderPorts(list) {
  $("#ports").innerHTML = "<h2>Ports</h2>" + list.sort((a,b)=>a.port-b.port).map((p) =>
    '<div class="svc"><span class="name"><b>:'+p.port+'</b> <span class="'+p.ownership+'">'+p.ownership+'</span> '+
    '<span class="muted">'+esc(p.comm||"?")+(p.service?(" · "+esc(p.service)):"")+(p.note?(" · "+esc(p.note)):"")+'</span></span></div>'
  ).join("");
}

function appendLog(l) {
  if (l.seq <= lastSeq) return;
  lastSeq = l.seq;
  const box = $("#log");
  const near = box.scrollTop + box.clientHeight > box.scrollHeight - 40;
  const div = document.createElement("div");
  div.className = "line fresh";
  div.textContent = "["+l.id.split("::").pop()+"] "+l.line;
  box.appendChild(div);
  requestAnimationFrame(() => div.classList.remove("fresh"));
  while (box.children.length > 500) box.removeChild(box.firstChild);
  if (near) box.scrollTop = box.scrollHeight;
}

const es = new EventSource("/api/events");
es.addEventListener("snapshot", (e) => { const s = JSON.parse(e.data); renderServices(s.services); renderPorts(s.ports); });
es.addEventListener("log", (e) => appendLog(JSON.parse(e.data)));

document.addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-a]");
  if (!b) return;
  await fetch("/api/services/"+b.dataset.id+"/"+b.dataset.a, { method:"POST" });
});

function esc(s){ const d=document.createElement("div"); d.textContent=s; return d.innerHTML; }
function enc(s){ return encodeURIComponent(s); }
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] ?? c));
}
