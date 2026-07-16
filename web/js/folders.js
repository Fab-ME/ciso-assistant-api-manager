import { $, escapeHtml, escapeAttribute, setMessage } from "./dom.js";
import { api } from "./api.js";

const state = {
  folders: [],
  byId: {},
  loaded: false,
};

function buildIndex() {
  state.byId = {};
  state.folders.forEach((folder) => {
    if (folder?.id) state.byId[String(folder.id)] = folder;
  });
}

function getParentId(folder) {
  const parent = folder?.parent_folder;
  if (!parent) return null;
  if (typeof parent === "object") return parent.id || null;
  return String(parent);
}

function getParentName(folder) {
  if (folder?.parent_name && typeof folder.parent_name === "string") return folder.parent_name;

  const parent = folder?.parent_folder;
  if (!parent) return "-";

  if (typeof parent === "object") {
    return parent.name || parent.str || parent.id || "-";
  }

  return state.byId[String(parent)]?.name || "-";
}

function getChildren(parentId) {
  const normalizedParentId = parentId ? String(parentId) : null;
  return state.folders.filter((folder) => getParentId(folder) === normalizedParentId);
}

function getDescendantIds(folderId) {
  const descendants = new Set();
  const stack = [String(folderId)];

  while (stack.length) {
    const current = stack.pop();
    getChildren(current).forEach((child) => {
      const childId = String(child.id);
      if (!descendants.has(childId)) {
        descendants.add(childId);
        stack.push(childId);
      }
    });
  }

  return descendants;
}

function normalizeText(value) {
  return String(value || "").toLowerCase();
}

function filteredFolders() {
  const search = normalizeText($("foldersSearch")?.value || "");
  if (!search) return state.folders;

  return state.folders.filter((folder) => {
    const haystack = [
      folder.name,
      folder.description,
      getParentName(folder),
      folder.id,
    ].map(normalizeText).join(" ");
    return haystack.includes(search);
  });
}

function ensureFoldersTableShape() {
  const table = document.getElementById("foldersTable");
  if (!table) return null;

  let thead = table.querySelector("thead");
  if (!thead) {
    thead = document.createElement("thead");
    table.prepend(thead);
  }

  thead.innerHTML = `
    <tr>
      <th>Nom</th>
      <th>Description</th>
      <th>Parent</th>
    </tr>
  `;

  let tbody = table.querySelector("tbody");
  if (!tbody) {
    tbody = document.createElement("tbody");
    table.appendChild(tbody);
  }

  return tbody;
}

export async function loadFolders(force = false) {
  if (state.loaded && !force) return;

  setMessage("foldersMessage", "Chargement des folders...", "");
  const data = await api("/api/folders");

  state.folders = data.folders || [];
  state.loaded = true;
  buildIndex();

  renderFoldersTable();
  renderTree();
  updateCount();

  setMessage("foldersMessage", `${state.folders.length} folder(s) chargé(s).`, "success");
}

function updateCount() {
  const count = $("foldersCount");
  if (!count) return;
  count.textContent = `${filteredFolders().length} affiché(s) / ${state.folders.length} total`;
}

function renderFoldersTable() {
  const tbody = ensureFoldersTableShape();
  if (!tbody) return;

  const rows = filteredFolders();

  tbody.innerHTML = rows.map((folder) => `
    <tr data-folder-id="${escapeAttribute(folder.id)}">
      <td><strong>${escapeHtml(folder.name || "")}</strong></td>
      <td>${escapeHtml(folder.description || "")}</td>
      <td class="folder-parent-cell" data-id="${escapeAttribute(folder.id)}">
        <button type="button" class="folder-parent-display" data-id="${escapeAttribute(folder.id)}" title="Cliquer pour modifier le parent">
          ${escapeHtml(getParentName(folder))} ▾
        </button>
      </td>
    </tr>
  `).join("");

  document.querySelectorAll(".folder-parent-display").forEach((button) => {
    button.addEventListener("click", () => openParentSelector(button.dataset.id));
  });

  updateCount();
}

