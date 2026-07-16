import { escapeHtml, setMessage } from "./dom.js";
import { api } from "./api.js";

const state = {
  folders: [],
  byId: {}
};

function buildIndex() {
  state.byId = {};

  state.folders.forEach(folder => {
    state.byId[folder.id] = folder;
  });
}

function getParentId(folder) {
  const parent = folder.parent_folder;

  if (!parent) return null;

  if (typeof parent === "object") {
    return parent.id || null;
  }

  return parent;
}

function getParentName(folder) {

  if (folder.parent_name) {
    return folder.parent_name;
  }

  const parentId = getParentId(folder);

  if (!parentId) {
    return "-";
  }

  return state.byId[parentId]?.name || "-";
}

function getChildren(parentId) {
  return state.folders.filter(
    folder => getParentId(folder) === parentId
  );
}

async function loadFolders() {

  const data = await api("/api/folders");

  state.folders = data.folders || [];

  buildIndex();

  renderFoldersTable();
  renderTree();
}

function renderFoldersTable() {

  const tbody =
    document.querySelector(
      "#foldersTable tbody"
    );

  if (!tbody) return;

  tbody.innerHTML =
    state.folders.map(folder => {

      const options = [
        `<option value="">Aucun parent</option>`,
        ...state.folders
          .filter(f => f.id !== folder.id)
          .map(f => `
            <option
              value="${f.id}"
              ${getParentId(folder) === f.id ? "selected" : ""}
            >
              ${escapeHtml(f.name)}
            </option>
          `)
      ].join("");

      return `
        <tr>

          <td>
            ${escapeHtml(folder.name || "")}
          </td>

          <td>
            ${escapeHtml(folder.description || "")}
          </td>

          <td>

            <select
              class="folder-parent-select"
              data-id="${folder.id}"
            >
              ${options}
            </select>

          </td>

        </tr>
      `;

    }).join("");

  document
    .querySelectorAll(
      ".folder-parent-select"
    )
    .forEach(select => {

      select.addEventListener(
        "change",
        async () => {

          await saveParent(
            select.dataset.id,
            select.value || null
          );

        }
      );

    });
}

async function saveParent(
  folderId,
  parentId
) {

  try {

    await api(
      "/api/folders/save",
      {
        method: "POST",
        body: JSON.stringify({

          id: folderId,

          payload: {
            parent_folder: parentId
          }

        })
      }
    );

    setMessage(
      "foldersMessage",
      "Folder mis à jour",
      "success"
    );

    await loadFolders();

  }
  catch (err) {

    console.error(err);

    setMessage(
      "foldersMessage",
      err.message,
      "error"
    );

  }
}

function renderTreeNode(folder) {

  const children =
    getChildren(folder.id);

  return `
    <li>

      📁 ${escapeHtml(folder.name)}

      ${
        children.length
          ? `
          <ul>
            ${children
              .map(renderTreeNode)
              .join("")}
          </ul>
        `
          : ""
      }

    </li>
  `;
}

function renderTree() {

  const container =
    document.getElementById(
      "foldersTree"
    );

  if (!container) return;

  const roots =
    state.folders.filter(
      folder =>
        getParentId(folder) === null
    );

  container.innerHTML = `
    <ul>
      ${roots
        .map(renderTreeNode)
        .join("")}
    </ul>
  `;
}

export function bindFoldersEvents() {

  loadFolders()
    .catch(error => {

      console.error(error);

      setMessage(
        "foldersMessage",
        error.message,
        "error"
      );

    });
}