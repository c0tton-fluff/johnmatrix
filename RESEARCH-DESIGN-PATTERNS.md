# Research: AI Red Team Blog Design Patterns for johnmatrix.org

Synthesized from 26 fetched sites (offensive-sec personal + corporate blogs, AI research labs, catalog sites) plus 9 design-pattern searches. All claims cite real fetched markup, class names, hex codes, or quoted structure.

## Executive Summary

The strongest composite direction for an AI red team blog is a **hybrid: clean research-lab structure with terminal-motif accents**. The "lab" skeleton comes from Anthropic's `PublicationList` table (Title | Date | Category) and PortSwigger's article-page anatomy (TLDR + TOC + author callout + colored inline code). The "terminal" personality comes from Omar Ibrahim's portfolio (`[root@host:ops]` header, `NN // section-slug` IDs, CLI-flag subtitles, `signal: online // engagements: open` status line). The "React feel" comes from three cheap micro-interactions that work in vanilla JS: 1.03x image zoom on card hover (Rapid7), a fading-in circular arrow CTA (OpenAI `group-hover:opacity-0 -> 100`), and fade-up scroll-reveal (ProjectDiscovery `opacity:0;transform:translateY(30px)` -> IntersectionObserver). Typography should stay IBM Plex Sans + JetBrains Mono but add IBM Plex Serif for body prose (mirrors Anthropic's Tiempos-for-body + Styrene-for-UI split). Color: a single-accent dark palette - near-black `#0a0a0a` background, `#fafafa` text, one accent (amber `#d47f2a` from Anthropic, or terminal green `#00ff41` if you want to lean terminal). BugForge writeups should move from "cards with vuln-type badges" to a **two-tier presentation**: a `PublicationList`-style table on the index (Title | Date | Category | Severity dot) and a structured per-post page using the 5-section pentest-report scaffold (Scope -> Recon -> Finding -> Impact -> Remediation) with CVE badges rendered as `<strong><a href="GHSA">CVE-XXXX-XXXXX</a></strong>:` bullets inside the body, not as list-page badges.

## Scope & Methodology

- 26 sites fetched via `webfetch` (HTML format) across 5 parallel research agents.
- Each agent quoted real class names, hex codes, font stacks, and DOM structure from the served HTML.
- Source ratings: all primary (the sites themselves), currency = high (live as of 2026-07-17).
- 3 of 9 web searches hit DuckDuckGo CAPTCHA; gaps filled by directly fetching live offensive-sec sites surfaced by successful searches.
- One site (Synack) returned fully truncated markup and is noted as a gap.
- OpenAI's research index is largely client-rendered; analysis based on the rendered shell + card-class system.

---

## 1. Ranked Top 10 Most Borrowable Design Patterns

Ranked by borrowability for an AI red team Hugo blog (impact x ease-of-implementation in vanilla JS + SCSS).

### #1. Anthropic's `PublicationList` table - Title | Date | Category columns
**Source:** `anthropic.com/research` (`PublicationList-module` with `headerTitle caption`="Title", `headerDate caption`="Date", `headerCategory caption`="Category")
**Why #1:** Single highest-signal "we are a lab, not a blog" element found across all 26 sites. Reads as an academic publications index. Cheap to build in Hugo: a `<table>` or CSS-grid `<ul>` with three columns, a `seeMore` link per row.
**Confidence:** HIGH (verbatim class names quoted from fetched HTML).

### #2. PortSwigger article-page anatomy: TLDR + TOC + author callout + colored inline code
**Source:** `portswigger.net/research/the-fragile-lock` (`<h2>TLDR</h2>`, `<ul id="toc" class="table-of-content">`, `<div class="callout-individual-profile">` with 114px photo + name + role + Twitter, `<code><span class="red">/<span class="blue">/<span class="orange">` for syntax tokens)
**Why #2:** The user-designated gold standard. Every article opens with TLDR, then TOC, then body. Researcher-as-author branding. Inline colored code (not separate `<pre>`) keeps technical density high.
**Confidence:** HIGH (quoted from fetched article HTML).

### #3. Content-type encoding in URL slug prefix + matching eyebrow label
**Source:** Rapid7 (`/blog/post/tr-bpfdoor-...` for Threat Research, `dr-` for Detection & Response, `ve-` for Vulnerability, `etr-` for Emerging Threat Report; eyebrow `class="eyebrow-card mb-2 uppercase text-blue-electric"` matches the prefix)
**Why #3:** Scannable without rendering, works in plain text, no DB lookup. For BugForge: `bf-` (BugForge), `rt-` (red team), `ai-` (AI red team), `vuln-` (vuln research). Hugo natively supports this via permalink config.
**Confidence:** HIGH.

