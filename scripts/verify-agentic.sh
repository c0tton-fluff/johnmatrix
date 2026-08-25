#!/usr/bin/env bash
# Verify agent-readiness behaviors against the BUILT site.
# Usage: bash scripts/verify-agentic.sh [root]   (default root: public)
set -euo pipefail

ROOT="${1:-public}"

python3 - "$ROOT" <<'PYEOF'
import json
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])

def fail(msg):
    print(f"FAIL: {msg}")
    sys.exit(1)

def walk_strings(node):
    """Yield every string value in a JSON structure (dict/list/scalar)."""
    if isinstance(node, dict):
        for v in node.values():
            yield from walk_strings(v)
    elif isinstance(node, list):
        for v in node:
            yield from walk_strings(v)
    elif isinstance(node, str):
        yield node

def is_double_encoded(s):
    """Double-encoding signature: value both starts AND ends with a literal quote."""
    return len(s) >= 2 and s[0] == '"' and s[-1] == '"'

# --- 1. Homepage JSON-LD: Person + WebSite graph, Person sameAs github.com ---
index = root / "index.html"
if not index.exists():
    fail("homepage index.html missing")
html = index.read_text(encoding="utf-8")

ld_blocks = re.findall(r'<script[^>]*type=["\']?application/ld\+json["\']?[^>]*>(.*?)</script>', html, re.S | re.I)
if len(ld_blocks) < 1:
    fail("homepage JSON-LD missing")
try:
    data = json.loads(ld_blocks[0])
except Exception as e:
    fail(f"homepage JSON-LD not valid JSON: {e}")
if not isinstance(data, dict):
    fail("homepage JSON-LD top level is not a JSON object")

graph = data.get("@graph", [])
if not isinstance(graph, list):
    fail("homepage JSON-LD @graph not an array")
person = next((n for n in graph if isinstance(n, dict) and n.get("@type") == "Person"), None)
website = next((n for n in graph if isinstance(n, dict) and n.get("@type") == "WebSite"), None)
if person is None:
    fail("homepage JSON-LD missing Person node")
if website is None:
    fail("homepage JSON-LD missing WebSite node")
same_as = person.get("sameAs", [])
if not any("github.com" in str(u) for u in same_as):
    fail("homepage JSON-LD Person sameAs missing github.com")

# --- 1b. Homepage JSON-LD value assertions (decoded, not double-encoded) ---
if person.get("name") != "johnmatrix":
    fail(f"homepage JSON-LD Person name != johnmatrix (got {person.get('name')!r})")
if same_as != ["https://github.com/c0tton-fluff"]:
    fail(f"homepage JSON-LD Person sameAs != [https://github.com/c0tton-fluff] (got {same_as!r})")
if website.get("url") != "https://johnmatrix.org/":
    fail(f"homepage JSON-LD WebSite url != https://johnmatrix.org/ (got {website.get('url')!r})")
if person.get("@id") != "https://johnmatrix.org/#person":
    fail(f"homepage JSON-LD Person @id != https://johnmatrix.org/#person (got {person.get('@id')!r})")

# --- 1c. Generic double-encoding guard across homepage @graph ---
for s in walk_strings(graph):
    if is_double_encoded(s):
        fail(f"homepage JSON-LD double-encoded string value: {s!r}")

# --- 2. Homepage visible text >= 1500 chars ---
body = re.sub(r'<script[^>]*>.*?</script>', ' ', html, flags=re.S | re.I)
body = re.sub(r'<style[^>]*>.*?</style>', ' ', body, flags=re.S | re.I)
text = re.sub(r'<[^>]+>', ' ', body)
text = re.sub(r'\s+', ' ', text).strip()
if len(text) < 1500:
    fail(f"homepage visible text too short: {len(text)} chars (< 1500)")

# --- 3. <h2>About</h2> present (quote-agnostic) ---
if not re.search(r'<h2[^>]*>\s*About\s*</h2>', html, re.I):
    fail("homepage missing <h2>About</h2>")

# --- 4. Regression: first bugforge article still carries Article JSON-LD ---
bf_files = sorted(root.glob("bugforge/bf-*/index.html"))
if not bf_files:
    fail("no bugforge article index.html found")
bf_html = bf_files[0].read_text(encoding="utf-8")
bf_blocks = re.findall(r'<script[^>]*type=["\']?application/ld\+json["\']?[^>]*>(.*?)</script>', bf_html, re.S | re.I)
if not bf_blocks:
    fail("bugforge article JSON-LD missing")
try:
    bf_data = json.loads(bf_blocks[0])
except Exception as e:
    fail(f"bugforge article JSON-LD not valid JSON: {e}")
if not isinstance(bf_data, dict):
    fail("article JSON-LD top level is not a JSON object")
if bf_data.get("@type") != "Article":
    fail("bugforge article JSON-LD @type is not Article")

# --- 4b. Article value assertions (regression + double-encoding guard) ---
headline = bf_data.get("headline")
if not isinstance(headline, str) or not headline.strip():
    fail("bugforge article JSON-LD headline is empty")
if headline.startswith('"'):
    fail(f"bugforge article JSON-LD headline starts with a literal quote: {headline!r}")
for s in walk_strings(bf_data):
    if is_double_encoded(s):
        fail(f"bugforge article JSON-LD double-encoded string value: {s!r}")

# --- 5. 404 page: choppa gag + agent recovery nav ---
p404 = root / "404.html"
if not p404.exists():
    fail("404.html missing")
html404 = p404.read_text(encoding="utf-8")

# 5a. <img> tag whose src is /arnie-404.png (quote-agnostic - minified HTML strips quotes)
if not re.search(r'<img[^>]*\bsrc=["\']?/arnie-404\.png["\']?[^>]*>', html404, re.I):
    fail("404 page missing image /arnie-404.png")

# 5b. literal choppa gag text
if "Get to the choppa" not in html404:
    fail("404 page missing 'Get to the choppa' text")

# 5c. agent recovery links (quote-agnostic href)
def has_href(href):
    # href followed by optional quote, then a delimiter so "/" does not match "/bugforge/"
    return re.search(r'href=["\']?' + re.escape(href) + r'["\'\s>]', html404, re.I) is not None

for href in ("/", "/bugforge/", "/ai-research/", "/brain-sharing/", "/tags/", "/sitemap.xml"):
    if not has_href(href):
        fail(f"404 page missing recovery link to {href}")

# 5d. arnie-404.png exists as a file (gates pushing without the image)
if not (root / "arnie-404.png").exists():
    fail("404 page image /arnie-404.png missing from site root (drop static/arnie-404.png and rebuild)")

print("agentic verification OK")
PYEOF