function parentOptionsHtml(folder) {
  const currentParentId = getParentId(folder);
  const blocked = getDescendantIds(folder.id);
  blocked.add(String(folder.id));

  const options = [`<option value="">Aucun parent</option>`];

  state.folders
    .filter((candidate) => !blocked.has(String(candidate.id)))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "fr", { sensitivity: "base" }))
    .forEach((candidate) => {
      const candidateId = String(candidate.id);
      options.push(`
        <option value="${escapeAttribute(candidateId)}" ${currentParentId === candidateId ? "selected" : ""}>
          ${escapeHtml(candidate.name || candidateId)}
        </option>
      `);
    });

  return options.join("");
}

function openParentSelector(folderId) {
  const folder = state.byId[String(folderId)];
  if (!folder) return;

  const cell = document.querySelector(`.folder-parent-cell[data-id="${CSS.escape(String(folderId))}"]`);
  if (!cell) return;

  cell.innerHTML = `
    <select class="folder-parent-select" data-id="${escapeAttribute(folderId)}">
      ${parentOptionsHtml(folder)}
    </select>
  `;

  const select = cell.querySelector("select");
  if (!select) return;

  select.focus();

  select.addEventListener("change", async () => {
    await saveParent(folderId, select.value || null);
  });

  select.addEventListener("keydown", (event) => {
    if (event.key === "Escape") renderFoldersTable();
  });

  select.addEventListener("blur", () => {
    setTimeout(() => renderFoldersTable(), 150);
  });
}

async function saveParent(folderId, parentId) {
  const folder = state.byId[String(folderId)];
  if (!folder) return;

  const previousParentId = getParentId(folder);
  if ((previousParentId || null) === (parentId || null)) {
    renderFoldersTable();
    return;
  }

  try {
    setMessage("foldersMessage", "Mise à jour du parent...", "");

    await api("/api/folders/save", {
      method: "POST",
      body: JSON.stringify({
        id: folderId,
        payload: {
          parent_folder: parentId,
        },
      }),
    });

    // Mise à jour locale immédiate pour ne pas attendre un rechargement complet.
    folder.parent_folder = parentId || null;
    folder.parent_name = parentId ? state.byId[String(parentId)]?.name || null : null;

    renderFoldersTable();
    renderTree();
    setMessage("foldersMessage", "Parent du folder mis à jour.", "success");

    // Re-synchronisation avec l'API pour récupérer la vérité serveur.
    state.loaded = false;
    await loadFolders(true);
  } catch (error) {
    console.error(error);
    setMessage("foldersMessage", error.message, "error");
    renderFoldersTable();
  }
}

function renderTreeNode(folder) {
  const children = getChildren(folder.id)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "fr", { sensitivity: "base" }));

  return `
    <li>
      <span class="folder-tree-node">📁 ${escapeHtml(folder.name || "")}</span>
      ${children.length ? `<ul>${children.map(renderTreeNode).join("")}</ul>` : ""}
    </li>
  `;
}

function renderTree() {
  const container = document.getElementById("foldersTree");
  if (!container) return;

  const roots = state.folders
    .filter((folder) => getParentId(folder) === null)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "fr", { sensitivity: "base" }));

  container.innerHTML = roots.length
    ? `<ul>${roots.map(renderTreeNode).join("")}</ul>`
    : `<p class="hint">Aucune racine trouvée.</p>`;
}

export function bindFoldersEvents() {
  $("refreshFoldersBtn")?.addEventListener("click", () => {
    state.loaded = false;
    loadFolders(true).catch((error) => setMessage("foldersMessage", error.message, "error"));
  });

  $("foldersSearch")?.addEventListener("input", () => {
    renderFoldersTable();
  });

  loadFolders(true).catch((error) => {
    console.error(error);
    setMessage("foldersMessage", error.message, "error");
  });
}
