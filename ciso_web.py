#!/usr/bin/env python3
"""
CISO Assistant API Manager - Local Web UI v1.2

Objectif : interface locale pour lire, filtrer, exporter et importer les donnees
CISO Assistant. Le serveur est volontairement limite a un usage local.

Usage :
  python ciso_web.py
  python ciso_web.py --host 127.0.0.1 --port 8080
"""

import argparse
import json
import mimetypes
import os
import sys
import traceback
import urllib.parse
import webbrowser
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

try:
    import ciso_manager as cm
except Exception as exc:
    print("[ERROR] Unable to import ciso_manager.py.", file=sys.stderr)
    print("        Make sure ciso_web.py is located in the same folder as ciso_manager.py.", file=sys.stderr)
    print(f"        Details: {exc}", file=sys.stderr)
    sys.exit(1)

APP_NAME = "CISO Assistant API Manager Web UI"
APP_VERSION = "1.2"

ROOT_DIR = Path(__file__).resolve().parent
WEB_DIR = ROOT_DIR / "web"
EXPORT_DIR = ROOT_DIR / "exports"
IMPORT_DIR = ROOT_DIR / "imports"
LOG_DIR = ROOT_DIR / "logs"

for directory in (WEB_DIR, EXPORT_DIR, IMPORT_DIR, LOG_DIR):
    directory.mkdir(exist_ok=True)

REFERENCE_RESOURCES = {
    "folder": "folders",
    "folders": "folders",
    "perimeter": "perimeters",
    "perimeters": "perimeters",
    "entity": "entities",
    "entities": "entities",
    "owner": "users",
    "owners": "users",
    "assignee": "users",
    "user": "users",
    "users": "users",
    "team": "teams",
    "teams": "teams",
    "framework": "frameworks",
    "frameworks": "frameworks",
    "library": "loaded-libraries",
    "libraries": "loaded-libraries",
    "loaded_library": "loaded-libraries",
    "stored_library": "stored-libraries",
}

COMMON_STATUS_VALUES = [
    "active", "inactive", "draft", "in_progress", "deprecated", "archived",
    "to_do", "done", "not_started", "completed", "approved", "rejected",
]

# cache format: {resource: {expires_at: datetime, data: {uuid: label}}}
LOOKUP_CACHE = {}
CACHE_TTL_SECONDS = int(os.getenv("CISO_LOOKUP_CACHE_TTL", "300"))


def now_stamp():
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def log_event(action, **details):
    entry = {"timestamp": datetime.now().isoformat(timespec="seconds"), "action": action, **details}
    with (LOG_DIR / "ciso_web.log").open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + "\n")


def base_url():
    value = os.getenv("CISO_BASE_URL") or getattr(cm, "BASE_URL", None) or "https://localhost:8443/api"
    return value.rstrip("/")


def token_configured():
    token = os.getenv("CISO_API_TOKEN") or getattr(cm, "API_TOKEN", None)
    return bool(token)


def verify_ssl_enabled():
    # Projet local : on conserve le comportement existant. Pas de changement impose.
    raw = os.getenv("CISO_VERIFY_SSL")
    if raw is None:
        return bool(getattr(cm, "VERIFY_SSL", False))
    return raw.lower() not in ("0", "false", "no", "off")


def full_url(resource_or_path):
    resolved = cm.resolve_endpoint(resource_or_path)
    if resolved.startswith("http://") or resolved.startswith("https://"):
        return resolved
    return base_url() + "/" + resolved.strip("/") + "/"


def safe_file_name(name):
    name = os.path.basename(name or "download.json")
    allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_."
    return "".join(ch if ch in allowed else "_" for ch in name)


def parse_json_body(handler):
    length = int(handler.headers.get("Content-Length", "0"))
    raw = handler.rfile.read(length).decode("utf-8") if length else "{}"
    return json.loads(raw or "{}")


def parse_records(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict) and isinstance(payload.get("results"), list):
        return payload["results"]
    if isinstance(payload, dict):
        return [payload]
    raise ValueError("Import content must be a JSON object, a JSON list, or an object with a results array.")


