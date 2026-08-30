# AI CEO — Agentic Business Discovery & Sales Automation

A production-shaped platform that discovers local businesses likely to need digital/AI services,
researches them, scores the opportunity, recommends a service, drafts personalised outreach, and
**stops at a human approval gate before anything reaches the outside world**.

It is not a chatbot. It is a multi-step agentic system with a central orchestrator, eight specialist
agents, a workflow engine, persistent data, an approval queue and a full audit log.

---

## What it does

```
Market Scout → Opportunity Analyst → Service Strategist → Lead Scorer
     ↓                                                         ↓
discover businesses                                    save to lead database
                                                              ↓
                                             qualified?  →  Outreach Agent
                                                              ↓
                                                    ✋ HUMAN APPROVAL
                                                              ↓
                                              send (only if explicitly enabled)
                                                              ↓
                                    Conversation Agent → Requirement Agent → Project request
```

| Agent | Responsibility |
|---|---|
| **AI CEO Orchestrator** | Turns a goal into a plan, delegates each step, validates results, retries recoverable failures, opens approval gates, writes the audit log |
| **Market Scout** | Discovers businesses by country / city / area / category from public sources |
| **Website verification** | Visits each lead's own site and records what is actually there — booking, ordering, chat, socials, a published email — turning unknowns into evidence |
| **Opportunity Analyst** | Detects digital gaps from observed evidence and scores the opportunity 0–100 |
| **Service Strategist** | Recommends the single best-supported service from the catalogue |
| **Lead Scoring Agent** | Scores seven dimensions and assigns grade A / B / C |
| **Outreach Agent** | Writes personalised email / WhatsApp variants — always into the approval queue |
| **Conversation Agent** | Reads replies, detects intent, buying signals and objections, escalates when needed |
| **Order / Requirement Agent** | Converts a request into a structured project with explicit missing information |

---

## The safety model

This is the part that matters most, and it is enforced in code rather than in prompts alone.

**Nothing is sent autonomously.** Four independent conditions must all hold before a message can
leave the platform:

1. a human approved it,
2. `OUTBOUND_SENDING_ENABLED=true` in the environment **and** the Settings toggle is on,
3. the channel's integration is connected, and
4. the day's outreach cap still has room.

Until then an approved message stays queued, and the UI says so explicitly. A message becomes `SENT`
only when the provider accepted it — a delivery that failed leaves it `APPROVED` with the reason,
never a status that overstates what happened. Autonomous mass messaging is deliberately not
implemented.

**Approval is required before** the first external message, any commercial commitment, any price
agreement, accepting a project, sending deliverables, and any other irreversible action.

**No fabrication.** A missing observation is treated as *unknown*, never as a deficiency — a business
whose booking setup was never checked does not get a "no booking system" signal. Contact details are
never inferred (Google Places does not expose email addresses, so live leads simply have none until
enriched). Every signal carries the evidence sentence that produced it.

**Post-generation guards.** Independently of what any prompt says, every draft is scanned for prices,
guarantees, unverifiable statistics, refund terms, spam phrasing, and language implying a human
sender. A draft that trips a hard rule is replaced with the safe template before a human ever sees it.

**Self-verification.** Every agent validates its own output (score in range, grade consistent with
score, recommendation backed by evidence, no duplicate leads, message quality). A failed blocking
check is retried within the agent's retry limit; the orchestrator never accepts output an agent could
not validate.

**Deterministic scoring.** Scores are computed in code, not by a model, so they are reproducible and
auditable. The model only writes the narrative around them — which is why the platform can always
answer "why this score?".

---

## Quick start

```bash
npm install
cp .env.example .env      # optional — it runs fully in demo mode without it
npm run seed              # populates a labelled demo dataset
npm run dev               # API on :4000, dashboard on :5173
```

Sign in with `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` (defaults
`admin@ai-ceo.local` / `ChangeMe!2024`). The admin account is created on first run only.

