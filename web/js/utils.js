export function cellValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function normalizeColumns(items) {
  const preferred = [
    "id", "ref_id", "name", "status", "owner", "owners", "folder", "perimeter",
    "entity", "category", "updated_at",
  ];
  const keys = new Set();
  items.slice(0, 100).forEach((item) => Object.keys(item || {}).forEach((key) => keys.add(key)));
  const ordered = preferred.filter((key) => keys.has(key));
  Array.from(keys).sort().forEach((key) => {
    if (!ordered.includes(key)) ordered.push(key);
  });
  return ordered;
}

export function buildSearchCache(item) {
  return JSON.stringify(item ?? {}).toLowerCase();
}

export function downloadJson(fileName, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