def label_from_object(obj):
    if not isinstance(obj, dict):
        return str(obj)
    for key in ("str", "name", "title", "ref_id", "email", "username", "id"):
        value = obj.get(key)
        if value:
            return str(value)
    return json.dumps(obj, ensure_ascii=False)


def looks_like_uuid(value):
    if value is None:
        return False
    value = str(value)
    return len(value) >= 32 and value.count("-") >= 4


def flatten_export(item):
    try:
        return cm.flatten_object(item)
    except Exception:
        return item


def get_lookup(resource, force=False):
    if not resource:
        return {}

    cached = LOOKUP_CACHE.get(resource)
    if cached and not force and cached["expires_at"] > datetime.now():
        return cached["data"]

    try:
        items = cm.paginate_all(full_url(resource), params={"page_size": 500})
        mapping = {}
        for item in items:
            if not isinstance(item, dict):
                continue
            uid = item.get("id")
            if uid:
                mapping[str(uid)] = label_from_object(item)
        LOOKUP_CACHE[resource] = {
            "expires_at": datetime.now() + timedelta(seconds=CACHE_TTL_SECONDS),
            "data": mapping,
        }
        return mapping
    except Exception as exc:
        log_event("lookup_error", resource=resource, error=str(exc))
        LOOKUP_CACHE[resource] = {"expires_at": datetime.now(), "data": {}}
        return {}


def lookup_label(field_name, uuid_value):
    if not uuid_value:
        return ""
    name = str(field_name or "").lower()
    candidates = []

    if name in REFERENCE_RESOURCES:
        candidates.append(REFERENCE_RESOURCES[name])
    if name.endswith("_id"):
        base = name[:-3]
        if base in REFERENCE_RESOURCES:
            candidates.append(REFERENCE_RESOURCES[base])
    if name.endswith("s") and name[:-1] in REFERENCE_RESOURCES:
        candidates.append(REFERENCE_RESOURCES[name[:-1]])

    for resource in dict.fromkeys(candidates):
        mapping = get_lookup(resource)
        if str(uuid_value) in mapping:
            return mapping[str(uuid_value)]
    return str(uuid_value)


def display_value(key, value):
    if value is None:
        return ""
    if isinstance(value, dict):
        if value.get("str") or value.get("name"):
            return label_from_object(value)
        if value.get("id"):
            return lookup_label(key, value.get("id"))
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        labels = []
        for item in value:
            if isinstance(item, dict):
                if item.get("str") or item.get("name"):
                    labels.append(label_from_object(item))
                elif item.get("id"):
                    labels.append(lookup_label(key, item.get("id")))
                else:
                    labels.append(json.dumps(item, ensure_ascii=False))
            else:
                labels.append(lookup_label(key, item) if looks_like_uuid(item) else str(item))
        return " | ".join(labels)
    if looks_like_uuid(value):
        return lookup_label(key, value)
    return value


def display_object(item):
    out = {}
    for key, value in item.items():
        if key in ("created_at", "updated_at", "id", "ref_id", "name", "status", "category"):
            out[key] = value
        else:
            out[key] = display_value(key, value)
    return out


def build_payload(item, exclude_keys=None, resource=None):
    if hasattr(cm, "build_payload"):
        return cm.build_payload(item, exclude_keys=exclude_keys, resource=resource)
    exclude = set(exclude_keys or []) | {"id"}
    payload = {}
    for key, value in item.items():
        if key in exclude or value is None:
            continue
        if isinstance(value, str) and value.strip() == "":
            continue
        payload[key] = value
    return payload


def canonical(value):
    if isinstance(value, dict):
        if "id" in value and len(value) <= 3:
            return value.get("id")
        return {k: canonical(v) for k, v in sorted(value.items())}
    if isinstance(value, list):
        return [canonical(v) for v in value]
    return value


def values_equal(a, b):
    return json.dumps(canonical(a), sort_keys=True, ensure_ascii=False) == json.dumps(canonical(b), sort_keys=True, ensure_ascii=False)


def fetch_existing_flat(url, uuid):
    target = url.rstrip("/") + f"/{uuid}/"
    status, data = cm.api_request("GET", target)
    if 200 <= status < 300 and isinstance(data, dict):
        return flatten_export(data), data
    return None, None


