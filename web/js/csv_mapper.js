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
  importedJsonObjects: [],
  options: {},
};

const REFERENCE_FIELDS = {
  folder: "folders",
  folders: "folders",
  parent_folder: "folders",
  owner: "users",
  owners: "users",
  assignee: "users",
  user: "users",
  users: "users",
  team: "teams",
  teams: "teams",
  entity: "entities",
  entities: "entities",
  perimeter: "perimeters",
  perimeters: "perimeters",
  role: "roles",
  roles: "roles",
};

function csvElementsPresent() {
  return Boolean(document.getElementById("csvMapperPage"));
}

function isUuidLike(value) {
  const text = String(value || "");
  return text.length >= 32 && text.includes("-");
}

function resourceForField(fieldName) {
  const name = String(fieldName || "").toLowerCase();
  if (REFERENCE_FIELDS[name]) return REFERENCE_FIELDS[name];
  if (name.endsWith("_id") && REFERENCE_FIELDS[name.slice(0, -3)]) return REFERENCE_FIELDS[name.slice(0, -3)];
  return null;
}

function getOptionLabel(resource, id) {
  if (!resource || !id) return null;
  const list = state.options?.[resource] || [];
  const item = list.find((entry) => String(entry.id) === String(id));
  return item?.label || null;
}

// Affichage uniquement : remplace les UID par des libelles lisibles a l'ecran.
function displayValue(fieldName, value) {
  if (value === null || value === undefined || value === "") return "";

  if (Array.isArray(value)) {
    return value.map((item) => displayValue(fieldName, item)).filter(Boolean).join(" | ");
  }

  if (typeof value === "object") {
    if (value.name || value.str || value.label || value.email || value.username) {
      return value.name || value.str || value.label || value.email || value.username;
    }
    if (value.id) {
      const resource = resourceForField(fieldName);
      return getOptionLabel(resource, value.id) || value.id;
    }
    return JSON.stringify(value);
  }

  const resource = resourceForField(fieldName);
  if (resource && isUuidLike(value)) {
    return getOptionLabel(resource, value) || String(value);
  }

  return String(value);
}

// Valeur technique : conserve les UID et les structures attendues par l'API.
// Important : l'import doit envoyer les valeurs techniques, pas les libelles affiches.
function technicalValueFromInput(value) {
  const raw = String(value ?? "").trim();
  if (raw === "") return "";
  if (raw.toLowerCase() === "true") return true;
  if (raw.toLowerCase() === "false") return false;
  if (raw.toLowerCase() === "null") return null;
  return raw;
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
  const preferred = ["id", "ref_id", "name", "description", "status", "folder", "parent_folder", "owner", "owners", "assignee"];
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
  const [resourcesData, optionsData] = await Promise.all([
    api("/api/resources"),
    api("/api/options").catch(() => ({ options: {} })),
  ]);
  state.resources = resourcesData.resources || [];
  state.options = optionsData.options || {};
  fillSelect("csvResourceSelect", state.resources, "Choisir une ressource");
}

async function refreshOptions() {
  const data = await api("/api/options?force=true").catch(() => ({ options: {} }));
  state.options = data.options || {};
}

async function loadExistingItems() {
  const resource = $("csvResourceSelect")?.value;
  if (!resource) {
    setMessage("csvMapperMessage", "Choisis d'abord une ressource.", "error");
    return;
  }

  setMessage("csvMapperMessage", "Chargement des elements existants...", "");
  await refreshOptions();
  const data = await api(`/api/data?resource=${encodeURIComponent(resource)}`);
  state.existingItems = data.exportItems || data.items || [];
  state.existingColumns = normalizeColumns(state.existingItems);
  renderExistingPreview();
  renderMappingTable();
  renderGeneratedPreview();
  setMessage("csvMapperMessage", `${state.existingItems.length} element(s) existant(s) charge(s).`, "success");
}

