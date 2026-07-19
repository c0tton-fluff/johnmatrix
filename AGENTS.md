# Hugo -- agent entry point

Hugo static site (`hugo.toml`, `content/`, `themes/`, `static/`, `public/`). See `MIGRATION-MANIFEST.md` and `RESEARCH-DESIGN-PATTERNS.md` for the migration and design context. Has a Lighthouse config (`.lighthouserc.json`) and GitHub Actions (`.github/`).

## Load project instructions
opencode loads THIS file (no CLAUDE.md exists here), and does NOT auto-expand `@`-references. At session start:
- Read `MIGRATION-MANIFEST.md` and `RESEARCH-DESIGN-PATTERNS.md` for site structure and design intent.
- Read `hugo.toml` for config.

## Build / verify
Hugo site. `hugo` builds to `public/`; `hugo server` for local preview. Do not hand-edit `public/` or `resources/` (generated). Verify a clean build before claiming done.

## CI: Lighthouse deploy gate (read before touching `.github/` or `lighthouserc.json`)

`.github/workflows/deploy.yml` builds Hugo, then a `lighthouse` job serves the built site on a fixed `localhost:8080` and reports Lighthouse category scores. It is ADVISORY, not a deploy gate: `deploy` has `needs: [build]` only, and the assertions are `warn` level, so a low score never blocks a deploy - it just shows in the job log / uploaded artifact. The single config is `lighthouserc.json` (no dot) at repo root; the workflow passes it explicitly via `--config=./lighthouserc.json`.

Current policy (in `lighthouserc.json`): 5 URLs, `numberOfRuns: 3`, all four categories (performance, accessibility, best-practices, seo) at `warn`/`>=0.95`. History: this started as a hard `error` gate, but a `0.95` bar blocked deploys over a 2-point SEO dip on a link-heavy list page (`/bugforge/` = 0.93), so it was made advisory. If you want a real blocking gate again, flip the relevant categories back to `error`, add `lighthouse` back to `deploy.needs`, and set a threshold each audited page actually clears (list pages score lower on SEO than articles).

Hard-learned gotchas (each cost real debugging time):
- ONE config file only, and mind the dotfile. lhci auto-discovers `.lighthouserc.json` (dotfile) with priority over `lighthouserc.json` (no dot). This repo had BOTH at one point and the no-dot one was silently dead. It is now consolidated into `lighthouserc.json` (no dot) with the workflow pointing `--config` at it. Do not re-introduce a `.lighthouserc.json`.
- Do NOT use `lhci autorun` here. When a `./public` build dir exists, autorun auto-detects it as a `staticDistDir`, serves its own random port, and DROPS `collect.url` - which also drops the assertions, giving a silent fake-green gate. The workflow runs `lhci collect` -> `lhci assert` -> `lhci upload` separately, each with `--config`.
- Serving + baseURL must stay in sync. The gate serves the build on a FIXED `localhost:8080` and Hugo is built with `--baseURL "http://localhost:8080/"` so asset AND canonical URLs resolve on the audited port (canonical must be a valid absolute URL or the SEO audit dings). Change one, change both.
- `0.95` is aggressive and page-specific. Section/list pages score lower on SEO than article pages - `/bugforge/` measured SEO `0.93` and blocked a deploy. When adding a URL to the audit list, check its real score first; if a page legitimately can't hit `0.95` (e.g. a thin list page with no meta description), either fix the page (add description/crawlable links) or set a per-page/lower threshold rather than letting it wedge deploys.
- Performance is noisy in CI (throttled CPU, local uncompressed serve). `numberOfRuns: 3` (median) helps; if a hard performance gate starts flaking, demote it to `warn` rather than lowering the structural gates. The a11y/best-practices/seo gates are what caught the original unstyled-site regression (color-contrast, csp-xss, tap-targets).
- Verify by run CONCLUSION, not a piped exit code. `gh run watch ... | tail` returns tail's exit, not the run's - use `gh run view <id> --json conclusion,jobs`.
- History: a past incident shipped this workflow with `continue-on-error: true` + assertions removed = a gate that could never fail. If you need to unblock a deploy, fix the page or the threshold - do not neuter the gate.

## Knowledge Vault (manual)
This folder is NOT auto-mapped to a Vault project, so no `.claude/vault-context.json` is generated on session start. The Vault is still available manually:
- Retrieve: `cd "/Users/mambrozkiewicz/Documents/The Vault/Knowledge" && python3 -m kb fetch "<topic>"`.
- Persist durable learnings: `python3 -m kb handoff --project tooling --title "..." --summary "..." --source claude`, then `python3 -m kb promote --all --compile`.