def strict_payload(url, uuid, payload):
    existing_flat, _ = fetch_existing_flat(url, uuid)
    if existing_flat is None:
        return payload, {"compared": False, "removed": [], "reason": "existing object could not be read"}

    cleaned = {}
    removed = []
    for key, value in payload.items():
        if key in existing_flat and values_equal(existing_flat.get(key), value):
            removed.append(key)
        else:
            cleaned[key] = value
    return cleaned, {"compared": True, "removed": removed}


def build_options_for_ui(resource=None):
    folders = get_lookup("folders")
    perimeters = get_lookup("perimeters")
    entities = get_lookup("entities")
    teams = get_lookup("teams")
    users = get_lookup("users")
    return {
        "statuses": COMMON_STATUS_VALUES,
        "folders": [{"id": k, "label": v} for k, v in sorted(folders.items(), key=lambda x: x[1].lower())],
        "perimeters": [{"id": k, "label": v} for k, v in sorted(perimeters.items(), key=lambda x: x[1].lower())],
        "entities": [{"id": k, "label": v} for k, v in sorted(entities.items(), key=lambda x: x[1].lower())],
        "teams": [{"id": k, "label": v} for k, v in sorted(teams.items(), key=lambda x: x[1].lower())],
        "users": [{"id": k, "label": v} for k, v in sorted(users.items(), key=lambda x: x[1].lower())],
    }


