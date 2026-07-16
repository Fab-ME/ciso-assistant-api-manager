import { $ } from "./dom.js";
import { bindExplorerEvents, loadHealth, loadResources, loadOptions } from "./explorer.js";
import { bindImportEvents } from "./imports.js";
import { bindFoldersEvents, loadFolders } from "./folders.js";
import { bindRolesEvents } from "./roles.js";

function bindNavigation() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".page").forEach((page) => page.classList.remove("active"));
      tab.classList.add("active");
      $(tab.dataset.page).classList.add("active");

      if (tab.dataset.page === "foldersPage") {
        loadFolders().catch((error) => console.error(error));
      }
    });
  });
}

function showStartupError(error) {
  document.body.innerHTML = `
  <div style="max-width:900px;margin:50px auto;padding:20px;border:1px solid #dc2626;background:#fef2f2;border-radius:10px;font-family:Segoe UI">
    <h2 style="color:#dc2626">Erreur de connexion à CISO Assistant</h2>
    <p>${error.message}</p>
    <h3>Actions recommandées</h3>
    <ul>
      <li>Vérifier CISO_API_TOKEN</li>
      <li>Vérifier CISO_BASE_URL</li>
      <li>Vérifier les droits du compte API</li>
      <li>Consulter les logs du serveur</li>
    </ul>
  </div>`;
}

async function start() {
  bindNavigation();
  bindExplorerEvents();
  bindImportEvents();
  bindFoldersEvents();
  try {
    bindRolesEvents();
  } catch(error) {
    console.warn("Roles page not loaded:", error);
  }

  await loadHealth();
  await loadResources();

  try {
    await loadOptions();
  } catch (error) {
    console.error(error);
    showStartupError(error);
  }
}

start().catch((error) => {
  console.error(error);
  showStartupError(error);
});
