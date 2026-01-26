- Today's lab made me want to have more pizzas!
- With this rate, and the broken logic today, I will have enough `dough` (you get it?) to invest in a private coach :)

- Anyhow ...

## Enumeration

![Daily](/BugForge/img/cheesy-01.png)

- While we are waiting, I clicked around the whole page, as usual, to understand how it responds and what are the actions in the background.
- Did not feel like activating the `Claude MCP` yet as I do not want to fall into the pit of always using AI and learning only a little...

### What if I did not like it?
- After the pizza was done, I noticed the button `Report Problem With Order`

![Daily](/BugForge/img/cheesy-02.png)

- Since my imaginary pizza arrived damaged and cold, why not?
- I said it was cold and also would like to grab a refund 

![Daily](/BugForge/img/cheesy-03.png)

- I caught it and sent to `Repeater`

![Daily](/BugForge/img/cheesy-04.png)

- Changing the `refund_amount` allowed me to become rich and provide pizzas for many :)
- I also did not realise at first I put a `.` between 100.000 and received only 100, but hey... lesson learned.

![Daily](/BugForge/img/cheesy-05.png)

## MCP

- I could not leave poor Claude on `ITS` own :)
- I did not want to spend too much time or tokens, so I simply mentioned that there `might` be a `Broken Logic` somewhere, simply to point `Claude MCP` at the right area

![Daily](/BugForge/img/cheesy-06.png)

- The waiting game ...

![Daily](/BugForge/img/cheesy-07.png)

- For some reason, which I need to diagnose later, MCP was overloaded with requests. Had to restart and it worked perfectly fine

![Daily](/BugForge/img/cheesy-08.png)

- Good reminder to always use the AI as a helper not for the whole task :)


## Security Takeaways

### Vulnerability

- Client-Side Price/Amount Manipulation - The `/api/orders/{id}/refund` endpoint trusts the client-provided `refund_amount` parameter instead of calculating it server-side from the actual order total.

### Impact

  - Financial Loss: Attacker paid $10.99, requested $99,999.99 refund
  - Unlimited monetary gain: No validation against order value
  - Business-critical: Direct financial fraud vector
  - Scalable attack: Can be automated against all delivered orders

### Remediation

  - Server-side calculation: Always calculate refund amount from the order's total_price in the database
  - Never trust client input for financial values
  - Add validation: if (refund_amount > order.total_price) reject()
  - Audit logging: Log all refund requests with original order values for fraud detection
  - Rate limiting: Limit refund requests per user/order
