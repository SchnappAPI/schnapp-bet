#!/usr/bin/env python3
"""Failover snapshot push: crawl the local prod site and push a static
read-only copy to Cloudflare R2 so the schnapp-failover Worker can serve
it when the Mac (tunnel origin) is unreachable.

Push, not pull: a dead Mac cannot be polled, so this job runs on a
LaunchAgent interval and uploads only content whose hash changed since
the last successful push. The manifest (with the snapshot timestamp the
Worker shows in its banner) is uploaded last so a half-finished push
never advances the visible "data as of" time. It uploads on every
successful crawl, changed content or not, so its generated_at doubles as
the heartbeat freshness_check.py alerts on.

Stdlib only. Auth: wrangler OAuth (`npx wrangler login`, one-time).

Usage:
  python3 snapshot_push.py            # crawl + push changed objects
  python3 snapshot_push.py --dry-run  # crawl only, report what would push
"""

from __future__ import annotations

import fcntl
import hashlib
import json
import mimetypes
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

BASE = "http://127.0.0.1:3001"
BUCKET = "schnapp-bet-failover"
WORKER_DIR = Path(__file__).resolve().parent / "worker"  # wrangler.toml lives here
STATE_FILE = Path.home() / ".schnapp-failover-state.json"
FETCH_TIMEOUT = 20
MAX_PAGES = 150
CRAWL_DEPTH = 2

SEED_PAGES = [
    "/",
    "/nba",
    "/nba/grades",
    "/mlb",
    "/mlb/research",
    "/mlb/grades",
    "/mlb/props",
    "/mlb/live",
    "/mlb/streaks",
    "/mlb/transparency",
    "/nfl",
    "/transparency",
    "/qb",
]

# Paths never worth snapshotting (admin/auth/live-refresh surfaces).
EXCLUDE_RE = re.compile(r"^/(admin|api|fish|_next/image)([/?]|$)")

ATTR_URL_RE = re.compile(r'(?:href|src)="(/[^"#]+)"')
CSS_URL_RE = re.compile(r'url\(\s*[\'"]?(/[^\'")]+)[\'"]?\s*\)')
ASSET_EXT_RE = re.compile(
    r"\.(css|js|mjs|json|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|txt|map|webmanifest)$",
    re.I,
)


def api_urls() -> list[str]:
    """Slate-level API GETs for today (ET), matching the exact URLs the
    client components request so SWR cache keys line up during an outage.
    Per-game and per-player endpoints are deliberately skipped: unbounded
    fan-out for detail pages the read-only mode does not promise."""
    d = datetime.now(ZoneInfo("America/New_York")).date().isoformat()
    return [
        "/api/scoreboard",
        f"/api/grades?date={d}",
        "/api/live-props",
        f"/api/mlb-games?date={d}",
        f"/api/mlb-props?date={d}",
        f"/api/mlb-streaks?date={d}",
        "/api/mlb-live-status",
        "/api/mlb-transparency",
        "/api/tier-accuracy-daily",
        f"/api/mlb/research/slate?date={d}",
        f"/api/mlb/research/leaders?date={d}",
    ]


def fetch(url_path: str) -> tuple[bytes, str] | None:
    req = urllib.request.Request(BASE + url_path, headers={"User-Agent": "schnapp-failover-snapshot"})
    try:
        with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as resp:
            if resp.status != 200:
                return None
            ct = resp.headers.get("Content-Type", "").split(";")[0].strip()
            return resp.read(), ct or guess_type(url_path)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        print(f"  fetch failed {url_path}: {exc}", file=sys.stderr)
        return None


def guess_type(path: str) -> str:
    ct, _ = mimetypes.guess_type(path.split("?")[0])
    return ct or "application/octet-stream"


def key_for(url_path: str) -> str:
    """R2 object key. Pages/assets: pathname without leading slash
    ("/" -> "index.html"). API URLs keep their query string so the Worker
    can exact-match the client's request URL."""
    if url_path.startswith("/api/"):
        return url_path.lstrip("/")
    path = url_path.split("?")[0].lstrip("/")
    return path or "index.html"


