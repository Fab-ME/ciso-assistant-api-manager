import { $ } from "./dom.js";
import { api } from "./api.js";

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
    resource: $("resourceSelect").value,
    content,
    key: $("keySelect").value,
    exclude: $("excludeInput").value,
    strict: $("strictImport").checked,
  };
  if (!dryRun && !confirm("You are about to apply changes to CISO Assistant. Continue?")) return;
  const endpoint = dryRun ? "/api/import/dry-run" : "/api/import/apply";
  const data = await api(endpoint, { method: "POST", body: JSON.stringify(body) });
  $("importResult").textContent = summarizeImportResult(data);
}

export function bindImportEvents() {
  $("dryRunBtn").addEventListener("click", () => runImport(true).catch((e) => { $("importResult").textContent = e.message; }));
  $("applyImportBtn").addEventListener("click", () => runImport(false).catch((e) => { $("importResult").textContent = e.message; }));
}
