# Changelog

Toutes les modifications notables sont documentées ici.
Format : [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/) — Versioning : [Semantic Versioning](https://semver.org/).

---

## [1.0.0] - 2026-07-09

Première release publique.

### Fonctionnalités

- Commande `export` : export complet (toutes pages) de n'importe quelle ressource API en JSON aplati ré-importable
  - Aplatissement automatique des relations (`{id, str}` → UUID)
  - Option `--fields` pour limiter les champs exportés
  - Option `--param` pour des filtres supplémentaires (ex: `status=active`)
- Commande `import` : création ou mise à jour d'objets depuis un fichier JSON
  - `POST` automatique si l'objet n'a pas d'`id` (création)
  - `PATCH` automatique si l'objet a un `id` (mise à jour partielle)
  - Seuls les champs présents et non-vides sont envoyés à l'API
  - Option `--dry-run` : simulation sans modification, affiche le payload exact
  - Option `--exclude` : ignorer des champs à l'import
- Commande `get` : affichage d'une ressource dans le terminal
  - Formats : `table` (défaut), `json`, `simple`
  - Pagination, filtres par statut, recherche textuelle
  - Option `--all` pour récupérer toutes les pages
- Commande `show` : JSON brut complet d'un objet par UUID
- Commande `folders` : liste des dossiers et leurs UUIDs

### Endpoints couverts

80+ raccourcis couvrant l'intégralité de l'API CISO Assistant :
- Gouvernance : `policies`, `applied-controls`, `reference-controls`, `filtering-labels`
- Métrologie : `metric-definitions`, `metric-instances`, `dashboards`, `dashboard-widgets`, `custom-metric-samples`, `builtin-metric-samples`
- Risques : `risk-assessments`, `risk-scenarios`, `risk-acceptances`, `risk-matrices`, `threats`, `vulnerabilities`
- Conformité : `compliance-assessments`, `frameworks`, `requirement-assessments`, `requirement-nodes`, `requirement-mapping-sets`
- Actifs : `assets`, `asset-class`, `asset-capabilities`
- Preuves & tâches : `evidences`, `evidence-revisions`, `task-templates`, `task-nodes`, `campaigns`
- Findings : `findings`, `findings-assessments`, `security-exceptions`
- Incidents : `incidents`
- Résilience : `asset-assessments`, `business-impact-analysis`, `escalation-thresholds`
- EBIOS-RM : `ebios-studies`, `ebios-feared-events`, `ebios-stakeholders`, `ebios-ro-to`, `ebios-attack-paths`, `ebios-operational-scenarios`, `ebios-strategic-scenarios`, `ebios-operating-modes`, `ebios-elementary-actions`, `ebios-kill-chains`
- CRQ : `crq-studies`, `crq-scenarios`, `crq-hypotheses`
- Privacy : `processings`, `personal-data`, `data-breaches`, `data-subjects`, `data-recipients`, `data-contractors`, `data-transfers`, `purposes`, `processing-natures`, `right-requests`
- Entités : `entities`, `entity-assessments`, `contracts`, `solutions`, `representatives`
- IAM : `users`, `user-groups`, `role-assignments`, `teams`
- Divers : `actors`, `organisation-issues`, `organisation-objectives`, `validation-flows`, `timeline-entries`, `terminologies`, `loaded-libraries`, `stored-libraries`, `webhooks`

### Technique

- Zéro dépendance externe (stdlib Python uniquement : `urllib`, `ssl`, `json`, `argparse`)
- Compatible Python 3.8+ (pas de f-string avec backslash, pas de walrus operator)
- Encodage automatique des caractères non-ASCII dans les URLs (`urllib.parse.quote`)
- `STRING_FIELDS` : protection des champs dont la valeur est du JSON sérialisé en chaîne
  - `value` (custom-metric-samples) : évite la désérialisation du payload `{"result":N}`
  - `choices_definition` (metric-definitions)
- `RESOURCE_STRING_FIELDS` : overrides par ressource pour les cas ambigus
- Détection automatique des types complexes à l'import :
  - Chaîne JSON → désérialisée (sauf champs protégés)
  - Chaîne avec `|` → liste d'UUIDs
  - Scalaires → conservés tels quels
- Aplatissement intelligent à l'export :
  - `{"id": "abc", "str": "Nom"}` → `"abc"`
  - `[{"id": "x"}, {"id": "y"}]` → `["x", "y"]`
  - Objets imbriqués complexes (ex: `cost`) → aplatis récursivement
- Exclusion automatique des métadonnées non ré-importables (`created_at`, `updated_at`, `str`, `repr`…)

---

## [1.2.0] - 2026-07-16

### Ajouté

#### Interface Web
- Nouvelle architecture modulaire JavaScript.
- Découpage du fichier app.js en plusieurs modules :
  - api.js
  - app.js
  - dom.js
  - explorer.js
  - imports.js
  - table.js
  - state.js
  - utils.js
  - domains.js
  - roles.js

#### Gestion des données
- Tri dynamique sur toutes les colonnes.
- Pagination locale.
- Cache local de recherche pour améliorer les performances.
- Gestion avancée des colonnes affichées.
- Gestion avancée des colonnes exportées.

#### Nouvelles pages
- Ajout d'une page "Domains organisation".
- Ajout d'une page "Roles and permissions".
- Préparation des futures opérations CRUD sur les domaines.
- Préparation des futures opérations CRUD sur les rôles et permissions.

#### Backend Web
- Refonte du serveur ciso_web.py.
- Ajout d'un cache TTL pour les référentiels.
- Amélioration de la résolution UUID → libellés.
- Ajout des routes :
  - /api/domains/save
  - /api/roles/save

### Corrigé

#### Export
- Correction d'un problème d'export JSON filtré pouvant exporter un objet incorrect après application de filtres.

#### Interface
- Correction de plusieurs problèmes CSS.
- Correction de la gestion des colonnes visibles.
- Correction de la gestion des colonnes exportées.

#### Performance
- Réduction des recalculs JSON.stringify()
- Optimisation du rendu des grands tableaux.

### Modifié

#### Structure du projet

Ancien :

```text
web/
├── index.html
├── app.js
└── style.css

## [1.2.1] - 2026-07-16

### Ajouté

- Gestionnaire de folders.
- Chargement automatique des folders.
- Affichage hiérarchique des folders.
- Endpoint GET /api/folders.
- Endpoint POST /api/folders/save.
- Résolution automatique parent_folder → nom du parent.
- Calcul du nombre d'enfants.

### Modifié

- Remplacement de la page Domains par une page Folders.
- Ajout d'un éditeur de parent_folder.
- Réorganisation de l'interface Web.

### Corrigé

- Gestion propre des erreurs API CISO Assistant.
- Suppression des ERR_EMPTY_RESPONSE.
- Affichage détaillé des erreurs 401/403.