**Locked out?** There is no password-reset email, because a fresh install has no
mail channel connected. Set `ADMIN_PASSWORD_RESET` to a new password and restart:
the admin account is reset to it (and re-enabled, if it was disabled). Sign in,
change the password from Settings → Team, then remove the variable — while it is
set, that value *is* the admin password. It grants nothing new, since anyone who
can set a variable can already read `APP_SECRET` and the database.

```bash
npm run build     # builds the dashboard and compiles the server
npm start         # single process serving the API and the built dashboard
npm test          # unit tests for scoring, signals, services and the safety guards
npm run typecheck # both workspaces
```

---

## Demo mode vs live

The platform is fully functional with no external services configured, and it never pretends demo
data is real:

| Without keys | With keys |
|---|---|
| Market Scout returns deterministic sample businesses, flagged `isDemo` end to end (badges in the UI, a `DEMO DATA` column in the CSV export) | Google Places — or the keyless OpenStreetMap connector — supplies real businesses |
| Agents use a deterministic rule engine for narrative and outreach copy | Claude writes the analysis and the outreach copy |
| Scores, evidence, workflow, approvals and audit log behave identically | Identical |

The header shows the live state at all times: *Demo data / Live discovery*, *Rule engine / Claude
reasoning*, and *Sending disabled / enabled*.

On a deployed instance there is no shell to run `npm run seed` from, so setting `SEED_DEMO_DATA=true`
seeds the same dataset on boot — once only, while the lead table is still empty, in the background so
health checks are unaffected. Locally, use `npm run seed`.

Connect integrations from **Integrations** (admin only). Credentials are encrypted at rest with
AES-256-GCM and are never returned to the browser — the API exposes masked hints and connection state
only. Keys supplied via environment variables are picked up automatically.

Available connectors: Google Places, OpenStreetMap, Website verification, Anthropic, Gmail, WhatsApp
Business, Google Sheets / Drive / Calendar, an external CRM, and outbound webhooks.

### Turning unknowns into evidence

A discovery source describes a business from the outside. Only its own website shows how it actually
serves customers, so the **Website verification** connector goes and looks: it fetches the homepage
plus up to two pages that tend to hold the answer (booking, menu, contact), and records what it finds.
A lead with no website is skipped — that is an unknown, not a gap — and a site that is listed but does
not load is itself recorded as a finding. Demo records are never fetched: their URLs are fictional.

Because the server fetches operator-supplied URLs, requests are limited to public http(s) addresses:
private, loopback, link-local and cloud-metadata ranges are refused before any connection, DNS results
are re-checked against the same rules, redirects are followed manually with the check applied at every
hop, and body size, page count and time are all capped.

Run it as part of discovery (the `verify` step in the default workflow) or on a single lead from its
page — **Verify website** re-scores that lead on what was found.

### Discovery without a Google key

Google Places needs a billing-enabled Cloud project, which in some countries is only sold through a
reseller and only to registered companies. The **OpenStreetMap** connector is the way around that: no
key, no billing, no contract — switch it on in Integrations and the Market Scout queries Nominatim
and Overpass instead. Places is still preferred whenever it is connected; OSM is the fallback, and
labelled demo data remains the last resort.

The trade-off is stated rather than hidden. OSM carries phone numbers, websites, opening hours and
published email addresses — which Places does not expose — but no ratings and no review counts, so
those stay unknown and the lead score leans on fewer dimensions. And because the map is
volunteer-maintained, a missing website tag is treated as *unrecorded*, never as proof that a
business has no site; only Places, which lists every site it knows, can support that conclusion.

---

## Architecture

