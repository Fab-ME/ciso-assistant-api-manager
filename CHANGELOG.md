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
## [2.0.0] - 2026-07-16

### 🚀 Nouveau

#### Interface Web complète

- Ajout d'une interface Web locale basée sur ciso_web.py.
- Navigation et visualisation des ressources CISO Assistant.
- Recherche locale.
- Pagination.
- Tri dynamique des colonnes.
- Sélection des colonnes visibles.
- Sélection des colonnes exportées.
- Résolution automatique UUID → libellés métiers.

#### Gestion des folders

- Page dédiée à la gestion des folders.
- Chargement automatique des folders.
- Affichage hiérarchique.
- Modification du parent_folder.
- Endpoint GET /api/folders.
- Endpoint POST /api/folders/save.

#### CSV Mapper

- Import de fichiers CSV.
- Détection automatique du séparateur.
- Mapping visuel CSV → API.
- Prévisualisation JSON.
- Dry-run avant import.
- Import réel depuis l'interface.
- Support JSON natif.
- Clés de rapprochement :
  - id
  - ref_id
  - name

#### Import avancé

- Logique d'upsert complète.
- PATCH si l'objet existe.
- POST si l'objet n'existe pas.
- Comptage :
  - created
  - updated
  - skipped
  - errors

#### Exports

- Export CSV technique importable.
- Export CSV lisible.
- Export JSON technique importable.
- Export JSON lisible.

### 🔧 Améliorations

- Refonte complète de ciso_web.py.
- Gestion robuste des erreurs API.
- Suppression des erreurs ERR_EMPTY_RESPONSE.
- Amélioration de la résolution des objets liés.
- Cache intelligent des référentiels.
- Architecture JavaScript modulaire.

### 🐞 Correctifs

- Correction du flux export/import CSV.
- Correction des imports de relations utilisant des UID.
- Correction des exports pouvant produire des valeurs non réimportables.
- Corrections CSS et affichage des tableaux.
- Amélioration des performances de rendu.

### 💥 Breaking Changes

- Introduction d'une interface Web complète.
- Nouvelle structure du projet.
- Les exports destinés à l'import utilisent désormais les valeurs techniques API.
- Les exports lisibles sont réservés à la consultation humaine.

---

## [2.1.0] - 2026-08-14

### 🚀 Nouveau

#### Import simplifié des objectifs d'assets

- Les champs `security_objectives`, `security_capabilities`,
  `disaster_recovery_objectives` et `recovery_capabilities` de la ressource
  `assets` acceptent désormais un dict plat en entrée (`{"confidentiality": 2, ...}`)
  au lieu de la structure imbriquée complète attendue par l'API.
- Reconstruction automatique de la structure `{"objectives": {clé: {"value": N, "is_enabled": true}}}`
  pour `security_objectives` / `security_capabilities`.
- Reconstruction automatique de la structure `{"objectives": {clé: {"value": N}}}`
  (sans `is_enabled`) pour `disaster_recovery_objectives` / `recovery_capabilities`.
- Rétrocompatible : un export déjà au format complet (clé `objectives` présente)
  est réimporté sans transformation.
- Possibilité de mixer valeurs simples et forme détaillée par clé
  (ex: `"confidentiality": {"value": 2, "is_enabled": false}`) pour désactiver
  explicitement un objectif.
- Les clés non reconnues sont ignorées silencieusement (pas d'erreur API sur
  un champ inattendu).

---
## [2.1.1] - 2026-08-14

### 🐞 Correctifs

- `security_objectives` / `security_capabilities` / `disaster_recovery_objectives`
  / `recovery_capabilities` : le format simplifié "liste de dicts à une clé"
  (`[{"confidentiality": 2}, {"integrity": 3}]`) n'était pas reconnu par
  `_expand_asset_objectives()` (seul le dict plat l'était) et était envoyé
  tel quel à l'API. Les deux formats sont désormais acceptés indifféremment.

---