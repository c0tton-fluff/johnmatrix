- Hi there!
- Let me take you on a journey from start to finish of `Claude MCP` running through the tests.

- Most interesting part of it is ... I have not given Claude **ANY** hints or ideas of where to look.

## Enumeration

- As usual, I registered, logged in and played around the page to make sure the `Burp History` is full and I can understand what the application does
- I then asked: `Please look into the Burp history using MCP and web-app-pentest skill to find a vulnerability. After we find vulnerability, there will be a flag as this is a CTF.`
- The usage of tokens was not too crazy today, altogether just under 10k.

### Step 1. Analysis

- Claude started off going through `IDOR` as first option

![Daily](/BugForge/img/sokudo-bac1.png)

### Step 2.  Query parameters

![Daily](/BugForge/img/sokudo-bac2.png)

- Made an observation, noted it down and moved on

### Step 3. Mass assignment

![Daily](/BugForge/img/sokudo-bac3.png)

- Testing the `mass assignment`

![Daily](/BugForge/img/sokudo-bac4.png)

- That did not work

![Daily](/BugForge/img/sokudo-bac5.png)

### Step 4.  PUT /api/stats test

![Daily](/BugForge/img/sokudo-bac6.png)

### Summary

![Daily](/BugForge/img/sokudo-bac7.png)

## Security Takeaway

### Stats Manipulation via Direct API Update

### Vulnerability
- The `PUT /api/stats` endpoint allows authenticated users to directly modify their statistics (`best_wpm`, `total_sessions`, `avg_wpm`) without server-side validation. -
- The endpoint accepts arbitrary values, bypassing the intended game flow where stats should only update through legitimate session submissions.

- **Discovery method:**
    - PUT request returned `{"error":"No valid fields to update"}` instead of 404, revealing the endpoint exists and accepts specific fields.

### Impact
- Leaderboard manipulation / cheating
- Integrity loss of competitive ranking system
- Potential reputational damage if exploited at scale

### Remediation
- Remove direct stat modification endpoint or restrict to admin-only
- Stats should only be calculated server-side from validated session data
- Implement rate limiting and anomaly detection for suspicious stat changes
- Add audit logging for any stat modifications
