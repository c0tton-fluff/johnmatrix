---
title: Shady Oaks Financial - 3
tags:
  - bugforge
  - race-condition
  - toctou
  - burpsuite
---

- Third round with Shady Oaks Financial - this time no hints, just vibes
- The application is a financial trading platform with currency exchange and stock trading

## Enumeration

- Registered a user, got a JWT with `role: "user"` and 1000 EUR starting balance
- Extracted all API endpoints from the JS bundle source map:

```
/api/register          /api/login
/api/profile           /api/verify-token
/api/currencies        /api/exchange-rates
/api/convert-currency  /api/stocks
/api/trade             /api/portfolio
/api/transactions      /api/admin/users
/api/admin/stats       /api/admin/transactions
/api/admin/stocks/:id
```

### Testing the Surface

- Admin endpoints return `403 Admin access required` with user JWT, `401` without - properly locked
- Mass assignment on register (`"role":"admin"`) - server strips it, returns `"role":"user"`
- Currency conversion and stock trading both work as expected with correct params

### Parameter Discovery

- Extracted from JS bundle:

```
POST /api/convert-currency
{"from_currency":"EUR","to_currency":"USD","amount":10}

POST /api/trade
{"stock_id":3,"shares":10,"action":"buy"}
```

- Legit conversion: 10 EUR -> 11.22 USD at rate 1.121675
- Legit trade: 10 shares of PONZI at 9.03 each = 90.30 EUR

## Exploitation

### Race Condition on Currency Conversion

- The `/api/convert-currency` endpoint checks balance then deducts - classic TOCTOU
- If multiple requests hit simultaneously, they all read the same 1000 EUR balance before any deduction happens

### Burp Suite - Single-Packet Attack

- Created 5 identical Repeater tabs with the same `POST /api/convert-currency` request (900 EUR each)
- Selected all tabs into a **Tab Group**, then used the send dropdown to select **"Send group in parallel"**
- Burp's single-packet attack stuffs all requests into one TCP segment, hitting the server before any balance deduction completes

![Burp Repeater setup - 5 tabs grouped, "Send group in parallel" selected](/BugForge/img/shady3-01.png)

### Result

- **All 5 conversions succeeded** - the race window is wide open
- Started with 1000 EUR, spent 900 EUR x 5 = 4,500 EUR
- Balance driven negative, flag returned in every response

![All 5 responses return 200 with the flag](/BugForge/img/shady3-02.png)

**Flag:** `bug{d4D5iG3oJdvmQttd56fu7rJT9tcxj7PG}`

### Why Single-Packet?

- Regular parallel sends have network jitter - microseconds between packets
- Burp's single-packet attack stuffs all HTTP requests into one TCP segment
- The server processes them truly simultaneously, maximizing the race window
- This is the James Kettle / PortSwigger technique from "Smashing the State Machine" research

## Security Takeaways

### Vulnerability: TOCTOU Race Condition on Financial Operations

**Type**: A04:2021 - Insecure Design

**CWE**: CWE-362 - Concurrent Execution Using Shared Resource with Improper Synchronization

**Root Cause**:
- Balance check and deduction are not atomic
- No database-level row locking on the user balance
- No transaction isolation preventing concurrent reads of the same balance

**Attack Chain**:
1. Register user with 1000 EUR balance
2. Fire 20 concurrent `POST /api/convert-currency` requests for 900 EUR each
3. All 20 read the same balance (1000 EUR) before any deduction occurs
4. All 20 succeed, driving balance to -17,000 EUR
5. Flag returned when balance goes negative (unlimited money glitch)

### Impact

| Category        | Severity                                                 |
| --------------- | -------------------------------------------------------- |                 
| Integrity       | Critical - unlimited money generation from thin air      |
| Availability    | Medium - negative balances could break downstream logic  |

### Remediation

1. **Use database transactions with row-level locking**
- `SELECT balance FROM users WHERE id = ? FOR UPDATE`
- This locks the row until the transaction commits

2. **Atomic balance operations**
- `UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?`
- Single query that checks and deducts atomically

3. **Application-level mutex**
- Per-user lock/semaphore for financial operations
- Prevents concurrent processing of the same user's transactions

4. **Idempotency keys**
- Require unique transaction IDs on each request
- Reject duplicates at the database constraint level
