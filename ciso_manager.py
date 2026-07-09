#!/usr/bin/env python3
"""
=============================================================================
 CISO Assistant - Gestionnaire générique d'objets API
=============================================================================
 Version : 3.2 (support ref_id comme clé d'identification pour les updates)
 Usage : python ciso_manager.py --help

 Opérations disponibles :
  export  → Exporter n'importe quelle ressource en JSON (ré-importable)
  import  → Créer ou mettre à jour des objets depuis un JSON
            (partiel avec id/ref_id = PATCH, sans identifiant = POST)
  get     → Afficher une ressource dans le terminal (tableau/json/simple)
  show    → Afficher le JSON brut d'un objet par ID
  folders → Lister les dossiers et leurs UUIDs

 Clé d'identification pour l'import (--key) :
  id      → utilise le champ 'id' (UUID) pour les mises à jour (défaut)
  ref_id  → utilise le champ 'ref_id' pour résoudre l'UUID avant PATCH

 Authentification : PAT (Personal Access Token)
  Créer un token dans CISO Assistant : Profil → API Tokens → Créer

 Variables d'environnement :
  CISO_BASE_URL (défaut: https://localhost:8443/api)
  CISO_API_TOKEN Votre Personal Access Token
  CISO_VERIFY_SSL true|false (défaut: false)
=============================================================================
"""

import argparse
import json
import sys
import os
import urllib.request
import urllib.error
import urllib.parse
import ssl
import math
import re
from datetime import datetime

from dotenv import load_dotenv
load_dotenv()

# ─────────────────────────────────────────────
# CONFIGURATION
# ─────────────────────────────────────────────
BASE_URL = os.getenv("CISO_BASE_URL")
API_TOKEN = os.getenv("CISO_API_TOKEN")
VERIFY_SSL = os.getenv("CISO_VERIFY_SSL", "false").lower() != "false"

DEFAULT_ENUM_CASE = os.getenv("CISO_ENUM_CASE", "lower")  # valeurs possibles : "none", "lower", "upper"

# Raccourcis endpoints
KNOWN_ENDPOINTS = {
    # ── Gouvernance ──────────────────────────────────────────────
    "policies": "policies",
    "applied-controls": "applied-controls",
    "reference-controls": "reference-controls",
    "filtering-labels": "filtering-labels",
    "folders": "folders",
    "perimeters": "perimeters",
    # ── Risques ──────────────────────────────────────────────────
    "risk-assessments": "risk-assessments",
    "risk-scenarios": "risk-scenarios",
    "risk-acceptances": "risk-acceptances",
    "risk-matrices": "risk-matrices",
    "threats": "threats",
    "vulnerabilities": "vulnerabilities",
    # ── Conformité ───────────────────────────────────────────────
    "compliance-assessments": "compliance-assessments",
    "requirement-assessments": "requirement-assessments",
    "requirement-nodes": "requirement-nodes",
    "requirement-mapping-sets": "requirement-mapping-sets",
    "frameworks": "frameworks",
    # ── Actifs ───────────────────────────────────────────────────
    "assets": "assets",
    "asset-class": "asset-class",
    "asset-capabilities": "asset-capabilities",
    # ── Métrologie ───────────────────────────────────────────────
    "metric-definitions": "metrology/metric-definitions",
    "metric-instances": "metrology/metric-instances",
    "custom-metric-samples": "metrology/custom-metric-samples",
    "builtin-metric-samples": "metrology/builtin-metric-samples",
    "dashboards": "metrology/dashboards",
    "dashboard-widgets": "metrology/dashboard-widgets",
    # ── Entités & tiers ──────────────────────────────────────────
    "entities": "entities",
    "entity-assessments": "entity-assessments",
    "representatives": "representatives",
    "contracts": "contracts",
    "solutions": "solutions",
    # ── Preuves & tâches ─────────────────────────────────────────
    "evidences": "evidences",
    "evidence-revisions": "evidence-revisions",
    "task-templates": "task-templates",
    "task-nodes": "task-nodes",
    "campaigns": "campaigns",
    # ── Findings & exceptions ────────────────────────────────────
    "findings": "findings",
    "findings-assessments": "findings-assessments",
    "security-exceptions": "security-exceptions",
    # ── Incidents ────────────────────────────────────────────────
    "incidents": "incidents",
    # ── Résilience ───────────────────────────────────────────────
    "asset-assessments": "resilience/asset-assessments",
    "business-impact-analysis": "resilience/business-impact-analysis",
    "escalation-thresholds": "resilience/escalation-thresholds",
    # ── EBIOS-RM ─────────────────────────────────────────────────
    "ebios-studies": "ebios-rm/studies",
    "ebios-feared-events": "ebios-rm/feared-events",
    "ebios-stakeholders": "ebios-rm/stakeholders",
    "ebios-ro-to": "ebios-rm/ro-to",
    "ebios-attack-paths": "ebios-rm/attack-paths",
    "ebios-operational-scenarios": "ebios-rm/operational-scenarios",
    "ebios-strategic-scenarios": "ebios-rm/strategic-scenarios",
    "ebios-operating-modes": "ebios-rm/operating-modes",
    "ebios-elementary-actions": "ebios-rm/elementary-actions",
    "ebios-kill-chains": "ebios-rm/kill-chains",
    # ── CRQ ──────────────────────────────────────────────────────
    "crq-studies": "crq/quantitative-risk-studies",
    "crq-scenarios": "crq/quantitative-risk-scenarios",
    "crq-hypotheses": "crq/quantitative-risk-hypotheses",
    # ── Privacy ──────────────────────────────────────────────────
    "processings": "privacy/processings",
    "personal-data": "privacy/personal-data",
    "data-subjects": "privacy/data-subjects",
    "data-recipients": "privacy/data-recipients",
    "data-contractors": "privacy/data-contractors",
    "data-transfers": "privacy/data-transfers",
    "data-breaches": "privacy/data-breaches",
    "purposes": "privacy/purposes",
    "processing-natures": "privacy/processing-natures",
    "right-requests": "privacy/right-requests",
    # ── IAM & paramètres ─────────────────────────────────────────
    "users": "users",
    "user-groups": "user-groups",
    "role-assignments": "role-assignments",
    "teams": "teams",
    # ── Divers ───────────────────────────────────────────────────
    "actors": "actors",
    "organisation-issues": "organisation-issues",
    "organisation-objectives": "organisation-objectives",
    "validation-flows": "validation-flows",
    "timeline-entries": "timeline-entries",
    "terminologies": "terminologies",
    "loaded-libraries": "loaded-libraries",
    "stored-libraries": "stored-libraries",
    "webhooks": "webhooks/endpoints",
}

