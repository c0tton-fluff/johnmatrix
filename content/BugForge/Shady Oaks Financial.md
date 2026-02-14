---
title: Shady Oaks Financial
tags:
  - bugforge
  - broken-access-control
  - admin-panel
  - api-enumeration
  - burpsuite
  - mcp
---

- Welcome to today's lab

![Daily](/BugForge/img/shady-01.png)

- As usual, we can register a user
- We are presented with a trading application, so might as well use it and see how it works

![Daily](/BugForge/img/shady-02.png)

- Using our handy script, we find more information

`Endpoints Found: 31`

![Daily](/BugForge/img/shady-03.png)

- We know now what we can abuse and search for

### MCP Burp Suite

- I asked GPT to search for anything, any api with admin, since the hint mentioned `Broken Access Control`, it could be very simple

![Daily](/BugForge/img/shady-04.png)

- It went on to search but did not find what we were looking for
- Next up, I simply told it to try not to overthink it as it is very simple
- By this time I already found it, to my own surprise, that `/admin` works ... it was the quickest win!

![Daily](/BugForge/img/shady-05.png)

- Ran the two-step test.
	- `Step 1: /api/admin/flag`
		- No auth → 401 {"error":"Access token required"}
		- With tester JWT (role=user) → 200 {"flag":"`bug{rWROg3bOL7OOlxN5gkf5gDqfIYurhtCg}`"}

  This confirms broken access control: a non-admin user can access the admin flag endpoint.

- Super simple and fast today
- Keep learning and be useful!

## Security Takeaways
### Impact

  - Non-admin users can access admin-only endpoints
  - Exposure of sensitive admin data (flag)
  - Confirms broken authorization at critical API paths

### Vulnerability Classification

  - OWASP Top 10: Broken Access Control
  - Vulnerability Type: Privilege bypass on admin endpoint
  - CWE: CWE-285 - Improper Authorization

### Root Cause
  - The /api/admin/flag endpoint verifies authentication but does not enforce role-based authorization, allowing a standard user JWT to access admin data.

### Remediation

  - Enforce role checks on all /api/admin/* routes
  - Separate admin routes behind dedicated middleware
  - Add automated tests for authorization boundaries
  - Monitor and alert on access to admin endpoints by non-admin roles
