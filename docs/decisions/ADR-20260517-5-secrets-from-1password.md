# ADR-20260517-5 — 1Password is the single source of truth for runtime secrets

Date: 2026-05-17
Status: Accepted
Related: ADR-20260517-3 (atomic commits), ADR-20260517-4 (git log is the changelog)

## Context

The ported ETL, Flask, and grading code reads runtime configuration from `os.environ`:

- `SQL_SERVER`, `SQL_DATABASE`, `SQL_USERNAME`, `SQL_PASSWORD`, `SQL_TRUST_CERT` — `shared/db.py` and per-script overrides.
- `NBA_PROXY_URL` — Webshare residential proxy for `stats.nba.com` calls.
- `ODDS_API_KEY` — FanDuel odds source.
- `RUNNER_API_KEY` — Flask runner authentication.

Before this ADR, schnapp-bet had no wiring layer: no `.env`, no GitHub Actions secrets, no workflow `env:` blocks. Running any ported script raised `KeyError` at the first `os.environ[...]` access.

A 1Password service account (`schnapp-automation`) is configured locally with read access to the `web-variables` vault. The vault contains 10 items covering every secret the platform needs (Database, Webshare Proxy, GitHub, GitHub Actions Runner, Web App, Claude Code, MCP Tokens, Anthropic, Cloudflare Tunnel, Service Account Auth Token). The `op` CLI v2.34.0 is installed at `/usr/local/bin/op`, and `OP_SERVICE_ACCOUNT_TOKEN` is exported in `~/.zshrc` on the primary host (Schnapps-MBP).

Three properties of this setup make it the natural fit:

1. Single bootstrap secret. Once `OP_SERVICE_ACCOUNT_TOKEN` is set, every other secret is reachable via `op://web-variables/<item>/<field>` URIs. Rotating a vault item is a one-side operation — no commit, no workflow change.
2. Symmetric across surfaces. Local Mac dev (via `op run`), GitHub Actions (via `1password/load-secrets-action`), and launchd-managed services (via `op run` wrapping the executable) all resolve URIs the same way.
3. Auditable. Service account access logs every read against the vault. Anything not reachable through the vault should not exist as a secret.

## Decision

1. The `web-variables` 1Password vault is the **single source of truth** for runtime secrets. No secret value lives in repo files, GitHub Actions secrets, or `launchd` plists — with one exception:
   - `OP_SERVICE_ACCOUNT_TOKEN` is the bootstrap secret. It is the _only_ secret that lives outside the vault. On Schnapps-MBP it lives in two shell init files for different consumers: `~/.zshrc` (read by `op-wrap.sh` for launchd services) and `~/.zshenv` (read by `com.schnapp.environment` at login — see Decision 4). On GitHub Actions it is the _only_ repository secret, named `OP_SERVICE_ACCOUNT_TOKEN`.

2. **Local dev (Mac)** resolves secrets via `op run`:

   ```bash
   op run --env-file=.env.template -- python3 etl/nba_etl.py
   ```

   The `.env.template` file is committed to the repo. Each line maps an env-var name to an `op://` URI. The file contains zero secret values.

3. **GitHub Actions** resolves secrets via `1password/load-secrets-action@v2`. Each workflow declares the URIs it needs in the action's `env:` block. The action exposes the resolved values to subsequent steps as standard env vars. The only repo-level GitHub secret is `OP_SERVICE_ACCOUNT_TOKEN`.

4. **launchd services** (Flask runner, Next.js web, MCP server) source secrets via two cooperating mechanisms:
   - `com.schnapp.environment` (`~/Library/LaunchAgents/com.schnapp.environment.plist`, not in this repo): runs at login, reads `OP_SERVICE_ACCOUNT_TOKEN` from `~/.zshenv`, and calls `launchctl setenv OP_SERVICE_ACCOUNT_TOKEN` to inject the token into the launchd environment for all subsequent service loads.
   - `services/launchd/op-wrap.sh`: each service plist's `ProgramArguments` invokes this wrapper, which reads `OP_SERVICE_ACCOUNT_TOKEN` independently from `~/.zshrc` and execs `op run --env-file=.env.template -- <real command>`. The `.env.template` path is absolute.
   - Both mechanisms are belt-and-suspenders; `op-wrap.sh` does not rely on `com.schnapp.environment` having run first.

5. **The canonical env-var → URI mapping lives in `.env.template`**, not in this ADR. Adding a new env var is a one-file edit (plus the vault entry); it does not require a new ADR.

6. **No fallback path.** Scripts do not check for missing env vars and proceed with defaults. The historical sole exception — `RUNNER_API_KEY` defaulting to `"runner-Lake4971"` in `services/flask/runner.py:45` — is honored as legacy until the Flask service port is revisited, at which point the default is removed.

7. **`gh` CLI** authenticates via 1Password plugin integration: `~/.config/op/plugins.sh` sets `alias gh="op plugin run -- gh"`. Biometric vault unlock via the 1Password desktop app — no stored token on disk or in `~/.git-credentials`.

8. **Claude Code sessions** resolve secrets natively: the `env` block in `~/.claude/settings.json` holds `ANTHROPIC_API_KEY` and `GITHUB_TOKEN` as `op://` URIs. Claude Code resolves them using `OP_SERVICE_ACCOUNT_TOKEN` from the shell environment on session start — no `op run` wrapper needed.

## Consequences

- New `.env.template` at repo root. Required header documents that this is not a plain dotenv file; direct sourcing (`set -a; . .env.template`) exports literal `op://` strings, which the consuming Python would reject.
- `.gitignore` updated to allow `.env.template` while continuing to block `.env`, `.env.local`, `.env.*` at the repo root (defense in depth — even if a user resolves URIs to plaintext locally, the file cannot be committed).
- `OP_SERVICE_ACCOUNT_TOKEN` is the only legitimate plaintext secret on the host. It lives in two shell init files: `~/.zshrc` (for interactive shells and `op-wrap.sh`) and `~/.zshenv` (for `com.schnapp.environment`). Both are scoped to the personal user account; shoulder-surfing is the only realistic risk. If it leaks, rotate the service account in 1Password — no other secret needs rotation.
- Self-hosted runner workflows (mac-runner) must also have `OP_SERVICE_ACCOUNT_TOKEN` exported in the runner's environment, or the workflow must accept it via the same `secrets.OP_SERVICE_ACCOUNT_TOKEN` and pass through.
- Future env vars added to ported code MUST land with a corresponding `.env.template` entry and a vault item/field. A code-only PR that reads a new `os.environ[...]` is incomplete until the wiring exists.

## Alternatives considered

- **A committed plaintext `.env` per-environment.** Rejected — that's the failure mode the entire change exists to avoid.
- **GitHub Actions repository secrets, no 1Password.** Rejected — duplicates the GitHub UI as a second source of truth, no audit log, no symmetry with local dev, every rotation requires both vault + GH UI updates.
- **1Password Connect server self-hosted on Schnapps-MBP.** Considered — more sophisticated than service-account flow, supports finer-grained ACLs. Rejected as over-engineered for a single-developer project; can be revisited if the access model needs splitting.
- **`op inject` instead of `op run`.** Considered. `op inject` substitutes URIs in a template file and prints to stdout; `op run` exports env vars and runs a subcommand. `op run` is the closer match to "set env then exec," which is what every consumer (Python ETL, Flask runner, launchd plist) wants.
