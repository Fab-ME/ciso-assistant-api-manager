import { $, escapeHtml, escapeAttribute, setMessage } from "./dom.js";
import { api } from "./api.js";

const state = {
  resources: [],
  existingItems: [],
  existingColumns: [],
  csvRows: [],
  csvHeaders: [],
  mapping: {},
  generatedObjects: [],
};

function csvElementsPresent() {
  return Boolean(document.getElementById("csvMapperPage"));
}

function splitCsvLine(line, delimiter) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  result.push(current.trim());
  return result;
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim());
  if (!firstLine) return ";";
  const candidates = [";", ",", "\t"];
  return candidates
    .map((delimiter) => ({ delimiter, count: splitCsvLine(firstLine, delimiter).length }))
    .sort((a, b) => b.count - a.count)[0].delimiter;
}

function parseCsv(text) {
  const delimiter = $("csvDelimiter")?.value || "auto";
  const effectiveDelimiter = delimiter === "auto" ? detectDelimiter(text) : delimiter;
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (!lines.length) throw new Error("Le fichier CSV est vide.");

  const headers = splitCsvLine(lines[0], effectiveDelimiter);
  const rows = lines.slice(1).map((line, index) => {
    const values = splitCsvLine(line, effectiveDelimiter);
    const row = { __line: index + 2 };
    headers.forEach((header, i) => {
      row[header] = values[i] ?? "";
    });
    return row;
  });

  return { headers, rows, delimiter: effectiveDelimiter };
}

function normalizeColumns(items) {
  const preferred = ["id", "ref_id", "name", "description", "status", "folder", "parent_folder", "owner"];
  const keys = new Set();
  items.slice(0, 100).forEach((item) => Object.keys(item || {}).forEach((key) => keys.add(key)));
  const ordered = preferred.filter((key) => keys.has(key));
  Array.from(keys).sort().forEach((key) => {
    if (!ordered.includes(key)) ordered.push(key);
  });
  return ordered;
}

