# Hugo -- agent entry point

Hugo static site (`hugo.toml`, `content/`, `themes/`, `static/`, `public/`). See `MIGRATION-MANIFEST.md` and `RESEARCH-DESIGN-PATTERNS.md` for the migration and design context. Has a Lighthouse config (`.lighthouserc.json`) and GitHub Actions (`.github/`).

## Load project instructions
opencode loads THIS file (no CLAUDE.md exists here), and does NOT auto-expand `@`-references. At session start:
- Read `MIGRATION-MANIFEST.md` and `RESEARCH-DESIGN-PATTERNS.md` for site structure and design intent.
- Read `hugo.toml` for config.

## Build / verify
Hugo site. `hugo` builds to `public/`; `hugo server` for local preview. Do not hand-edit `public/` or `resources/` (generated). Verify a clean build before claiming done.

## Knowledge Vault (manual)
This folder is NOT auto-mapped to a Vault project, so no `.claude/vault-context.json` is generated on session start. The Vault is still available manually:
- Retrieve: `cd "/Users/mambrozkiewicz/Documents/The Vault/Knowledge" && python3 -m kb fetch "<topic>"`.
- Persist durable learnings: `python3 -m kb handoff --project tooling --title "..." --summary "..." --source claude`, then `python3 -m kb promote --all --compile`.