function renderExistingPreview() {
  const container = $("csvExistingPreview");
  if (!container) return;

  const columns = state.existingColumns.slice(0, 10);
  const rows = state.existingItems.slice(0, 10);

  if (!rows.length) {
    container.innerHTML = `<p class="hint">Aucun element existant charge.</p>`;
    return;
  }

  container.innerHTML = `
    <p class="hint">Apercu ecran : les references sont affichees avec des libelles quand c'est possible. Les exports importables restent techniques.</p>
    <div class="table-wrap medium">
      <table>
        <thead><tr>${columns.map((col) => `<th>${escapeHtml(col)}</th>`).join("")}</tr></thead>
        <tbody>
          ${rows.map((row) => `<tr>${columns.map((col) => `<td>${escapeHtml(displayValue(col, row[col]))}</td>`).join("")}</tr>`).join("")}
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
  state.importedJsonObjects = [];

  autoMapColumns();
  renderCsvPreview();
  renderMappingTable();
  setMessage("csvMapperMessage", `${state.csvRows.length} ligne(s) CSV chargee(s). Delimiteur detecte : ${parsed.delimiter === "\t" ? "tabulation" : parsed.delimiter}`, "success");
}

async function handleJsonFileChange() {
  const file = $("jsonFile")?.files?.[0];
  if (!file) return;
  const text = await file.text();
  const parsed = JSON.parse(text);
  state.importedJsonObjects = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.results) ? parsed.results : [parsed]);
  state.generatedObjects = state.importedJsonObjects;
  state.csvRows = [];
  state.csvHeaders = [];
  renderCsvPreview();
  renderMappingTable();
  renderGeneratedPreview();
  setMessage("csvMapperMessage", `${state.importedJsonObjects.length} objet(s) JSON charge(s).`, "success");
}

function autoMapColumns() {
  state.csvHeaders.forEach((header) => {
    const exact = state.existingColumns.find((col) => col.toLowerCase() === header.toLowerCase());
    if (exact) {
      state.mapping[header] = exact;
      return;
    }
    const cleaned = header.toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
    const normalized = state.existingColumns.find((col) => col.toLowerCase() === cleaned);
    if (normalized) state.mapping[header] = normalized;
  });
}

function renderCsvPreview() {
  const container = $("csvPreview");
  if (!container) return;

  if (!state.csvRows.length) {
    container.innerHTML = state.importedJsonObjects.length
      ? `<p class="hint">Source JSON chargee : pas de mapping CSV necessaire.</p>`
      : `<p class="hint">Aucun CSV charge.</p>`;
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
    container.innerHTML = state.importedJsonObjects.length
      ? `<p class="hint">Import JSON charge : mapping CSV non utilise.</p>`
      : `<p class="hint">Charge un CSV pour construire le mapping.</p>`;
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

function buildGeneratedObjects() {
  if (state.importedJsonObjects.length) {
    state.generatedObjects = state.importedJsonObjects;
    return;
  }

  // Option 1 : aucune conversion libelle -> UID.
  // Le CSV importable doit contenir les valeurs techniques attendues par l'API.
  state.generatedObjects = state.csvRows.map((row) => {
    const obj = {};
    Object.entries(state.mapping).forEach(([csvColumn, targetColumn]) => {
      if (!targetColumn) return;
      const value = technicalValueFromInput(row[csvColumn]);
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

function toCsvValue(value) {
  const text = String(value ?? "");
  if (text.includes(";") || text.includes('"') || text.includes("\n")) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function downloadText(fileName, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportCsvTechnical() {
  if (!state.existingItems.length) throw new Error("Charge d'abord les elements en base.");
  const columns = state.existingColumns;
  const lines = [columns.join(";")];
  state.existingItems.forEach((item) => {
    lines.push(columns.map((col) => toCsvValue(item[col])).join(";"));
  });
  downloadText(`${$("csvResourceSelect")?.value || "export"}_technical_importable.csv`, lines.join("\n"), "text/csv;charset=utf-8");
}

function exportCsvReadable() {
  if (!state.existingItems.length) throw new Error("Charge d'abord les elements en base.");
  const columns = state.existingColumns;
  const lines = [columns.join(";")];
  state.existingItems.forEach((item) => {
    lines.push(columns.map((col) => toCsvValue(displayValue(col, item[col]))).join(";"));
  });
  downloadText(`${$("csvResourceSelect")?.value || "export"}_readable.csv`, lines.join("\n"), "text/csv;charset=utf-8");
}

function exportJsonReadable() {
  if (!state.existingItems.length) throw new Error("Charge d'abord les elements en base.");
  const humanReadable = state.existingItems.map((item) => {
    const obj = {};
    state.existingColumns.forEach((col) => {
      obj[col] = displayValue(col, item[col]);
    });
    return obj;
  });
  downloadText(`${$("csvResourceSelect")?.value || "export"}_readable.json`, JSON.stringify(humanReadable, null, 2), "application/json;charset=utf-8");
}

function exportJsonTechnical() {
  if (!state.existingItems.length) throw new Error("Charge d'abord les elements en base.");
  downloadText(`${$("csvResourceSelect")?.value || "export"}_technical_importable.json`, JSON.stringify(state.existingItems, null, 2), "application/json;charset=utf-8");
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

  buildGeneratedObjects();
  if (!state.generatedObjects.length) throw new Error("Aucune donnee generee. Verifie le mapping ou le JSON importe.");

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
  setMessage("csvMapperMessage", dryRun ? "Dry-run termine." : "Import termine.", result.ok ? "success" : "error");
}

export function bindCsvMapperEvents() {
  if (!csvElementsPresent()) return;

  loadCsvResources().catch((error) => setMessage("csvMapperMessage", error.message, "error"));

  $("csvLoadExistingBtn")?.addEventListener("click", () => loadExistingItems().catch((error) => setMessage("csvMapperMessage", error.message, "error")));
  $("csvFile")?.addEventListener("change", () => handleCsvFileChange().catch((error) => setMessage("csvMapperMessage", error.message, "error")));
  $("jsonFile")?.addEventListener("change", () => handleJsonFileChange().catch((error) => setMessage("csvMapperMessage", error.message, "error")));
  $("csvBuildPreviewBtn")?.addEventListener("click", () => {
    buildGeneratedObjects();
    renderGeneratedPreview();
    setMessage("csvMapperMessage", `${state.generatedObjects.length} objet(s) genere(s).`, "success");
  });
  $("csvExportTechnicalBtn")?.addEventListener("click", () => {
    try { exportCsvTechnical(); } catch (error) { setMessage("csvMapperMessage", error.message, "error"); }
  });
  $("csvExportReadableBtn")?.addEventListener("click", () => {
    try { exportCsvReadable(); } catch (error) { setMessage("csvMapperMessage", error.message, "error"); }
  });
  $("jsonExportReadableBtn")?.addEventListener("click", () => {
    try { exportJsonReadable(); } catch (error) { setMessage("csvMapperMessage", error.message, "error"); }
  });
  $("jsonExportTechnicalBtn")?.addEventListener("click", () => {
    try { exportJsonTechnical(); } catch (error) { setMessage("csvMapperMessage", error.message, "error"); }
  });
  $("csvDryRunBtn")?.addEventListener("click", () => runCsvImport(true).catch((error) => setMessage("csvMapperMessage", error.message, "error")));
  $("csvApplyBtn")?.addEventListener("click", () => runCsvImport(false).catch((error) => setMessage("csvMapperMessage", error.message, "error")));
}
