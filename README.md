# CISO Assistant API Manager

> Outil CLI Python pour exporter, importer et gérer les objets de l'API REST de CISO Assistant.
> Conçu pour les RSSI, équipes GRC et consultants sécurité. Distribué sous licence MIT avec restriction d'usage commercial.

![Python](https://img.shields.io/badge/python-3.8+-blue)
![License](https://img.shields.io/badge/license-MIT%20%2B%20Commercial%20Restriction-orange)
![Version](https://img.shields.io/badge/version-2.0.0-green)
![Maintainer](https://img.shields.io/badge/maintainer-Fab--ME-blue)

---

## Présentation

**CISO Assistant API Manager** est un outil en ligne de commande (CLI) Python permettant de gérer les objets exposés par l'API REST de [CISO Assistant](https://github.com/intuitem/ciso-assistant-community).

Il facilite l'**export**, l'**import**, la **mise à jour** et la **consultation** des objets de gouvernance, risques, conformité, actifs, métriques et bien plus — directement en JSON ré-importable.

Cet outil est destiné aux :

- RSSI / CISO
- Équipes GRC
- Consultants sécurité
- Équipes conformité / audit

---

## Fonctionnalités

- ✅ Export de n'importe quelle ressource API en JSON aplati ré-importable
- ✅ Import / création / mise à jour d'objets (`POST` / `PATCH` automatique selon présence de l'`id`)
- ✅ Mise à jour partielle : seuls les champs présents dans le JSON sont envoyés
- ✅ Support de 80+ endpoints CISO Assistant (gouvernance, métrologie, risques, conformité, EBIOS-RM, CRQ, privacy, IAM…)
- ✅ Affichage terminal en tableau, JSON ou liste simple
- ✅ Mode `--dry-run` : simulation sans modification
- ✅ Aucun secret stocké dans le code (variables d'environnement)
- ✅ Zéro dépendance externe (stdlib Python uniquement)
- ✅ Compatible Python 3.8+
- ✅ Interface Web locale intégrée
- ✅ Filtres par colonne
- ✅ Sélection dynamique des colonnes visibles
- ✅ Tri des colonnes
- ✅ Pagination locale
- ✅ Export JSON filtré
- ✅ Traduction automatique UUID → libellés métiers
- ✅ Préparation de la gestion des domaines et sous-domaines
- ✅ Préparation de la gestion des rôles et permissions
- ✅ Cache intelligent des référentiels

---

## Prérequis

- Python 3.8 ou supérieur
- Une instance CISO Assistant accessible (self-hosted ou cloud)
- Un Personal Access Token CISO Assistant

---

## Installation

```bash
git clone https://github.com/Fab-ME/ciso-assistant-api-manager.git
cd ciso-assistant-api-manager
```

Aucun `pip install` requis — uniquement la bibliothèque standard Python.

---

## Configuration

Définir les variables d'environnement avant toute utilisation :

```bash
# Linux / macOS
export CISO_API_TOKEN="votre_token_ici"
export CISO_BASE_URL="https://votre-instance:8443/api"
export CISO_VERIFY_SSL="false"

# Windows (PowerShell)
$env:CISO_API_TOKEN  = "votre_token_ici"
$env:CISO_BASE_URL   = "https://votre-instance:8443/api"
$env:CISO_VERIFY_SSL = "false"
```

> Le token se crée dans CISO Assistant : **Profil → API Tokens → Créer**

---

## Utilisation

### `export` — Extraire des données

```bash
python ciso_manager.py export <ressource> [options]

# Options
--output fichier.json        Fichier de sortie (défaut : horodaté)
--fields id,name,folder      Limiter les champs exportés (id toujours inclus)
--param cle=valeur           Filtre supplémentaire (répétable)

# Exemples
python ciso_manager.py export metric-definitions --output metriques.json
python ciso_manager.py export policies --output politiques.json
python ciso_manager.py export risk-scenarios --param status=active --output risques.json
python ciso_manager.py export assets --fields id,name,folder --output assets_light.json
```

### `import` — Créer ou mettre à jour

```bash
python ciso_manager.py import <ressource> --file fichier.json [options]

# Options
--dry-run                    Simuler sans envoyer (affiche le payload exact)
--exclude champ1,champ2      Ignorer ces champs à l'import

# Exemples
python ciso_manager.py import metric-definitions --file metriques.json --dry-run
python ciso_manager.py import metric-definitions --file metriques.json
python ciso_manager.py import policies --file politiques.json --exclude library,provider
```

**Règle :** objet avec `id` → `PATCH` (mise à jour partielle), sans `id` → `POST` (création).

### `get` — Consulter dans le terminal

```bash
python ciso_manager.py get <ressource> [options]

# Options
--page N                     Page à afficher
--page-size N                Nombre d'éléments par page
--status active              Filtrer par statut
--search texte               Recherche textuelle
--fields id,name             Colonnes à afficher
--format table|json|simple   Format d'affichage (défaut : table)
--all                        Toutes les pages
--param cle=valeur           Paramètre supplémentaire

# Exemples
python ciso_manager.py get metric-definitions
python ciso_manager.py get policies --status active --fields id,name,status
python ciso_manager.py get risk-scenarios --page 2 --page-size 20
python ciso_manager.py get folders --format json
python ciso_manager.py get policies --all
```

### `show` et `folders`

```bash
# Détail complet d'un objet (JSON brut)
python ciso_manager.py show <ressource> --id <UUID>

# Lister les dossiers avec leurs UUIDs
python ciso_manager.py folders
```

---

## Format du fichier JSON d'import

Le fichier doit être une liste JSON d'objets. Création et mise à jour peuvent coexister :

```json
[
  {
    "name": "Nouvelle métrique",
    "folder": "ee9b21f6-3b27-4cd6-b701-83885fdd164f",
    "category": "quantitative",
    "locale": "en",
    "is_published": true
  },
  {
    "id": "a3f4c3bd-19ff-49ee-a82a-d8ab0d9cdddb",
    "description": "Mise à jour de ce champ uniquement"
  }
]
```

> Les champs `null` ou vides sont ignorés — seuls les champs présents sont envoyés à l'API.

---

## Ressources disponibles

| Catégorie | Raccourcis |
|---|---|
| Gouvernance | `policies`, `applied-controls`, `reference-controls`, `filtering-labels` |
| Métrologie | `metric-definitions`, `metric-instances`, `dashboards`, `dashboard-widgets`, `custom-metric-samples` |
| Risques | `risk-assessments`, `risk-scenarios`, `risk-acceptances`, `risk-matrices`, `threats`, `vulnerabilities` |
| Conformité | `compliance-assessments`, `frameworks`, `requirement-assessments`, `requirement-nodes` |
| Actifs | `assets`, `asset-class`, `asset-capabilities` |
| Preuves & tâches | `evidences`, `task-templates`, `task-nodes`, `campaigns` |
| Findings | `findings`, `findings-assessments`, `security-exceptions` |
| Incidents | `incidents` |
| Résilience | `asset-assessments`, `business-impact-analysis`, `escalation-thresholds` |
| EBIOS-RM | `ebios-studies`, `ebios-feared-events`, `ebios-stakeholders`, `ebios-ro-to`, `ebios-attack-paths` |
| CRQ | `crq-studies`, `crq-scenarios`, `crq-hypotheses` |
| Privacy | `processings`, `personal-data`, `data-breaches`, `data-subjects`, `right-requests` |
| Entités | `entities`, `entity-assessments`, `contracts`, `solutions`, `representatives` |
| IAM | `users`, `user-groups`, `role-assignments`, `teams` |
| Divers | `actors`, `organisation-issues`, `organisation-objectives`, `terminologies`, `loaded-libraries` |

Pour une ressource non listée, passer le chemin relatif directement :

```bash
python ciso_manager.py export metrology/custom-metric-samples --output samples.json
```

---

## Flux de travail recommandé

```bash
# 1. Identifier les dossiers
python ciso_manager.py folders

# 2. Exporter les données existantes
python ciso_manager.py export metric-definitions --output metriques.json

# 3. Modifier le fichier JSON localement

# 4. Simuler l'import
python ciso_manager.py import metric-definitions --file metriques.json --dry-run

# 5. Importer
python ciso_manager.py import metric-definitions --file metriques.json

# 6. Vérifier
python ciso_manager.py get metric-definitions --all
```

---

## Structure du dépôt

```
ciso-assistant-api-manager/
├── ciso_manager.py
├── ciso_web.py
├── README.md
├── CHANGELOG.md
│
├── exports/
│   └── .gitkeep
│
├── imports/
│   └── .gitkeep
│
├── logs/
│   └── .gitkeep
│
├── web/
│   ├── index.html
│   ├── style.css
│   └── js/
│       ├── api.js
│       ├── app.js
│       ├── csv_mapper.js
│       ├── dom.js
│       ├── folders.js
│       ├── explorer.js
│       ├── imports.js
│       ├── roles.js
│       ├── state.js
│       ├── table.js
│       └── utils.js
│
└── examples/
```

---

## Aide

```bash
python ciso_manager.py --help
python ciso_manager.py export --help
python ciso_manager.py import --help
python ciso_manager.py get    --help
```

---

## Licence

MIT License with Commercial Use Restriction — Copyright (c) 2026 Fab-ME

- ✅ Usage personnel et interne : **libre et gratuit**
- ✅ Modification et redistribution : **autorisées**
- ❌ Usage commercial (intégration dans un produit payant, prestation, SaaS, hébergement tiers) : **accord préalable requis**

📩 Contact commercial : [contact@fab-me.com](mailto:contact@fab-me.com)

Voir [LICENSE](./LICENSE) pour les termes complets.

---

## Interface Web

Le projet intègre une interface Web locale permettant :

- d'explorer les données CISO Assistant ;
- de filtrer par statut, dossier, périmètre ou texte ;
- d'effectuer des recherches locales ;
- d'exporter les jeux de données en JSON ;
- d'importer des objets avec dry-run ;
- de gérer les colonnes visibles ;
- de trier les résultats ;
- de parcourir les résultats par pagination.

---

### Lancement

```bash
python ciso_web.py

---

## Interface Web

L'interface Web locale fournit une couche graphique au moteur API.

### Modules disponibles

#### Data Explorer

- consultation des ressources CISO Assistant
- filtrage multicritère
- recherche texte
- tri des colonnes
- pagination locale
- sélection des colonnes visibles
- export JSON des résultats

#### Folder Manager

- affichage automatique des folders
- création de folders
- modification des folders
- gestion de la hiérarchie parent/enfant
- résolution automatique des UUID vers les noms

#### Role Manager

- consultation des rôles
- visualisation des permissions
- préparation à l'édition des rôles

#### CSV Mapper

Import massif de données à partir de fichiers CSV.

Fonctionnalités :

- détection automatique du séparateur
- mapping visuel CSV → API
- prévisualisation JSON
- Dry Run
- Import réel
- mode Upsert
- clé de rapprochement :
  - id
  - ref_id
  - name

#### Moteur de résolution

Les champs de référence suivants peuvent être automatiquement résolus :

- folder
- owner
- entity
- team
- perimeter
- asset_class

Le moteur conserve les UID techniques nécessaires aux imports.

---

## Exports

Deux types d'exports sont disponibles.

### Exports techniques

Destinés à être réimportés.

Formats :

- CSV technique
- JSON technique

Ces exports contiennent les UID attendus par l'API.

### Exports lisibles

Destinés à l'analyse et aux contrôles.

Formats :

- CSV lisible
- JSON lisible

Les UUID sont remplacés par les libellés métiers lorsque les correspondances sont disponibles.
'
---

## Mode Upsert

Le moteur d'import détecte automatiquement si un objet doit être créé ou mis à jour.

Règles :

- id trouvé → PATCH
- ref_id trouvé → PATCH
- name trouvé → PATCH
- aucune correspondance → POST

Résultat d'import :

```json
{
  "created": 3,
  "updated": 12,
  "skipped": 1,
  "errors": 0
}

---

## Contribuer

Les issues et pull requests sont les bienvenues pour les corrections de bugs et l'ajout de nouveaux endpoints.
Pour toute contribution significative, ouvrir d'abord une issue pour en discuter.