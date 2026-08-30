# Launch checklist

The platform is deployed and working. This is the operator's page: what is done,
what is left, and where each remaining thing lives. Everything below was checked
against the running deployment, not assumed.

**Dashboard:** https://ai-ceo-production-07b1.up.railway.app
**Public page:** the same host at `/landing` — see *Point the domain* below.

---

## Already done

| | Where to see it |
|---|---|
| Discovery from OpenStreetMap, no key needed | Integrations → OpenStreetMap |
| Website verification — visits each lead's site for real evidence | Integrations → Website verification |
| Deterministic scoring, grades, evidence per signal | any lead's page |
| Approval queue — nothing leaves without a human | Approvals |
| Audit log of every action and its reason | Activity Logs |
| Company identity, services, pricing policy, daily cap | Settings |
| Public page in Arabic | `/landing` |

---

## Left to do

Each of these needs an account or a payment method, so they can only be done by
the person who owns them.

### 1. An email transport — the only thing blocking automatic sending

The host blocks outbound SMTP ports on its lower plans, which is why the Gmail
connector times out no matter which password is used. Delivery over HTTPS is the
way around it.

1. Create a free account at https://resend.com/signup
2. Add the domain and copy the DNS records it gives you into the registrar —
   this also sets SPF and DKIM, which is what keeps cold email out of spam
3. Create an API key (`re_…`)
4. Dashboard → **Integrations → Resend** → paste the key and the sending
   address → Enable → **Save** → **Test connection**

The test authenticates and disconnects. It never emails anyone.

### 2. Anthropic credit — optional, changes the writing only

The key is saved and valid; the account balance is empty, so every call falls
back to the rule engine and the dashboard says *Rule engine* rather than
claiming otherwise. Scores and evidence are identical either way — only the
wording of the outreach changes.

Add credit at https://console.anthropic.com/settings/billing

### 3. Point the domain at the app — one DNS record

`karmaai.online` is already attached to the service, and the marketing domain is
already saved in **Settings**, so the public page will answer on it. One record
is left, at the registrar:

| Type | Host | Value |
|---|---|---|
| `CNAME` | `@` | `in2n6fon.up.railway.app` |

Delete the parking `A` record first — the two cannot coexist on the same name.
The certificate issues automatically once the record resolves.

If the registrar refuses a `CNAME` on the root, attach `www.karmaai.online` in
Railway instead (**Settings → Networking → Custom Domain**) and point the record
at the target it gives you.

---

## Launching by hand, today, with none of the above

This path is fully supported and leaves the same audit trail as automatic
delivery. It is the honest way to start before a transport works.

1. **Approvals** → read the message → **Approve**
2. Copy the text → send it from your own mailbox
3. Back in **Messages** → **I sent this myself**

The lead moves to `CONTACTED`, the conversation is recorded, and reply analysis
works exactly as it would have. The button refuses on a draft nobody approved,
and on a message already marked sent.

---

## Turning on automatic sending, once a transport passes its test

In this order, and not before a message to yourself has arrived:

1. Railway → Variables → `OUTBOUND_SENDING_ENABLED=true`, then redeploy
2. **Settings** → turn on outbound sending
3. Keep the daily cap low at first — a new sending domain that opens with fifty
   messages gets treated as spam

Four conditions must then all hold for anything to leave: a human approved it,
both switches are on, the transport is connected, and the day's cap has room. A
message is recorded as sent only once the provider accepts it; a failure leaves
it approved with the reason attached.

---

## If you are locked out of the dashboard

There is no reset email — a fresh install has no mail channel to send one from.
Instead: Railway → Variables → `ADMIN_PASSWORD_RESET=<a new password>` → redeploy.
The admin account is reset to it and re-enabled if it had been disabled. Sign in,
change the password from **Settings → Team**, then **delete the variable**: while
it is set, that value is the admin password. Leaving it set also raises a warning
in the deployment logs on every boot.

The database is untouched by this — no lead, message or approval is lost.
