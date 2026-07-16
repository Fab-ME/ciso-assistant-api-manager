import { state, TECHNICAL_COLUMNS } from "./state.js";
import { $, escapeHtml, escapeAttribute } from "./dom.js";
import { cellValue, buildSearchCache } from "./utils.js";

export function buildRows(items, exportItems) {
  return items.map((item, index) => ({
    item,
    exportItem: exportItems[index] || item,
    index,
    searchCache: buildSearchCache(item),
  }));
}

export function ensureColumnSelectionDefaults() {
  const signature = state.columns.join("|");
  const resourceChanged = signature !== state.currentColumnSignature;
  if (resourceChanged) {
    state.currentColumnSignature = signature;
    for (const col of Array.from(state.visibleColumns)) {
      if (!state.columns.includes(col)) state.visibleColumns.delete(col);
    }
    for (const col of Array.from(state.exportColumns)) {
      if (!state.columns.includes(col)) state.exportColumns.delete(col);
    }
    state.columns.forEach((col) => {
      if (!state.visibleColumns.has(col) && !TECHNICAL_COLUMNS.has(col)) state.visibleColumns.add(col);
      if (!state.exportColumns.has(col) && !TECHNICAL_COLUMNS.has(col)) state.exportColumns.add(col);
    });
  }
  if (state.visibleColumns.size === 0) state.columns.forEach((col) => state.visibleColumns.add(col));
  if (state.exportColumns.size === 0) state.columns.forEach((col) => state.exportColumns.add(col));
}

export function getFilteredRows() {
  const localSearch = ($("localSearch")?.value || "").trim().toLowerCase();
  const filtered = state.rows.filter((row) => {
    if (localSearch && !row.searchCache.includes(localSearch)) return false;
    for (const [column, filterValue] of Object.entries(state.columnFilters)) {
      if (!filterValue) continue;
      const value = cellValue(row.item[column]).toLowerCase();
      if (!value.includes(filterValue.toLowerCase())) return false;
    }
    return true;
  });

  if (state.sort.column) {
    const direction = state.sort.direction === "desc" ? -1 : 1;
    filtered.sort((a, b) => {
      const av = cellValue(a.item[state.sort.column]).toLowerCase();
      const bv = cellValue(b.item[state.sort.column]).toLowerCase();
      return av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" }) * direction;
    });
  }

  return filtered;
}

export function getPagedRows(rows) {
  const pageSize = Number($("pageSizeSelect")?.value || state.pageSize || 100);
  state.pageSize = pageSize;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  if (state.page > totalPages) state.page = totalPages;
  const start = (state.page - 1) * pageSize;
  return { pageRows: rows.slice(start, start + pageSize), totalPages };
}

export function renderTable() {
  const allRows = getFilteredRows();
  const { pageRows, totalPages } = getPagedRows(allRows);
  const columns = state.columns.filter((col) => state.visibleColumns.has(col));
  const thead = document.querySelector("#dataTable thead");
  const tbody = document.querySelector("#dataTable tbody");
  if (!thead || !tbody) return;

  const headerRow = "<tr>" + columns.map((col) => {
    const marker = state.sort.column === col ? (state.sort.direction === "asc" ? " ▲" : " ▼") : "";
    return `<th><button class="sort-button" data-column="${escapeAttribute(col)}">${escapeHtml(col)}${marker}</button></th>`;
  }).join("") + "</tr>";

  const filterRow = "<tr>" + columns.map((col) => `
    <th>
      <input type="text" class="column-filter" data-column="${escapeAttribute(col)}" placeholder="filter..."
        value="${escapeAttribute(state.columnFilters[col] || "")}" />
    </th>`).join("") + "</tr>";

  thead.innerHTML = headerRow + filterRow;
  tbody.innerHTML = pageRows.map(({ item }) => "<tr>" + columns.map((col) => {
    const text = cellValue(item[col]);
    return `<td title="${escapeAttribute(text)}">${escapeHtml(text)}</td>`;
  }).join("") + "</tr>").join("");

  document.querySelectorAll(".sort-button").forEach((button) => {
    button.addEventListener("click", () => {
      const column = button.dataset.column;
      if (state.sort.column === column) {
        state.sort.direction = state.sort.direction === "asc" ? "desc" : "asc";
      } else {
        state.sort.column = column;
        state.sort.direction = "asc";
      }
      renderTable();
    });
  });

  document.querySelectorAll(".column-filter").forEach((input) => {
    input.addEventListener("input", (event) => {
      state.columnFilters[event.target.dataset.column] = event.target.value;
      state.page = 1;
      renderTable();
    });
  });

  $("resultSummary").textContent = `${allRows.length} displayed / ${state.items.length} loaded`;
  $("pageIndicator").textContent = `Page ${state.page} / ${totalPages}`;
  $("prevPageBtn").disabled = state.page <= 1;
  $("nextPageBtn").disabled = state.page >= totalPages;
}

export function renderColumnSelectors() {
  const displayDiv = $("displayColumns");
  const exportDiv = $("exportColumns");
  if (!displayDiv || !exportDiv) return;

  displayDiv.innerHTML = state.columns.map((col) => `
    <label class="column-checkbox">
      <input type="checkbox" class="display-column-checkbox" data-column="${escapeAttribute(col)}" ${state.visibleColumns.has(col) ? "checked" : ""}>
      ${escapeHtml(col)}
    </label>`).join("");

  exportDiv.innerHTML = state.columns.map((col) => `
    <label class="column-checkbox">
      <input type="checkbox" class="export-column-checkbox" data-column="${escapeAttribute(col)}" ${state.exportColumns.has(col) ? "checked" : ""}>
      ${escapeHtml(col)}
    </label>`).join("");

  document.querySelectorAll(".display-column-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      const column = event.target.dataset.column;
      event.target.checked ? state.visibleColumns.add(column) : state.visibleColumns.delete(column);
      renderTable();
    });
  });

  document.querySelectorAll(".export-column-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      const column = event.target.dataset.column;
      event.target.checked ? state.exportColumns.add(column) : state.exportColumns.delete(column);
    });
  });
}
