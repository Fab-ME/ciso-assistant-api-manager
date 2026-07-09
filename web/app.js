const state = {
  items: [],
  exportItems: [],
  columns: [],
  options: {},
};

const columnFilters = {};
const visibleColumns = new Set();
const exportColumns = new Set();
let currentColumnSignature = "";

const TECHNICAL_COLUMNS = new Set([
  "created_at",
  "updated_at",
  "created_by",
  "modified_by",
  "etag",
  "repr",
  "str",
]);

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

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function setMessage(elementId, message, type = "") {
  const element = $(elementId);
  if (!element) return;
  element.className = `message ${type}`;
  element.innerHTML = message || "";
}

function normalizeColumns(items) {
  const preferred = [
    "id",
    "ref_id",
    "name",
    "status",
    "owner",
    "owners",
    "folder",
    "perimeter",
    "entity",
    "category",
    "updated_at",
  ];

  const keys = new Set();

  items.slice(0, 50).forEach((item) => {
    Object.keys(item || {}).forEach((key) => keys.add(key));
  });

  const ordered = preferred.filter((key) => keys.has(key));

  Array.from(keys)
    .sort()
    .forEach((key) => {
      if (!ordered.includes(key)) ordered.push(key);
    });

  return ordered;
}

function cellValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function selectedResource() {
  return $("resourceSelect").value;
}

function fieldsArray() {
  const input = $("fieldsInput");
  if (!input) return [];
  return input.value
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function fillSelect(selectId, options, placeholder) {
  const select = $(selectId);
  if (!select) return;

  const current = select.value;

  select.innerHTML =
    `<option value="">${escapeHtml(placeholder)}</option>` +
    (options || [])
      .map((item) => {
        if (typeof item === "string") {
          return `<option value="${escapeAttribute(item)}">${escapeHtml(item)}</option>`;
        }
        return `<option value="${escapeAttribute(item.id)}">${escapeHtml(item.label)}</option>`;
      })
      .join("");

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

  select.innerHTML = data.resources
    .map((resource) => `<option value="${escapeAttribute(resource)}">${escapeHtml(resource)}</option>`)
    .join("");
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

function ensureColumnSelectionDefaults() {
  const signature = state.columns.join("|");
  const resourceChanged = signature !== currentColumnSignature;

  if (resourceChanged) {
    currentColumnSignature = signature;

    // Remove obsolete columns from previous resource.
    for (const col of Array.from(visibleColumns)) {
      if (!state.columns.includes(col)) visibleColumns.delete(col);
    }
    for (const col of Array.from(exportColumns)) {
      if (!state.columns.includes(col)) exportColumns.delete(col);
    }

    // First load or new columns: display all useful columns by default.
    state.columns.forEach((col) => {
      if (!visibleColumns.has(col) && !TECHNICAL_COLUMNS.has(col)) {
        visibleColumns.add(col);
      }
      if (!exportColumns.has(col) && !TECHNICAL_COLUMNS.has(col)) {
        exportColumns.add(col);
      }
    });
  }

  // Safety fallback: never keep the table empty on first load.
  if (visibleColumns.size === 0) {
    state.columns.forEach((col) => visibleColumns.add(col));
  }

  if (exportColumns.size === 0) {
    state.columns.forEach((col) => exportColumns.add(col));
  }
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
  state.exportItems = data.exportItems || data.items || [];
  state.columns = normalizeColumns(state.items);

  ensureColumnSelectionDefaults();
  renderColumnSelectors();
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

  const data = await api("/api/export", {
    method: "POST",
    body: JSON.stringify(body),
  });

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
  const data = await api(endpoint, {
    method: "POST",
    body: JSON.stringify(body),
  });

  $("importResult").textContent = summarizeImportResult(data);
}

function getFilteredRows() {
  const localSearch = ($("localSearch")?.value || "").trim().toLowerCase();

  return state.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      if (localSearch && !JSON.stringify(item).toLowerCase().includes(localSearch)) {
        return false;
      }

      for (const [column, filterValue] of Object.entries(columnFilters)) {
        if (!filterValue) continue;

        const value = String(item[column] || "").toLowerCase();

        if (!value.includes(filterValue.toLowerCase())) {
          return false;
        }
      }

      return true;
    });
}

function getFilteredItems() {
  return getFilteredRows().map((row) => row.item);
}

