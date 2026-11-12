"""Package an operator-authorized ZIP and run its browser workflow inside a disposable Docker container."""
import argparse
import hashlib
import io
import json
import re
import stat
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

MAX_SOURCE = 8 * 1024 * 1024
MAX_UNPACKED = 25 * 1024 * 1024
IMAGE = "zcode-runner:1"
FIXED_DATE = (2026, 11, 12, 0, 0, 0)
SUSPECT = re.compile(rb"-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{25,}|\bAKIA[A-Z0-9]{16}|\bsk-(?:proj-)?[A-Za-z0-9_-]{25,}")
EXCLUDED = {".git", "node_modules", "__pycache__", "dist", ".wrangler", ".vercel", ".idea", ".vscode", ".github"}
UNSAFE_SUFFIXES = {".key", ".pem", ".p12", ".pfx", ".keystore"}


class Blocked(Exception):
    pass


class RetryLater(Exception):
    pass


def digest(data):
    return hashlib.sha256(data).hexdigest()


def package(data, strip_root):
    if len(data) > MAX_SOURCE:
        raise Blocked("Archive exceeds the 8 MiB source limit.")
    entries = {}
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as source:
            files = source.infolist()
            if len(files) > 1500 or sum(item.file_size for item in files) > MAX_UNPACKED:
                raise Blocked("Archive exceeds the file count or expansion limit.")
            roots = set()
            portable_names = set()
            for item in files:
                path = PurePosixPath(item.filename)
                parts = path.parts
                if item.filename.startswith("/") or not parts or ".." in parts or "\\" in item.filename or ":" in item.filename:
                    raise Blocked("Archive includes an unsafe path.")
                if any(part.rstrip(" .") != part or not re.fullmatch(r"[A-Za-z0-9 ._@+()-]{1,110}", part) or
                       part.split(".")[0].lower() in {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}
                       for part in parts):
                    raise Blocked("Archive has a file name that cannot be safely extracted on supported platforms.")
                mode = stat.S_IFMT(item.external_attr >> 16)
                if mode not in (0, stat.S_IFREG, stat.S_IFDIR) or item.flag_bits & 1:
                    raise Blocked("Symlinks, encrypted entries and special files are unsupported.")
                roots.add(parts[0])
                if item.is_dir():
                    continue
                parts = parts[1:] if strip_root else parts
                if not parts or any(part in EXCLUDED for part in parts):
                    continue
                name = "/".join(parts)
                lower = parts[-1].lower()
                if lower == ".gitmodules":
                    raise Blocked("Include required submodule content directly in the authorized source.")
                if (lower.startswith((".env", ".dev.vars")) and not lower.endswith((".example", ".sample"))) or lower in {".npmrc", ".netrc"} or PurePosixPath(lower).suffix in UNSAFE_SUFFIXES:
                    raise Blocked("Source contains private configuration or credential files. Submit a corrected release.")
                if name.casefold() == "zcode-manifest.json":
                    raise Blocked("Remove the reserved ZCODE-MANIFEST.json file before submission.")
                if name.casefold() in portable_names:
                    raise Blocked("Archive contains duplicate or case-conflicting paths.")
                content = source.read(item)
                if content.startswith(b"version https://git-lfs.github.com/spec/v1"):
                    raise Blocked("Archive has an unresolved Git LFS pointer.")
                if SUSPECT.search(content):
                    raise Blocked("A potential bundled credential was found. Submit a corrected release.")
                entries[name] = content
                portable_names.add(name.casefold())
            if strip_root and len(roots) != 1:
                raise Blocked("The GitHub archive must have one root directory.")
    except (zipfile.BadZipFile, RuntimeError, NotImplementedError) as error:
        raise Blocked("Source is not a readable ZIP archive.") from error
    for name in entries:
        parts = name.casefold().split("/")
        if any("/".join(parts[:n]) in portable_names for n in range(1, len(parts))):
            raise Blocked("A file conflicts with a directory in the archive.")
    if not {"README.md", "package.json", "package-lock.json"}.issubset(entries):
        raise Blocked("Include README.md, package.json and package-lock.json for clean setup.")
    if not any(name in entries for name in ("LICENSE", "LICENSE.txt", "LICENSE.md", "NOTICE", "THIRD_PARTY_NOTICES.md")):
        raise Blocked("Include a license or third-party notices file.")
    entries["ZCODE-MANIFEST.json"] = json.dumps(
        [{"path": name, "bytes": len(content), "sha256": digest(content)} for name, content in sorted(entries.items())],
        indent=2,
    ).encode() + b"\n"
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as target:
        for name, content in sorted(entries.items()):
            item = zipfile.ZipInfo(name, FIXED_DATE)
            item.compress_type = zipfile.ZIP_DEFLATED
            item.external_attr = 0o100644 << 16
            target.writestr(item, content)
    if len(output.getbuffer()) > MAX_SOURCE:
        raise Blocked("Packaged release exceeds the 8 MiB delivery limit.")
    return output.getvalue()


