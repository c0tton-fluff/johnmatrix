---
title: The AI-Era Security Engineer
tags:
  - security
  - ai
  - typescript
  - code-review
---

# The AI-Era Security Engineer

A practical guide for security professionals building, specifying, and reviewing code in the age of AI-assisted development.

## The Mindset Shift

Traditional security review: find vulnerabilities in human-written code.

AI-era security engineering:
- Design systems **secure by default**
- Write specs that **produce secure code** from AI tools
- Recognize the **predictable mistakes** AI consistently makes

The game changed. Catch up or get caught.

---

## Type Systems: Your New Superpower

You don't need a CS degree. You need to read typed code and spot when types are being bypassed.

### What Types Give You

| Benefit | Security Relevance |
|---------|-------------------|
| Explicit data shapes | Function contracts visible. No hidden assumptions. |
| Null safety | Forces explicit handling vs runtime crashes |
| Boundary enforcement | Distinguish validated from unvalidated input |
| Compile-time guarantees | Entire vulnerability classes eliminated before runtime |

### The Four Languages You'll Encounter

**TypeScript** (Web/Full-stack)
```typescript
// Types show you the contract
function processUser(input: RawUserInput): ValidatedUser | ValidationError {
  // Key questions: what makes RawUserInput become ValidatedUser?
  // Where's the validation boundary?
}
```
Review points: `any` bypasses safety, watch for `as` assertions, verify validation at boundaries.

**Go** (Backend/Infrastructure)
```go
// Explicit error handling. No exceptions hiding control flow.
func ProcessPayment(amount int64) (Receipt, error) {
    // Every error path is traceable
}
```
Review points: ignored errors (`_ =`), goroutine race conditions, defer cleanup.

**Rust** (Systems/Performance-critical)
```rust
// Ownership tells you who can access data and when
fn process(data: String) -> Result<Output, Error> {
    // data is *moved* here. Original caller loses access.
}
```
Review points: `unsafe` blocks, `.unwrap()` calls skipping errors, lifetime annotations.

**Python** (ML/Scripting)
```python
def process_input(data: str) -> SanitizedOutput:
    # Type hints are documentation, not enforcement
    # Implementation must be verified manually
```
Review points: hints optional/unenforced, dynamic typing surprises, pickle deserialization.

### The One Concept That Transfers Everywhere

**Parse, Don't Validate**

Weak:
```
receive input → validate → use (hoping validation was done)
```

Strong:
```
receive input → parse into validated type → type system enforces validity
```

When reviewing: "Does the type system **guarantee** this data is valid, or are we **hoping** someone validated it earlier?"

---

## AI-Generated Code Vulnerabilities

AI makes predictable mistakes. Learn these patterns = catch the majority of issues.

### The Top 5 (By Frequency)

#### 1. Broken Access Control
The #1 CodeQL alert on GitHub. AI scaffolds endpoints that look correct but lack auth checks.

**Look for:**
- Routes without authentication middleware
- Authorization checks missing after authentication
- Direct object references without ownership validation
- CRUD operations with no permission model

#### 2. Injection Flaws
AI concatenates strings when it should use parameterized queries.

**Look for:**
- String interpolation in SQL, shell commands, LDAP
- Template rendering with unescaped user input
- Dynamic code execution (`eval`, `exec`, `Function`)

#### 3. Secrets & Configuration
AI training data included bad practices. They persist.

**Look for:**
- Hardcoded API keys, passwords, tokens
- Secrets in env vars that get logged/exposed
- Default configs left in place
- `.env` files not in `.gitignore`

#### 4. Insecure Dependencies
AI suggests packages without checking security posture.

**Look for:**
- Outdated packages with known CVEs
- Typosquatted package names
- Packages with excessive permissions
- Abandoned/unmaintained deps

#### 5. Missing Error Handling
AI generates the happy path and glosses over failures.

