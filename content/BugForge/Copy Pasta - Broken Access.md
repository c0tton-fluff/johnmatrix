
- Welcome to today's challenge
- I have decided to fully run it through `Claude MCP` within Burp.
- Since I have recently fallen in love with how `Claude Code` works and behaves as well as what it can offer compared to `Codex`, I felt it would be fitting to test it out

- As usual, I browsed the page to see how it works and then checked within Burp what is the behaviour in the background
- I then asked `Claude MCP` to find anything it can

## MCP 

![Daily](/BugForge/img/claude-01.png)

- On its own, without much pushing, it found small snippet issues, and continued in that direction, however did not run for too long realising it is a dead end

![Daily](/BugForge/img/claude-02.png)

- Snippet `#4` was a potential for about 30 seconds ...

![Daily](/BugForge/img/claude-05.png)

- After 2 minutes of trying it managed to find the issue
- It has burned through fair few tokens to get there but nevertheless it was a very satisfying moment watching it realise its own mistakes

![Daily](/BugForge/img/claude-07.png)
![Daily](/BugForge/img/claude-09.png)

### MCP Approach lessons

- I asked Claude: `Since it took longer and we were a bit all over the place, tell me how you would have tested it differently?`

- Looking back at my approach, here's what I should have done differently:
    - What I Did Wrong
	    - Focused too much on read-based IDOR - I kept trying to access snippets by ID, admin endpoints, etc. I was looking for unauthorized read access.
	    - Ignored state-changing operations - The profile endpoint returned 500 errors and I dismissed it as broken rather than investigating further.
	    - Didn't enumerate all endpoints systematically - I found PUT /api/profile existed (returned 500) but never tried sub-paths like /api/profile/password.

    - Better Approach

    1. Map all authenticated functionality first
	  - When testing BAC, list every action a user can perform: create snippet, edit snippet, delete snippet, change password, update profile, etc.
	  - Each of these is a potential IDOR target.

    2. For each endpoint, check for user_id/id parameters
	  - Any request that includes a user identifier (user_id, id, owner_id) is a prime IDOR candidate.
	  - Test by changing the ID to another user (1 is always a good guess for admin).

    3. Prioritise write operations over read
	  - Password change, profile update, delete operations are higher impact than just reading data.
	  - When the hint is "broken access control," think about what damage an attacker could do - account takeover via password change is classic.

    4. When an endpoint returns errors, dig deeper
	  - The 500 "Database error" on PUT /api/profile was a signal - it meant the endpoint existed but my payload was wrong.
	  - I should have fuzzed the path (/api/profile/password, /api/profile/email) and field names.

- `Lesson`: Always test password/credential change functionality for IDOR - it's one of the most common and critical patterns.

## Security Takeaways

  1. Always test credential-changing endpoints for IDOR - password reset, email change, and similar sensitive operations are high-value targets
  2. Client-supplied user identifiers cannot be trusted - the user_id in the request body was used directly without validation
  3. Error messages reveal endpoint existence - 500 "Database error" vs 404 "Cannot PUT" helped identify valid endpoints
  4. JWT tokens should be the source of truth - user identity should come from the authenticated token, not request parameters

### Impact

  - Severity: `Critical`
  - Account Takeover: Full compromise of any user account including administrator
  - Data Breach: Access to all private snippets and user data
  - Privilege Escalation: Regular user can become admin
  - Business Impact: Complete loss of confidentiality, integrity, and trust

### Vulnerability Classification

  - OWASP Top 10 2021: A01:2021 - Broken Access Control
  - CWE-639: Authorization Bypass Through User-Controlled Key (IDOR)
  - CWE-284: Improper Access Control
  - CVSS 3.1 Score: 9.8 (Critical)

### Root Cause

  The `/api/profile/password` endpoint accepted a `user_id` parameter from the request body and used it directly in the database query without verifying that:
  1. The `user_id` matches the authenticated user's ID from the JWT token
  2. The requesting user has permission to modify that account

  ```javascript
  // Vulnerable code pattern (pseudocode)
  app.put('/api/profile/password', authenticate, (req, res) => {
    const { user_id, password } = req.body;  // VULNERABLE: trusts client input
    db.query('UPDATE users SET password = ? WHERE id = ?', [hash(password), user_id]);
  });
  ```
### Remediation

  1. Use session/token for user identity:
  ```javascript
  // Fixed code pattern
  app.put('/api/profile/password', authenticate, (req, res) => {
    const user_id = req.user.id;  // FIXED: from JWT token, not request body
    const { password } = req.body;
    db.query('UPDATE users SET password = ? WHERE id = ?', [hash(password), user_id]);
  });
  ```
  
  2. If `user_id` must be in request, validate ownership:
  ```javascript
  if (req.body.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  ```

  3. Implement proper authorization checks at the middleware level
  4. Log and alert on attempts to modify other users' data
  5. Security testing - include IDOR checks in CI/CD pipeline
