---
title: Sokudo
tags:
  - bugforge
  - api-enumeration
  - endpoint-discovery
  - burpsuite
  - broken-access-control
---

- Today's challenge is a very interesting one and new to me
- Recently, I came across a very helpful addition in testing APIs
- Definitely worth getting it! - https://gist.github.com/jhaddix/daba27d11fdd97d9077d610dccbe91df
	- It is invaluable in testing and uncovers many hidden paths
    - Super easy to save too:
        - Copy the script and save a new tab
        - Instead of URL you paste in the script, name it, and you are good to go
        - When testing, just click on it and it will take few seconds and spit out a nice page for you

```javascript
javascript:(function(){var scripts=document.getElementsByTagName("script"),regex=/(?<=(\"|\%27|\`))\/[a-zA-Z0-9_?&=\/\-\#\.]*(?=(\"|\'|\%60))/g,jsRegex=/(?<=(\"|\'|\%60))(?:\/|https?:\/\/)[a-zA-Z0-9_?&=\/\-\#\.]+\.js(?:\?[^"'%60]*)?(?=(\"|\'|\%60))/g;const results=new Set;const paramMap=new Map();const jsFiles=new Set();function processContent(t,src){var e=t.matchAll(regex);for(let r of e){results.add(r[0]);var params=r[0].split('?')[1];if(params){params.split('&').forEach(param=>{var [key,]=param.split('=');if(key){if(!paramMap.has(key)){paramMap.set(key,[]);}paramMap.get(key).push(src||'Inline script or HTML');}});}}var j=t.matchAll(jsRegex);for(let r of j){jsFiles.add(r[0]);}}for(var i=0;i<scripts.length;i++){var t=scripts[i].src;if(t){jsFiles.add(t);fetch(t).then(function(t){return t.text()}).then(text=>processContent(text,t)).catch(function(t){console.log("An error occurred: ",t)});}else{processContent(scripts[i].textContent);}}var pageContent=document.documentElement.outerHTML;processContent(pageContent,'Page content');function writeResults(){var div=document.createElement("div");div.style.cssText="position:fixed;top:0;left:0;width:100%;height:100%;background:#f0f8ff;color:#333;overflow:auto;z-index:9999;padding:20px;font-family:Arial,sans-serif;";var content="<h2 style='color:#4a69bd;'>Endpoints Found: " + results.size + "</h2>";content+="<div style='display:grid;grid-template-columns:1fr 1fr;gap:10px;'>";content+=Array.from(results).map(endpoint=>{var fullUrl=endpoint.startsWith("http")?endpoint:window.location.origin+endpoint;return "<div style='background:#fff;margin-bottom:10px;padding:10px;border-left:5px solid #4a69bd;'>" + endpoint + "</div><div style='background:#fff;margin-bottom:10px;padding:10px;border-left:5px solid #4a69bd;'><a href='" + fullUrl + "' target='_blank' style='color:#4a69bd;text-decoration:none;word-break:break-all;'>" + fullUrl + "</a></div>"}).join("");content+="</div>";content+="<h2 style='color:#4a69bd;margin-top:20px;'>Parameters Found:</h2>";content+="<div style='display:grid;grid-template-columns:1fr 1fr;gap:10px;'>";paramMap.forEach((sources,param)=>{content+="<div style='background:#fff;margin-bottom:10px;padding:10px;border-left:5px solid #4a69bd;'>" + param + "</div><div style='background:#fff;margin-bottom:10px;padding:10px;border-left:5px solid #4a69bd;'>" + sources.join('<br>') + "</div>";});content+="</div>";content+="<h2 style='color:#4a69bd;margin-top:20px;'>JS Files Found: " + jsFiles.size + "</h2>";content+="<div style='display:grid;grid-template-columns:1fr;gap:10px;'>";jsFiles.forEach(file=>{var fullUrl=file.startsWith("http")?file:window.location.origin+file;content+="<div style='background:#fff;margin-bottom:10px;padding:10px;border-left:5px solid #4a69bd;'><a href='" + fullUrl + "' target='_blank' style='color:#4a69bd;text-decoration:none;word-break:break-all;'>" + file + "</a></div>";});content+="</div>";div.innerHTML=content;var closeBtn=document.createElement("button");closeBtn.textContent="Close";closeBtn.style.cssText="position:fixed;top:10px;right:10px;background:#4a69bd;color:white;border:none;padding:10px 20px;cursor:pointer;";closeBtn.onclick=function(){document.body.removeChild(div);};div.appendChild(closeBtn);document.body.appendChild(div)}setTimeout(writeResults,3000);})();
```

