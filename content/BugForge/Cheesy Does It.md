---
title: Cheesy Does It
tags:
  - bugforge
  - business-logic
  - input-validation
  - parameter-tampering
  - burpsuite
  - mcp
---

- Welcome to today's tasty lab!
- I have ordered a lot of pizzas doing this !!!
## Enumeration

![Daily](/BugForge/img/pizza-01.png)

- As usual we can play around the page and check functionality
- We can make a simple order and check how it works in Burp

- The fact we are given the `discount code` made me think of testing against it straight away to see if I can apply more than what was given.

![Daily](/BugForge/img/pizza-02.png)

- For a moment I thought it worked!
- It did not ...
- Even though it was sent through, the price has not changed neither have I seen the flag

![Daily](/BugForge/img/pizza-03.png)

- Then an idea came up
- What if instead of sending more discounts, I can multiply the fields to see whether that is being checked
- I supplied an `array` of `PIZZA-10` and this gave me the flag

![Daily](/BugForge/img/pizza-04.png)

## MCP

- Knowing what I have done already without the AI, I asked it to find a potential vulnerability within the orders

![Daily](/BugForge/img/pizza-05.png)

- This one confused it the most as it attempted to create two python scripts attacking JWT for some reason, which I can understand in some ways but it felt to me like a little bit of hallucination

- I redirected its thinking back on track after using 10% of the tokens of the session, as I let it think and run while fixing its own issue in code :)

- I gave it the idea of `How about you check whether we can make the discount code more than it is? Make it simpler, do not overcomplicate simple application`

![Daily](/BugForge/img/pizza-06.png)

- That seems to have worked the trick!

![Daily](/BugForge/img/pizza-07.png)

## Security Takeaways
### Impact
- Discount code can be applied multiple times in a single order
- Order totals can be reduced beyond intended limits
- Promotional abuse with direct revenue loss

### Vulnerability Classification
- OWASP Top 10: A01 Broken Access Control / A04 Insecure Design (Business Logic)
- Vulnerability Type: Discount stacking via input type confusion
- CWE: CWE-20 - Improper Input Validation

### Proof of Concept (HTTP)

```
POST /api/orders
  Authorization: Bearer <token>
  Content-Type: application/json

  {
    "items":[{"pizza_name":"Classic Margherita","base_name":"Thin Crust","sauce_name":"Classic Tomato","size":"Medium","toppings":
  ["Tomatoes","Extra Mozzarella"],"quantity":1,"unit_price":10.99,"total_price":10.99,"id":1768810789613}],
    "delivery_address":"123",
    "phone":"123",
    "payment_method":"card",
    "notes":"",
    "discount":["PIZZA-10","PIZZA-10","PIZZA-10","PIZZA-10"]
  }
```

  - Observed Result
  Request succeeds (`200 OK`) and discount is stacked.

### Root Cause
- The API accepts non-scalar input for discount and applies each entry without enforcing “one code per order” business rules.

### Remediation
- Enforce strict input validation: discount must be a single string or null
- Reject arrays/objects for discount
- Enforce max one discount per order at the server
- Add guardrails for minimum payable total and log abuse attempts
