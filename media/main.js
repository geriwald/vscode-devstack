// @ts-nocheck
(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById("root");

  let currentState = null;

  // Render initial state injected by the provider (available before postMessage)
  if (typeof INITIAL_STATE !== "undefined" && INITIAL_STATE) {
    currentState = INITIAL_STATE;
    render(currentState);
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "update") {
      currentState = message.state;
      render(currentState);
    }
  });

  function render(state) {
    if (!state) { return; }

    let html = "";

    // Stack overview
    if (state.techs && state.techs.length > 0) {
      html += '<div class="stack-section">';
      html += '<div class="section-title">Stack</div>';
      for (const tech of state.techs) {
        const desc = TECH_DESCRIPTIONS[tech];
        const color = desc ? desc.color : "var(--vscode-foreground)";
        const description = desc ? desc.description : "";
        html += '<div class="tech-item">';
        html += '  <span class="tech-icon" style="color:' + color + '">&#x25CF;</span>';
        html += '  <span class="tech-name">' + escapeHtml(tech) + '</span>';
        html += '  <span class="tech-desc">' + escapeHtml(description) + '</span>';
        html += '</div>';
      }
      html += '</div>';
    }

    // Services grouped by role
    const roles = Object.keys(state.servicesByRole);
    if (roles.length === 0 && (!state.techs || state.techs.length === 0)) {
      html += '<div class="empty-state">No services detected.<br>Open a project with a recognized tech stack.</div>';
    }

    for (const role of roles) {
      const services = state.servicesByRole[role];
      const label = ROLE_LABELS[role] || role;
      const count = services.length;

      html += '<div class="role-section">';
      html += '  <div class="role-header" data-role="' + role + '">';
      html += '    <span class="role-chevron">&#x25BC;</span>';
      html += '    <span class="role-label">' + escapeHtml(label) + '</span>';
      html += '    <span class="role-count">(' + count + ')</span>';
      html += '  </div>';
      html += '  <div class="role-services" data-role-services="' + role + '">';

      for (const svc of services) {
        const isRunning = svc.status === "running";
        const isError = svc.status === "error";
        const statusClass = isError ? "status-error" : isRunning ? "status-running" : "status-stopped";
        const statusIcon = isError ? "&#x2716;" : isRunning ? "&#x25CF;" : "&#x25CB;";
        const actionIcon = (isRunning || isError) ? "&#x25A0;" : "&#x25B6;";
        const actionCmd = (isRunning || isError) ? "stop" : "start";
        const actionTitle = (isRunning || isError) ? "Stop" : "Start";

        html += '<div class="service-item">';
        html += '  <div class="service-row">';
        html += '    <span class="service-status ' + statusClass + '">' + statusIcon + '</span>';
        html += '    <span class="service-name">' + escapeHtml(svc.name) + '</span>';
        html += '    <button class="service-action" data-action="' + actionCmd + '" data-name="' + escapeHtml(svc.name) + '" data-role="' + svc.role + '" title="' + actionTitle + '">' + actionIcon + '</button>';
        html += '  </div>';
        html += '  <div class="service-details">';
        html += '    <div class="service-command">' + escapeHtml(svc.command) + '</div>';

        // Badges
        const badges = [];
        if (svc.modeLabel) { badges.push({ text: svc.modeLabel, type: "mode" }); }
        if (svc.defaultPort) { badges.push({ text: ":" + svc.defaultPort, type: "port" }); }

        // Docker Compose individual services as badges
        if (svc.composeServices && svc.composeServices.length > 0) {
          for (const cs of svc.composeServices) {
            badges.push({ text: cs, type: "compose" });
          }
        }

        if (badges.length > 0) {
          html += '    <div class="service-badges">';
          for (const b of badges) {
            let cls = "badge";
            if (b.type === "mode" && (b.text.includes("hot reload") || b.text.includes("HMR"))) { cls = "badge badge-hot"; }
            if (b.type === "compose") { cls = "badge badge-compose"; }
            html += '      <span class="' + cls + '">' + escapeHtml(b.text) + '</span>';
          }
          html += '    </div>';
        }

        // URL (only when running and port known)
        if (svc.url) {
          html += '    <div class="service-url">';
          html += '      <a href="#" data-url="' + escapeHtml(svc.url) + '">' + escapeHtml(svc.url) + '</a>';
          html += '    </div>';
        }

        html += '  </div>';
        html += '</div>';
      }

      html += '  </div>';
      html += '</div>';
    }

    root.innerHTML = html;
    attachListeners();
  }

  function attachListeners() {
    // Action buttons (start/stop) — debounce to prevent double-click issues
    document.querySelectorAll(".service-action").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        // Ignore clicks during the debounce window
        if (btn.dataset.busy) { return; }
        btn.dataset.busy = "1";
        setTimeout(() => { delete btn.dataset.busy; }, 1000);

        const action = btn.getAttribute("data-action");
        const name = btn.getAttribute("data-name");
        const role = btn.getAttribute("data-role");
        vscode.postMessage({ command: action, name, role });
      });
    });

    // URL links
    document.querySelectorAll(".service-url a").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const url = link.getAttribute("data-url");
        vscode.postMessage({ command: "openUrl", url });
      });
    });

    // Collapse/expand role sections
    document.querySelectorAll(".role-header").forEach((header) => {
      header.addEventListener("click", () => {
        const role = header.getAttribute("data-role");
        const chevron = header.querySelector(".role-chevron");
        const services = document.querySelector('[data-role-services="' + role + '"]');
        if (services && chevron) {
          services.classList.toggle("collapsed");
          chevron.classList.toggle("collapsed");
        }
      });
    });
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
})();