def evaluate(archive, image):
    image_id = subprocess.check_output(["docker", "image", "inspect", "--format", "{{.Id}}", image], text=True, timeout=15).strip()
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", image_id):
        raise Blocked("Could not identify the trusted runner image.")
    started = time.monotonic()
    result = {}
    name = "zcode-job-" + uuid.uuid4().hex[:14]
    with tempfile.TemporaryDirectory(prefix="zcode-job-") as tmp:
        # The final archive is the sole source used for the run.
        with zipfile.ZipFile(io.BytesIO(archive)) as source:
            source.extractall(tmp)
        command = ["docker", "run", "--rm", "--name", name, "--network", "none", "--read-only",
                   "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "150",
                   "--memory", "800m", "--cpus", "1.5", "--shm-size", "64m", "--ulimit", "nofile=1024:1024",
                   "--tmpfs", "/tmp:rw,nosuid,nodev,size=256m,mode=1777",
                   "--mount", f"type=bind,src={tmp},dst=/source,readonly", image_id]
        try:
            job = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=60, check=False)
            if job.returncode == 0 and len(job.stdout) < 1000:
                result = json.loads(job.stdout)
        except (subprocess.TimeoutExpired, json.JSONDecodeError):
            pass
        finally:
            subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=12, check=False)
    core = result.get("observed") is True and result.get("phase") == "complete"
    phase = result.get("phase")
    if core:
        observations = {
            "local": ("pass", "Installed the delivered ZIP with npm ci and started its localhost server in a clean container."),
            "offline": ("pass", "Completed setup and gameplay with container networking disabled."),
            "no-paid-api": ("pass", "The tested install and gameplay completed with no network access or API credentials."),
            "keyboard": ("pass", "Used Enter and Arrow Right to collect three acorns and complete the trail."),
            "browser": ("pass", "Chromium rendered the game and observed its trail completion state."),
        }
    else:
        status = "fail" if phase in {"install", "startup", "play"} else "inconclusive"
        notes = {"install": "Offline clean install failed. Include every required dependency or supply an approved cache.",
                 "startup": "The documented start command did not open localhost port 4173.",
                 "play": "The browser did not observe the expected transition after keyboard input."}
        observations = {"local": (status, notes.get(phase, "The isolated browser probe could not complete."))}
    observations.update({
        "multiplayer": ("untested", "The runner exercised one browser session."),
        "persistence": ("untested", "The runner did not test saves or reloads."),
        "mobile": ("untested", "The clean install probe used desktop Chromium and keyboard input."),
    })
    release_digest = digest(archive)
    return {"adapter": "node-browser-trail/1", "environment": f"Linux Docker · {result.get('runtime', 'Node')} · Chromium {result.get('chromium') or 'unavailable'} · {image_id}",
            "checkedAt": datetime.now(timezone.utc).isoformat(), "elapsedMs": round((time.monotonic() - started) * 1000),
            "digest": release_digest, "corePassed": core,
            "findings": [{"id": "ev-" + release_digest[:12] + "-" + key, "capability": key, "status": value[0], "observation": value[1]}
                         for key, value in observations.items()]}