## Enumeration

- As usual, we can check the way the website works and how it behaves
- It is the good old trusted typing practice

![Daily](/BugForge/img/Sokudo-01.png)

- Since there is not much functionality apart from the practice, we can check what is BurpSuite showing

![Daily](/BugForge/img/Sokudo-02.png)

- First thing to notice is the `/v2/login` ... if there is a v2 ... there definitely used to be `/v1`

![Daily](/BugForge/img/Sokudo-03.png)

- This confirms it
- With the helpful script mentioned before, we can enumerate more without guessing

## Endpoint checker

- `Endpoints Found: 21`

![Daily](/BugForge/img/Sokudo-04.png)

- This is interesting
- Apart from the `/v1`, we also find multiple `/v2` endpoints with `admin` and `flag`
- Now the question is how we can get there
- I thought this was as simple as this ...

![Daily](/BugForge/img/Sokudo-05.png)

- I knew it felt too easy ...

### JWT token

- I tried multiple `/v2` ways but was not able to move forward
- I tried with `/v1` since I felt this could be at least worth to test

![Daily](/BugForge/img/Sokudo-06.png)

- I simply used the token I had and of course it did not work, but this time, I knew `JSON Web Token` option in Burp was open

![Daily](/BugForge/img/Sokudo-07.png)

- With this I have tried to abuse it in the simplest way, by changing the `role` from `user` to `admin`
- That still did not work

![Daily](/BugForge/img/Sokudo-08.png)

- This time I thought of two things ... either changing the `"id": 4` or simply changing `alg : none`
- The `id = 1` worked like a charm

![Daily](/BugForge/img/Sokudo-09.png)

### MCP attempt

- Here I wanted to see the approach from MCP server within Burp
- I gave it some options but wanted to see how far it can take me

![Daily](/BugForge/img/Sokudo-10.png)

![Daily](/BugForge/img/Sokudo-11.png)

![Daily](/BugForge/img/Sokudo-12.png)

- It struggled to find a way in...

![Daily](/BugForge/img/Sokudo-13.png)

- I was still a firm believer it was able to accomplish it, even thought I felt it started to go away from the goal, more trying to overcomplicate its own existence ...

![Daily](/BugForge/img/Sokudo-14.png)

- At some point though, it started to show some promise!

![Daily](/BugForge/img/Sokudo-15.png)

- Found its limitation and helped it with the token I have already created previously 

![Daily](/BugForge/img/Sokudo-16.png)

- When given a hand, it was able to work it out ...
- The whole MCP journey for me with Burp is brand new and I see its huge potential for sure!

![Daily](/BugForge/img/Sokudo-17.png)

- Keep learning and be useful!


## Security Takeaways
### Impact

  - Unauthorized access to admin‑only endpoints and sensitive data
  - Privilege escalation by modifying client‑controlled JWT claims
  - Demonstrates broken authorization at the API layer

### Vulnerability Classification

  - OWASP Top 10: Broken Access Control
  - Vulnerability Type: JWT claim manipulation / privilege escalation
  - CWE: CWE-269 – Improper Privilege Management

### Root Cause
  - The backend trusts client‑supplied JWT claims (e.g., role/id) without validating them against server‑side authorization logic, allowing users to escalate privileges.

### Remediation

  - Never trust JWT claims alone for authorization decisions
  - Re‑validate user roles/permissions server‑side on every request
  - Enforce strict JWT signing and verification (reject alg: none)
  - Use least‑privilege roles and separate admin endpoints