**Look for:**
- Empty catch blocks
- Errors logged but not handled
- Sensitive info in error messages
- Missing timeout/retry logic

### Language-Specific AI Pitfalls

| Language | Common AI Mistake | What to Check |
|----------|------------------|---------------|
| TypeScript | Using `any` to compile | Search for `any`, `as unknown` |
| Go | Ignoring returned errors | Search for `_ =` patterns |
| Rust | Excessive `.unwrap()` | Search for `unwrap`, `expect` in prod paths |
| Python | Shell injection via subprocess | Check all `subprocess`/`os.system` calls |

---

## Speccing Projects for AI

Good specs = secure code on first pass. Bad specs = endless iteration fixing vulns.

### The Security-First Spec Template

```markdown
## Overview
[One paragraph: what and why]

## Security Requirements
- Authentication: [method, provider]
- Authorization: [model: RBAC, ABAC, ownership-based]
- Data classification: [what's sensitive, what's not]
- Compliance: [SOC2, GDPR, etc.]

## Trust Boundaries
- External input: [all sources of untrusted data]
- Internal services: [what can talk to what]
- Data flow: [where sensitive data moves]

## Technical Constraints
- Language: [choice and rationale]
- Dependencies: [approved packages or criteria]
- Infrastructure: [where it runs, what it accesses]

## Interface Definitions
[Types/schemas for all inputs and outputs]

## Error Handling
- How failures are handled
- What gets logged vs not
- User-facing vs internal error messages

## Out of Scope
[What this does NOT do. Prevents AI adding features.]
```

### Spec Principles

1. **Be explicit about what NOT to do** - AI fills gaps with assumptions. "Do not store passwords in plain text" beats hoping.
2. **Define types before implementation** - Provide interfaces, AI implements. Let AI design interfaces = review forever.
3. **Specify security model upfront** - "All endpoints require auth except /health and /public/*" = no ambiguity.
4. **Include constraints as requirements** - "Use parameterized queries for all database access" = checkable criterion.
5. **Reference standards, not intentions** - "Follow OWASP ASVS Level 2" is verifiable. "Make it secure" is not.

---

## The 15-Minute Security Review

For AI-generated PRs, check in order:

| Step | Time | Focus |
|------|------|-------|
| **1. Boundaries** | 2 min | Where does external input enter? Validated/parsed immediately? |
| **2. Auth** | 2 min | Authentication required where expected? Authorization for each action? |
| **3. Data flow** | 3 min | Trace sensitive data entry→storage. Where logged? Exposed? Transmitted? |
| **4. Dependencies** | 2 min | New packages? Run `npm audit` / `govulncheck` / `cargo audit` |
| **5. Error paths** | 3 min | What happens on failure? Sensitive info leaked in errors? |
| **6. AI smell test** | 3 min | Generic variable names? Comments explaining obvious code? Patterns copied without context? |

### Red Flags by Language

**TypeScript**
- `any` type usage
- Type assertions (`as`)
- Missing null checks
- Unvalidated request bodies

**Go**
- Ignored errors (`_ =`)
- Missing context cancellation
- Unbounded goroutines
- No input validation

**Rust**
- `unsafe` blocks
- `.unwrap()` in prod code
- Missing error propagation
- Unchecked array indexing

**Python**
- `eval()` / `exec()`
- Shell injection vectors
- Pickle deserialization
- Missing input validation

---

## Learning Path

### Phase 1: Foundations (Weeks 1-4)
**Goal:** Read and understand typed code confidently.

**Week 1-2: TypeScript**
- TypeScript Handbook ("Everyday Types" + "Narrowing" sections)
- Read 5 TypeScript PRs on GitHub daily. Don't write, just read.
- Security focus: Search each PR for `any` and type assertions

**Week 3-4: Go**
- Go by Example (types, errors, goroutines)
- Read Kubernetes/Docker source (small utilities)
- Security focus: Trace error handling paths

**Checkpoint:** Explain what a TypeScript or Go file does without running it.

