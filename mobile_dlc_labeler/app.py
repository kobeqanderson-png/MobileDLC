"""Touch-first single-animal DLC annotation editor. Run: python app.py PROJECT_DIR."""

import argparse
import errno
import io
import json
import math
import re
import secrets
import socket
import sqlite3
import sys
import threading
import webbrowser
from datetime import datetime, timezone
from html import escape
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlsplit

import pandas as pd
import yaml
from PIL import Image


SIMBA7 = ["Ear_left", "Ear_right", "Nose", "Center", "Lateral_left", "Lateral_right", "Tail_base"]
FOCUS7 = ["nose", "left_ear", "right_ear", "spine_mid", "left_hip", "right_hip", "tail_base"]
FOCUS7_NAMES = {"nose": "Nose", "left_ear": "Left ear", "right_ear": "Right ear",
                "spine_mid": "Mid spine", "left_hip": "Left lateral", "right_hip": "Right lateral",
                "tail_base": "Tail base"}
IMAGES = {".png", ".jpg", ".jpeg", ".tif", ".tiff"}
ROOT = Path(__file__).resolve().parent
APP_VERSION = "1.3"
LAUNCHER_CONFIG = ROOT / ".mobile-dlc-launcher.json"


def lan_addresses():
    """Prefer the address used for outbound traffic, then offer other local interfaces."""
    addresses = []
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("1.1.1.1", 80))
            addresses.append(sock.getsockname()[0])
    except OSError:
        pass
    try:
        addresses.extend(info[4][0] for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET))
    except OSError:
        pass
    return list(dict.fromkeys(addr for addr in addresses if addr and not addr.startswith("127.") and addr != "0.0.0.0"))


def default_project():
    if LAUNCHER_CONFIG.exists():
        try:
            path = Path(json.loads(LAUNCHER_CONFIG.read_text())["project"])
            if (path / "config.yaml").is_file():
                return path
        except (OSError, ValueError, KeyError, TypeError):
            pass
    return ROOT / "real_pilot"


def access_token(project):
    """Keep a project's private phone link valid when the server restarts."""
    path = project.state_dir / f"access-token-{project.schema}.txt"
    try:
        existing = path.read_text().strip()
        if re.fullmatch(r"[A-Za-z0-9_-]{32,128}", existing):
            return existing
    except OSError:
        pass
    token = secrets.token_urlsafe(32)
    path.write_text(token + "\n")
    path.chmod(0o600)
    return token


def image_key(folder, name):
    return f"labeled-data/{folder}/{name}"


def natural_name(path):
    return tuple((1, int(token)) if token.isdigit() else (0, token.casefold())
                 for token in re.split(r"(\d+)", path.name))


def read_labels(path):
    if not path.exists():
        return {}
    df = pd.read_hdf(path)
    if not isinstance(df.columns, pd.MultiIndex) or df.columns.nlevels != 3:
        raise ValueError(f"Unsupported annotation columns in {path}")
    result = {}
    for index, row in df.iterrows():
        key = "/".join(map(str, index)) if isinstance(index, tuple) else str(index).replace("\\", "/").lstrip("/")
        result[key] = {}
        for scorer, part, coord in df.columns:
            if coord != "x" or part in result[key]:
                continue
            x, y = row[(scorer, part, "x")], row[(scorer, part, "y")]
            if pd.notna(x) and pd.notna(y):
                result[key][part] = [float(x), float(y)]
    return result


