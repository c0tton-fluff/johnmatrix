---
title: Tanuki
tags:
  - bugforge
  - idor
  - broken-access-control
  - burpsuite
  - mcp
---

Today's daily challenge is a straightforward one, but I used BurpSuite with MCP server to solve as it as I am trying to learn and understand the AI impact.

![Daily](/BugForge/img/tanuki-01.png)

# Recon 

- We get a landing page, so as usual we can register
![Daily2](/BugForge/img/tanuki-02.png)

- The best way to check for web application vulnerabilities is to simply use it, not automatically search for them
- Majority of the time, we can observe something out of the ordinary while simply clicking through and checking the responses from the application/server

![Daily3](/BugForge/img/tanuki-03.png)


- After browsing decks, we can add them to dashboard and `Start Studying`

- This pretty much gives us all of the functionality of the website, we can continue now within BurpSuite

## BurpSuite

- Any time we see `GET` request and numbers within, it would be **rude** not to play around and check

![Daily4](/BugForge/img/tanuki-04.png)


- In this case, I approached it different ... as I have my MCP connected to Burp, I used `codex` to help me solve this and see whether there is a good way to showcase AI usage.

### MCP BurpSuite

- I asked first to give me an idea whether it can find anything within the HTTP history of Burp, as I clicked around the page, based on the `hint`

![Daily5](/BugForge/img/tanuki-05.png)


- The suggestion was taken literally, so that one was on me :)
- Next, I asked to dig deeper and see whether there is something meaningful that we can use
- It was very adamant about the `42 Socket.IO event`, I had to politely ask to change approach

![Daily6](/BugForge/img/tanuki-06.png)


- Since I have observed the `API stats` before with the `GET`, I redirected its brain there

![Daily7](/BugForge/img/tanuki-07.png)


- It was able to run tests and found the correct way to get the flag

![Daily8](/BugForge/img/tanuki-08.png)


- Thank you for reading, my first (of many to come) published writeup! 
- Keep Learning and Be Useful! 

## Security Takeaways
### Impact

  - Unauthorized access to other users’ data via IDOR
  - Potential exposure of private content and user metadata
  - Demonstrates broken authorization logic

### Vulnerability Classification

  - OWASP Top 10: Broken Access Control
  - Vulnerability Type: IDOR (Insecure Direct Object Reference)
  - CWE: CWE-639 – Authorization Bypass Through User-Controlled Key

  Root Cause
  The backend trusts client‑controlled identifiers (e.g. resource IDs in GET requests) without verifying that the authenticated user is allowed to access the referenced object.

### Remediation

  - Enforce server‑side authorization checks on every object access
  - Validate ownership or access rights before returning data
  - Avoid using predictable, sequential IDs where possible
  - Add logging and alerting for unusual access patterns