### Phase 2: Security Patterns (Weeks 5-8)
**Goal:** Recognize secure/insecure patterns instantly.

**Week 5-6: Vulnerability Patterns**
- OWASP Top 10, OWASP ASVS
- Review CVE reports for TypeScript/Go projects
- Setup: CodeQL, Semgrep for target languages

**Week 7-8: Secure Coding Patterns**
- OWASP Cheat Sheet Series
- Find real implementations in open source
- Build: One small secure API (auth, input validation, error handling)

**Checkpoint:** Identify vulnerability category within 60 seconds.

### Phase 3: AI-Assisted Building (Weeks 9-12)
**Goal:** Spec and build secure systems with AI assistance.

**Week 9-10: Speccing Practice**
- Take 3 open source projects you know
- Write specs that would have produced them
- Test: Give spec to AI, compare output to original

**Week 11-12: Build + Review Cycle**
- Build complete small project with AI assistance
- Apply security review to your own AI-generated code
- Document: What did AI get wrong? What patterns emerge?

**Checkpoint:** Spec → generate → security review in under a day.

### Phase 4: Advanced (Weeks 13-16)
**Goal:** Handle complex systems and edge cases.

**Week 13-14: Rust**
- Rust Book chapters 1-10
- Focus: Ownership, borrowing, error handling
- Security: Understand why `unsafe` exists

**Week 15-16: Architecture**
- Study: Auth systems, API gateways, secrets management
- Review architecture of 2-3 well-known secure systems
- Build: Add Rust component to Phase 3 project

**Checkpoint:** Architect multi-service system with clear security boundaries.

### Ongoing Practice

| Cadence | Activity |
|---------|----------|
| Daily (15 min) | Review one PR. Skim security advisories. |
| Weekly (1 hour) | Build something small with AI. Write/refine one spec. |
| Monthly | Deep-dive one vulnerability class. Update review checklist. |

---

## Tools for Efficiency

### Static Analysis
- **CodeQL** - Deep analysis for complex vulnerabilities
- **ESLint / golangci-lint / clippy** - Language-specific

### Dependency Scanning
- `npm audit` / `yarn audit` (TypeScript)
- `govulncheck` (Go)
- `cargo audit` (Rust)
- Dependabot for automation

### AI Tools
- Claude Code with security-review prompts
- Cursor/Copilot with security rules in context
- Custom system prompts with security requirements

### Efficiency Multipliers

**Build a snippet library** - Secure patterns you've verified: auth middleware, input validation, error handling. Compare against known-good patterns.

**Use AI to explain, not just write** - "Explain the security implications of this function" > "write this function"

**Template your specs** - Same structure every time = nothing forgotten.

---

## Quick Reference

### Secure by Default Questions

| Before Building | During Review |
|----------------|---------------|
| What's the threat model? | Where does input enter? |
| Where are trust boundaries? | Is it validated immediately? |
| What's the auth model? | Who can access this? |
| What data is sensitive? | What happens on failure? |

### Type Safety Cheat Sheet

| Safe | Unsafe |
|------|--------|
| Explicit types | `any`, `unknown` casts |
| Parsed input types | Raw strings passed around |
| Result/Option types | Null/undefined assumptions |
| Compile-time checks | Runtime type checking |

### AI Prompt Security Additions

Always include in specs:

```
Security requirements:
- Use parameterized queries for all database access
- Validate and sanitize all external input at entry points
- Return generic error messages to users; log details internally
- No hardcoded secrets; use environment variables
- All endpoints require authentication unless explicitly listed as public
```

---

## The Multiplier

Your leverage comes from:

1. **Specs that prevent** vulnerabilities rather than catching them later
2. **Type systems doing enforcement** rather than manual checking
3. **Pattern recognition** rather than line-by-line review
4. **AI generating secure code** because you told it how
5. **Automation catching the obvious** so you catch the subtle
