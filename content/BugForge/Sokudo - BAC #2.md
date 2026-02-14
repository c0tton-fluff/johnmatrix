---
title: Sokudo - BAC #2
tags:
  - bugforge
  - broken-access-control
  - caido-mcp
---

- Here we go again!

![](/BugForge/img/soku1.png)

## Enumeration

- Today's challenge is on a freshly built `Caido MCP` server
- Poividing nothing more but the history and slight direction to save some tokens

![](/BugForge/img/soku2.png)

- After clicking around as usual, I noticed a different thing to my normal `I am used to seeing you` things

![](/BugForge/img/soku3.png)

- The token that was created, has a date.
- Definitely worth exploring this, hence this is where I pointed our friendly `Caido MCP`

## Caido MCP

- I will take you on a journey of my prompts today to show the way I am thinking and how `Claude` is handling it
- `Image #1` is screenshot of the dashboard in the web app

![](/BugForge/img/soku4.png)

- After checking multiple settings within...

![](/BugForge/img/soku5.png)

- At this point I felt it would have been a moment .. and it was less than 5 seconds before it found it all and did a writeup

![](/BugForge/img/soku6.png)

## Security Takeaways

### Vulnerability

- Insecure Token Generation + Information Disclosure
### Type

- Broken Authentication (OWASP A07:2021)
### Root Cause

- Tokens generated using predictable timestamps (YYYYMMDDHHMMSS format from login time)
- /api/stats/leaderboard endpoint publicly exposes last_login timestamps for all users
- No cryptographic signing or randomness in token generation
### Attack Chain

1. Attacker calls /api/stats/leaderboard with any valid session
2. Extracts admin's last_login: 2026-01-29T16:21:43.084Z
3. Converts timestamp to token format → 20260129162143
4. Uses forged token in Authorization: Bearer header
5. Accesses /api/admin/users with full admin privileges
### Remediation

1.  Use cryptographically secure tokens
	- Generate tokens with crypto.randomBytes(32).toString('hex') or UUID v4
	- Never derive tokens from predictable or guessable values like timestamps

2. Don't expose sensitive timestamps
	- Remove last_login from public endpoints
	- Or display relative time ("5 mins ago") without exact timestamps

3.  Implement proper session management
	- Use signed JWTs with server-side secret
	- Include user ID and role in token payload with signature verification
	- Set token expiration (short-lived access tokens + refresh tokens)

4. Add token binding
	- Tie tokens to IP address or device fingerprint
	- Invalidate tokens on password change or logout
