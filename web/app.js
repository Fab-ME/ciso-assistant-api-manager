const state = {
  items: [],
  columns: [],
  importContent: null,
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

function setMessage(elementId, message, type = "") {
  const element = $(elementId);
  element.className = `message ${type}`;
  element.innerHTML = message || "";
}

function normalizeColumns(items) {
  const preferred = ["id", "ref_id", "name", "status", "folder", "category", "updated_at"];
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function selectedResource() {
  return $("resourceSelect").value;
}

function fieldsArray() {
  return $("fieldsInput").value.split(",").map((x) => x.trim()).filter(Boolean);
}

async function loadHealth() {
  const data = await api("/api/health");
  $("health").innerHTML = `
    <strong>${escapeHtml(data.app)}</strong><br>
    API: ${escapeHtml(data.baseUrl)}<br>
    Token: ${data.tokenConfigured ? "configured" : "missing"} · SSL verify: ${data.verifySsl ? "enabled" : "disabled"}
  `;
}

async function loadResources() {
  const data = await api("/api/resources");
  const select = $("resourceSelect");
  select.innerHTML = data.resources.map((resource) => `<option value="${escapeHtml(resource)}">${escapeHtml(resource)}</option>`).join("");
}

async function loadData() {
  setMessage("exportResult", "");
  const params = new URLSearchParams({
    resource: selectedResource(),
    all: "true",
  });
  const status = $("statusFilter").value.trim();
  const search = $("searchFilter").value.trim();
  const fields = fieldsArray().join(",");
  if (status) params.set("status", status);
  if (search) params.set("search", search);
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

async function runImport(dryRun) {
  const content = await readImportFile();
  const body = {
    resource: selectedResource(),
    content,
    key: $("keySelect").value,
    exclude: $("excludeInput").value,
  };

  if (!dryRun) {
    const confirmed = confirm("You are about to apply changes to CISO Assistant. Continue?");
    if (!confirmed) return;
  }

  const endpoint = dryRun ? "/api/import/dry-run" : "/api/import/apply";
  const data = await api(endpoint, { method: "POST", body: JSON.stringify(body) });
  $("importResult").textContent = JSON.stringify(data, null, 2);
}

function bindEvents() {
  $("loadBtn").addEventListener("click", () => loadData().catch((e) => setMessage("exportResult", e.message, "error")));
  $("exportBtn").addEventListener("click", () => exportData().catch((e) => setMessage("exportResult", e.message, "error")));
  $("dryRunBtn").addEventListener("click", () => runImport(true).catch((e) => $("importResult").textContent = e.message));
  $("applyImportBtn").addEventListener("click", () => runImport(false).catch((e) => $("importResult").textContent = e.message));
  $("localSearch").addEventListener("input", renderTable);
}

async function start() {
  bindEvents();
  await loadHealth();
  await loadResources();
}

start().catch((error) => {
  document.body.innerHTML = `<pre>${escapeHtml(error.stack || error.message)}</pre>`;
});
