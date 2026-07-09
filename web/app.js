const state = {
  items: [],
  columns: [],
  options: {},
};

const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(text || response.statusText);
  }
  if (!response.ok && !data.ok) {
    throw new Error(data.error || response.statusText);
  }
  return data;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setMessage(elementId, message, type = "") {
  const element = $(elementId);
  element.className = `message ${type}`;
  element.innerHTML = message || "";
}

function normalizeColumns(items) {
  const preferred = ["id", "ref_id", "name", "status", "folder", "perimeter", "entity", "category", "updated_at"];
  const keys = new Set();
  items.slice(0, 50).forEach((item) => Object.keys(item || {}).forEach((key) => keys.add(key)));
  const ordered = preferred.filter((key) => keys.has(key));
  Array.from(keys).sort().forEach((key) => {
    if (!ordered.includes(key)) ordered.push(key);
  });
  return ordered;
}

function cellValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function renderTable() {
  const filter = $("localSearch").value.trim().toLowerCase();
  const items = filter
    ? state.items.filter((item) => JSON.stringify(item).toLowerCase().includes(filter))
    : state.items;

  const columns = state.columns.length ? state.columns : normalizeColumns(items);
  const thead = $("dataTable").querySelector("thead");
  const tbody = $("dataTable").querySelector("tbody");

  thead.innerHTML = `<tr>${columns.map((col) => `<th>${escapeHtml(col)}</th>`).join("")}</tr>`;
  tbody.innerHTML = items.map((item) => {
    return `<tr>${columns.map((col) => `<td title="${escapeHtml(cellValue(item[col]))}">${escapeHtml(cellValue(item[col]))}</td>`).join("")}</tr>`;
  }).join("");

  $("resultSummary").textContent = `${items.length} displayed / ${state.items.length} loaded`;
}

function selectedResource() {
  return $("resourceSelect").value;
}

function fieldsArray() {
  return $("fieldsInput").value.split(",").map((x) => x.trim()).filter(Boolean);
}

function fillSelect(selectId, options, placeholder) {
  const select = $(selectId);
  const current = select.value;
  select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` +
    (options || []).map((item) => {
      if (typeof item === "string") {
        return `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`;
      }
      return `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`;
    }).join("");
  if (current) select.value = current;
}

async function loadHealth() {
  const data = await api("/api/health");
  $("health").innerHTML = `
    <strong>${escapeHtml(data.app)} v${escapeHtml(data.version || "")}</strong><br>
    API: ${escapeHtml(data.baseUrl)}<br>
    Token: ${data.tokenConfigured ? "configured" : "missing"} · SSL verify: ${data.verifySsl ? "enabled" : "disabled"}
  `;
}

async function loadResources() {
  const data = await api("/api/resources");
  const select = $("resourceSelect");
  select.innerHTML = data.resources.map((resource) => `<option value="${escapeHtml(resource)}">${escapeHtml(resource)}</option>`).join("");
}

async function loadOptions() {
  const resource = selectedResource();
  const params = resource ? `?resource=${encodeURIComponent(resource)}` : "";
  const data = await api(`/api/options${params}`);
  state.options = data.options || {};
  fillSelect("statusFilter", state.options.statuses, "All statuses");
  fillSelect("folderFilter", state.options.folders, "All folders");
  fillSelect("perimeterFilter", state.options.perimeters, "All perimeters");
}

async function loadData() {
  setMessage("exportResult", "");
  const params = new URLSearchParams({ resource: selectedResource() });
  const status = $("statusFilter").value.trim();
  const search = $("searchFilter").value.trim();
  const folder = $("folderFilter").value.trim();
  const perimeter = $("perimeterFilter").value.trim();
  const fields = fieldsArray().join(",");
  if (status) params.set("status", status);
  if (search) params.set("search", search);
  if (folder) params.set("folder", folder);
  if (perimeter) params.set("perimeter", perimeter);
  if (fields) params.set("fields", fields);

  $("resultSummary").textContent = "Loading...";
  const data = await api(`/api/data?${params.toString()}`);
  state.items = data.items || [];
  state.columns = normalizeColumns(state.items);
  renderTable();
}

async function exportData() {
  const body = {
    resource: selectedResource(),
    fields: fieldsArray(),
    status: $("statusFilter").value.trim(),
    search: $("searchFilter").value.trim(),
    folder: $("folderFilter").value.trim(),
    perimeter: $("perimeterFilter").value.trim(),
  };
  const data = await api("/api/export", { method: "POST", body: JSON.stringify(body) });
  setMessage(
    "exportResult",
    `Export completed: ${data.count} records. <a href="${data.downloadUrl}">Download ${escapeHtml(data.file)}</a>`,
    "success"
  );
}

async function readImportFile() {
  const file = $("importFile").files[0];
  if (!file) throw new Error("Please select a JSON file first.");
  return await file.text();
}

function summarizeImportResult(data) {
  const lines = [];
  lines.push(`Resource: ${data.resource}`);
  lines.push(`Records: ${data.count}`);
  lines.push(`Skipped unchanged PATCH: ${data.skipped || 0}`);
  lines.push(`Errors: ${data.errors || 0}`);
  lines.push(`Strict mode: ${data.strict ? "enabled" : "disabled"}`);
  lines.push("");
  lines.push(JSON.stringify(data, null, 2));
  return lines.join("\n");
}

async function runImport(dryRun) {
  const content = await readImportFile();
  const body = {
    resource: selectedResource(),
    content,
    key: $("keySelect").value,
    exclude: $("excludeInput").value,
    strict: $("strictImport").checked,
  };

  if (!dryRun) {
    const confirmed = confirm("You are about to apply changes to CISO Assistant. Continue?");
    if (!confirmed) return;
  }

  const endpoint = dryRun ? "/api/import/dry-run" : "/api/import/apply";
  const data = await api(endpoint, { method: "POST", body: JSON.stringify(body) });
  $("importResult").textContent = summarizeImportResult(data);
}

function bindEvents() {
  $("loadBtn").addEventListener("click", () => loadData().catch((e) => setMessage("exportResult", e.message, "error")));
  $("exportBtn").addEventListener("click", () => exportData().catch((e) => setMessage("exportResult", e.message, "error")));
  $("refreshOptionsBtn").addEventListener("click", () => loadOptions().catch((e) => setMessage("exportResult", e.message, "error")));
  $("dryRunBtn").addEventListener("click", () => runImport(true).catch((e) => $("importResult").textContent = e.message));
  $("applyImportBtn").addEventListener("click", () => runImport(false).catch((e) => $("importResult").textContent = e.message));
  $("localSearch").addEventListener("input", renderTable);
  $("resourceSelect").addEventListener("change", () => loadOptions().catch((e) => setMessage("exportResult", e.message, "error")));
}

async function start() {
  bindEvents();
  await loadHealth();
  await loadResources();
  await loadOptions();
}

start().catch((error) => {
  document.body.innerHTML = `<pre>${escapeHtml(error.stack || error.message)}</pre>`;
});