function renderTable() {
  const rows = getFilteredRows();
  const columns = (state.columns.length ? state.columns : normalizeColumns(state.items)).filter((col) => visibleColumns.has(col));

  const thead = document.querySelector("#dataTable thead");
  const tbody = document.querySelector("#dataTable tbody");

  if (!thead || !tbody) return;

  const headerRow =
    "<tr>" +
    columns.map((col) => `<th>${escapeHtml(col)}</th>`).join("") +
    "</tr>";

  const filterRow =
    "<tr>" +
    columns
      .map(
        (col) => `
          <th>
            <input
              type="text"
              class="column-filter"
              data-column="${escapeAttribute(col)}"
              placeholder="filter..."
              value="${escapeAttribute(columnFilters[col] || "")}"
              style="width:100%;font-size:11px;padding:4px;"
            >
          </th>
        `
      )
      .join("") +
    "</tr>";

  thead.innerHTML = headerRow + filterRow;

  tbody.innerHTML = rows
    .map(({ item }) => {
      return (
        "<tr>" +
        columns
          .map((col) => `<td title="${escapeAttribute(cellValue(item[col]))}">${escapeHtml(cellValue(item[col]))}</td>`)
          .join("") +
        "</tr>"
      );
    })
    .join("");

  document.querySelectorAll(".column-filter").forEach((input) => {
    input.addEventListener("input", (event) => {
      const column = event.target.dataset.column;
      columnFilters[column] = event.target.value;
      renderTable();
    });
  });

  $("resultSummary").textContent = `${rows.length} displayed / ${state.items.length} loaded`;
}

function renderColumnSelectors() {
  const displayDiv = $("displayColumns");
  const exportDiv = $("exportColumns");

  if (!displayDiv || !exportDiv) {
    console.error("displayColumns/exportColumns not found");
    return;
  }

  displayDiv.innerHTML = state.columns
    .map(
      (col) => `
        <label class="column-checkbox">
          <input
            type="checkbox"
            class="display-column-checkbox"
            data-column="${escapeAttribute(col)}"
            ${visibleColumns.has(col) ? "checked" : ""}
          >
          ${escapeHtml(col)}
        </label>
      `
    )
    .join("");

  exportDiv.innerHTML = state.columns
    .map(
      (col) => `
        <label class="column-checkbox">
          <input
            type="checkbox"
            class="export-column-checkbox"
            data-column="${escapeAttribute(col)}"
            ${exportColumns.has(col) ? "checked" : ""}
          >
          ${escapeHtml(col)}
        </label>
      `
    )
    .join("");

  document.querySelectorAll(".display-column-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      toggleVisibleColumn(event.target.dataset.column, event.target.checked);
    });
  });

  document.querySelectorAll(".export-column-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      toggleExportColumn(event.target.dataset.column, event.target.checked);
    });
  });
}

function toggleVisibleColumn(column, checked) {
  if (checked) {
    visibleColumns.add(column);
  } else {
    visibleColumns.delete(column);
  }

  renderTable();
}

function toggleExportColumn(column, checked) {
  if (checked) {
    exportColumns.add(column);
  } else {
    exportColumns.delete(column);
  }
}

function exportFilteredResults() {
  const rows = getFilteredRows();
  const selectedExportColumns = Array.from(exportColumns);

  const jsonData = rows.map(({ item, index }) => {
    const source = state.exportItems[index] || item;
    const result = {};

    selectedExportColumns.forEach((col) => {
      if (source[col] !== undefined) {
        result[col] = source[col];
      } else if (item[col] !== undefined) {
        result[col] = item[col];
      }
    });

    return result;
  });

  const blob = new Blob([JSON.stringify(jsonData, null, 2)], {
    type: "application/json",
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${selectedResource()}_filtered.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function bindEvents() {
  $("loadBtn").addEventListener("click", () => loadData().catch((e) => setMessage("exportResult", e.message, "error")));
  $("exportBtn").addEventListener("click", () => exportData().catch((e) => setMessage("exportResult", e.message, "error")));
  $("refreshOptionsBtn").addEventListener("click", () => loadOptions().catch((e) => setMessage("exportResult", e.message, "error")));
  $("dryRunBtn").addEventListener("click", () => runImport(true).catch((e) => ($("importResult").textContent = e.message)));
  $("applyImportBtn").addEventListener("click", () => runImport(false).catch((e) => ($("importResult").textContent = e.message)));
  $("localSearch").addEventListener("input", renderTable);
  $("resourceSelect").addEventListener("change", () => loadOptions().catch((e) => setMessage("exportResult", e.message, "error")));

  const exportFilteredButton = $("exportFilteredBtn");
  if (exportFilteredButton) {
    exportFilteredButton.addEventListener("click", exportFilteredResults);
  }
}

async function start() {
  bindEvents();
  await loadHealth();
  await loadResources();
  await loadOptions();
}

// Optional global bindings for browser console debugging.
window.columnFilters = columnFilters;
window.visibleColumns = visibleColumns;
window.exportColumns = exportColumns;
window.renderTable = renderTable;
window.renderColumnSelectors = renderColumnSelectors;
window.toggleVisibleColumn = toggleVisibleColumn;
window.toggleExportColumn = toggleExportColumn;
window.exportFilteredResults = exportFilteredResults;

start().catch((error) => {
  document.body.innerHTML = `<pre>${escapeHtml(error.stack || error.message)}</pre>`;
});
