---
title: CopyPasta
tags:
  - bugforge
  - broken-access-control
  - idor
  - api-testing
  - burpsuite
  - mcp
---

Today's challenge: Broken Access Control

![Daily](/BugForge/img/copy-01.png)

## Enumeration

- We can register as usual
- As normal, we can click around the page to find more of the functionality 

![Daily2](/BugForge/img/copy-02.png)

- Continuing enumeration, we switch over to the Burp MCP and let it run to find issues

![Daily3](/BugForge/img/copy-03.png)

## MCP

- It went on to test all sorts...
![Daily4](/BugForge/img/copy-04.png)
![Daily5](/BugForge/img/copy-05.png)

- Again, I had to ask it to laser focus on what it was searching for
- Previously finding api/snippets/1 made me think to check those out so this is where I asked Burp MCP to focus

![Daily6](/BugForge/img/copy-06.png)

- Now that I asked it to rethink the actions, and not only use the snippets to change numbers but also methods like `PUT`and `DELETE`
- It did not take long for it to find the culprit

![Daily7](/BugForge/img/copy-07.png)

- Keep learning and be useful!

## Security Takeaways
### Impact

  - Unauthorized access to other users’ snippets
  - Ability to modify or delete content without ownership
  - Data integrity and confidentiality at risk

### Vulnerability Classification

  - OWASP Top 10: Broken Access Control
  - Vulnerability Type: IDOR / improper access control on resource endpoints
  - CWE: CWE-639 - Authorization Bypass Through User-Controlled Key

### Root Cause
  - The API trusts user-supplied identifiers in /api/snippets/{id} and does not enforce ownership checks on read/update/delete operations.

### Remediation

  - Enforce object-level authorization on all snippet endpoints
  - Validate ownership before read, update, or delete
  - Use access control middleware consistently across all methods
  - Add audit logging for unauthorized access attempts
