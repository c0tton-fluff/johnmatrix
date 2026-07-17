---
title: Secret Scrubber
tags:
  - security
  - python
  - cli
  - secrets
  - ai-tools
aliases:
  - "/Brain-Sharing/MCP-Setup/Secret-Scrubber"
  - "/brain-sharing/mcp-setup/secret-scrubber/"
---
Find and scrub secrets from AI CLI session logs. AWS keys, SSH private keys, GitHub tokens, JWTs, Bearer tokens, cloud credentials -- replaced with `[REDACTED-<type>]` markers while preserving conversation context. Zero dependencies, stdlib-only Python.

Source: [c0tton-fluff/secret-scrubber](https://github.com/c0tton-fluff/secret-scrubber)

## The Problem

AI coding assistants like Claude Code and OpenAI Codex log full conversation transcripts to disk as plaintext JSONL. Every secret you work with during a session ends up recorded -- AWS credentials from deployments, SSH keys from server access, GitHub tokens from CLI operations, Bearer tokens from API testing, database connection strings.

These logs are backed up to cloud storage, synced across devices, and persisted indefinitely. The secrets inside them are a lateral movement goldmine for anyone who gains access to a developer workstation.

[Bagel](/brain-sharing/bagel/) detects the exposure. Secret Scrubber removes it.

## Real Results

From a security engineer's workstation after daily AI-assisted work:

| Metric | Before | After |
|--------|--------|-------|
| Bagel credential findings | 271 | ~23 (regex false positives) |
| Files scrubbed | - | 1,920 |
| Total redactions | - | 5,150 |

## Install

Zero dependencies. Clone and run:

```bash
git clone https://github.com/c0tton-fluff/secret-scrubber.git
python3 secret-scrubber/scripts/scrub-sessions.py --dry-run
```

Requires Python 3.6+. No pip install needed.

## Usage

```bash
python3 scrub-sessions.py              # Dry run with preview
python3 scrub-sessions.py run          # Scrub with 60-minute grace period
python3 scrub-sessions.py run --all    # Scrub everything (no grace period)
python3 scrub-sessions.py run --verbose
```

## What It Catches (21 Patterns)

| Category | Patterns | Example |
|----------|----------|---------|
| SSH | Private keys (RSA, EC, OpenSSH, DSA) | `-----BEGIN RSA PRIVATE KEY-----` |
| Bearer auth | Bearer + JWT, Bearer + generic token | `Bearer eyJ...` |
| HTTP auth | Basic auth headers, basic auth in URLs | `Basic dXNl...` |
| AWS | Access keys, STS keys, session tokens, secret keys | `AKIA...`, `ASIA...` |
| GitHub | PAT, OAuth, user, app, fine-grained tokens | `ghp_`, `gho_`, `github_pat_` |
| AI services | Anthropic, OpenAI | `sk-ant-`, `sk-proj-` |
| Splunk | Session tokens | `splunkd_` |
| NPM | Auth tokens | `npm_` |
| Azure | Storage account keys | `AccountKey=...` |
| GCP | API keys | `AIza...` |
| JWT | Standalone tokens | `eyJ...eyJ...` |
| Headers | X-API-Key, Authorization | `X-API-Key: ...` |

## Safety

- **Read-only by default** -- dry-run previews changes without modifying anything
- **Grace period** -- skips files modified in the last 60 minutes (active session protection)
- **Targeted scope** -- only touches `~/.claude/projects/**/*.jsonl`, `~/.claude/projects/**/*.txt`, and `~/.codex/sessions/**/*.jsonl`
- **Never touches config** -- ignores `.mcp.json`, `settings.json`, `CLAUDE.md`, `auth.json`
- **Context preserved** -- conversation text, tool calls, and structure remain intact

## How It Works

The scrubber applies 21 compiled regex patterns in priority order from most specific to least specific. This prevents partial matches -- a `Bearer eyJ...` is caught as a Bearer+JWT token, not as a standalone JWT. Each match is replaced with a descriptive `[REDACTED-<type>]` marker.

Files are read into memory, scrubbed, and written back atomically.

## Recommended Workflow

1. Run [Bagel](https://github.com/boostsecurityio/bagel) to assess your exposure
2. Run `secret-scrubber` to clean up AI session logs
3. Re-run Bagel to verify the reduction
4. Rotate any credentials that were found -- treat them as compromised
5. Schedule periodic scrubs (cron/launchd) to keep logs clean

## See Also

- **[Bagel](/brain-sharing/bagel/)** -- workstation scanner that detects credential exposure across dev tools
- **[Bagel fork with `bagel scrub`](https://github.com/c0tton-fluff/bagel)** -- Go implementation of this scrubber integrated directly into Bagel as a native command. Same 21 patterns, concurrent file processing, single binary. Use this if you want scan + scrub in one tool.
