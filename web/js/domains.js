import { state } from "./state.js";
import { $, escapeHtml, setMessage } from "./dom.js";
import { api } from "./api.js";

function renderDomainsDraft() {
  const tbody = document.querySelector("#domainsTable tbody");
  tbody.innerHTML = state.domainsDraft.map((domain, index) => `
    <tr>
      <td>${escapeHtml(domain.name)}</td>
      <td>${escapeHtml(domain.parent || "")}</td>
      <td>${escapeHtml(domain.description || "")}</td>
      <td><button class="secondary soft remove-domain" data-index="${index}">Remove</button></td>
    </tr>`).join("");
  document.querySelectorAll(".remove-domain").forEach((button) => {
    button.addEventListener("click", () => {
      state.domainsDraft.splice(Number(button.dataset.index), 1);
      renderDomainsDraft();
    });
  });
}

function addDomainDraft() {
  const name = $("domainName").value.trim();
  if (!name) {
    setMessage("domainsMessage", "Domain name is required.", "error");
    return;
  }
  state.domainsDraft.push({
    name,
    parent: $("domainParent").value.trim(),
    description: $("domainDescription").value.trim(),
  });
  $("domainName").value = "";
  $("domainParent").value = "";
  $("domainDescription").value = "";
  setMessage("domainsMessage", "Draft line added.", "success");
  renderDomainsDraft();
}

async function saveDomains() {
  const data = await api("/api/domains/save", {
    method: "POST",
    body: JSON.stringify({ domains: state.domainsDraft }),
  });
  setMessage("domainsMessage", data.message || "Domains saved.", data.ok ? "success" : "error");
}

export function bindDomainsEvents() {
  $("addDomainDraftBtn").addEventListener("click", addDomainDraft);
  $("saveDomainsBtn").addEventListener("click", () => saveDomains().catch((e) => setMessage("domainsMessage", e.message, "error")));
  renderDomainsDraft();
}
