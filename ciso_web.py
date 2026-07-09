#!/usr/bin/env python3
"""
CISO Assistant API Manager - Local Web UI

Autonomous local web interface for ciso_manager.py.
- No external web dependency
- Runs on localhost by default
- Token stays server-side
- Supports read, search/filter, export JSON and import JSON with dry-run first

Usage:
    python ciso_web.py
    python ciso_web.py --host 127.0.0.1 --port 8080
"""

import argparse
import json
import mimetypes
import os
import sys
import time
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
ROOT_DIR = Path(__file__).resolve().parent
WEB_DIR = ROOT_DIR / "web"
EXPORT_DIR = ROOT_DIR / "exports"
IMPORT_DIR = ROOT_DIR / "imports"
LOG_DIR = ROOT_DIR / "logs"

for directory in (WEB_DIR, EXPORT_DIR, IMPORT_DIR, LOG_DIR):
    directory.mkdir(exist_ok=True)


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
    """Return a full API URL from a known resource, relative path or full URL."""
    resolved = cm.resolve_endpoint(resource_or_path)
    if resolved.startswith("http://") or resolved.startswith("https://"):
        return resolved
    return base_url() + "/" + resolved.strip("/") + "/"


def parse_records(payload):
    """Accept a list, a paginated API object {results: []}, or a single object."""
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict) and isinstance(payload.get("results"), list):
        return payload["results"]
    if isinstance(payload, dict):
        return [payload]
    raise ValueError("Import content must be a JSON object, a JSON list, or an object with a results array.")


def flatten(item):
    try:
        return cm.flatten_object(item)
    except Exception:
        return item


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


def apply_local_filters(items, search=None, where_status=None):
    result = list(items)
    if where_status:
        result = [x for x in result if str(x.get("status", "")).lower() == where_status.lower()]
    if search:
        needle = search.lower()
        result = [x for x in result if needle in json.dumps(x, ensure_ascii=False).lower()]
    return result


def select_fields(items, fields):
    fields = [f.strip() for f in (fields or []) if f and f.strip()]
    if not fields:
        return items
    if "id" not in fields:
        fields.insert(0, "id")
    return [{field: item.get(field) for field in fields} for item in items]


def safe_file_name(name):
    name = os.path.basename(name or "download.json")
    allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_."
    return "".join(ch if ch in allowed else "_" for ch in name)


class CisoWebHandler(BaseHTTPRequestHandler):
    server_version = "CisoWebUI/1.0"

    def log_message(self, fmt, *args):
        # Keep console output concise but keep operational logs in logs/ciso_web.log.
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
            "baseUrl": base_url(),
            "tokenConfigured": token_configured(),
            "verifySsl": verify_ssl_enabled(),
            "hostOnly": "127.0.0.1 recommended",
        })

    def api_resources(self):
        resources = sorted(getattr(cm, "KNOWN_ENDPOINTS", {}).keys())
        self.send_json({"ok": True, "resources": resources})

    def api_data(self, query):
        resource = (query.get("resource") or [""])[0]
        if not resource:
            self.send_json({"ok": False, "error": "Missing resource parameter."}, status=400)
            return

        search = (query.get("search") or [""])[0].strip() or None
        status_filter = (query.get("status") or [""])[0].strip() or None
        fields_raw = (query.get("fields") or [""])[0]
        fields = [x.strip() for x in fields_raw.split(",") if x.strip()]
        all_pages = (query.get("all") or ["true"])[0].lower() != "false"
        page_size = (query.get("page_size") or ["100"])[0]

        url = full_url(resource)
        params = {}
        if status_filter:
            params["status"] = status_filter
        if search:
            params["search"] = search
        if page_size:
            params["page_size"] = page_size

        if all_pages:
            raw_items = cm.paginate_all(url, params=params)
            items = [flatten(x) for x in raw_items]
            count = len(items)
        else:
            status, data = cm.api_request("GET", url, params=params)
            if status >= 400:
                self.send_json({"ok": False, "status": status, "error": data}, status=502)
                return
            raw_items = data.get("results", data if isinstance(data, list) else [])
            items = [flatten(x) for x in raw_items]
            count = data.get("count", len(items)) if isinstance(data, dict) else len(items)

        items = apply_local_filters(items, search=None, where_status=None)
        items = select_fields(items, fields)
        self.send_json({"ok": True, "resource": resource, "count": count, "items": items})

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

        if status_filter:
            params["status"] = status_filter
        if search:
            params["search"] = search

        url = full_url(resource)
        raw_items = cm.paginate_all(url, params=params)
        items = [flatten(x) for x in raw_items]
        items = select_fields(items, fields)

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
        if isinstance(exclude_keys, str):
            exclude_keys = [x.strip() for x in exclude_keys.split(",") if x.strip()]

        if not resource:
            self.send_json({"ok": False, "error": "Missing resource."}, status=400)
            return
        if not content:
            self.send_json({"ok": False, "error": "Missing JSON content."}, status=400)
            return

        if isinstance(content, str):
            import_data = json.loads(content)
        else:
            import_data = content
        records = parse_records(import_data)
        url = full_url(resource)

        ref_index = {}
        if key_field == "ref_id":
            ref_index = cm.build_ref_id_index(url)

        results = []
        errors = 0

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

            if dry_run:
                results.append({
                    "index": idx,
                    "ok": True,
                    "action": method,
                    "target": target,
                    "payload": body,
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
            })

        log_event("import_dry_run" if dry_run else "import_apply", resource=resource, count=len(records), errors=errors, key=key_field)
        self.send_json({
            "ok": errors == 0,
            "dryRun": dry_run,
            "resource": resource,
            "count": len(records),
            "errors": errors,
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
    print(f"[OK] {APP_NAME} running on {url}")
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
