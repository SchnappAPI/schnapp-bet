#!/usr/bin/env python3
"""Failover snapshot freshness alert: read manifest.json from the R2 bucket
and iMessage the owner when the snapshot heartbeat is stale.

The snapshot pusher (snapshot_push.py, every 30 min) uploads manifest.json
on every successful crawl, so its generated_at is a heartbeat. If the
LaunchAgent silently dies, the edge fallback keeps serving increasingly
stale data with only the banner timestamp as a tell; this check runs hourly
on the same Mac and alerts when the heartbeat is older than STALE_AFTER.
Running locally is the "Mac is up" precondition for free: a dead Mac cannot
run the check, and in that state the fallback being stale is expected.

Stdlib only. Auth: wrangler OAuth (shared with snapshot_push.py).
The recipient handle arrives via ALERT_IMESSAGE_TO, resolved by op-wrap from
services/failover/.env.template (never hardcoded; this repo is public).

Usage:
  python3 freshness_check.py          # check + alert if stale
  python3 freshness_check.py --test   # send a test alert and exit
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

BUCKET = "schnapp-bet-failover"
WORKER_DIR = Path(__file__).resolve().parent / "worker"  # wrangler.toml lives here
STATE_FILE = Path.home() / ".schnapp-failover-freshness.json"

STALE_AFTER = timedelta(hours=2)  # 4 missed 30-min push cycles
REALERT_EVERY = timedelta(hours=6)  # while the condition persists
FETCH_FAILURES_BEFORE_ALERT = 2  # skip one-off wrangler/network blips

SEND_SCRIPT = """
on run argv
    tell application "Messages"
        set svc to 1st account whose service type = iMessage
        send (item 2 of argv) to participant (item 1 of argv) of svc
    end tell
end run
"""


def fetch_manifest() -> dict | None:
    tmp = Path("/tmp") / f"sb-failover-manifest-{os.getpid()}.json"
    try:
        subprocess.run(
            [
                "npx",
                "--yes",
                "wrangler",
                "r2",
                "object",
                "get",
                f"{BUCKET}/manifest.json",
                "--file",
                str(tmp),
                "--remote",
            ],
            cwd=WORKER_DIR,
            check=True,
            capture_output=True,
            text=True,
            timeout=120,
        )
        return json.loads(tmp.read_text())
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        stderr = getattr(exc, "stderr", "") or ""
        print(f"manifest fetch failed: {stderr.strip() or exc}", file=sys.stderr)
        return None
    except (json.JSONDecodeError, OSError) as exc:
        print(f"manifest unreadable: {exc}", file=sys.stderr)
        return None
    finally:
        tmp.unlink(missing_ok=True)


def send_imessage(handle: str, text: str) -> None:
    subprocess.run(
        ["osascript", "-e", SEND_SCRIPT, handle, text],
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )


def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text())
    except (OSError, json.JSONDecodeError):
        return {}


def main() -> int:
    handle = os.environ.get("ALERT_IMESSAGE_TO")
    if not handle:
        print(
            "ALERT_IMESSAGE_TO not set; run via op-wrap / op run (see services/failover/.env.template)",
            file=sys.stderr,
        )
        return 1

    if "--test" in sys.argv:
        send_imessage(handle, "schnapp.bet failover: test alert (freshness_check.py --test)")
        print("test alert sent")
        return 0

    state = load_state()
    now = datetime.now(timezone.utc)

    problem: str | None = None
    manifest = fetch_manifest()
    if manifest is None:
        failures = state.get("consecutive_fetch_failures", 0) + 1
        state["consecutive_fetch_failures"] = failures
        if failures >= FETCH_FAILURES_BEFORE_ALERT:
            problem = f"cannot read R2 manifest.json ({failures} consecutive failures)"
    else:
        state["consecutive_fetch_failures"] = 0
        try:
            generated = datetime.fromisoformat(manifest["generated_at"])
            age = now - generated
            print(f"snapshot age {age}, generated_at {manifest['generated_at']}")
            if age > STALE_AFTER:
                hours = age.total_seconds() / 3600
                problem = (
                    f"snapshot is {hours:.1f}h stale (generated_at "
                    f"{manifest['generated_at']}); check the "
                    "bet.schnapp.failover-snapshot LaunchAgent"
                )
        except (KeyError, ValueError) as exc:
            problem = f"manifest.json has no parseable generated_at ({exc})"

    if problem:
        last = state.get("last_alert_at")
        due = last is None or now - datetime.fromisoformat(last) >= REALERT_EVERY
        if due:
            send_imessage(handle, f"schnapp.bet failover: {problem}")
            state["last_alert_at"] = now.isoformat()
            print(f"alert sent: {problem}")
        else:
            print(f"still failing, alert throttled: {problem}")
        state["alerting"] = True
    else:
        if state.get("alerting"):
            send_imessage(handle, "schnapp.bet failover: snapshot fresh again")
            print("recovery alert sent")
        state["alerting"] = False
        state["last_alert_at"] = None

    STATE_FILE.write_text(json.dumps(state))
    return 1 if problem else 0


if __name__ == "__main__":
    sys.exit(main())
