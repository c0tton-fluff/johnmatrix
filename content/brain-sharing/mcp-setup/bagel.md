---
title: Bagel
tags:
  - security
  - go
  - cli
  - devops
  - secrets
aliases:
  - "/Brain-Sharing/MCP-Setup/Bagel"
  - "/brain-sharing/mcp-setup/bagel/"
---
Dev workstation security scanner from BoostSecurity. Checks Git config, SSH keys, npm settings, shell history, cloud credentials, IDE plugins, GitHub CLI, and AI tool configs for security gaps. Privacy-first -- only metadata leaves the machine.

I'm a contributor to this project.

Source: [boostsecurityio/bagel](https://github.com/boostsecurityio/bagel)

## What It Does

Bagel scans your local dev environment for misconfigurations and exposed secrets that attackers target in supply chain compromises. It runs 9 probes and 8 secret detectors across common developer tools.

```
bagel scan  -->  9 probes + 8 secret detectors  -->  findings report
```

No data leaves your machine. Bagel reads local configs and reports findings locally. In `--report` mode, only metadata (finding type, severity) is sent -- never file contents, secrets, or paths.

## Install

```bash
brew install boostsecurityio/tap/bagel
```

Or from source:

```bash
git clone https://github.com/boostsecurityio/bagel.git
cd bagel && go build -o bagel .
```

Requires Go 1.25+. License: GPL-3.0.

## Usage

```bash
bagel scan              # scan with default settings
bagel scan --strict     # CI/CD mode -- exit 1 on any finding
bagel scan --report     # send metadata to BoostSecurity dashboard
bagel scrub             # interactive cleanup of detected secrets
```

## Probes (9)

| Probe | What it checks |
|-------|---------------|
| Git | Commit signing, credential helpers, safe directory settings |
| SSH | Key types, permissions, agent forwarding config |
| npm | Registry config, auth tokens in .npmrc, publish settings |
| Environment Variables | Secrets in shell rc files (.bashrc, .zshrc, .profile) |
| Shell History | Credentials and tokens leaked in command history |
| Cloud Credentials | AWS, GCP, Azure credential files and their permissions |
| JetBrains | IDE plugin security, stored credentials, project settings |
| GitHub CLI | Token scopes, auth config, stored credentials |
| AI Tools | API keys and configs for Copilot, Claude, OpenAI, etc. |

## Secret Detectors (8)

Scans common locations for leaked credentials:

- AWS access keys and secret keys
- GCP service account JSON keys
- Azure client secrets
- GitHub personal access tokens
- npm auth tokens
- SSH private keys (checks permissions too)
- Generic API keys in env files
- AI tool API keys (OpenAI, Anthropic, etc.)

## CI/CD Integration

Use `--strict` to fail pipelines when findings exist:

```yaml
# GitHub Actions
- name: Dev workstation audit
  run: bagel scan --strict
```

This catches developers committing with misconfigured Git settings, expired SSH keys, or leaked credentials in rc files.

## Scrub Command

`bagel scrub` provides interactive cleanup:

1. Shows each finding with context
2. Offers to fix automatically where possible (permissions, config changes)
3. For secrets: shows location, offers to rotate/remove

## Why This Matters

Supply chain attacks increasingly target developer machines -- not just CI/CD. A compromised `.npmrc` with an auth token, an AWS key in `.bash_history`, or a GitHub PAT with `repo` scope in an unsecured config file are all realistic attack vectors. Bagel catches these before an attacker does.