### #4. CVE ID as post subtitle / secondary line
**Source:** `0xacb.com` (`<h3 class="post-subtitle">CVE-2026-25253</h3>` directly under `<h2 class="post-title">`)
**Why #4:** Instantly signals "real research" to peers and recruiters. Zero cost. Hugo front-matter field `cve:` rendered as a styled subtitle when present.
**Confidence:** HIGH.

### #5. Subtle card hover: 1.03x image zoom + border color shift + soft shadow
**Source:** Rapid7 (`group-hover:scale-[1.03] transition-all duration-300 ease-in` + `hover:border-gray-pastel hover:[box-shadow:0px_8px_14px_0px_rgba(0,0,0,0.06)]`); OpenAI (`group-hover:[&_img]:scale-102.5` + circular `bg-primary-44` arrow CTA fading `opacity-0 -> group-hover:opacity-100`)
**Why #5:** The "React feel" the user wants. 1.03x is the refined number - 1.1x reads as amateur. Pure CSS, no JS.
**Confidence:** HIGH.

### #6. Fade-up scroll-reveal on cards
**Source:** ProjectDiscovery (`style="opacity:0;transform:translateY(30px)"` animated in via IntersectionObserver/Framer Motion)
**Why #6:** Second "React feel" element. Trivial in vanilla JS: `IntersectionObserver` adds a class when the card enters viewport. `prefers-reduced-motion` fallback skips the animation.
**Confidence:** HIGH.

### #7. Terminal-motif accents: shell-prompt header + `NN // section-slug` IDs + CLI-flag subtitles + status line
**Source:** Omar Ibrahim's portfolio (`omaralmasri.github.io/Portfolio`): `[root@ripcord88x:offensive-ops]` header, `00 // entrypoint` through `07 // signal-notes` section IDs, `regmon.exe` / `enumerate --ad --paths --priv-esc` project subtitles, `signal: online // engagements: open` status banner
**Why #7:** Personality without sacrificing readability. Use as accents (header, section anchors, project subtitles) - not as body font. Pairs with the lab structure.
**Confidence:** HIGH.

### #8. 5-section pentest-report writeup scaffold
**Source:** `designtocodes.com/blog/cybersecurity-portfolio-examples-how-to-build` + `hackthebox.com/blog/security-report-writing` (independent corroboration): Scope -> Recon -> Finding -> Impact -> Remediation
**Why #8:** The de-facto standard offensive-sec writeup layout. Use as the Hugo single-post archetype partial. Each section is an `<h2>` with consistent styling.
**Confidence:** HIGH (two independent sources agree).

### #9. Category caption badge on every card + date-as-eyebrow
**Source:** DeepMind (`class="text-caption meta__category">Models` / `Responsibility & Safety` / `Company`); Google (`glue-card__eyebrow label` = "July 15, 2026" - date in small label above title)
**Why #9:** Editorial magazine feel. For BugForge: caption taxonomy = `Phishing` / `Initial Access` / `Persistence` / `Exfil` / `Detection Bypass` / `AI Prompt Injection` / `Model Exfil` / `Agent RCE`. Date-as-eyebrow reads as a publication date stamp, not a blog timestamp.
**Confidence:** HIGH.

### #10. Whole-card link + revealed arrow CTA on hover
**Source:** DeepMind (`card--is-link` - entire card is a link); OpenAI (`absolute inset-e-4 top-4` 32px circular `bg-primary-44` arrow button, `opacity-0 transition duration-200 group-hover:opacity-100`)
**Why #10:** Third "React feel" element. The whole card is clickable (better hit target), and a small CTA fades in on hover to signal interactivity. Pure CSS.
**Confidence:** HIGH.

### Honorable mentions (situational)
- **Auto-scrolling research ticker at top** (Kudelski `ticker w-slider data-autoplay=true data-duration=500`) - signals "active research org" but adds JS complexity.
- **Algolia InstantSearch with heading breadcrumbs** (Doyensec) - best-in-class search, but requires a paid service. For Hugo, use lunr.js or pagefind for a free static equivalent.
- **Category sidebar with post-count badges** (CrowdStrike `count ml-auto` showing 53/147/361) - signals depth. Pair with per-category SVG icons.
- **`⌘K` command-palette search** (awesome-prometheus-alerts header) - high-value for a writeup-heavy blog. Implementable in ~80 lines of vanilla JS.
- **Privacy-respecting analytics** (samcurry Plausible, 0xacb Cloudflare Insights) - visible "I know what I'm doing" tell to a security audience. Drop GA.

---

## 2. Recommended Design Direction: Hybrid (Lab Skeleton + Terminal Accents)

