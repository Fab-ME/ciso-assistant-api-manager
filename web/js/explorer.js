import { state } from "./state.js";
import { $, fillSelect, setMessage, escapeHtml } from "./dom.js";
import { api } from "./api.js";
import { normalizeColumns, downloadJson } from "./utils.js";
import {
  buildRows,
  ensureColumnSelectionDefaults,
  getFilteredRows,
  renderColumnSelectors,
  renderTable,
} from "./table.js";

function selectedResource() {
  return $("resourceSelect").value;
}

function fieldsArray() {
  const input = $("fieldsInput");
  if (!input) return [];
  return input.value.split(",").map((x) => x.trim()).filter(Boolean);
}

export async function loadHealth() {
  const data = await api("/api/health");
  $("health").innerHTML = `
    ${escapeHtml(data.app)} v${escapeHtml(data.version || "")}<br>
    API: ${escapeHtml(data.baseUrl)}<br>
    Token: ${data.tokenConfigured ? "configured" : "missing"} - SSL verify: ${data.verifySsl ? "enabled" : "disabled"}<br>
    Cache TTL: ${escapeHtml(data.cacheTtlSeconds || "n/a")}s
  `;
}

export async function loadResources() {
  const data = await api("/api/resources");
  const select = $("resourceSelect");
  select.innerHTML = data.resources.map((resource) =>
    `<option value="${escapeHtml(resource)}">${escapeHtml(resource)}</option>`
  ).join("");
}

export async function loadOptions(force = false) {
  const resource = selectedResource();
  const params = new URLSearchParams();
  if (resource) params.set("resource", resource);
  if (force) params.set("force", "true");

  const data = await api(`/api/options?${params.toString()}`);
  state.options = data.options || {};
  fillSelect("statusFilter", state.options.statuses, "All statuses");
  fillSelect("folderFilter", state.options.folders, "All folders");
  fillSelect("perimeterFilter", state.options.perimeters, "All perimeters");
}

export async function loadData() {
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

  // items = affichage lisible, exportItems = donnees techniques importables.
  state.items = data.items || [];
  state.exportItems = data.exportItems || data.items || [];
  state.rows = buildRows(state.items, state.exportItems);

  // Les colonnes viennent de la verite technique pour ne pas perdre de champs API.
  state.columns = normalizeColumns(state.exportItems);

  state.page = 1;
  state.sort = { column: null, direction: "asc" };
  ensureColumnSelectionDefaults();
  renderColumnSelectors();
  renderTable();
}

export async function exportFullDataset() {
  const body = {
    resource: selectedResource(),
    fields: fieldsArray(),
    status: $("statusFilter").value.trim(),
    search: $("searchFilter").value.trim(),
    folder: $("folderFilter").value.trim(),
    perimeter: $("perimeterFilter").value.trim(),
  };

  const data = await api("/api/export", { method: "POST", body: JSON.stringify(body) });
  setMessage("exportResult", `Export completed: ${data.count} records. <a href="${data.downloadUrl}">Download ${escapeHtml(data.file)}</a>`, "success");
}

export function exportFilteredResults() {
  const selectedExportColumns = Array.from(state.exportColumns);
  const jsonData = getFilteredRows().map((row) => {
    const source = row.exportItem || row.item;
    const result = {};
    selectedExportColumns.forEach((col) => {
      if (source[col] !== undefined) result[col] = source[col];
      else if (row.item[col] !== undefined) result[col] = row.item[col];
    });
    return result;
  });
  downloadJson(`${selectedResource()}_filtered.json`, jsonData);
}

export function bindExplorerEvents() {
  $("loadBtn").addEventListener("click", () => loadData().catch((e) => setMessage("exportResult", e.message, "error")));
  $("exportBtn").addEventListener("click", () => exportFullDataset().catch((e) => setMessage("exportResult", e.message, "error")));
  $("exportFilteredBtn").addEventListener("click", exportFilteredResults);
  $("refreshOptionsBtn").addEventListener("click", () => loadOptions(true).catch((e) => setMessage("exportResult", e.message, "error")));
  $("localSearch").addEventListener("input", () => { state.page = 1; renderTable(); });
  $("pageSizeSelect").addEventListener("change", () => { state.page = 1; renderTable(); });
  $("prevPageBtn").addEventListener("click", () => { state.page = Math.max(1, state.page - 1); renderTable(); });
  $("nextPageBtn").addEventListener("click", () => { state.page += 1; renderTable(); });
  $("resourceSelect").addEventListener("change", () => loadOptions().catch((e) => setMessage("exportResult", e.message, "error")));
}
