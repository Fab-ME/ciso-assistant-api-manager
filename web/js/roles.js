import { state } from "./state.js";
import { $, escapeHtml, setMessage } from "./dom.js";
import { api } from "./api.js";

function renderRolesDraft() {
  const tbody = document.querySelector("#rolesTable tbody");
  tbody.innerHTML = state.rolesDraft.map((role, index) => `
    <tr>
      <td>${escapeHtml(role.name)}</td>
      <td>${escapeHtml(role.scope || "")}</td>
      <td>${escapeHtml(role.permissions.join(", "))}</td>
      <td><button class="secondary soft remove-role" data-index="${index}">Remove</button></td>
    </tr>`).join("");
  document.querySelectorAll(".remove-role").forEach((button) => {
    button.addEventListener("click", () => {
      state.rolesDraft.splice(Number(button.dataset.index), 1);
      renderRolesDraft();
    });
  });
}

function addRoleDraft() {
  const name = $("roleName").value.trim();
  if (!name) {
    setMessage("rolesMessage", "Role name is required.", "error");
    return;
  }
  const permissions = $("rolePermissions").value.split("\n").map((x) => x.trim()).filter(Boolean);
  state.rolesDraft.push({
    name,
    scope: $("roleScope").value.trim(),
    permissions,
  });
  $("roleName").value = "";
  $("roleScope").value = "";
  $("rolePermissions").value = "";
  setMessage("rolesMessage", "Draft line added.", "success");
  renderRolesDraft();
}

async function saveRoles() {
  const data = await api("/api/roles/save", {
    method: "POST",
    body: JSON.stringify({ roles: state.rolesDraft }),
  });
  setMessage("rolesMessage", data.message || "Roles saved.", data.ok ? "success" : "error");
}

export function bindRolesEvents() {
  const addBtn = document.getElementById("addRoleDraftBtn");
  const saveBtn = document.getElementById("saveRolesBtn");

  if (!addBtn || !saveBtn) {
      console.warn("Roles UI not present");
      return;
  }

  $("addRoleDraftBtn").addEventListener("click", addRoleDraft);
  $("saveRolesBtn").addEventListener("click", () => saveRoles().catch((e) => setMessage("rolesMessage", e.message, "error")));
  renderRolesDraft();
}
