# services/flask/

Flask service providing live NBA CDN data to the web tier. Runs as launchd agent `bet.schnapp.flask` on Schnapps-MBP. Public at `https://mac-flask.schnapp.bet`.

Invariants and rules live in `.claude/rules/flask.md` (auto-loaded when editing files under `services/flask/`). For routes, restart procedure, and ops detail, see that rule file and `/docs/runbooks/runner-and-services.md`.
