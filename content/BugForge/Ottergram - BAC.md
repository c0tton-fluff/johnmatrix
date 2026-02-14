---
title: Ottergram - BAC
tags:
  - bugforge
  - broken-access-control
  - autorize
  - burpsuite
---

- Third round with the otters - this time focusing on Broken Access Control
- The key lesson from this one: always test with NO authentication, not just wrong-user tokens
- Used Burp Suite with Autorize extension to automate the access control discovery

## Enumeration

- Same app as before - React SPA + Express backend + SQLite
- Registered a user, browsed around, posted a comment

1. Endpoint Discovery (via Burp Proxy History)

```
GET  /api/posts                - List posts
GET  /api/posts/{id}/comments  - List comments
POST /api/posts/{id}/comments  - Add comment (requires auth)
PUT  /api/comments/{id}        - Edit comment (requires auth... or does it?)
GET  /api/profile/{username}   - View profile
PUT  /api/profile              - Update profile
GET  /api/admin                - Admin panel (requires admin role)
POST /api/login                - Login
POST /api/register             - Register
```

2. Users

```
id:1 - otter_lover
id:2 - admin (role: admin)
id:3 - sea_otter_fan
id:4 - tester (me, role: user)
```

## Autorize - Access Control Testing

- Loaded the Autorize extension in Burp to passively detect authorization bypasses
- Configuration:
  - Interception Filter: URL Contains `/api/`
  - Unauthenticated Detection: Body contains `Access token required`
  - Cleared all default placeholder headers (important - Autorize ships with dummy Cookie/Auth headers)

- Browsed the app normally with my auth token while Autorize tested every request with no authentication in the background


![Autorize config](/BugForge/img/ottersqli-01.png)
![Unauthorize config](/BugForge/img/ottersqli-05.png)

- Autorize results immediately lit up red on the PUT /api/comments endpoint
- Every other endpoint correctly returned 401 (green/yellow) - but PUT comments showed **Bypassed!**

![Autorize results showing Bypassed](/BugForge/img/ottersqli-02.png)

## The Vulnerability - No-Auth Comment Edit

- The edit comment endpoint (`PUT /api/comments/:id`) has no authentication middleware
- The ownership check (`is this your comment?`) sits inside an `if (req.user)` block
- When you send a request with NO Authorization header, `req.user` is undefined
- The ownership check is skipped entirely - you can edit any comment without logging in

```javascript
// Pseudocode of the vulnerable pattern
app.put('/api/comments/:id', (req, res) => {
  if (req.user) {
    // Only checks ownership IF a token is provided
    if (req.user.id !== comment.user_id) {
      return res.status(403).json({ error: "Not authorized" });
    }
  }
  // Falls through here when no token - updates anyway!
  updateComment(id, content);
});
```

- This is the Three-Token Test lesson:

| Test | Authorization Header | Result | Meaning |
|------|---------------------|--------|---------|
| Admin token | Bearer admin-jwt | 200 | Baseline |
| Wrong-user token | Bearer tester-jwt | 403 | Ownership check works IF authenticated |
| No token at all | (none) | 200 | Authentication bypass - ownership check skipped |

- A 403 with the wrong token does NOT mean the endpoint is secure

## Exploitation

- Sent the PUT from Repeater with no Authorization header - just the content body

```
PUT /api/comments/3 HTTP/2
Host: lab-1771068220506-ke92sm.labs-app.bugforge.io
Content-Type: application/json

{"content":"edited without auth"}
```

- Response: `200 "Comment updated successfully"`


- Comment successfully modified without any authentication
- The flag is revealed through this broken access control

![Flag revealed](/BugForge/img/ottersqli-04.png)

## Flag

```
bug{...}
```

## Security Takeaways

### Vulnerability

- Broken Access Control on `PUT /api/comments/:id`
- OWASP Top 10: A01:2021 - Broken Access Control
- CWE: CWE-306 - Missing Authentication for Critical Function

### Impact

- Any unauthenticated user can edit any comment
- No token, no session, no credentials needed
- Ownership check is completely bypassed when no token is provided

### Root Cause

- Authentication middleware not applied to the PUT route
- Authorization check placed inside an `if (req.user)` conditional block
- When no token is sent, `req.user` is undefined, the entire ownership check is skipped
- POST (create) correctly requires auth, but PUT (edit) does not - inconsistent middleware

### Remediation

- Apply authentication middleware at the router level, not per-handler
- Never place authorization checks inside conditional blocks that can be skipped
- Ensure all WRITE endpoints (PUT, PATCH, DELETE) require authentication
- Implement automated access control testing in CI/CD (like Autorize but in pipeline)

### Key Lesson - Three-Token Test

- Always test three auth levels for every WRITE endpoint:
  1. Valid high-privilege token (admin) - baseline
  2. Valid low-privilege token (regular user) - horizontal/vertical BAC
  3. No token at all - authentication bypass
- A 403 with the wrong token only proves the ownership check works WHEN authenticated
- It says nothing about what happens with NO authentication