class Project:
    def __init__(self, root, schema, state_dir=None):
        self.root = Path(root).resolve()
        self.config = yaml.safe_load((self.root / "config.yaml").read_text())
        if self.config.get("multianimalproject"):
            raise ValueError("This version supports single-animal DLC projects only")
        self.scorer = self.config["scorer"]
        self.individuals = list(self.config.get("individuals") or ["animal"])
        self.project_parts = list(self.config["bodyparts"])
        self.parts = SIMBA7 if schema == "simba7" else FOCUS7 if schema == "focus7" else self.project_parts
        self.display_names = {part: FOCUS7_NAMES.get(part, part.replace("_", " ")) for part in self.parts} if schema == "focus7" else {part: part.replace("_", " ") for part in self.parts}
        if len(set(self.parts)) != len(self.parts):
            raise ValueError("Duplicate bodypart names in config")
        self.schema = schema
        self.compatible = set(self.parts).issubset(set(self.project_parts))
        self.demo = (self.root / "DEMO_PREVIEW_ONLY").exists()
        self.frames = []
        self.original = {}
        self.sources = {}
        base = self.root / "labeled-data"
        if not base.is_dir():
            raise ValueError("Missing labeled-data folder")
        for folder in sorted((p for p in base.iterdir() if p.is_dir()), key=natural_name):
            images = sorted((p for p in folder.iterdir() if p.suffix.lower() in IMAGES), key=lambda p: p.name)
            source = folder / f"CollectedData_{self.scorer}.h5"
            if source.exists():
                self.original.update(read_labels(source))
                self.sources[folder.name] = source
            for img in images:
                key = image_key(folder.name, img.name)
                with Image.open(img) as im:
                    width, height = im.size
                self.frames.append({"key": key, "folder": folder.name, "name": img.name,
                                    "width": width, "height": height})
        if not self.frames:
            raise ValueError("No extracted images under labeled-data/<video>/")
        self.by_key = {f["key"]: f for f in self.frames}
        if state_dir is None:
            state_dir = self.root / ".mobile-dlc-labeler"
        self.state_dir = Path(state_dir).resolve()
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.state_dir / f"annotations-{schema}.sqlite3", check_same_thread=False)
        self.db.execute("CREATE TABLE IF NOT EXISTS edits (frame TEXT, part TEXT, x REAL, y REAL, updated_at TEXT, PRIMARY KEY(frame, part))")
        self.db.execute("CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY, frame TEXT, part TEXT, old_x REAL, old_y REAL, x REAL, y REAL, updated_at TEXT)")
        self.db.commit()
        self.lock = threading.RLock()
        self.start_index = 0
        for i, frame in enumerate(self.frames):
            if any(point is None for point in self.points(frame["key"]).values()):
                self.start_index = i
                break

    def points(self, key):
        points = {p: self.original.get(key, {}).get(p) for p in self.parts}
        with self.lock:
            edits = self.db.execute("SELECT part,x,y FROM edits WHERE frame=?", (key,)).fetchall()
        for part, x, y in edits:
            if part in points:
                points[part] = None if x is None else [x, y]
        return points

    def change(self, key, changes):
        if key not in self.by_key or not isinstance(changes, dict) or not changes:
            raise ValueError("Invalid frame or empty change set")
        frame = self.by_key[key]
        for part, value in changes.items():
            if part not in self.parts:
                raise ValueError(f"Unknown bodypart: {part}")
            if value is not None and (not isinstance(value, list) or len(value) != 2 or
                                      not all(isinstance(n, (int, float)) and not isinstance(n, bool) and math.isfinite(n) for n in value) or
                                      not (0 <= value[0] < frame["width"] and 0 <= value[1] < frame["height"])):
                raise ValueError(f"Point outside image or invalid coordinates: {part}")
        with self.lock, self.db:
            old = self.points(key)
            now = datetime.now(timezone.utc).isoformat()
            for part, value in changes.items():
                x, y = value if value is not None else (None, None)
                ox, oy = old[part] if old[part] is not None else (None, None)
                self.db.execute("INSERT INTO edits VALUES (?,?,?,?,?) ON CONFLICT(frame,part) DO UPDATE SET x=excluded.x,y=excluded.y,updated_at=excluded.updated_at", (key, part, x, y, now))
                self.db.execute("INSERT INTO history(frame,part,old_x,old_y,x,y,updated_at) VALUES (?,?,?,?,?,?,?)", (key, part, ox, oy, x, y, now))
        return self.points(key)

    def export(self):
        if self.demo:
            raise ValueError("Preview images have baked-in dots; export is disabled. Use original extracted frames.")
        if not self.compatible:
            raise ValueError("The selected points are absent from config.yaml. Export requires matching DLC bodyparts.")
        output = self.state_dir / "export" / "labeled-data"
        written = []
        with self.lock:
            for folder in sorted({f["folder"] for f in self.frames}):
                keys = [f["key"] for f in self.frames if f["folder"] == folder]
                source = self.sources.get(folder)
                if source:
                    df = pd.read_hdf(source).copy()
                    expected = [(self.scorer, p, c) for p in self.parts for c in ("x", "y")]
                    if not set(expected).issubset(set(df.columns.tolist())):
                        raise ValueError(f"Unexpected H5 columns in {source}; export stopped")
                else:
                    cols = pd.MultiIndex.from_product([[self.scorer], self.project_parts, ["x", "y"]], names=["scorer", "bodyparts", "coords"])
                    df = pd.DataFrame(columns=cols, dtype=float)
                edited = [key for key in keys if self.db.execute("SELECT 1 FROM edits WHERE frame=? LIMIT 1", (key,)).fetchone()]
                if not edited:
                    continue
                for key in edited:
                    row_key = tuple(key.split("/", 2)) if isinstance(df.index, pd.MultiIndex) else key
                    if row_key not in df.index:
                        index = pd.MultiIndex.from_tuples([row_key], names=df.index.names) if isinstance(df.index, pd.MultiIndex) else pd.Index([row_key], name=df.index.name)
                        df = pd.concat([df, pd.DataFrame(index=index, columns=df.columns, dtype=float)])
                    for part, x, y in self.db.execute("SELECT part,x,y FROM edits WHERE frame=?", (key,)):
                        if part not in self.parts:
                            continue
                        df.at[row_key, (self.scorer, part, "x")] = float("nan") if x is None else x
                        df.at[row_key, (self.scorer, part, "y")] = float("nan") if y is None else y
                dest = output / folder
                dest.mkdir(parents=True, exist_ok=True)
                h5 = dest / f"CollectedData_{self.scorer}.h5"
                tmp = dest / f"CollectedData_{self.scorer}.tmp.h5"
                df.to_hdf(tmp, key="df_with_missing", mode="w")
                tmp.replace(h5)
                df.to_csv(dest / f"CollectedData_{self.scorer}.csv")
                written.append({"folder": folder, "frames_edited": len(edited), "h5": str(h5), "csv": str(dest / f"CollectedData_{self.scorer}.csv")})
        if not written:
            raise ValueError("No edits yet")
        return written