### The direction in one sentence
A dark, single-accent **publications-index layout** (Anthropic `PublicationList` + PortSwigger article anatomy) with **terminal-motif accents** (Omar's shell-prompt header + `NN //` section IDs + CLI-flag subtitles) and three **vanilla-JS micro-interactions** (1.03x hover zoom, fade-up scroll-reveal, revealed arrow CTA) that together produce the "React feel" without React.

### Why hybrid, not pure terminal or pure lab
- **Pure terminal** (Omar's portfolio, full monospace): designtocodes explicitly warns "the hacker terminal aesthetic is fine in moderation, but readability wins - a recruiter on mobile needs to scan your specialty and certs in seconds." Pure terminal also conflicts with the "AI research lab" register the user wants.
- **Pure lab** (Anthropic, OpenAI): reads as polished but generic. Loses the offensive-sec personality that distinguishes a red-team blog from a generic AI blog.
- **Hybrid**: the lab skeleton gives credibility and readability; the terminal accents (header, section IDs, CLI-flag project subtitles, status line) give personality without compromising body readability. Body stays in IBM Plex Sans/Serif, accents in JetBrains Mono.

### Layout structure (concrete)
```
[Sticky header: shell-prompt brand "root@johnmatrix:ai-red-team" + nav: Research / BugForge / Writeups / Talks / About + ⌘K search icon]
[Status line: "signal: online // engagements: open // last op: 2026-07-15"]
[Hero: H1 "AI Red Team Research" (heading-4 size, understated like DeepMind) + one-line subhead + 3 live stat counters: "N writeups / N CVEs / N AI systems tested"]
[Featured + Recent two-tier: 1 large featured card (image overlay + title + date-eyebrow + category caption) + 3-col grid of recent]
[PublicationList table: Title | Date | Category | Severity-dot (filterable by category via sidebar pills)]
[Series section: numbered multi-part research (nateross.dev pattern) with series-architecture SVG + per-part tag chips]
[Footer: RSS + Plausible + Bluesky/GitHub/X + hex-obfuscated contact]
```

### Per-post page structure (PortSwigger gold standard + 5-section scaffold)
```
[Shell-prompt breadcrumb: root@johnmatrix:ai-red-team > bugforge > CVE-2026-XXXXX]
[H1 title]
[CVE subtitle: <h2 class="post-subtitle">CVE-2026-XXXXX · CVSS 9.8 · GHSA-xxxx</h2>]
[Author callout: 96px photo + name + role + Twitter]
[Publication list: Published: YYYY-MM-DD HH:MM UTC · Updated: ...]
[TLDR section]
[TOC: "On this page" sticky right-rail (aisle.com pattern)]
[Body: 5-section scaffold - Scope / Recon / Finding / Impact / Remediation]
[Colored inline code: <code><span class="red">/<span class="blue">/<span class="orange">]
[Blockquote with branded accent SVG quote mark (Detectify pattern)]
[PDF + slides links (PortSwigger)]
[Related writeups grid]
```

---

## 3. Specific CSS/Layout Ideas for Hugo + Vanilla JS + SCSS

### Layout
```scss
// Centered narrow column for prose (samcurry max-w-3xl pattern)
.prose-column { max-width: 48rem; margin: 0 auto; padding: 0 1.5rem; }

// PublicationList table (Anthropic pattern)
.publication-list {
  display: grid;
  grid-template-columns: 1fr auto auto auto; // Title | Date | Category | Severity
  gap: 0;
  border-top: 1px solid var(--border);
}
.pub-row { display: contents; }
.pub-row > * { padding: 1rem 0; border-bottom: 1px solid var(--border); }
.pub-header { font: 600 0.75rem/1 var(--mono); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); }

// Featured + recent two-tier (DeepMind pattern)
.featured-hero { display: grid; grid-template-columns: 2fr 1fr; gap: 2rem; }
@media (max-width: 768px) { .featured-hero { grid-template-columns: 1fr; } }
```

### Card hover (Rapid7 + OpenAI pattern, 1.03x zoom + revealed CTA)
```scss
.card { position: relative; overflow: hidden; border: 1px solid var(--border); border-radius: 12px; transition: border-color 300ms ease, box-shadow 300ms ease; }
.card:hover { border-color: var(--border-hover); box-shadow: 0 8px 14px 0 rgba(0,0,0,0.06); }
.card__img { transition: transform 300ms ease; }
.card:hover .card__img { transform: scale(1.03); }  // NOT 1.1
.card__cta { position: absolute; top: 1rem; right: 1rem; width: 2rem; height: 2rem; border-radius: 9999px; background: var(--accent); opacity: 0; transition: opacity 200ms ease; }
.card:hover .card__cta { opacity: 1; }
```

### Fade-up scroll-reveal (ProjectDiscovery pattern, vanilla JS)
```scss
.reveal { opacity: 0; transform: translateY(30px); transition: opacity 600ms ease, transform 600ms ease; }
.reveal.is-visible { opacity: 1; transform: none; }
@media (prefers-reduced-motion: reduce) { .reveal { opacity: 1; transform: none; transition: none; } }
```
```js
// vanilla JS, ~20 lines
const io = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); } });
}, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));
```

### Terminal-motif accents (Omar pattern)
```scss
.shell-prompt::before { content: '[root@johnmatrix:ai-red-team]# '; font-family: var(--mono); color: var(--accent); }
.section-id { font-family: var(--mono); color: var(--text-muted); font-size: 0.875rem; }
// <h2 id="01--entrypoint"><span class="section-id">01 // entrypoint</span> Entrypoint</h2>
.cli-subtitle { font-family: var(--mono); font-size: 0.8125rem; color: var(--text-muted); }
// <p class="cli-subtitle">enumerate --ad --paths --priv-esc</p>
.status-line { font-family: var(--mono); font-size: 0.8125rem; }
.status-line .signal-online { color: #76b900; }  // NVIDIA green for "online"
```

### CVE badge (0xacb pattern + AISLE evidence-quote pattern)
```scss
.cve-subtitle { font-family: var(--mono); font-size: 1.125rem; color: var(--text-muted); }
.cve-badge { font-family: var(--mono); font-weight: 700; background: var(--cve-bg); color: var(--cve-fg); padding: 0.125rem 0.5rem; border-radius: 4px; }
.cve-badge--critical { --cve-bg: #7f1d1d; --cve-fg: #fecaca; }
.cve-badge--high { --cve-bg: #78350f; --cve-fg: #fed7aa; }
.cve-badge--medium { --cve-bg: #1e3a8a; --cve-fg: #bfdbfe; }
```

### Sticky right-rail TOC (aisle.com pattern)
```scss
.post-layout { display: grid; grid-template-columns: 1fr minmax(0, 48rem) 16rem; gap: 2rem; }
@media (max-width: 1024px) { .post-layout { grid-template-columns: 1fr; } .toc-rail { display: none; } }
.toc-rail { position: sticky; top: 5rem; align-self: start; font-size: 0.875rem; }
.toc-rail a { color: var(--text-muted); display: block; padding: 0.25rem 0; border-left: 2px solid transparent; }
.toc-rail a.is-active { color: var(--text); border-left-color: var(--accent); }
```
```js
// scrollspy, ~15 lines vanilla JS
const headings = document.querySelectorAll('.post-body h2[id]');
const tocLinks = document.querySelectorAll('.toc-rail a');
const spy = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) { tocLinks.forEach(l => l.classList.remove('is-active')); document.querySelector(`.toc-rail a[href="#${e.target.id}"]`)?.classList.add('is-active'); } });
}, { rootMargin: '-20% 0px -70% 0px' });
headings.forEach(h => spy.observe(h));
```

### Command palette (awesome-prometheus-alerts pattern, ~80 lines vanilla JS)
- Modal overlay with input, filters posts by title/category/CVE from a JSON index Hugo generates at build time.
- Keyboard: `Cmd+K`/`Ctrl+K` to open, `Esc` to close, arrow keys to navigate, Enter to navigate.
- Use Fuse.js (one ~30KB file, no framework) or built-in `Intl.Collator` for fuzzy matching.

### Colored inline code (PortSwigger pattern)
```scss
.post-body code { font-family: var(--mono); font-size: 0.875em; background: var(--code-bg); padding: 0.125rem 0.375rem; border-radius: 4px; }
.post-body code .tok-red { color: #f87171; }
.post-body code .tok-blue { color: #60a5fa; }
.post-body code .tok-orange { color: #fbbf24; }
// Hugo: enable chroma syntax highlighting with a custom style, or use a regex render-hook for inline code spans
```

---

## 4. Color Palette Recommendations (Dark Theme)

### Primary recommendation: "Anthropic warm + terminal green accent"
A warm-tinted dark palette (not pure zinc/neutral) with a single terminal-green accent. Combines Anthropic's warmth (signals "lab") with the terminal green (signals "offensive sec").

| Token | Hex | Role | Source |
|---|---|---|---|
| `--bg` | `#0e0e0c` | Page background (warm near-black, not pure) | Anthropic `#141413` shifted darker |
| `--bg-elevated` | `#161613` | Cards, header | - |
| `--bg-code` | `#1a1a17` | Code blocks | Detectify `#333646` shifted warmer |
| `--border` | `#262622` | Hairline dividers | samcurry `neutral-800` warmed |
| `--border-hover` | `#3f3f38` | Card hover border | Rapid7 `gray-pastel` |
| `--text` | `#faf9f5` | Primary text | Anthropic `#faf9f5` |
| `--text-muted` | `#a8a59c` | Meta, captions | Anthropic warm gray |
| `--text-subtle` | `#7c7c74` | Date eyebrows | Anthropic `#7c7c74` |
| `--accent` | `#76b900` | Single accent (links, CTA, online status) | NVIDIA green |
| `--accent-amber` | `#d47f2a` | Secondary accent (warnings, CVSS high) | Anthropic amber |
| `--cve-critical` | `#7f1d1d` / `#fecaca` | CVE badge bg/fg | - |
| `--cve-high` | `#78350f` / `#fed7aa` | CVE badge bg/fg | - |
| `--cve-medium` | `#1e3a8a` / `#bfdbfe` | CVE badge bg/fg | - |
| `--cve-low` | `#14532d` / `#bbf7d0` | CVE badge bg/fg | - |

### Alternative: "PortSwigger navy + orange" (if you want a more corporate feel)
- `--bg`: `#0a1628` (PortSwigger `theme-navy-1` dark navy)
- `--accent`: `#f63` (PortSwigger orange, confirmed from SVG fill)
- `--text`: `#f4f4f5`
- Reads as more "corporate research" than "hacker lab."

### Why not pure terminal green-on-black
- Pure `#00ff41` on `#000` is the Hollywood hacker cliché. Designtocodes warns it hurts readability.
- The recommended `#76b900` (NVIDIA green) is a more refined, slightly yellow-green that reads as "engineering" not "movie hacker." Used sparingly as an accent, not as body text color.

### Anti-patterns observed
- Pure `#000` on `#fff` (default theme) - reads as unconfigured. Every AI lab uses off-white/cream or warm-tinted dark.
- Multiple accent colors (HackerOne's `primary-innovative-pink` + `primary-trusted-blue` + product colors) - requires a full design system. Pick one.
- 16 dark-mode presets (BHIS) - overkill. Ship one dark, optionally one light.

---

## 5. Typography Recommendations

### Keep: IBM Plex Sans + JetBrains Mono. Add: IBM Plex Serif for body prose.

The user's current stack (IBM Plex Sans + JetBrains Mono) is already strong - both are open-source, both have variable-font versions, both are used by serious engineering orgs. **Do not switch.** The gap is body prose: a sans body at long-form reading lengths is fatiguing. Add IBM Plex Serif (same family, free, variable) for post body text. This mirrors the Anthropic split: Tiempos (serif) for body + Styrene (sans) for UI + JetBrains Mono for code.

### Recommended role assignment
| Role | Font | Size | Weight | Notes |
|---|---|---|---|---|
| H1 (page title) | IBM Plex Sans | `clamp(2rem, 4vw, 3rem)` | 600 | Understated like DeepMind `heading-4` H1, not giant |
| H2 (section) | IBM Plex Sans | 1.5rem | 600 | With `NN //` mono section-id prefix |
| H3 (subsection) | IBM Plex Sans | 1.25rem | 600 | - |
| Post body | **IBM Plex Serif** | 1.0625rem (17px) | 400 | `line-height: 1.7`; max-width 48rem |
| UI / nav / cards | IBM Plex Sans | 0.875rem-1rem | 500 | - |
| Meta / eyebrows / captions | JetBrains Mono | 0.75rem | 500 | `letter-spacing: 0.08em; text-transform: uppercase` (Detectify pattern) |
| Code blocks | JetBrains Mono | 0.875rem | 400 | Dark bg `#1a1a17`, colored tokens |
| CVE badges | JetBrains Mono | 0.875rem | 700 | - |
| Shell-prompt accents | JetBrains Mono | 0.8125rem | 500 | `[root@johnmatrix:ai-red-team]#` |
| CLI-flag subtitles | JetBrains Mono | 0.8125rem | 400 | `enumerate --ad --paths --priv-esc` |

### Type-scale tokens (SCSS)
```scss
:root {
  --font-sans: 'IBM Plex Sans', system-ui, sans-serif;
  --font-serif: 'IBM Plex Serif', Georgia, serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
  --text-h1: clamp(2rem, 4vw, 3rem);
  --text-h2: 1.5rem;
  --text-h3: 1.25rem;
  --text-body: 1.0625rem;
  --text-ui: 0.9375rem;
  --text-caption: 0.75rem;
  --leading-body: 1.7;
  --tracking-caption: 0.08em;
}
```

### Why this works
- IBM Plex family has a coherent geometric feel across sans/serif/mono - they were designed together by IBM, so the pairing looks intentional, not random.
- JetBrains Mono is already the user's choice and is also Anthropic's mono (`jetbrainsmono_7d7bdbc6` in their font stack) - validated by the gold-standard AI lab.
- Adding the serif for body is the single highest-impact typography upgrade. It separates "reading mode" (post body) from "scanning mode" (index, nav, cards) without adding a second unrelated family.

### Anti-patterns observed
- Wix default Arial (jhaddix) - instant amateur tell.
- Bootstrap default + no custom font (PT SWARM) - reads as unconfigured.
- 8-font system (Anthropic) - overkill for a personal site. Three (sans/serif/mono) is the sweet spot.

---

## 6. BugForge Writeup Presentation: From "Cards with Badges" to Professional

### Current state (per user)
Cards with vuln-type badges.

### Problem with current approach
Vuln-type badges on index cards add visual noise without adding information density. PortSwigger (the gold standard) deliberately keeps CVEs and severity **off the list page** - they live inside the article body as `<strong><a href="GHSA">CVE-XXXX-XXXXX</a></strong>:` bullets. The list page stays clean.

### Recommended two-tier presentation

#### Tier 1: Index page - `PublicationList` table (Anthropic + PortSwigger hybrid)
Replace the card grid with a publications-index table. Each row = one writeup. Columns:

| Title | Date | Category | Severity |
|---|---|---|---|
| `<a>OpenClaw One-Click ATO to RCE</a>` | `Jan 29, 2026` | `BugForge` | `● Critical` (colored dot, not badge) |

```html
<table class="publication-list">
  <thead>
    <tr><th>Title</th><th>Date</th><th>Category</th><th>Severity</th></tr>
  </thead>
  <tbody>
    <tr class="pub-row">
      <td><a href="/bugforge/openclaw-one-click-rce/">OpenClaw One-Click ATO to RCE</a>
        <span class="cve-subtitle">CVE-2026-25253</span></td>
      <td><time datetime="2026-01-29">Jan 29, 2026</time></td>
      <td><span class="caption">BugForge</span></td>
      <td><span class="sev-dot sev-critical" title="Critical"></span></td>
    </tr>
  </tbody>
</table>
```

- Severity is a **colored dot** (8px circle), not a badge - scannable without dominating.
- CVE ID is a **subtitle under the title** (0xacb pattern), not a badge.
- Category is a **caption** (uppercase mono, Detectify pattern).
- Filterable by category via sidebar pills (CrowdStrike count-badges pattern).

#### Tier 2: Featured + recent (for the homepage, not the BugForge index)
On the homepage hero, show one featured BugForge writeup (large card with image overlay, CrowdStrike `blog_featured_latest` pattern) + a 3-card recent row. The BugForge index itself stays as the table.

#### Tier 3: Per-post page - 5-section scaffold + CVE evidence-quote pattern
```
[Shell-prompt breadcrumb]
[H1 title]
[CVE subtitle: CVE-2026-25253 · CVSS 9.8 · GHSA-xxxx (linked)]
[Author callout: photo + name + "AI Red Team Lead" + @handle]
[Published: 2026-01-29 12:32 UTC · Updated: ...]
[TLDR]
[TOC: On this page (sticky right-rail)]
[Scope] - what was tested, target system, AI model/agent
[Recon] - how you mapped it, attack surface
[Finding] - the vulnerability, exploitation steps, colored inline code
[Impact] - what it let an attacker do, CVSS justification, quoted maintainer response (AISLE pattern)
[Remediation] - the fix, vendor patch link, timeline
[Related writeups grid]
```

### Why this is more professional
- **Index page**: publications-index table reads as "lab" not "blog." Scannable at high density. No badge noise.
- **CVEs**: present as evidence (linked, in-body) not as marketing (badges on cards). This is how PortSwigger and AISLE do it.
- **Severity**: a colored dot, not a word badge - conveys the same info at 1/4 the visual weight.
- **Post page**: the 5-section scaffold is the industry-standard pentest-report structure (HTB + designtocodes consensus). Adds credibility instantly.
- **CVE evidence-quote**: AISLE's pattern of quoting the maintainer's endorsement ("We appreciate the high quality of the reports") is a strong professional signal - shows real disclosure process, not just a finding.

---

## 7. Terminal/CLI vs Clean Research Lab vs Hybrid: Hybrid, with reasoning

### Recommendation: Hybrid (lab skeleton + terminal accents)

### Reasoning

**Pure terminal aesthetic (Omar's portfolio, full monospace):**
- Pros: instant personality, on-brand for offensive sec, distinctive.
- Cons: designtocodes warns "readability wins - a recruiter on mobile needs to scan your specialty in seconds." Body text in mono is fatiguing at length. Conflicts with the "AI research lab" register the user explicitly wants. Reads as "hacker portfolio" not "AI red team researcher."
- Verdict: use as accents only.

**Pure clean research lab (Anthropic, OpenAI, DeepMind):**
- Pros: polished, readable, credible, "React feel" achievable. The user explicitly wants this register.
- Cons: generic. Could be any AI company. Loses the offensive-sec personality that distinguishes a red-team blog from a generic AI blog.
- Verdict: use as the skeleton.

**Hybrid (recommended):**
- Lab skeleton: Anthropic `PublicationList` table, PortSwigger article anatomy, DeepMind featured+recent, Detectify caption badges, Rapid7/OpenAI card hovers.
- Terminal accents (used sparingly, only in UI chrome - never body): Omar's shell-prompt header, `NN // section-slug` IDs, CLI-flag project subtitles, `signal: online // engagements: open` status line.
- Body text: IBM Plex Serif (readable, lab-like). UI/accents: IBM Plex Sans + JetBrains Mono.
- Result: reads as "this person does serious AI red-team research AND knows the offensive-sec tradition." Neither generic nor costume.

### The line to walk
- Terminal motifs in **chrome only** (header, section IDs, project subtitles, status line, breadcrumbs).
- Lab structure in **layout** (PublicationList table, featured+recent, TOC, author callout).
- Readable serif in **body** (IBM Plex Serif).
- Mono in **code, captions, CVEs, CLI accents** (JetBrains Mono).
- Never: mono body text, full-screen green-on-black, more than one accent color.

### Confidence
HIGH. The hybrid recommendation is corroborated by 3 independent lines of evidence:
1. designtocodes (synthesis article) explicitly recommends "terminal in moderation + readability wins."
2. Anthropic (AI lab gold standard) uses JetBrains Mono for code/accents + Tiempos serif for body - the same split.
3. PortSwigger (offensive-sec gold standard) uses mono for code + sans for body + terminal-style "TLDR" labels - the same restraint.

---

## Conflicting Viewpoints

- **Featured+list vs flat grid:** Anthropic/DeepMind/OpenAI use featured+recent (editorial curation, more lab-like); Google/NVIDIA lean flatter (complete index). For a low-volume personal blog, featured+list is better - it signals curation. For a high-volume BugForge index, the flat `PublicationList` table is better - it signals completeness. Use both: featured+recent on homepage, flat table on `/bugforge/`.
- **Filter by year vs by category:** Google filters by year (2012-2026); Anthropic/DeepMind surface category captions. For red-team work, **category (technique/target/severity) is more useful than year** - researchers think in vulnerability classes, not calendar years (PortSwigger's nav confirms this: XSS, Request Smuggling, Template Injection as top-level categories).
- **Table vs card index:** Anthropic's `PublicationList` table is most efficient for dense reading; DeepMind/Google cards are more visual. For BugForge (CVE-heavy, dense), table wins. For the homepage (showcase, low count), cards win.
- **Search:** Algolia (Doyensec) is best-in-class but paid. Free static alternatives: lunr.js (prebuilt index), pagefind (post-build indexer, best for Hugo). ⌘K command palette (awesome-prometheus-alerts) is high-value for a writeup-heavy blog.

## Limitations & Gaps

- **Synack** (`synack.com/blog`): fetch returned 199,909 bytes but fully truncated; zero usable markup recovered. Not analyzed.
- **HackerOne** and **BHIS** blog-index post-card structures were below the truncation fold; only their global headers/mega-navs were analyzed.
- **OpenAI** research index is largely client-rendered; analysis based on the rendered shell + card-class system, not the full populated list.
- **PortSwigger** exact hex codes for `theme-navy-1` and `theme-grey-5` live in compiled `psresearch.css` which was not fetched; only orange `#f63` was confirmed from inline SVG.
- 3 of 9 web searches (terminal-style, hacker-portfolio, CVE-badge) were CAPTCHA-blocked on DuckDuckGo. Specific Hugo terminal-theme results were not retrieved. Known candidates worth manual review: `panr/hugo-theme-terminal`, `rhazdon/hugo-theme-hello-friend`.
- Individual post pages were not fetched for most sites (only PortSwigger's article page was analyzed in detail). Post-page patterns for Anthropic/OpenAI/DeepMind are inferred from their index-page design systems.
- Color hex codes for sites using compiled CSS bundles (Detectify `ink-800`, ProjectDiscovery `midnight`/`sun`) were not always extractable from inline HTML; values cited are from inline-styled elements or `<meta name="theme-color">` where available.

## References

### Personal researcher sites (fetched 2026-07-17)
- `https://www.jhaddix.com/` - Jason Haddix (Wix, light, Arial default)
- `https://samcurry.net/` - Sam Curry (Next.js, dark, grayscale-only, fixed-height thumbnail rows, Plausible)
- `https://0xacb.com/` - 0xacb (Jekyll + Clean Blog theme, Hind + Quantico, CVE-as-subtitle)

### Offensive-sec corporate research blogs (fetched 2026-07-17)
- `https://portswigger.net/research/` + `/research/the-fragile-lock` - GOLD STANDARD (navy + orange `#f63`, TLDR + TOC + author callout + colored inline code)
- `https://swarm.ptsecurity.com/` - PT SWARM (WordPress + Bootstrap, multi-author bylines, CVEs as `<strong>` GHSA links)
- `https://blog.doyensec.com/` - Doyensec (Jekyll + Hyde, Algolia InstantSearch with heading breadcrumbs, video hero)
- `https://www.synack.com/blog/` - Synack (FETCH FAILED - gap)
- `https://www.hackerone.com/blog` - HackerOne (Drupal + Tailwind, `blue-black` + `primary-innovative-pink` design tokens, animated radius transitions)
- `https://labs.detectify.com/` - Detectify (Next.js + styled-components, Averta font, purple `#957CF6`, uppercase tracked captions)
- `https://blog.projectdiscovery.io/` - ProjectDiscovery (Next.js, Geist Sans, `midnight` dark, 3D card hover, fade-up scroll animations)
- `https://www.blackhillsinfosec.com/` - BHIS (WordPress + Themify, WP Dark Mode 16 presets, over-engineered)

### Corporate security blogs (fetched 2026-07-17)
- `https://www.sonarsource.com/blog/` - Sonar (Tailwind, Inter + Poppins + JetBrains Mono, custom color tokens `persistence-purple #290042`)
- `https://www.fastly.com/blog` - Fastly (Astro, ESRebondGrotesque + Inter, marquee logo scroller, scroll-driven quote carousel)
- `https://www.elastic.co/blog/` - Elastic (React, named tokens `blurple`/`elastic-teal`, Space Mono for code)
- `https://research.kudelskisecurity.com/` - Kudelski (Webflow, Georgia serif, auto-scrolling research ticker, hover-to-switch mega-menu)
- `https://www.tenable.com/blog` - Tenable (Drupal, `#E7FF00` electric lime accent, Lottie button animations, hex motif)
- `https://www.crowdstrike.com/blog/` - CrowdStrike (Adobe AEM, red `#EC0000` + blue `#1F60A2` gradient, category sidebar with count badges)
- `https://www.sprocketsecurity.com/blog` - Sprocket (Poppins + Roboto + Geist Mono, author role/title displayed, scrollspy)
- `https://www.cobalt.io/blog` - Cobalt (HubSpot, `punch-` design system, read-time estimates on cards)
- `https://www.rapid7.com/blog/` - Rapid7 (Next.js, `font-goodProNarrow`, URL-prefix content typing `tr-`/`dr-`/`ve-`, 1.03x hover zoom)

### AI research labs (fetched 2026-07-17)
- `https://www.anthropic.com/research` - Anthropic (8-font system incl. Tiempos + Styrene + JetBrains Mono, `PublicationList` table, warm earthy palette `#141413`/`#faf9f5`/`#d47f2a`)
- `https://openai.com/research/` - OpenAI (Next.js + Tailwind, `text-balance` headings, `group-hover:scale-102.5` + revealed circular CTA)
- `https://deepmind.google/discover/` -> `/blog/` - DeepMind (Google Sans Flex variable font, `card-blog` with `meta__category` captions, understated `heading-4` H1)
- `https://ai.googleblog.com/` -> `research.google/blog/` - Google (Glue design system, year-archive filter 2012-2026, date-as-eyebrow, Roboto Mono)
- `https://research.nvidia.com/` -> `nvidia.com/en-us/research/` - NVIDIA (NVIDIASansVF variable font, `#76B900` green, expandable use-case cards, `labs/` sub-sites)

### Design-pattern searches and synthesis sources (fetched 2026-07-17)
- `omaralmasri.github.io/Portfolio/` - Omar Ibrahim (terminal aesthetic exemplar: shell-prompt header, `NN //` section IDs, CLI-flag subtitles, status line)
- `designtocodes.com/blog/cybersecurity-portfolio-examples-how-to-build/` - 9 portfolio patterns + 5-section writeup scaffold
- `nateross.dev/blog/ai-security-research` - 7-part AI security series (series-architecture SVG, per-part tag chips, prerequisites split)
- `aisle.com/blog/what-ai-security-research-looks-like-when-it-works` - AI CVE research (CVE-badge + CVSS + maintainer-quote pattern, sticky right-rail TOC)
- `samber.github.io/awesome-prometheus-alerts/` - catalog site (Astro + TS, count-driven hero, category card grids with per-item badges, ⌘K search)
- `github.com/samber/awesome-prometheus-alerts` - repo README (Astro 77.4%, category subsections)
- `hackthebox.com/blog/security-report-writing` - writeup/report best practices (corroborates 5-section scaffold)