def crawl() -> dict[str, tuple[bytes, str]]:
    """Returns {r2_key: (content_bytes, content_type)}."""
    objects: dict[str, tuple[bytes, str]] = {}
    seen_pages: set[str] = set()
    asset_queue: set[str] = set()
    frontier = [(p, 0) for p in SEED_PAGES]

    while frontier and len(seen_pages) < MAX_PAGES:
        path, depth = frontier.pop(0)
        if path in seen_pages or EXCLUDE_RE.search(path):
            continue
        seen_pages.add(path)
        got = fetch(path)
        if not got:
            continue
        body, ct = got
        objects[key_for(path)] = (body, ct)
        if "html" not in ct:
            continue
        html = body.decode("utf-8", errors="replace")
        for ref in ATTR_URL_RE.findall(html):
            if EXCLUDE_RE.search(ref):
                continue
            if ASSET_EXT_RE.search(ref.split("?")[0]):
                asset_queue.add(ref)
            elif ref.startswith("/_next/"):
                asset_queue.add(ref)
            elif depth < CRAWL_DEPTH:
                frontier.append((ref.split("?")[0], depth + 1))

    for path in sorted(asset_queue):
        key = key_for(path)
        if key in objects:
            continue
        got = fetch(path)
        if not got:
            continue
        body, ct = got
        objects[key] = (body, ct)
        # Fonts and images referenced from stylesheets.
        if "css" in ct:
            for ref in CSS_URL_RE.findall(body.decode("utf-8", errors="replace")):
                k2 = key_for(ref)
                if k2 not in objects and not EXCLUDE_RE.search(ref):
                    got2 = fetch(ref)
                    if got2:
                        objects[k2] = got2

    for url in api_urls():
        got = fetch(url)
        if got:
            objects[key_for(url)] = got

    return objects


def wrangler_put(key: str, body: bytes, content_type: str) -> None:
    tmp = Path("/tmp") / f"sb-failover-{os.getpid()}.bin"
    tmp.write_bytes(body)
    try:
        subprocess.run(
            [
                "npx",
                "--yes",
                "wrangler",
                "r2",
                "object",
                "put",
                f"{BUCKET}/{key}",
                "--file",
                str(tmp),
                "--content-type",
                content_type,
                "--remote",
            ],
            cwd=WORKER_DIR,
            check=True,
            capture_output=True,
            text=True,
            timeout=120,
        )
    finally:
        tmp.unlink(missing_ok=True)


def main() -> int:
    dry_run = "--dry-run" in sys.argv
    STATE_FILE.touch(exist_ok=True)
    with open(STATE_FILE, "r+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("another snapshot push is running; exiting")
            return 0

        raw = lock.read().strip()
        state: dict[str, str] = json.loads(raw) if raw else {}

        t0 = time.time()
        objects = crawl()
        print(f"crawled {len(objects)} objects in {time.time() - t0:.1f}s")
        if not objects.get("index.html"):
            print("crawl produced no homepage; refusing to push", file=sys.stderr)
            return 1

        changed = []
        for key, (body, ct) in sorted(objects.items()):
            digest = hashlib.sha256(body).hexdigest()
            if state.get(key) != digest:
                changed.append((key, body, ct, digest))
        print(f"{len(changed)} changed since last push")

        if dry_run:
            for key, _, ct, _ in changed:
                print(f"  would push {key} ({ct})")
            return 0

        # No early return when nothing changed: the manifest still goes up
        # (for-else below) so generated_at is a heartbeat freshness_check.py
        # can alert on. Semantics hold: the crawl just verified the snapshot
        # is current as of now.
        pushed = 0
        for key, body, ct, digest in changed:
            try:
                wrangler_put(key, body, ct)
            except subprocess.CalledProcessError as exc:
                print(f"push failed {key}: {exc.stderr}", file=sys.stderr)
                break  # keep manifest un-advanced; retry next interval
            state[key] = digest
            pushed += 1
        else:
            manifest = json.dumps(
                {
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                    "object_count": len(objects),
                }
            ).encode()
            wrangler_put("manifest.json", manifest, "application/json")
            print(f"pushed {pushed} objects + manifest")

        lock.seek(0)
        lock.truncate()
        lock.write(json.dumps(state))
        return 0 if pushed == len(changed) else 1


if __name__ == "__main__":
    sys.exit(main())
