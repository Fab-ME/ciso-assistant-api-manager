#!/usr/bin/env python3
"""
CISO Assistant API Manager - Local Web UI v1.1

Enhancements in v1.1:
- Friendly display labels for common UUID references such as folders, perimeters,
  entities, users, teams, frameworks and libraries.
- Live option loading from CISO Assistant to populate dropdown filters.
- Strict import mode: for PATCH operations, unchanged fields are removed from the
  payload so imports are limited to what is strictly necessary.

Usage:
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
from datetime import datetime
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
APP_VERSION = "1.1"
ROOT_DIR = Path(__file__).resolve().parent
WEB_DIR = ROOT_DIR / "web"
EXPORT_DIR = ROOT_DIR / "exports"
IMPORT_DIR = ROOT_DIR / "imports"
LOG_DIR = ROOT_DIR / "logs"

for directory in (WEB_DIR, EXPORT_DIR, IMPORT_DIR, LOG_DIR):
    directory.mkdir(exist_ok=True)

# Reference resources used to translate UUIDs into readable labels.
REFERENCE_RESOURCES = {
    "folder": "folders",
    "folders": "folders",
    "perimeter": "perimeters",
    "perimeters": "perimeters",
    "entity": "entities",
    "entities": "entities",
    "owner": "users",
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

# Cache format: {resource: {uuid: label}}
LOOKUP_CACHE = {}

COMMON_STATUS_VALUES = [
    "active", "inactive", "draft", "in_progress", "deprecated", "archived",
    "to_do", "done", "not_started", "completed", "approved", "rejected",
]


def now_stamp():
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def log_event(action, **details):
    entry = {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "action": action,
        **details,
    }
    with (LOG_DIR / "ciso_web.log").open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + "\n")


def base_url():
    value = os.getenv("CISO_BASE_URL") or getattr(cm, "BASE_URL", None) or "https://localhost:8443/api"
    return value.rstrip("/")


def token_configured():
    token = os.getenv("CISO_API_TOKEN") or getattr(cm, "API_TOKEN", None)
    return bool(token)


def verify_ssl_enabled():
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


def flatten_export(item):
    try:
        return cm.flatten_object(item)
    except Exception:
        return item


def get_lookup(resource, force=False):
    """Return UUID -> label map for a reference resource."""
    if not resource:
        return {}
    if resource in LOOKUP_CACHE and not force:
        return LOOKUP_CACHE[resource]
    try:
        items = cm.paginate_all(full_url(resource), params={"page_size": 500})
        mapping = {}
        for item in items:
            if not isinstance(item, dict):
                continue
            uid = item.get("id")
            if uid:
                mapping[str(uid)] = label_from_object(item)
        LOOKUP_CACHE[resource] = mapping
        return mapping
    except Exception:
        LOOKUP_CACHE[resource] = {}
        return {}


def lookup_label(field_name, uuid_value):
    if not uuid_value:
        return ""
    name = str(field_name or "").lower()
    candidates = []

    if name in REFERENCE_RESOURCES:
        candidates.append(REFERENCE_RESOURCES[name])
    else:
        # Heuristics for common fields: folder_id, perimeter, owner_id, etc.
        clean = name.replace("_id", "")
        if clean in REFERENCE_RESOURCES:
            candidates.append(REFERENCE_RESOURCES[clean])
        for key, resource in REFERENCE_RESOURCES.items():
            if key in clean:
                candidates.append(resource)

    for resource in dict.fromkeys(candidates):
        mapping = get_lookup(resource)
        label = mapping.get(str(uuid_value))
        if label:
            return label
    return str(uuid_value)


def display_value(key, value):
    """Value used for table display: readable labels instead of raw technical objects."""
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


def looks_like_uuid(value):
    if not isinstance(value, str):
        value = str(value)
    return len(value) >= 32 and value.count("-") >= 4


def display_object(item):
    """Build a user-friendly item for table rendering."""
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
        if key in exclude:
            continue
        if value is None:
            continue
        if isinstance(value, str) and value.strip() == "":
            continue
        payload[key] = value
    return payload


def canonical(value):
    """Comparable representation for strict import diff."""
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
    """Remove unchanged fields from PATCH payload."""
    existing_flat, existing_raw = fetch_existing_flat(url, uuid)
    if existing_flat is None:
        return payload, {"compared": False, "removed": [], "reason": "existing object could not be read"}

    filtered = {}
    removed = []
    for key, value in payload.items():
        if key in existing_flat and values_equal(existing_flat.get(key), value):
            removed.append(key)
        else:
            filtered[key] = value
    return filtered, {"compared": True, "removed": removed}


def build_options_for_ui(resource=None):
    folders = get_lookup("folders")
    perimeters = get_lookup("perimeters")
    entities = get_lookup("entities")
    teams = get_lookup("teams")
    users = get_lookup("users")

    status_values = list(COMMON_STATUS_VALUES)
    if resource:
        try:
            sample = cm.paginate_all(full_url(resource), params={"page_size": 200})
            discovered = sorted({str(x.get("status")) for x in sample if isinstance(x, dict) and x.get("status")})
            status_values = sorted(set(status_values + discovered))
        except Exception:
            pass

    def to_options(mapping):
        return [{"id": uid, "label": label} for uid, label in sorted(mapping.items(), key=lambda x: x[1].lower())]

    return {
        "folders": to_options(folders),
        "perimeters": to_options(perimeters),
        "entities": to_options(entities),
        "teams": to_options(teams),
        "users": to_options(users),
        "statuses": status_values,
    }


class CisoWebHandler(BaseHTTPRequestHandler):
    server_version = "CisoWebUI/1.1"

    def log_message(self, fmt, *args):
        return

    def send_json(self, data, status=200):
        raw = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def send_text(self, text, status=200):
        raw = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw) if raw.strip() else {}

    def handle_error(self, exc):
        log_event("error", path=self.path, error=str(exc), traceback=traceback.format_exc())
        self.send_json({"ok": False, "error": str(exc)}, status=500)

    def do_GET(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path
            query = urllib.parse.parse_qs(parsed.query)

            if path == "/":
                return self.serve_file(WEB_DIR / "index.html")
            if path.startswith("/web/"):
                relative = path.replace("/web/", "", 1)
                return self.serve_file(WEB_DIR / relative)
            if path == "/api/health":
                return self.api_health()
            if path == "/api/resources":
                return self.api_resources()
            if path == "/api/options":
                return self.api_options(query)
            if path == "/api/data":
                return self.api_data(query)
            if path == "/api/download":
                return self.api_download(query)

            self.send_text("Not found", status=404)
        except Exception as exc:
            self.handle_error(exc)

    def do_POST(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path

            if path == "/api/export":
                return self.api_export()
            if path == "/api/import/dry-run":
                return self.api_import(dry_run=True)
            if path == "/api/import/apply":
                return self.api_import(dry_run=False)

            self.send_text("Not found", status=404)
        except Exception as exc:
            self.handle_error(exc)

    def serve_file(self, file_path):
        file_path = Path(file_path).resolve()
        if not str(file_path).startswith(str(WEB_DIR.resolve())):
            self.send_text("Forbidden", status=403)
            return
        if not file_path.exists() or not file_path.is_file():
            self.send_text("Not found", status=404)
            return
        content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        raw = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def api_health(self):
        self.send_json({
            "ok": True,
            "app": APP_NAME,
            "version": APP_VERSION,
            "baseUrl": base_url(),
            "tokenConfigured": token_configured(),
            "verifySsl": verify_ssl_enabled(),
            "hostOnly": "127.0.0.1 recommended",
        })

    def api_resources(self):
        resources = sorted(getattr(cm, "KNOWN_ENDPOINTS", {}).keys())
        self.send_json({"ok": True, "resources": resources})

    def api_options(self, query):
        resource = (query.get("resource") or [""])[0] or None
        self.send_json({"ok": True, "options": build_options_for_ui(resource)})

    def api_data(self, query):
        resource = (query.get("resource") or [""])[0]
        if not resource:
            self.send_json({"ok": False, "error": "Missing resource parameter."}, status=400)
            return

        search = (query.get("search") or [""])[0].strip() or None
        status_filter = (query.get("status") or [""])[0].strip() or None
        folder_filter = (query.get("folder") or [""])[0].strip() or None
        perimeter_filter = (query.get("perimeter") or [""])[0].strip() or None
        fields_raw = (query.get("fields") or [""])[0]
        fields = [x.strip() for x in fields_raw.split(",") if x.strip()]
        page_size = (query.get("page_size") or ["500"])[0]

        url = full_url(resource)
        params = {}
        if status_filter:
            params["status"] = status_filter
        if search:
            params["search"] = search
        if folder_filter:
            params["folder"] = folder_filter
        if perimeter_filter:
            params["perimeter"] = perimeter_filter
        if page_size:
            params["page_size"] = page_size

        raw_items = cm.paginate_all(url, params=params)
        export_items = [flatten_export(x) for x in raw_items]
        display_items = [display_object(x) for x in raw_items]

        if fields:
            if "id" not in fields:
                fields.insert(0, "id")
            export_items = [{field: item.get(field) for field in fields} for item in export_items]
            display_items = [{field: item.get(field) for field in fields} for item in display_items]

        self.send_json({
            "ok": True,
            "resource": resource,
            "count": len(display_items),
            "items": display_items,
            "exportItems": export_items,
            "lookupsLoaded": sorted(LOOKUP_CACHE.keys()),
        })

    def api_export(self):
        payload = self.read_json()
        resource = payload.get("resource")
        if not resource:
            self.send_json({"ok": False, "error": "Missing resource."}, status=400)
            return

        fields = payload.get("fields") or []
        if isinstance(fields, str):
            fields = [x.strip() for x in fields.split(",") if x.strip()]
        params = payload.get("params") or {}
        search = payload.get("search") or None
        status_filter = payload.get("status") or None
        folder_filter = payload.get("folder") or None
        perimeter_filter = payload.get("perimeter") or None

        if status_filter:
            params["status"] = status_filter
        if search:
            params["search"] = search
        if folder_filter:
            params["folder"] = folder_filter
        if perimeter_filter:
            params["perimeter"] = perimeter_filter

        url = full_url(resource)
        raw_items = cm.paginate_all(url, params=params)
        items = [flatten_export(x) for x in raw_items]

        if fields:
            if "id" not in fields:
                fields.insert(0, "id")
            items = [{field: item.get(field) for field in fields} for item in items]

        filename = safe_file_name(f"{resource}_{now_stamp()}.json")
        output_path = EXPORT_DIR / filename
        output_path.write_text(json.dumps(items, indent=2, ensure_ascii=False), encoding="utf-8")

        log_event("export", resource=resource, count=len(items), file=filename)
        self.send_json({
            "ok": True,
            "resource": resource,
            "count": len(items),
            "file": filename,
            "downloadUrl": f"/api/download?file={urllib.parse.quote(filename)}",
        })

    def api_import(self, dry_run=True):
        payload = self.read_json()
        resource = payload.get("resource")
        content = payload.get("content")
        key_field = payload.get("key") or "id"
        exclude_keys = payload.get("exclude") or []
        strict = bool(payload.get("strict", True))
        if isinstance(exclude_keys, str):
            exclude_keys = [x.strip() for x in exclude_keys.split(",") if x.strip()]

        if not resource:
            self.send_json({"ok": False, "error": "Missing resource."}, status=400)
            return
        if not content:
            self.send_json({"ok": False, "error": "Missing JSON content."}, status=400)
            return

        import_data = json.loads(content) if isinstance(content, str) else content
        records = parse_records(import_data)
        url = full_url(resource)

        ref_index = {}
        if key_field == "ref_id":
            ref_index = cm.build_ref_id_index(url)

        results = []
        errors = 0
        skipped = 0

        for idx, item in enumerate(records, start=1):
            if not isinstance(item, dict):
                errors += 1
                results.append({"index": idx, "ok": False, "error": "Record is not an object."})
                continue

            identifier = item.get("id") if key_field == "id" else item.get("ref_id")
            uuid = None
            if key_field == "id" and identifier:
                uuid = str(identifier)
            elif key_field == "ref_id" and identifier:
                uuid = ref_index.get(str(identifier).strip())

            method = "PATCH" if uuid else "POST"
            target = url.rstrip("/") + f"/{uuid}/" if uuid else url
            body = build_payload(item, exclude_keys=exclude_keys, resource=resource)
            diff_info = {"strict": strict, "compared": False, "removed": []}

            if strict and method == "PATCH":
                body, diff_info = strict_payload(url, uuid, body)

            if method == "PATCH" and not body:
                skipped += 1
                results.append({
                    "index": idx,
                    "ok": True,
                    "action": "SKIP",
                    "target": target,
                    "reason": "No changed field to send",
                    "diff": diff_info,
                })
                continue

            if dry_run:
                results.append({
                    "index": idx,
                    "ok": True,
                    "action": method,
                    "target": target,
                    "payload": body,
                    "diff": diff_info,
                })
                continue

            status, data = cm.api_request(method, target, data=body)
            ok = 200 <= status < 300
            if not ok:
                errors += 1
            results.append({
                "index": idx,
                "ok": ok,
                "action": method,
                "status": status,
                "response": data,
                "diff": diff_info,
            })

        log_event(
            "import_dry_run" if dry_run else "import_apply",
            resource=resource,
            count=len(records),
            errors=errors,
            skipped=skipped,
            key=key_field,
            strict=strict,
        )
        self.send_json({
            "ok": errors == 0,
            "dryRun": dry_run,
            "resource": resource,
            "count": len(records),
            "errors": errors,
            "skipped": skipped,
            "strict": strict,
            "results": results,
        }, status=200 if errors == 0 else 207)

    def api_download(self, query):
        filename = safe_file_name((query.get("file") or [""])[0])
        if not filename:
            self.send_text("Missing file", status=400)
            return
        path = (EXPORT_DIR / filename).resolve()
        if not str(path).startswith(str(EXPORT_DIR.resolve())) or not path.exists():
            self.send_text("File not found", status=404)
            return
        raw = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def main():
    parser = argparse.ArgumentParser(description="CISO Assistant API Manager Web UI")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind. Default: 127.0.0.1")
    parser.add_argument("--port", type=int, default=8080, help="Port to bind. Default: 8080")
    parser.add_argument("--no-browser", action="store_true", help="Do not open the browser automatically")
    args = parser.parse_args()

    if args.host not in ("127.0.0.1", "localhost"):
        print("[WARNING] You are not binding to localhost. This may expose the tool on the network.")

    server = ThreadingHTTPServer((args.host, args.port), CisoWebHandler)
    url = f"http://{args.host}:{args.port}"
    print(f"[OK] {APP_NAME} v{APP_VERSION} running on {url}")
    print("[INFO] Press Ctrl+C to stop.")
    log_event("server_start", host=args.host, port=args.port, baseUrl=base_url(), tokenConfigured=token_configured())

    if not args.no_browser:
        try:
            webbrowser.open(url)
        except Exception:
            pass

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[INFO] Server stopped.")
    finally:
        log_event("server_stop")
        server.server_close()


if __name__ == "__main__":
    main()