def local_sample(args):
    source = Path(args.source).resolve()
    files = io.BytesIO()
    with zipfile.ZipFile(files, "w", zipfile.ZIP_DEFLATED) as incoming:
        for path in sorted(source.rglob("*")):
            if path.is_file() and not path.is_symlink() and not EXCLUDED.intersection(path.relative_to(source).parts):
                incoming.write(path, path.relative_to(source).as_posix())
    archive = package(files.getvalue(), False)
    report = evaluate(archive, args.image)
    Path(args.output).mkdir(parents=True, exist_ok=True)
    (Path(args.output) / "acorn-trail.zip").write_bytes(archive)
    (Path(args.output) / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"corePassed": report["corePassed"], "digest": report["digest"], "elapsedMs": report["elapsedMs"]}))
    return 0 if report["corePassed"] else 1


def process(args):
    import os
    token = os.environ.get("ZCODE_RUNNER_TOKEN", "")
    origin = urllib.parse.urlparse(args.origin)
    if len(token) < 32 or (origin.scheme != "https" and origin.hostname not in {"127.0.0.1", "localhost"}):
        raise SystemExit("Use an HTTPS Pages origin and set ZCODE_RUNNER_TOKEN in the operator environment.")
    if not args.repo:
        raise SystemExit("Specify the numeric GitHub repository ID you reviewed and explicitly authorize.")
    api = args.origin.rstrip("/") + "/api/operator"

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    opener = urllib.request.build_opener(NoRedirect())

    def request(path, payload=None, method="POST", extra=None, cap=MAX_SOURCE):
        headers = {"Authorization": "Bearer " + token, "User-Agent": "Zcode-Verification-Runner/1.0", **(extra or {})}
        if isinstance(payload, dict):
            headers["Content-Type"] = "application/json"
            payload = json.dumps(payload).encode()
        try:
            with opener.open(urllib.request.Request(api + path, payload, headers, method=method), timeout=35) as response:
                data = response.read(cap + 1)
        except urllib.error.HTTPError as error:
            if error.code in (429, 500, 502, 503, 504):
                raise RetryLater(f"Verification will retry after a temporary HTTP {error.code} response.") from error
            raise Blocked(f"Operator endpoint returned HTTP {error.code}.") from error
        if len(data) > cap:
            raise Blocked("Source exceeds the configured byte limit.")
        return data

    job = json.loads(request("/jobs/claim", {"repoId": args.repo}))
    if not job.get("id"):
        print("No authorized verification job is ready.")
        return 0
    path = "/jobs/" + job["id"]
    headers = {"X-Lease-Id": job["lease"]}
    try:
        raw = request(path + "/source", method="GET", extra=headers)
        archive = package(raw, True)
        report = evaluate(archive, args.image)
        request(path + "/artifact", archive, "PUT", {**headers, "Content-Type": "application/zip", "X-Archive-Sha256": report["digest"]})
        request(path + "/complete", {"report": report}, extra=headers)
    except Blocked as error:
        request(path + "/complete", {"blocked": str(error)}, extra=headers)
    print("Recorded verification outcome.")
    return 0


if __name__ == "__main__":
    cli = argparse.ArgumentParser()
    cli.add_argument("--image", default=IMAGE)
    action = cli.add_subparsers(dest="command", required=True)
    sample = action.add_parser("sample")
    sample.add_argument("--source", default="samples/acorn-trail")
    sample.add_argument("--output", default=".local/sample")
    job = action.add_parser("job")
    job.add_argument("--origin", required=True)
    job.add_argument("--repo", type=int, required=True)
    options = cli.parse_args()
    try:
        raise SystemExit(local_sample(options) if options.command == "sample" else process(options))
    except RetryLater as error:
        print(error)
        raise SystemExit(75) from None