# ─────────────────────────────────────────────
# RÉSOLUTION D'ENDPOINT
# ─────────────────────────────────────────────
def resolve_endpoint(resource: str) -> str:
    """Résout un nom de ressource en URL complète."""
    if resource.startswith("http"):
        return resource
    path = KNOWN_ENDPOINTS.get(resource, resource)
    return f"{BASE_URL}/{path.strip('/')}/"


# ─────────────────────────────────────────────
# CLIENT HTTP
# ─────────────────────────────────────────────
def _ssl_context():
    ctx = ssl.create_default_context()
    if not VERIFY_SSL:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _headers():
    return {
        "Authorization": f"Token {API_TOKEN}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def api_request(method, url, data=None, params=None):
    """Effectue une requête HTTP vers l'API CISO."""
    if params:
        url = url + "?" + urllib.parse.urlencode(params)
    body = json.dumps(data).encode("utf-8") if data else None
    req = urllib.request.Request(url, data=body, headers=_headers(), method=method)
    try:
        with urllib.request.urlopen(req, context=_ssl_context()) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        try:
            detail = json.loads(raw)
        except Exception:
            detail = raw
        return e.code, detail
    except urllib.error.URLError as e:
        print(f"[ERREUR RÉSEAU] Impossible de joindre {url}: {e.reason}", file=sys.stderr)
        sys.exit(1)


def paginate_all(url, params=None):
    """Récupère toutes les pages d'un endpoint et retourne la liste complète."""
    results = []
    current_url = url
    first_page = True
    while current_url:
        p = params if first_page else None
        status, data = api_request("GET", current_url, params=p)
        if status != 200:
            print(f"[ERREUR {status}] {data}", file=sys.stderr)
            sys.exit(1)
        if isinstance(data, list):
            results.extend(data)
            break
        results.extend(data.get("results", []))
        current_url = data.get("next")
        first_page = False
    return results


# ─────────────────────────────────────────────
# INDEX ref_id → uuid (pour import --key ref_id)
# ─────────────────────────────────────────────
def build_ref_id_index(url: str) -> dict:
    """
    Récupère tous les objets de l'endpoint et retourne un dict
    { ref_id_value: uuid_string }.
    Les objets sans ref_id sont ignorés.
    """
    print(f"[INFO] Construction de l'index ref_id → UUID depuis {url} ...")
    items = paginate_all(url)
    index = {}
    for obj in items:
        ref = obj.get("ref_id")
        uid = obj.get("id")
        if ref and uid:
            index[str(ref).strip()] = str(uid).strip()
    print(f"[INFO] Index construit : {len(index)} entrée(s) avec ref_id.")
    return index


# ─────────────────────────────────────────────
# APLATISSEMENT (API → JSON exportable)
# ─────────────────────────────────────────────
EXPORT_EXCLUDE_KEYS = {
    "created_at", "updated_at", "repr", "str",
    "composer_display", "perimeter_display",
}


def _flatten_value(val):
    """
    Aplatit une valeur complexe en ré-importable.
    IMPORTANT : on NE MODIFIE PAS la casse des strings.
    """
    if val is None:
        return None
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        return val
    if isinstance(val, str):
        return val  # aucune transformation
    if isinstance(val, list):
        if not val:
            return []
        if all(isinstance(item, dict) and "id" in item for item in val):
            return [item["id"] for item in val if item.get("id")]
        return val
    if isinstance(val, dict):
        if "id" in val and len(val) <= 3:
            uid = val.get("id")
            return uid if uid else None
        return {k: _flatten_value(v) for k, v in val.items()}
    return val


def flatten_object(obj: dict) -> dict:
    """Objet API brut → dict exportable ré-importable."""
    result = {}
    for key, val in obj.items():
        if key in EXPORT_EXCLUDE_KEYS:
            continue
        result[key] = _flatten_value(val)
    return result


# ─────────────────────────────────────────────
# OPTIONNEL : NORMALISATION ENUM
# ─────────────────────────────────────────────
ENUM_KEYS_DEFAULT = {"status", "category", "priority", "effort"}


def apply_enum_case(obj: dict, mode: str = "none", enum_keys=None) -> dict:
    """
    mode='none' -> aucun changement
    mode='lower'/'upper' -> applique sur quelques champs enum
    """
    if mode == "none":
        return obj
    keys = enum_keys or ENUM_KEYS_DEFAULT
    out = dict(obj)
    for k in keys:
        v = out.get(k)
        if isinstance(v, str):
            out[k] = v.lower() if mode == "lower" else v.upper()
    return out


# ─────────────────────────────────────────────
# FILTRAGE LOCAL EXPORT : --where
# ─────────────────────────────────────────────
_WHERE_RE = re.compile(r"^\s*([A-Za-z0-9_.-]+)\s*(==|=|!=|>=|<=|>|<|~|in)\s*(.+?)\s*$")


def _parse_scalar(text: str):
    """Parse bool/none/numbers/json sinon string brute."""
    if not isinstance(text, str):
        return text
    s = text.strip()
    if not s:
        return ""
    low = s.lower()
    if low in ("true", "false"):
        return low == "true"
    if low in ("null", "none"):
        return None
    if s[0] in ('{', '[', '"'):
        try:
            return json.loads(s)
        except Exception:
            pass
    try:
        if "." in s:
            return float(s)
        return int(s)
    except Exception:
        return s


def _get_nested(obj: dict, path: str):
    """Accès champ imbriqué via 'a.b.c'."""
    cur = obj
    for part in path.split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return None
    return cur


def _parse_where(where_list):
    """Parse --where en clauses (field, op, value)."""
    clauses = []
    for w in (where_list or []):
        m = _WHERE_RE.match(w)
        if not m:
            print(f"[AVERTISSEMENT] --where ignoré (format attendu: champ<op>val) : {w}")
            continue
        field, op, value = m.group(1), m.group(2), m.group(3)
        clauses.append((field, op, value))
    return clauses


def _match_where(obj: dict, clauses: list) -> bool:
    """
    clauses = [(field, op, expected_raw), ...]
    '='/'=='  égalité stricte (sans changement de casse)
    '!='      différent
    '~'       contient (substring) ou appartenance si liste
    'in'      actual in expected_list
    > >= < <= numérique
    """
    for field, op, expected_raw in clauses:
        actual = _get_nested(obj, field)
        expected = _parse_scalar(expected_raw)

        if op == "~":
            if actual is None:
                return False
            if isinstance(actual, list):
                return expected in actual or str(expected) in [str(x) for x in actual]
            return str(expected) in str(actual)

        if op == "in":
            if not isinstance(expected, list):
                if isinstance(expected_raw, str) and "," in expected_raw:
                    expected = [x.strip() for x in expected_raw.split(",") if x.strip()]
                else:
                    return False
            return actual in expected or str(actual) in [str(x) for x in expected]

        if op in (">", ">=", "<", "<="):
            try:
                a = float(actual)
                b = float(expected)
            except Exception:
                return False
            if op == ">" and not (a > b):
                return False
            if op == ">=" and not (a >= b):
                return False
            if op == "<" and not (a < b):
                return False
            if op == "<=" and not (a <= b):
                return False
            continue

        if op in ("=", "=="):
            if isinstance(actual, list):
                if expected not in actual and str(expected) not in [str(x) for x in actual]:
                    return False
            else:
                if str(actual) != str(expected):
                    return False
            continue

        if op == "!=":
            if isinstance(actual, list):
                if expected in actual or str(expected) in [str(x) for x in actual]:
                    return False
            else:
                if str(actual) == str(expected):
                    return False
            continue

        return False

    return True


# ─────────────────────────────────────────────
# RECONSTRUCTION DU PAYLOAD (JSON → API)
# ─────────────────────────────────────────────
STRING_FIELDS = {
    "value",
    "choices_definition",
}

RESOURCE_STRING_FIELDS: dict = {
    # "metrology/custom-metric-samples": {"extra_field"},
}

def _parse_complex_field(val, key=None, resource=None):
    """
    Détecte et reconstruit les champs complexes lors de l'import.

    Règles appliquées dans l'ordre :
      1. Non-string → retourné tel quel (bool, int, list, dict...)
      2. Champ protégé (STRING_FIELDS ou RESOURCE_STRING_FIELDS) → str conservée
      3. Chaîne ressemblant à du JSON ({...}, [...], "...") → json.loads()
      4. Chaîne avec séparateur '|' → liste d'UUIDs
      5. Chaîne simple → str (ou None si vide)
    """
    if not isinstance(val, str):
        return val

    stripped = val.strip()
    if not stripped:
        return None

    # Champs protégés : conserver la chaîne sans désérialisation
    resource_extras = RESOURCE_STRING_FIELDS.get(resource, set()) if resource else set()
    if key and (key in STRING_FIELDS or key in resource_extras):
        return val

    # Tentative de désérialisation JSON
    if stripped[0] in ("{", "[", '"'):
        try:
            return json.loads(stripped)
        except json.JSONDecodeError:
            pass

    # Séparateur | → liste d'UUIDs
    if "|" in stripped:
        return [t.strip() for t in stripped.split("|") if t.strip()]

    return val


def build_payload(item, exclude_keys=None, resource=None):
    """
    Construit le payload API depuis un objet JSON importé.
    - Exclut 'id' et les clés de exclude_keys
    - Préserve les champs STRING_FIELDS comme chaînes (pas de désérialisation JSON)
    - Reconstruit les autres champs complexes (listes, dicts imbriqués)
    - Ignore les valeurs None / chaînes vides
    """
    skip = {"id"} | (set(exclude_keys) if exclude_keys else set())
    payload = {}

    for key, val in item.items():
        if key in skip:
            continue

        if val is None:
            continue
        if isinstance(val, str) and not val.strip():
            continue

        parsed = _parse_complex_field(val, key=key, resource=resource)

        if parsed is None:
            continue

        payload[key] = parsed

    return payload


# ─────────────────────────────────────────────
# AFFICHAGE EN TABLEAU TERMINAL
# ─────────────────────────────────────────────
def _cell(val, max_len=40):
    """Représentation courte d'une valeur pour affichage tableau."""
    if val is None:
        return ""
    if isinstance(val, bool):
        return "oui" if val else "non"
    if isinstance(val, list):
        parts = []
        for item in val:
            if isinstance(item, dict):
                parts.append(item.get("str", item.get("name", item.get("id", str(item)))))
            else:
                parts.append(str(item))
        text = " | ".join(parts)
    elif isinstance(val, dict):
        text = val.get("str", val.get("name", val.get("id", str(val))))
    else:
        text = str(val)
    return (text[:max_len - 1] + "…") if len(text) > max_len else text


def print_table(items, fields=None, max_col_width=40):
    """Affiche une liste de dicts dans un tableau Unicode aligné."""
    if not items:
        print(" (aucun résultat)")
        return

    if fields is None:
        all_keys = []
        for item in items:
            for k in item.keys():
                if k not in all_keys:
                    all_keys.append(k)
        prio = ["id", "name", "ref_id", "status", "category",
                "csf_function", "effort", "priority", "is_published", "folder", "str"]
        fields = [f for f in prio if f in all_keys]
        if not fields:
            fields = all_keys[:7]

    rows = []
    for item in items:
        rows.append({f: _cell(item.get(f, ""), max_col_width) for f in fields})

    col_widths = {f: len(f) for f in fields}
    for row in rows:
        for f in fields:
            col_widths[f] = max(col_widths[f], len(row[f]))

    def _sep(left, mid, right, cross):
        return left + cross.join("─" * (col_widths[f] + 2) for f in fields) + right

    print(_sep("┌", "─", "┐", "┬"))
    print("│" + "│".join(f" {f:<{col_widths[f]}} " for f in fields) + "│")
    print(_sep("╞", "═", "╡", "╪"))
    for i, row in enumerate(rows):
        print("│" + "│".join(f" {row[f]:<{col_widths[f]}} " for f in fields) + "│")
        if i < len(rows) - 1:
            print(_sep("├", "─", "┤", "┼"))
    print(_sep("└", "─", "┘", "┴"))


def print_simple(items, fields=None):
    """Affichage simple : une ligne par item."""
    if not items:
        print(" (aucun résultat)")
        return
    for item in items:
        if fields:
            parts = [f"{f}={_cell(item.get(f, ''))}" for f in fields]
            print(" " + " | ".join(parts))
        else:
            item_id = item.get("id", "")
            item_name = item.get("name", item.get("str", "?"))
            item_st = item.get("status", item.get("category", ""))
            print(f" [{item_id}] {item_name} ({item_st})")


# ─────────────────────────────────────────────
# COMMANDE : EXPORT
# ─────────────────────────────────────────────
def cmd_export(resource, output_file, params=None, fields=None, where=None, enum_case="none"):
    """
    Exporte une ressource complète en JSON aplati ré-importable.
    - params : filtres API (--param)
    - where  : filtres locaux (--where)
    - enum_case : none/lower/upper (défaut none => raw API)
    """
    url = resolve_endpoint(resource)
    print(f"[INFO] Export de '{resource}' depuis {url} ...")
    items_raw = paginate_all(url, params=params)

    if not items_raw:
        print("[INFO] Aucun élément trouvé.")
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump([], f)
        print(f"[OK] Fichier vide écrit → {output_file}")
        return

    items = [flatten_object(obj) for obj in items_raw]

    if enum_case != "none":
        items = [apply_enum_case(obj, mode=enum_case) for obj in items]

    if where:
        before = len(items)
        items = [obj for obj in items if _match_where(obj, where)]
        print(f"[INFO] Filtrage local --where : {len(items)}/{before} conservés.")

    if fields:
        wanted = {f.strip() for f in fields if f.strip()}
        wanted.add("id")
        items = [{k: v for k, v in obj.items() if k in wanted} for obj in items]

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(items, f, indent=2, ensure_ascii=False)

    print(f"[OK] {len(items)} élément(s) exporté(s) → {output_file}")


# ─────────────────────────────────────────────
# COMMANDE : IMPORT
# ─────────────────────────────────────────────
def cmd_import(resource, json_file, dry_run=False, exclude_keys=None, key_field="id"):
    """
    Importe des objets depuis un fichier JSON vers une ressource API.

    key_field : 'id' (défaut) ou 'ref_id'
      - 'id'     : comportement original — cherche le champ 'id' dans chaque item,
                   fait un PATCH sur /<resource>/<id>/ si présent, sinon POST.
      - 'ref_id' : cherche le champ 'ref_id' dans chaque item, résout l'UUID
                   correspondant via un index construit depuis l'API, puis fait
                   un PATCH si trouvé, sinon POST (nouvel objet).
    """
    if not os.path.exists(json_file):
        print(f"[ERREUR] Fichier introuvable : {json_file}")
        sys.exit(1)

    with open(json_file, encoding="utf-8") as f:
        raw = json.load(f)

    if isinstance(raw, dict):
        items = raw["results"] if "results" in raw else [raw]
    elif isinstance(raw, list):
        items = raw
    else:
        print("[ERREUR] Format JSON inattendu. Attendu : liste ou objet avec 'results'.")
        sys.exit(1)

    url = resolve_endpoint(resource)
    mode_label = "[DRY-RUN] " if dry_run else ""

    # ── Construction de l'index ref_id → UUID si nécessaire ──────
    ref_id_index = {}
    if key_field == "ref_id":
        if dry_run:
            print(f"[DRY-RUN] Construction de l'index ref_id → UUID depuis {url} ...")
        ref_id_index = build_ref_id_index(url)

    stats = {"created": 0, "updated": 0, "skipped": 0, "errors": 0}

    print(f"{mode_label}[INFO] {len(items)} élément(s) à traiter depuis '{json_file}' → {url}")
    print(f"{mode_label}[INFO] Clé d'identification : '{key_field}'")
    print()

    for i, item in enumerate(items, start=1):
        name = item.get("name") or item.get("ref_id") or item.get("str") or f"item-{i}"
        payload = build_payload(item, exclude_keys=exclude_keys, resource=resource)

        if not payload:
            print(f" Item {i} → [IGNORÉ] Payload vide (aucun champ utile).")
            stats["skipped"] += 1
            continue

        # ── Résolution de l'UUID selon la clé choisie ────────────
        resolved_uuid = None

        if key_field == "id":
            # Comportement original
            raw_id = item.get("id", "")
            if isinstance(raw_id, str):
                raw_id = raw_id.strip()
            resolved_uuid = raw_id if raw_id else None

        elif key_field == "ref_id":
            raw_ref = item.get("ref_id", "")
            if isinstance(raw_ref, str):
                raw_ref = raw_ref.strip()
            if raw_ref:
                resolved_uuid = ref_id_index.get(raw_ref)
                if resolved_uuid is None:
                    print(f" Item {i} → [CRÉATION] ref_id='{raw_ref}' non trouvé dans l'API → POST")
                else:
                    print(f" Item {i} → [MISE À JOUR] ref_id='{raw_ref}' résolu → UUID={resolved_uuid}")
            else:
                print(f" Item {i} → [CRÉATION] Aucun ref_id présent → POST")

        # ── PATCH (mise à jour) ───────────────────────────────────
        if resolved_uuid:
            item_url = f"{url.rstrip('/')}/{resolved_uuid}/"
            if key_field == "id":
                print(f" Item {i} → [MISE À JOUR] '{name}' (id={resolved_uuid})")
            print(f" Champs : {', '.join(payload.keys())}")
            if not dry_run:
                status, data = api_request("PATCH", item_url, data=payload)
                if status in (200, 201):
                    print(" ✓ Mise à jour réussie.")
                    stats["updated"] += 1
                else:
                    print(f" ✗ Erreur {status} : {data}")
                    stats["errors"] += 1
            else:
                print(f" → URL cible : {item_url}")
                print(f" → Payload :\n{json.dumps(payload, indent=2, ensure_ascii=False)}")
                stats["updated"] += 1

        # ── POST (création) ───────────────────────────────────────
        else:
            if key_field == "id":
                print(f" Item {i} → [CRÉATION] '{name}'")
            print(f" Champs : {', '.join(payload.keys())}")
            if not dry_run:
                status, data = api_request("POST", url, data=payload)
                if status == 201:
                    print(f" ✓ Créé avec l'id : {data.get('id', '?')}")
                    stats["created"] += 1
                else:
                    print(f" ✗ Erreur {status} : {data}")
                    stats["errors"] += 1
            else:
                print(f" → Payload :\n{json.dumps(payload, indent=2, ensure_ascii=False)}")
                stats["created"] += 1

        print()

    print("─" * 60)
    print(f"{mode_label}Résumé de l'import sur '{resource}' (clé: {key_field}) :")
    print(f" Créés       : {stats['created']}")
    print(f" Mis à jour  : {stats['updated']}")
    print(f" Ignorés     : {stats['skipped']}")
    print(f" Erreurs     : {stats['errors']}")
    print("─" * 60)

    if stats["errors"] > 0:
        sys.exit(1)


# ─────────────────────────────────────────────
# COMMANDE : GET
# ─────────────────────────────────────────────
def cmd_get(resource, page=None, page_size=None, status_filter=None,
            search=None, fields=None, fmt="table", params=None, all_pages=False):
    """Affiche une ressource dans le terminal (tableau/json/simple)."""
    url = resolve_endpoint(resource)
    query = {}
    if status_filter:
        query["status"] = status_filter
    if search:
        query["search"] = search
    if page_size:
        query["page_size"] = page_size
    if page and not all_pages:
        query["page"] = page
    if params:
        query.update(params)

    if all_pages:
        items = paginate_all(url, params=query or None)
        _display_get(items, len(items), None, fields, fmt, resource)
        return

    status, data = api_request("GET", url, params=query or None)
    if status != 200:
        print(f"[ERREUR {status}] {data}", file=sys.stderr)
        sys.exit(1)

    if isinstance(data, list):
        items = data
        count = len(data)
        next_url = None
        prev_url = None
    else:
        items = data.get("results", [])
        count = data.get("count", len(items))
        next_url = data.get("next")
        prev_url = data.get("previous")

    pg = page or 1
    ps = page_size or max(len(items), 1)
    total_pages = math.ceil(count / ps) if ps else 1
    page_info = {
        "page": pg, "page_size": ps, "count": count,
        "total_pages": total_pages,
        "has_next": bool(next_url), "has_prev": bool(prev_url),
    }
    _display_get(items, count, page_info, fields, fmt, resource)


def _display_get(items, count, page_info, fields, fmt, resource):
    print()
    print(f" Ressource : {resource}")
    if page_info:
        print(f" Résultats : {len(items)} affichés / {count} total | Page {page_info['page']}/{page_info['total_pages']}")
    else:
        print(f" Résultats : {len(items)} (toutes pages)")
    print()
    if not items:
        print(" (aucun résultat)\n")
        return

    if fmt == "json":
        print(json.dumps(items, indent=2, ensure_ascii=False))
    elif fmt == "simple":
        field_list = [f.strip() for f in fields.split(",")] if fields else None
        print_simple(items, fields=field_list)
    else:
        field_list = [f.strip() for f in fields.split(",")] if fields else None
        print_table(items, fields=field_list)
    print()

    if page_info and (page_info["has_next"] or page_info["has_prev"]):
        pg = page_info["page"]
        ps = page_info["page_size"]
        print(" Navigation :")
        if page_info["has_prev"]:
            print(f" ← Précédente : --page {pg - 1} --page-size {ps}")
        if page_info["has_next"]:
            print(f" → Suivante   : --page {pg + 1} --page-size {ps}")
        print()


# ─────────────────────────────────────────────
# COMMANDE : SHOW
# ─────────────────────────────────────────────
def cmd_show(resource, obj_id):
    """Affiche le JSON brut complet d'un objet par son ID."""
    url = f"{resolve_endpoint(resource).rstrip('/')}/{obj_id}/"
    status, data = api_request("GET", url)
    if status == 200:
        print(json.dumps(data, indent=2, ensure_ascii=False))
    elif status == 404:
        print(f"[ERREUR] Objet '{obj_id}' introuvable dans '{resource}'.")
        sys.exit(1)
    else:
        print(f"[ERREUR {status}] {data}", file=sys.stderr)
        sys.exit(1)


# ─────────────────────────────────────────────
# COMMANDE : FOLDERS
# ─────────────────────────────────────────────
def cmd_list_folders():
    """Liste les dossiers avec leur UUID et leur parent."""
    url = resolve_endpoint("folders")
    print(f"[INFO] Récupération des dossiers depuis {url}...")
    folders = paginate_all(url)
    if not folders:
        print("[INFO] Aucun dossier trouvé.")
        return

    print(f"\n{'UUID':<40} {'Nom':<40} Parent")
    print("─" * 100)
    for folder in folders:
        parent = folder.get("parent_name", "") or ""
        print(f"{folder.get('id',''):<40} {folder.get('name',''):<40} {parent}")


# ─────────────────────────────────────────────
# OUTILS CLI
# ─────────────────────────────────────────────
def _parse_params(param_list):
    """Convertit une liste ['CLE=VALEUR', ...] en dict."""
    result = {}
    for p in (param_list or []):
        if "=" in p:
            k, v = p.split("=", 1)
            result[k.strip()] = v.strip()
        else:
            print(f"[AVERTISSEMENT] --param ignoré (format CLE=VALEUR attendu) : {p}")
    return result


_KNOWN_SHORTCUTS = " " + "\n ".join(
    f"{k:<30} -> /{v}/" for k, v in KNOWN_ENDPOINTS.items()
)
_EPILOG = (
    "Ressources connues (raccourcis) :\n"
    + _KNOWN_SHORTCUTS
    + "\n\nVous pouvez aussi passer n'importe quel chemin relatif ou URL complete."
    + """
─────────────────────────────────────────────
Exemples :
─────────────────────────────────────────────
 # Export (raw API, aucune modification de casse)
 python ciso_manager.py export applied-controls --output out.json

 # Import classique par UUID (comportement v3.1)
 python ciso_manager.py import applied-controls --file out.json

 # Import / mise à jour par ref_id (résolution UUID automatique)
 python ciso_manager.py import applied-controls --file out.json --key ref_id

 # Import ref_id en dry-run (aucune requête modifiante)
 python ciso_manager.py import applied-controls --file out.json --key ref_id --dry-run

 # Export avec filtre local
 python ciso_manager.py export applied-controls --where status=active --output actifs.json

 # Export champs sélectionnés
 python ciso_manager.py export metrics --fields id,name,status --output metrics_light.json
"""
)


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Gestionnaire generique CISO Assistant v3.2",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=_EPILOG,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # ── export ──
    p_exp = sub.add_parser(
        "export",
        help="Exporter une ressource complète en JSON ré-importable",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p_exp.add_argument("resource", help="Ressource à exporter (ex: policies, applied-controls, ...)")
    p_exp.add_argument("--output", "-o", default=None,
                       help="Fichier de sortie (défaut: <resource>_YYYYMMDD_HHMMSS.json)")
    p_exp.add_argument("--fields", "-c", default=None,
                       help="Champs à conserver, séparés par des virgules (id toujours inclus)")
    p_exp.add_argument("--param", action="append", dest="extra_params", default=[],
                       metavar="CLE=VALEUR", help="Filtre côté API (répétable, ex: status=active)")
    p_exp.add_argument("--where", action="append", dest="where_clauses", default=[],
                       metavar="CHAMP<op>VALEUR",
                       help="Filtre local (répétable) : champ=val | champ!=val | champ~val | champ in [...] | champ>=3")
    p_exp.add_argument("--enum-case", choices=["none", "lower", "upper"], default=DEFAULT_ENUM_CASE,
                       help=f"OPTIONNEL: normalise la casse de quelques enums. Défaut: {DEFAULT_ENUM_CASE} (raw API).")

    # ── import ──
    p_imp = sub.add_parser(
        "import",
        help="Créer ou mettre à jour des objets depuis un fichier JSON",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p_imp.add_argument("resource", help="Ressource cible (ex: metrics, applied-controls, ...)")
    p_imp.add_argument("--file", "-f", required=True, help="Fichier JSON à importer")
    p_imp.add_argument(
        "--key", "-k",
        choices=["id", "ref_id"],
        default="id",
        dest="key_field",
        help=(
            "Champ utilisé pour identifier les objets existants lors des mises à jour.\n"
            "  id     : utilise l'UUID (champ 'id') — comportement par défaut\n"
            "  ref_id : utilise le ref_id humain ; l'UUID est résolu automatiquement\n"
            "           via un appel GET sur la ressource avant l'import."
        ),
    )
    p_imp.add_argument("--dry-run", action="store_true",
                       help="Simuler sans envoyer de requêtes modifiantes")
    p_imp.add_argument("--exclude", "-e", default=None,
                       help="Champs à ignorer lors de l'import, séparés par des virgules (ex: folder,category)")

    # ── get ──
    p_get = sub.add_parser(
        "get",
        help="Afficher une ressource dans le terminal (pagination, filtres)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p_get.add_argument("resource", help="Ressource ou URL complète")
    p_get.add_argument("--page", "-p", type=int, default=None)
    p_get.add_argument("--page-size", "-n", type=int, default=None, dest="page_size")
    p_get.add_argument("--status", "-s", default=None)
    p_get.add_argument("--search", "-q", default=None)
    p_get.add_argument("--fields", "-c", default=None,
                       help="Colonnes à afficher, séparées par des virgules")
    p_get.add_argument("--format", "-f", choices=["table", "json", "simple"],
                       default="table", dest="fmt")
    p_get.add_argument("--all", "-a", action="store_true", dest="all_pages",
                       help="Récupérer et afficher toutes les pages")
    p_get.add_argument("--param", action="append", dest="extra_params", default=[],
                       metavar="CLE=VALEUR")

    # ── show ──
    p_show = sub.add_parser("show", help="Afficher le JSON brut d'un objet par son ID")
    p_show.add_argument("resource", help="Ressource (ex: metrics)")
    p_show.add_argument("--id", required=True, help="UUID de l'objet")

    # ── folders ──
    sub.add_parser("folders", help="Lister les dossiers et leurs UUIDs")

    args = parser.parse_args()

    # Vérification du token
    if API_TOKEN in ("", "XX", "VOTRE_TOKEN_ICI", "XXXXXXXXX"):
        print("[ERREUR] Token API non configuré.")
        print(" → export CISO_API_TOKEN='votre_token'")
        sys.exit(1)

    # Dispatch
    if args.command == "export":
        if not args.output:
            args.output = f"{args.resource.replace('/', '_')}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        fields = [f.strip() for f in args.fields.split(",")] if args.fields else None
        where = _parse_where(args.where_clauses) or None

        cmd_export(
            resource=args.resource,
            output_file=args.output,
            params=_parse_params(args.extra_params) or None,
            fields=fields,
            where=where,
            enum_case=args.enum_case,
        )

    elif args.command == "import":
        exclude = [f.strip() for f in args.exclude.split(",")] if args.exclude else None
        cmd_import(
            resource=args.resource,
            json_file=args.file,
            dry_run=args.dry_run,
            exclude_keys=exclude,
            key_field=args.key_field,
        )

    elif args.command == "get":
        cmd_get(
            resource=args.resource,
            page=args.page,
            page_size=args.page_size,
            status_filter=args.status,
            search=args.search,
            fields=args.fields,
            fmt=args.fmt,
            params=_parse_params(args.extra_params) or None,
            all_pages=args.all_pages,
        )

    elif args.command == "show":
        cmd_show(resource=args.resource, obj_id=args.id)

    elif args.command == "folders":
        cmd_list_folders()


if __name__ == "__main__":
    main()