# Hugo -- agent entry point

Hugo static site (`hugo.toml`, `content/`, `themes/`, `static/`, `public/`). See `MIGRATION-MANIFEST.md` and `RESEARCH-DESIGN-PATTERNS.md` for the migration and design context. Has a Lighthouse config (`.lighthouserc.json`) and GitHub Actions (`.github/`).

## Load project instructions
opencode loads THIS file (no CLAUDE.md exists here), and does NOT auto-expand `@`-references. At session start:
- Read `MIGRATION-MANIFEST.md` and `RESEARCH-DESIGN-PATTERNS.md` for site structure and design intent.
- Read `hugo.toml` for config.

## Build / verify
Hugo site. `hugo` builds to `public/`; `hugo server` for local preview. Do not hand-edit `public/` or `resources/` (generated). Verify a clean build before claiming done.

## CI: Lighthouse deploy gate (read before touching `.github/` or `.lighthouserc.json`)

`.github/workflows/deploy.yml` builds Hugo, then a `lighthouse` job audits the built site and asserts scores. `deploy` has `needs: [build, lighthouse]`, so a failing audit blocks the deploy. It runs on `pull_request` too (deploy skipped there) so the gate can protect merges. There is exactly ONE Lighthouse config: `.lighthouserc.json` (dotfile). Do not add a second `lighthouserc.json` (no dot) - see the gotcha below.

Hard-learned gotchas (all cost real debugging time):
- ONE config file only. lhci auto-discovers `.lighthouserc.json` (dotfile) and ignores a sibling `lighthouserc.json` (no dot). Two files = the no-dot one is silently dead. Edit `.lighthouserc.json`.
- Do NOT use `lhci autorun` here. When a `./public` build dir exists, autorun auto-detects it as a `staticDistDir`, serves its own random port, and DROPS `collect.url` - which also drops the assertions, giving a silent fake-green gate. The workflow runs `lhci collect` -> `lhci assert` -> `lhci upload` separately, each with `--config=./.lighthouserc.json`.
- The gate serves the build on a FIXED `localhost:8080` and Hugo is built with `--baseURL "http://localhost:8080/"` so asset AND canonical URLs resolve on the audited port (canonical must be a valid absolute URL or the SEO audit dings). Keep the port and baseURL in sync if you change either.
- Assertion policy: `accessibility`, `best-practices`, `seo` are hard `error` gates at `>=0.9` (these caught the original unstyled-site regression: color-contrast, csp-xss, tap-targets). `performance` is `warn` only - lab perf in CI is noisy (throttled CPU, single run, uncompressed local serve): prod scores 100 but a CI audit measured 0.85. Do not promote performance to `error` without also stabilizing it (more runs / median).
- `preset: desktop` in the config - the site is validated at 100/100/100/100 on desktop. Mobile-only audits (tap-targets, target-size) do not run under desktop; the category gates still catch catastrophic regressions.
- Verify by CI run CONCLUSION, not a piped exit code. `gh run watch ... | tail` returns tail's exit, not the run's - check `gh run view <id> --json conclusion,jobs`.
- History note: a past incident shipped a Lighthouse workflow with `continue-on-error: true` + assertions removed = a gate that could never fail. If you ever need to unblock, fix the assertions or serving, don't neuter the gate.

## Knowledge Vault (manual)
This folder is NOT auto-mapped to a Vault project, so no `.claude/vault-context.json` is generated on session start. The Vault is still available manually:
- Retrieve: `cd "/Users/mambrozkiewicz/Documents/The Vault/Knowledge" && python3 -m kb fetch "<topic>"`.
- Persist durable learnings: `python3 -m kb handoff --project tooling --title "..." --summary "..." --source claude`, then `python3 -m kb promote --all --compile`.