function fillSelect(selectId, options, placeholder) {
  const select = $(selectId);
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` +
    options.map((option) => `<option value="${escapeAttribute(option)}">${escapeHtml(option)}</option>`).join("");
  if (current) select.value = current;
}

async function loadCsvResources() {
  const data = await api("/api/resources");
  state.resources = data.resources || [];
  fillSelect("csvResourceSelect", state.resources, "Choisir une ressource");
}

async function loadExistingItems() {
  const resource = $("csvResourceSelect")?.value;
  if (!resource) {
    setMessage("csvMapperMessage", "Choisis d'abord une ressource.", "error");
    return;
  }

  setMessage("csvMapperMessage", "Chargement des éléments existants...", "");
  const data = await api(`/api/data?resource=${encodeURIComponent(resource)}`);
  state.existingItems = data.exportItems || data.items || [];
  state.existingColumns = normalizeColumns(state.existingItems);
  renderExistingPreview();
  renderMappingTable();
  setMessage("csvMapperMessage", `${state.existingItems.length} élément(s) existant(s) chargé(s).`, "success");
}

function renderExistingPreview() {
  const container = $("csvExistingPreview");
  if (!container) return;

  const columns = state.existingColumns.slice(0, 8);
  const rows = state.existingItems.slice(0, 10);

  if (!rows.length) {
    container.innerHTML = `<p class="hint">Aucun élément existant chargé.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="table-wrap medium">
      <table>
        <thead><tr>${columns.map((col) => `<th>${escapeHtml(col)}</th>`).join("")}</tr></thead>
        <tbody>
          ${rows.map((row) => `<tr>${columns.map((col) => `<td>${escapeHtml(row[col] ?? "")}</td>`).join("")}</tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
}

async function handleCsvFileChange() {
  const file = $("csvFile")?.files?.[0];
  if (!file) return;

  const text = await file.text();
  const parsed = parseCsv(text);
  state.csvHeaders = parsed.headers;
  state.csvRows = parsed.rows;
  state.mapping = {};

  autoMapColumns();
  renderCsvPreview();
  renderMappingTable();
  setMessage("csvMapperMessage", `${state.csvRows.length} ligne(s) CSV chargée(s). Délimiteur détecté : ${parsed.delimiter === "\t" ? "tabulation" : parsed.delimiter}`, "success");
}

function autoMapColumns() {
  const targetColumns = new Set(state.existingColumns);
  state.csvHeaders.forEach((header) => {
    const exact = state.existingColumns.find((col) => col.toLowerCase() === header.toLowerCase());
    if (exact) {
      state.mapping[header] = exact;
      return;
    }

    const cleaned = header.toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
    const normalized = state.existingColumns.find((col) => col.toLowerCase() === cleaned);
    if (normalized && targetColumns.has(normalized)) {
      state.mapping[header] = normalized;
    }
  });
}

function renderCsvPreview() {
  const container = $("csvPreview");
  if (!container) return;

  if (!state.csvRows.length) {
    container.innerHTML = `<p class="hint">Aucun CSV chargé.</p>`;
    return;
  }

  const headers = state.csvHeaders;
  const rows = state.csvRows.slice(0, 10);
  container.innerHTML = `
    <div class="table-wrap medium">
      <table>
        <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
        <tbody>
          ${rows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header] ?? "")}</td>`).join("")}</tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function mappingSelectHtml(csvHeader) {
  const selected = state.mapping[csvHeader] || "";
  const options = [`<option value="">Ignorer</option>`];
  state.existingColumns.forEach((column) => {
    options.push(`<option value="${escapeAttribute(column)}" ${selected === column ? "selected" : ""}>${escapeHtml(column)}</option>`);
  });
  return `<select class="csv-map-select" data-csv="${escapeAttribute(csvHeader)}">${options.join("")}</select>`;
}

function renderMappingTable() {
  const container = $("csvMappingTable");
  if (!container) return;

  if (!state.csvHeaders.length) {
    container.innerHTML = `<p class="hint">Charge un CSV pour construire le mapping.</p>`;
    return;
  }

  container.innerHTML = `
    <table>
      <thead><tr><th>Colonne CSV</th><th>Champ CISO Assistant</th><th>Exemple</th></tr></thead>
      <tbody>
        ${state.csvHeaders.map((header) => `
          <tr>
            <td>${escapeHtml(header)}</td>
            <td>${mappingSelectHtml(header)}</td>
            <td>${escapeHtml(state.csvRows[0]?.[header] ?? "")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  document.querySelectorAll(".csv-map-select").forEach((select) => {
    select.addEventListener("change", () => {
      const csvHeader = select.dataset.csv;
      if (select.value) state.mapping[csvHeader] = select.value;
      else delete state.mapping[csvHeader];
      buildGeneratedObjects();
      renderGeneratedPreview();
    });
  });

  buildGeneratedObjects();
  renderGeneratedPreview();
}

function parseCellValue(value) {
  const raw = String(value ?? "").trim();
  if (raw === "") return "";
  if (raw.toLowerCase() === "true") return true;
  if (raw.toLowerCase() === "false") return false;
  if (raw.toLowerCase() === "null") return null;
  return raw;
}

function buildGeneratedObjects() {
  state.generatedObjects = state.csvRows.map((row) => {
    const obj = {};
    Object.entries(state.mapping).forEach(([csvColumn, targetColumn]) => {
      if (!targetColumn) return;
      const value = parseCellValue(row[csvColumn]);
      if (value !== "") obj[targetColumn] = value;
    });
    return obj;
  }).filter((obj) => Object.keys(obj).length > 0);
}

function renderGeneratedPreview() {
  const output = $("csvGeneratedPreview");
  if (!output) return;
  output.textContent = JSON.stringify(state.generatedObjects.slice(0, 20), null, 2);
}

function selectedKey() {
  return $("csvKeySelect")?.value || "id";
}

function excludedFields() {
  return $("csvExcludeInput")?.value || "";
}

async function runCsvImport(dryRun) {
  const resource = $("csvResourceSelect")?.value;
  if (!resource) throw new Error("Ressource manquante.");
  if (!state.generatedObjects.length) throw new Error("Aucune donnée générée. Vérifie le mapping.");

  const endpoint = dryRun ? "/api/import/dry-run" : "/api/import/apply";

  if (!dryRun && !confirm("Tu vas appliquer les modifications dans CISO Assistant. Continuer ?")) return;

  const payload = {
    resource,
    content: JSON.stringify(state.generatedObjects),
    key: selectedKey(),
    exclude: excludedFields(),
    strict: $("csvStrictImport")?.checked ?? true,
  };

  const result = await api(endpoint, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  const output = $("csvImportResult");
  if (output) output.textContent = JSON.stringify(result, null, 2);
  setMessage("csvMapperMessage", dryRun ? "Dry-run CSV terminé." : "Import CSV terminé.", result.ok ? "success" : "error");
}

export function bindCsvMapperEvents() {
  if (!csvElementsPresent()) return;

  loadCsvResources().catch((error) => setMessage("csvMapperMessage", error.message, "error"));

  $("csvLoadExistingBtn")?.addEventListener("click", () => loadExistingItems().catch((error) => setMessage("csvMapperMessage", error.message, "error")));
  $("csvFile")?.addEventListener("change", () => handleCsvFileChange().catch((error) => setMessage("csvMapperMessage", error.message, "error")));
  $("csvBuildPreviewBtn")?.addEventListener("click", () => {
    buildGeneratedObjects();
    renderGeneratedPreview();
    setMessage("csvMapperMessage", `${state.generatedObjects.length} objet(s) généré(s).`, "success");
  });
  $("csvDryRunBtn")?.addEventListener("click", () => runCsvImport(true).catch((error) => setMessage("csvMapperMessage", error.message, "error")));
  $("csvApplyBtn")?.addEventListener("click", () => runCsvImport(false).catch((error) => setMessage("csvMapperMessage", error.message, "error")));
}
