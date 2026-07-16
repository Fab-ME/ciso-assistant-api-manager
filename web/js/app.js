import { $ } from "./dom.js";
import { bindExplorerEvents, loadHealth, loadResources, loadOptions } from "./explorer.js";
import { bindImportEvents } from "./imports.js";
import { bindDomainsEvents } from "./domains.js";
import { bindRolesEvents } from "./roles.js";

function bindNavigation() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".page").forEach((page) => page.classList.remove("active"));
      tab.classList.add("active");
      $(tab.dataset.page).classList.add("active");
    });
  });
}

async function start() {
  bindNavigation();
  bindExplorerEvents();
  bindImportEvents();
  bindDomainsEvents();
  bindRolesEvents();
  await loadHealth();
  await loadResources();
  await loadOptions();
}

start().catch((error) => {
  document.body.innerHTML = `<pre>${error.stack || error.message}</pre>`;
});