def make_handler(project, token, phone_url=None, local_url=None, other_urls=()):
    import qrcode

    phone_url = phone_url or f"http://127.0.0.1:8765/?token={quote(token)}"
    local_url = local_url or phone_url
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=8, border=3)
    qr.add_data(phone_url)
    qr.make(fit=True)
    image = qr.make_image(fill_color="#102e34", back_color="white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    qr_png = buffer.getvalue()
    links = "".join(f'<li><a href="{escape(url, quote=True)}">{escape(url)}</a></li>' for url in other_urls)
    launch_html = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Start labeling</title>
<style>body{{background:#101823;color:#f3f6f8;font:18px system-ui,sans-serif;margin:0;padding:30px}}
main{{max-width:650px;margin:auto}}h1{{font-size:29px}}p{{line-height:1.5;color:#bfd0d7}}
img{{display:block;width:min(320px,100%);background:white;border-radius:16px;padding:8px;margin:20px 0}}
a{{color:#97f2d2;overflow-wrap:anywhere}}.button{{display:inline-block;background:#287369;color:white;
padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:bold}}
.card{{border:1px solid #415466;border-radius:16px;background:#182430;padding:20px}}
</style></head><body><main><h1>Label your frames</h1><div class="card">
<p><strong>{escape(project.root.name)}</strong> · {len(project.frames)} frames across {len({f['folder'] for f in project.frames})} Test folders · {len(project.parts)} body points · Labeler {APP_VERSION}</p>
<p>Keep this laptop and your phone on the same Wi-Fi. Scan this QR code with your phone's camera.</p>
<img src="/api/qr?token={quote(token)}" alt="QR code to open the project on your phone">
<p><a href="{escape(phone_url, quote=True)}">{escape(phone_url)}</a></p>
<p><a class="button" href="{escape(local_url, quote=True)}">Open editor on this laptop</a></p>
<p>The QR code opens the whole project. Previous and Next move across all extracted frames.</p>
{"<details><summary>Other local addresses</summary><ul>" + links + "</ul></details>" if links else ""}
</div></main></body></html>""".encode("utf-8")

    class Handler(BaseHTTPRequestHandler):
        def reply(self, code, data):
            blob = json.dumps(data, allow_nan=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(blob)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(blob)

        def do_GET(self):
            url = urlsplit(self.path)
            valid = parse_qs(url.query).get("token", [""])[0] == token
            if url.path not in ("/app.js", "/style.css") and not valid:
                if url.path in ("/", "/launch") and self.client_address[0] in ("127.0.0.1", "::1"):
                    self.send_response(HTTPStatus.FOUND)
                    self.send_header("Location", f"/launch?token={quote(token)}")
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    return
                if url.path in ("/", "/launch"):
                    blob = ("<!doctype html><html><meta name='viewport' content='width=device-width,initial-scale=1'>"
                            "<title>Open a new QR code</title><body style='font:18px system-ui;padding:24px'>"
                            "<h1>This labeling link has expired</h1><p>On the laptop, run Start_Labeler.bat "
                            "and scan the QR code on its launch screen again.</p></body></html>").encode()
                    self.send_response(HTTPStatus.FORBIDDEN)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Content-Length", str(len(blob)))
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    self.wfile.write(blob)
                    return
                return self.reply(HTTPStatus.FORBIDDEN, {"error": "Invalid access token"})
            if url.path == "/launch":
                blob = launch_html
                mime = "text/html; charset=utf-8"
            elif url.path == "/api/qr":
                blob = qr_png
                mime = "image/png"
            elif url.path == "/":
                blob = (ROOT / "static" / "index.html").read_bytes()
                mime = "text/html; charset=utf-8"
            elif url.path == "/app.js":
                blob = (ROOT / "static" / "app.js").read_bytes()
                mime = "text/javascript; charset=utf-8"
            elif url.path == "/style.css":
                blob = (ROOT / "static" / "style.css").read_bytes()
                mime = "text/css; charset=utf-8"
            elif url.path == "/api/project":
                return self.reply(200, {"scorer": project.scorer, "schema": project.schema,
                                        "project_name": project.root.name,
                                        "individuals": project.individuals,
                                        "bodyparts": project.parts, "display_names": project.display_names,
                                        "config_bodyparts": project.project_parts,
                                        "compatible": project.compatible, "demo": project.demo,
                                        "frames": project.frames, "start_index": project.start_index})
            elif url.path == "/api/frame":
                key = parse_qs(url.query).get("key", [""])[0]
                if key not in project.by_key:
                    return self.reply(404, {"error": "Unknown frame"})
                return self.reply(200, {"points": project.points(key)})
            elif url.path == "/api/image":
                key = parse_qs(url.query).get("key", [""])[0]
                if key not in project.by_key:
                    return self.reply(404, {"error": "Unknown image"})
                blob = (project.root / key).read_bytes()
                mime = "image/png" if key.lower().endswith(".png") else "image/jpeg" if key.lower().endswith((".jpg", ".jpeg")) else "image/tiff"
            else:
                return self.reply(404, {"error": "Not found"})
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(blob)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(blob)

        def do_POST(self):
            url = urlsplit(self.path)
            if parse_qs(url.query).get("token", [""])[0] != token:
                return self.reply(403, {"error": "Invalid access token"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length > 65536 or length < 0:
                    raise ValueError("Request too large")
                data = json.loads(self.rfile.read(length)) if length else {}
                if url.path == "/api/edit":
                    return self.reply(200, {"points": project.change(data.get("key"), data.get("changes"))})
                if url.path == "/api/export":
                    return self.reply(200, {"written": project.export()})
                return self.reply(404, {"error": "Not found"})
            except (ValueError, TypeError, KeyError) as exc:
                return self.reply(400, {"error": str(exc)})

    return Handler


class LabelerHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = False

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", nargs="?", type=Path, help="DLC project folder; defaults to the last opened project or bundled real_pilot")
    parser.add_argument("--schema", choices=["simba7", "focus7", "project"], default="focus7")
    parser.add_argument("--state-dir", type=Path, help="Annotation journal and export folder (defaults inside project)")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--no-browser", action="store_true", help="Print launch URL without opening it")
    args = parser.parse_args()
    project = Project(args.project or default_project(), args.schema, args.state_dir)
    if args.project and not project.demo:
        LAUNCHER_CONFIG.write_text(json.dumps({"project": str(project.root)}, indent=2) + "\n")
    token = access_token(project)
    server = None
    ports = [0] if args.port == 0 else range(args.port, args.port + 10)
    for candidate in ports:
        try:
            server = LabelerHTTPServer((args.host, candidate), BaseHTTPRequestHandler)
            break
        except OSError as exc:
            if exc.errno not in (errno.EADDRINUSE, errno.EACCES) or candidate == ports[-1]:
                print(f"Could not start on port {candidate}: {exc}", file=sys.stderr)
                raise SystemExit(1) from None
    if args.port != 0 and server.server_port != args.port:
        print(f"Port {args.port} is in use (possibly by an older labeler). This run uses port {server.server_port}. Use the new browser tab and its QR code.", flush=True)
    port = server.server_port
    addresses = lan_addresses() if args.host == "0.0.0.0" else [args.host]
    phone_address = addresses[0] if addresses else "127.0.0.1"
    phone_url = f"http://{phone_address}:{port}/?token={quote(token)}"
    local_url = f"http://127.0.0.1:{port}/?token={quote(token)}"
    launch_url = f"http://127.0.0.1:{port}/launch?token={quote(token)}"
    other_urls = [f"http://{address}:{port}/?token={quote(token)}" for address in addresses[1:]]
    server.RequestHandlerClass = make_handler(project, token, phone_url, local_url, other_urls)
    print(f"Mobile DLC Labeler {APP_VERSION}: loaded {len(project.frames)} extracted images; {len(project.parts)} bodyparts ({args.schema}).", flush=True)
    print(f"Launch screen on laptop: {launch_url}", flush=True)
    print(f"Phone URL (same Wi-Fi): {phone_url}", flush=True)
    if not addresses:
        print("No laptop Wi-Fi address found. Connect to Wi-Fi, then restart for a phone QR code.", flush=True)
    print("Original H5 files are read only. Exports go under", project.state_dir / "export", flush=True)
    if not args.no_browser:
        browser_timer = threading.Timer(0.5, lambda: webbrowser.open(launch_url))
        browser_timer.daemon = True
        browser_timer.start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