class CisoWebHandler(BaseHTTPRequestHandler):
    server_version = "CisoWebUI/1.2"

    def log_message(self, format, *args):
        log_event("http", client=self.client_address[0], message=format % args)

    def send_json(self, payload, status=200):
        raw = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def send_error_json(self, message, status=500, details=None):
        self.send_json({"ok": False, "error": message, "details": details}, status=status)

    def serve_static(self):
        requested = urllib.parse.urlparse(self.path).path
        if requested == "/":
            requested = "/web/index.html"
        requested = requested.lstrip("/")
        target = (ROOT_DIR / requested).resolve()
        if not str(target).startswith(str(ROOT_DIR.resolve())) or not target.exists() or not target.is_file():
            self.send_error_json("Not found", status=404)
            return
        content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        raw = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path
            query = urllib.parse.parse_qs(parsed.query)

            if path == "/api/health":
                self.send_json({
                    "ok": True,
                    "app": APP_NAME,
                    "version": APP_VERSION,
                    "baseUrl": base_url(),
                    "tokenConfigured": token_configured(),
                    "verifySsl": verify_ssl_enabled(),
                    "cacheTtlSeconds": CACHE_TTL_SECONDS,
                })
                return

            if path == "/api/resources":
                self.send_json({"ok": True, "resources": sorted(cm.KNOWN_ENDPOINTS.keys())})
                return

            if path == "/api/options":
                resource = query.get("resource", [None])[0]
                force = query.get("force", ["false"])[0].lower() == "true"
                if force:
                    LOOKUP_CACHE.clear()
                self.send_json({"ok": True, "options": build_options_for_ui(resource)})
                return

            if path == "/api/data":
                resource = query.get("resource", [""])[0]
                if not resource:
                    self.send_error_json("Missing resource", status=400)
                    return
                params = {}
                for key in ("status", "search", "folder", "perimeter"):
                    value = query.get(key, [""])[0].strip()
                    if value:
                        params[key] = value
                fields = [f.strip() for f in query.get("fields", [""])[0].split(",") if f.strip()]
                raw_items = cm.paginate_all(full_url(resource), params=params or None)
                export_items = [flatten_export(item) for item in raw_items]
                display_items = [display_object(item) for item in export_items]
                if fields:
                    def select_fields(item):
                        return {k: item.get(k) for k in fields if k in item}
                    display_items = [select_fields(item) for item in display_items]
                    export_items = [select_fields(item) for item in export_items]
                self.send_json({"ok": True, "items": display_items, "exportItems": export_items, "count": len(display_items)})
                return

            if path.startswith("/exports/"):
                self.serve_static()
                return

            self.serve_static()
        except SystemExit:
            raise
        except Exception as exc:
            self.send_error_json(str(exc), details=traceback.format_exc())

    def do_POST(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path
            body = parse_json_body(self)

            if path == "/api/export":
                resource = body.get("resource")
                if not resource:
                    self.send_error_json("Missing resource", status=400)
                    return
                params = {k: body.get(k) for k in ("status", "search", "folder", "perimeter") if body.get(k)}
                fields = [f.strip() for f in body.get("fields", []) if f.strip()]
                raw_items = cm.paginate_all(full_url(resource), params=params or None)
                items = [flatten_export(item) for item in raw_items]
                if fields:
                    items = [{k: item.get(k) for k in fields if k in item} for item in items]
                file_name = safe_file_name(f"{resource}_{now_stamp()}.json")
                target = EXPORT_DIR / file_name
                target.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
                self.send_json({"ok": True, "file": file_name, "downloadUrl": f"/exports/{file_name}", "count": len(items)})
                return

            if path in ("/api/import/dry-run", "/api/import/apply"):
                resource = body.get("resource")
                content = body.get("content") or "[]"
                key_field = body.get("key") or "id"
                exclude = [x.strip() for x in (body.get("exclude") or "").split(",") if x.strip()]
                strict = bool(body.get("strict", True))
                dry_run = path.endswith("dry-run")

                if not resource:
                    self.send_error_json("Missing resource", status=400)
                    return

                payload = json.loads(content)
                records = parse_records(payload)
                url = full_url(resource)
                ref_index = cm.build_ref_id_index(url) if key_field == "ref_id" else {}
                results = []
                skipped = 0
                errors = 0

                for record in records:
                    try:
                        uuid = record.get("id")
                        if key_field == "ref_id" and record.get("ref_id"):
                            uuid = ref_index.get(str(record.get("ref_id")).strip())
                        payload_item = build_payload(record, exclude_keys=exclude, resource=resource)
                        diff = None
                        method = "POST"
                        target = url
                        if uuid:
                            method = "PATCH"
                            target = url.rstrip("/") + f"/{uuid}/"
                            if strict:
                                payload_item, diff = strict_payload(url, uuid, payload_item)
                            if not payload_item:
                                skipped += 1
                                results.append({"id": uuid, "method": method, "skipped": True, "diff": diff})
                                continue
                        if dry_run:
                            results.append({"id": uuid, "method": method, "target": target, "payload": payload_item, "diff": diff})
                        else:
                            status, response = cm.api_request(method, target, data=payload_item)
                            ok = 200 <= status < 300
                            if not ok:
                                errors += 1
                            results.append({"id": uuid, "method": method, "status": status, "ok": ok, "response": response, "diff": diff})
                    except Exception as item_exc:
                        errors += 1
                        results.append({"ok": False, "error": str(item_exc), "record": record})

                self.send_json({
                    "ok": errors == 0,
                    "resource": resource,
                    "count": len(records),
                    "skipped": skipped,
                    "errors": errors,
                    "strict": strict,
                    "dryRun": dry_run,
                    "results": results,
                })
                return

            # Stubs volontaires pour les prochaines evolutions.
            # Tu me donneras ensuite les endpoints/champs CISO Assistant exacts.
            if path in ("/api/domains/save", "/api/roles/save"):
                self.send_json({
                    "ok": False,
                    "implemented": False,
                    "message": "Endpoint placeholder. Il faut renseigner les appels API CISO Assistant exacts avant activation.",
                    "received": body,
                }, status=501)
                return

            self.send_error_json("Not found", status=404)
        except SystemExit:
            raise
        except Exception as exc:
            self.send_error_json(str(exc), details=traceback.format_exc())


def main():
    parser = argparse.ArgumentParser(description="CISO Assistant API Manager Web UI")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind. Default: 127.0.0.1")
    parser.add_argument("--port", type=int, default=8080, help="Port to bind. Default: 8080")
    parser.add_argument("--no-browser", action="store_true", help="Do not open the browser automatically")
    args = parser.parse_args()

    httpd = ThreadingHTTPServer((args.host, args.port), CisoWebHandler)
    url = f"http://{args.host}:{args.port}/"
    print(f"[INFO] {APP_NAME} v{APP_VERSION}")
    print(f"[INFO] Listening on {url}")
    print("[INFO] Local tool: do not expose it on an untrusted network.")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[INFO] Stopped.")


if __name__ == "__main__":
    main()
