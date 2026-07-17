---
title: Brain Sharing
aliases:
  - "/Brain-Sharing"
---
Guides, tools, and knowledge sharing. Everything here is either open source or described well enough to build your own. The goal is practical - things that work, how to set them up, and why they exist.


## MCP Servers

MCP (Model Context Protocol) servers give AI assistants structured access to external tools. These are all Go binaries that run via stdio transport -- single binary, zero runtime dependencies.

- **[Caido MCP Server](/brain-sharing/mcp-setup/caido-mcp-setup/)** -> 42 tools for the Caido web proxy. Replay, intercept, fuzz, and manage findings from your AI assistant.
- **[Burp MCP Server](/brain-sharing/mcp-setup/burp-mcp-setup/)** -> 10 tools for Burp Suite Professional. Send requests, race conditions, proxy history, scanner findings.
- **[SentinelOne MCP Server](/brain-sharing/mcp-setup/sentinelone-mcp-server/)** -> 14 tools for SentinelOne EDR. Threat management, agent control, Deep Visibility hunting.
- **[HackerOne MCP Server](/brain-sharing/mcp-setup/hackerone-mcp/)** -> 14 tools for HackerOne triage. Report lifecycle, severity, assignments, program management.
- **[Caido Go SDK](/brain-sharing/mcp-setup/caido-sdk-go/)** -> community Go SDK for building custom Caido integrations.

## Security Tools

- **[Bagel](/brain-sharing/mcp-setup/bagel/)** -> dev workstation security scanner. Checks Git, SSH, npm, cloud creds, AI tools for misconfigs and leaked secrets.
- **[Secret Scrubber](/brain-sharing/mcp-setup/secret-scrubber/)** -> finds and removes secrets from AI CLI session logs. 21 patterns, zero dependencies.

## Guides

- **[The AI-Era Security Engineer](/brain-sharing/ai-era-security-engineering/)** -> practical guide for security professionals building, specifying, and reviewing code in the age of AI-assisted development.