```
server/src/
  config/        environment and secret handling
  db/            SQLite schema, connection, seed script
  domain/        business rules — signals, scoring, service catalogue  (pure, unit-tested)
  llm/           Anthropic provider with typed outcomes and graceful degradation
  tools/         integration layer — Google Places, demo data, tool registry
  agents/        the eight agents + shared self-verification primitives
  orchestrator/  execution engine, workflow model, inbound-reply pipeline
  services/      persistence and business services (leads, messages, approvals, runs, …)
  routes/        REST API
  middleware/    auth, RBAC, error handling

web/src/
  components/    layout and the shared UI kit
  lib/           API client, hooks, chart theme, formatting
  pages/         the 15 dashboard screens
```

Modules depend downward only, so an agent, a tool or an integration can be replaced without touching
the rest. Adding a discovery source means implementing one function in `tools/`; adding an agent means
a config row plus a module in `agents/`.

### Dashboard

Overview · Market Research · Opportunities · Leads · Messages · Approvals · Projects · Agents ·
Workflows · Analytics · Activity Logs · Integrations · Settings — with dark/light mode, responsive
layout down to mobile, and an agent activity timeline.

**Agent Control Center** configures each agent's name, role, system instructions, enabled tools,
allowed actions, approval requirement, maximum actions, retry limit and output format.

**Workflow Builder** edits the graph the orchestrator actually walks — changing a condition threshold
or an approval kind changes what the next run does.

### API

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/login`, `GET /api/auth/me`, `GET/POST/PATCH /api/auth/users` |
| Leads | `GET/POST /api/leads`, `GET/PATCH/DELETE /api/leads/:id`, `/api/leads/:id/draft-outreach`, `/api/leads/export.csv` |
| Research | `POST /api/research/run`, `GET /api/research/options\|runs\|executions` |
| Messages | `GET/PATCH /api/messages`, `/api/messages/:id/approve\|reject\|send` |
| Approvals | `GET /api/approvals`, `POST /api/approvals/:id/decide` |
| Projects | `GET/PATCH /api/projects` |
| Conversations | `GET /api/conversations`, `POST /api/conversations/reply` |
| Agents | `GET/PATCH /api/agents`, `POST /api/agents/:key/reset` |
| Workflows | `GET/POST/PATCH/DELETE /api/workflows`, `POST /api/workflows/validate` |
| System | `/api/system/overview\|analytics\|status\|catalog\|logs\|settings\|integrations` |

### Roles

| Role | Can |
|---|---|
| **admin** | Everything, including agents, workflows, integrations, settings and team |
| **operator** | Approve / reject / send, edit leads and projects |
| **analyst** | Run research and generate drafts — cannot approve or send |
| **viewer** | Read-only |

---

## Enabling real outreach

1. Connect a channel (Gmail or WhatsApp Business) in **Integrations**.
2. Set `OUTBOUND_SENDING_ENABLED=true` and restart.
3. Turn on sending in **Settings**.
4. Fill in company identity, approved claims and the pricing policy so the agents have real
   boundaries to work within.

Messages still require per-message human approval, and a fourth gate applies: the daily outreach cap
in Settings. Email is delivered over Gmail SMTP, which needs the sending address and a Google App
Password (2-step verification on — an account password will not work). A message is recorded as SENT
only once the provider accepted it; a failed delivery leaves it APPROVED with the reason attached,
because a status that overstates what happened is worse than no automation. WhatsApp is not wired to a
provider yet and says so rather than pretending.

---

## Notes and limits

- SQLite is used for portability; the data layer is small and isolated if you move to Postgres.
- Email delivery is real (Gmail SMTP). WhatsApp, SMS and LinkedIn are modelled end to end — approval,
  queueing, status and audit — but have no provider wired, and a send over them reports exactly that.
- Signals depend on what the source can prove, encoded in `SOURCE_PROVES_ABSENCE`
  (`server/src/domain/business.ts`). Places lists every website and phone it knows, so a blank there
  is evidence; it never exposes emails or social profiles, so a blank there is not. OpenStreetMap is
  volunteer-maintained, so no blank is evidence. Live leads therefore produce fewer signals than demo
  records — by design, rather than guessing — and the missing dimensions lower confidence instead.
