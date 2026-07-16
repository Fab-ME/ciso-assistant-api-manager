export const $ = (id) => document.getElementById(id);

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

export function setMessage(elementId, message, type = "") {
  const element = $(elementId);
  if (!element) return;
  element.className = `message ${type}`;
  element.innerHTML = message || "";
}

export function fillSelect(selectId, options, placeholder) {
  const select = $(selectId);
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` +
    (options || []).map((item) => {
      if (typeof item === "string") {
        return `<option value="${escapeAttribute(item)}">${escapeHtml(item)}</option>`;
      }
      return `<option value="${escapeAttribute(item.id)}">${escapeHtml(item.label)}</option>`;
    }).join("");
  if (current) select.value = current;
}
