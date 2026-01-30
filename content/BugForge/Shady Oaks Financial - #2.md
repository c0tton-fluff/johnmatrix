- Full send with `Caido MCP` today to test it on a different application.
- We are met with familiar page, steps away from the riches!

## Enumeration
- Browsing as usual to get all the history and application's behaviour

![](/BugForge/img/oaks1.png)

### Prompting
- You can come on a journey with me today alongside my prompts

![](/BugForge/img/oaks2.png)
![](/BugForge/img/oaks3.png)

### First finding

- I was unsure whether this was something to be happy about, but continued on...

![](/BugForge/img/oaks4.png)

### MCP focus work
- I directed the MCP to focus on one thing, as it is easy to just run around and test multiple things, without actually finding anything meaningful
- As you can see above ... SOMEHOW, even though I have cleared all history before, it found an old lab :)

![](/BugForge/img/oaks5.png)

### New skill learned
- New skill addition was added afterwards, learning that sending TOO MANY requests does not work :)

![](/BugForge/img/oaks6.png)

### Focused work
- Because i focused the MCP on a specific task, it is not running wild

![](/BugForge/img/oaks7.png)

### Administrator
- Finds the `administrator` ... at this point I have not provided ANY prompts, it basically has a free will of its own to check

![](/BugForge/img/oaks8.png)

### Summary
![](/BugForge/img/oaks9.png)

- Well, that wasn't bad!
- Thankfully, the MCP I built actually works :)

## Security Takeaways

### Vulnerability: Mass Assignment to Privilege Escalation

  **Type**: A01:2021 - Broken Access Control
  
  **Root Cause**:
  - Server blindly accepts user-supplied `role` value in upgrade request
  - No allowlist validation for permitted role values
  - Exact string matching (`administrator`) without role hierarchy
- 
  **Attack Chain**:
  1. Authenticate as regular user
  2. Send `POST /api/upgrade` with `{"role":"administrator"}`
  3. Receive new JWT with elevated privileges
  4. Access admin-only endpoints (`/api/admin/users`, `/api/admin/flag`)

### Impact
| `Category`      | `Severity`                                   |
| --------------- | -------------------------------------------- |
| Confidentiality | Critical - Full user database exposed        |
| Integrity       | Critical - Attacker can modify any user data |
| Availability    | Medium - Admin could delete accounts         |
  
### Remediation
1. **Implement allowlist validation**
- Define explicit list of permitted upgrade tiers
- Reject any role not in allowlist with 403
  
1. **Separate upgrade logic from role assignment**
- Map tier names to internal roles server-side
- Never accept raw role strings from client

3. **Add authorization checks**
- Verify user is permitted to upgrade to requested tier
- Check payment/subscription status before granting premium roles

4. **Audit logging**
- Log all role changes with before/after values
- Alert on any escalation to admin-level roles
