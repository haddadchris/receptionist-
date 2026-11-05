# Fekerte — build progress

_Last updated: all 7 phases complete (handoff)._

## Status by phase

| Phase | Scope | Status |
|---|---|---|
| 1 | Foundation + Basic tier (online booking) | ✅ Done |
| 2 | Standard tier — AI WhatsApp receptionist | ✅ Done |
| 3 | Premium tier — AI voice receptionist (Lebanese Arabic) | ✅ Done |
| 4 | Billing, plans, limits | ✅ Done |
| 5 | Growth layer (CRM, deposits, reviews, recalls, analytics, campaigns) | ✅ Done |
| 6 | Marketing site + sales tools | ✅ Done |
| 7 | Hardening + handoff | ✅ Done |

**Verified at handoff** (all from a clean `pnpm dev` stack): typecheck ✅ · lint ✅ · unit + integration tests **180/180** (core 172, voice 5, web 3) · Playwright **22/22** (desktop + mobile) · evals **49/49** with the mock LLM · `next build` ✅ · production-mode smoke test (`next start`) ✅.

## Production readiness at a glance

| Area | State |
|---|---|
| Booking engine, calendar, double-booking protection, reminders, manage links | **Production-ready** (tested incl. concurrency + DST) |
| Multi-tenancy (RLS), auth (local or Supabase), roles, super admin, impersonation | **Production-ready** |
| Dashboard, onboarding, booking page (ar/en/fr, RTL, mobile) | **Production-ready** |
| Billing (plans, limits, manual invoices, trial/overdue pausing) | **Production-ready** for manual (bank / cash / Whish-OMT) billing |
| Growth (CRM, deposits, reviews, recalls, campaigns, analytics) | **Production-ready** logic; WhatsApp sends need Meta + approved templates |
| Marketing site, live demo, leads pipeline, ROI calculator | **Production-ready** |
| Security hardening (RLS tests, signatures, rate limits, guard, headers) | **Done**, see Phase 7 |
| AI agent (tools, prompts, guard, evals) | Logic **ready**; quality only proven with the **mock** — run `EVAL_PROVIDER=anthropic pnpm eval` with a real key before go-live |
| WhatsApp Cloud API adapter | **Written, unit-tested, never run against live Meta** |
| Twilio voice + OpenAI Realtime / transcription + ElevenLabs | **Written, unit-tested with stubs, never run against the live services** |
| Supabase Storage (receipts), Sentry reporting | Written from documented REST/envelope shapes, **untested live** |
| Deploy configs (`apps/voice/Dockerfile`, `fly.toml`, `railway.json`, `apps/web/vercel.json`) | Written from vendor docs; **not deployed from here** (no Docker / cloud access in this environment) |

Vendor documentation hosts (developers.facebook.com, twilio.com, platform.openai.com, elevenlabs.io) were unreachable from the build environment; shapes were taken from SDK type definitions and web search where possible and are marked "verify" in code comments.

## What to buy / sign up for

| Need | Service | Notes |
|---|---|---|
| Database (+ optional auth, storage) | **Supabase** project (Frankfurt) | Paid plan recommended for daily backups / no pausing |
| Web hosting | **Vercel** (Pro if you want the per-minute cron; Hobby works because the voice worker drains jobs) | Root directory `apps/web` |
| Voice server hosting | **Railway** or **Fly.io** (1 always-on small machine) | Needs long-lived WebSockets |
| AI | **Anthropic API** key (Claude) | Default model `claude-opus-5-5`, effort `low` |
| WhatsApp | **Meta Business** account (verified), WhatsApp Business Platform app, a phone number not used in the WhatsApp app | Template approval takes from minutes to days |
| Phone | **Twilio** account + 1 voice number per clinic | Clinic forwards its Lebanese line to it (Alfa / touch / Ogero call forwarding) |
| Natural Lebanese voice | **OpenAI API** (streaming transcription / realtime) + **ElevenLabs** (Levantine voice) | Without them the phone line still works with Twilio's `<Gather>` + `<Say>` |
| Error tracking (optional) | **Sentry** project | Just `SENTRY_DSN` |
| Domain | e.g. `fekerte.app` + `voice.fekerte.app` | HTTPS for both (Twilio and Meta require it) |

Check each vendor's current pricing; nothing in the code depends on a specific tier.

## Exact steps to put the first clinic live

1. **Accounts**: create everything in the table above. Generate `APP_SECRET` (`openssl rand -hex 32`) and `CRON_SECRET`.
2. **Database**: `DATABASE_URL=<supabase session pooler> pnpm db:migrate`, then set real `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` and `pnpm db:seed` (plans + super admin + demo clinics for `/demo`).
3. **Deploy web** to Vercel (root `apps/web`) with the env vars from README → Deploying. Check `/api/health`.
4. **Deploy voice** to Railway/Fly with the same `DATABASE_URL` and `APP_SECRET`. Check `https://voice…/health`.
5. **Claude**: set `ANTHROPIC_API_KEY` on both apps; run `EVAL_PROVIDER=anthropic pnpm eval` locally against a scratch DB; fix any failing scenario (prompt tweaks in `packages/core/src/agent/prompt.ts`) until ≥ 90 %.
6. **WhatsApp**: Meta app → system-user token, app secret, verify token; webhook `https://<web>/api/webhooks/whatsapp` subscribed to `messages`; submit the templates from `packages/core/src/notifications/templates.ts` (ar/en/fr); set `WHATSAPP_PROVIDER=meta`. Send yourself a message and check the inbox.
7. **Phone**: Twilio number → `https://<voice>/twilio/voice` (+ status `/twilio/status`); set `TWILIO_*`, `VOICE_PUBLIC_URL`, `OPENAI_API_KEY`, `ELEVENLABS_*`. Run the live-call checklist (Phase 3 section).
8. **Onboard the clinic** (README → Onboarding a real business): account, services/prices, staff, hours, holidays, booking rules, AI persona; put their WhatsApp phone-number ID and Twilio number in AI settings; set call forwarding at their carrier ("on no answer" first, "always" once they trust it).
9. **Billing**: in Admin set the plan and negotiated fees, issue the first invoice, mark it paid with the transfer reference.
10. **First week**: watch Inbox, Calls and the audit trail daily; check Analytics → "Booked by the AI"; tune the persona's extra information from real questions.

## Phase 1 — what's done

- **Monorepo** (pnpm): `apps/web` (Next.js 16 App Router, Tailwind 4, Radix primitives in shadcn style), `packages/core` (domain logic, Drizzle schema, providers).
- **Database**: full schema for every entity in the spec (businesses, users/memberships, staff, services, hours/breaks/time off/holidays, customers, appointments, conversations/messages, calls, jobs, notifications, usage, subscriptions/invoices/payments, review requests, campaigns, leads, audit log). Migrations in `packages/core/drizzle/`.
- **Multi-tenancy, enforced twice**: every query filters by `business_id`, and Postgres RLS policies apply to the restricted `fekerte_app` role that every tenant transaction switches to (`withTenant`). Tests prove tenant A can't read/insert/update/delete/move rows of tenant B, and that every table with `business_id` has RLS + a policy.
- **Double-booking guard at the DB level**: gist exclusion constraint on `(staff_id, tstzrange(blocked_start, blocked_end))` for non-cancelled appointments (buffers included, maintained by trigger).
- **Availability engine** (`packages/core/src/availability/engine.ts`): pure, DST-correct (Asia/Beirut), working hours / split shifts / breaks / time off / holidays / buffers / resource capacity / min notice / max days ahead / slot granularity / "any staff" ranking. 32 unit tests incl. both DST transitions.
- **Booking service**: transactional create / reschedule / cancel / status changes with per-staff advisory locks + re-check + DB constraint. Concurrency tests: 2 racers on one slot → exactly 1 wins; 5 racers on "any staff" with 2 staff → exactly 2 win.
- **Auth adapter**: `local` (default: email+password with scrypt, magic links printed to the server log and shown on the login page in dev, signed JWT session cookie) or `supabase` (Supabase Auth; users mirrored by id). Roles: owner / staff / super admin.
- **i18n**: Arabic (default, RTL), English, French — typed dictionaries, `?lang=` / cookie / Accept-Language negotiation in `proxy.ts`, logical CSS (`ms/me/ps/pe/start/end`) everywhere. Lebanese month names + Latin digits for Arabic dates (`ar-LB-u-nu-latn`).
- **Onboarding wizard** (`/onboarding`): business → services (pre-filled per vertical) → team & hours → booking page live with share link. ~1–2 minutes.
- **Dashboard** (`/dashboard`): overview (today, next 7 days, pending, no-show rate, booking link), **calendar** (day view with per-staff columns, week view, working-hours shading, now line, drag to reschedule with snapping, tap empty slot to book, colors by status), appointments list (filters: upcoming/past/all, status, staff, source, search; quick actions), customers list (search, segments, tags) + profile (history, no-shows, notes, tags, consent, conversations), services, staff (services, custom hours, time off), hours & holidays, business settings (languages, branding, booking rules, reminders). Mobile: bottom nav + "more" sheet.
- **Public booking page** `/b/[slug]`: service → staff/any → date strip + slots → name + phone → confirm; branded with the business colour; consent text; honeypot; manage link (HMAC-signed token) to cancel or reschedule within the business's notice policy.
- **Notifications**: WhatsApp-template-ready messages (confirmation / pending / reminder / reminder-with-confirm / rescheduled / cancelled, in ar/en/fr) scheduled as jobs (24h + 2h by default, configurable) and sent via the **mock WhatsApp provider** (logs + `notifications` table).
- **Jobs**: Postgres job queue (`jobs` table, `FOR UPDATE SKIP LOCKED`, retries with backoff, dedupe keys) processed by `/api/cron/jobs` (Bearer `CRON_SECRET`); `pnpm dev` runs a local pinger every 20s.
- **Super-admin** `/admin`: platform totals, all businesses with tier/status/owner/bookings/usage, per-business page (change plan/status/trial end, feature-flag overrides, audit log), **read-only impersonation** (writes are refused server-side).
- **Tests**: core 77 (Vitest, real Postgres), web 3 unit, Playwright 8 e2e flows (mobile Arabic booking + manage/cancel, tampered link, signup→onboarding→live page, dashboard create/cancel, RTL, cross-tenant 404, admin impersonation, owner blocked from admin).


## Phase 2 — what's done

- **Agent** (`packages/core/src/agent/`): channel-agnostic runner (LLM ↔ tools loop, max 6 iterations, short DB transactions per tool call), per-business system prompt (stable part cache-friendly + per-turn dynamic context with agent memory), and 9 zod-validated tools: `get_business_info`, `list_services`, `check_availability`, `create_booking`, `find_customer_appointments`, `reschedule_booking`, `cancel_booking`, `handoff_to_human`, `take_message`. Tools never trust identity from the model: the phone comes from the channel; appointments are scoped to the verified customer (web chat: only those created in that chat). Every tool call is stored on the AI message (`messages.tool_calls`) and visible in the inbox ("AI actions").
- **LLM providers**: `AnthropicProvider` (default model `claude-opus-5-5`, `output_config.effort` = `LLM_EFFORT` (default low), cached stable system block, server-side refusal fallback `fallbacks: "default"`, raw content replay inside a tool loop, streaming for voice), `OpenAICompatibleProvider` (fetch, any `/chat/completions`), and `MockLLMProvider` (deterministic rule-based NLU for Lebanese Arabic / Arabizi / English / French + reply templates — the whole product works without keys).
- **Language**: detection of Arabic script vs Arabizi vs English vs French with code-switching; replies mirror the customer's script. Lebanese spoken date/time phrasing ("bukra, sa3a 4 w nos ba3d el dohr", "بكرا، الساعة أربعة ونص بعد الضهر", "demain à 16h30") shared with voice.
- **Guardrails**: no medical advice, emergency → urgent handoff with Red Cross 140, complaints/anger/"real person" → handoff, off-topic decline, prompt-injection/discount/other-customer-data requests refused, "booked" only after `create_booking` ok:true; confused twice → offer message/handoff.
- **WhatsApp**: Meta Cloud API adapter (send text/template, mark read, media download, `X-Hub-Signature-256` verification, GET challenge) + mock; webhook `/api/webhooks/whatsapp` stores events idempotently (unique inbound provider id), replies after the 200 via `after()`, with the `whatsapp.reply` job as cron safety net; per-conversation processing lease + batching of rapid messages; voice notes downloaded and transcribed via the STT adapter (mock → polite "please type"); reply "1" to a confirm-reminder confirms without the LLM, "2" starts rescheduling; STOP opts out; reminders/templates mirrored into the conversation; delivery statuses update notifications/messages.
- **Inbox** `/dashboard/inbox`: list with filters (all / needs attention / staff / AI), unread counts, AI/staff badges, live updates (4s refresh), thread with AI tool audit, staff composer (auto-takeover), one-click take over / hand back. **WhatsApp simulator** (mock provider only) injects Meta-shaped payloads through the real pipeline.
- **Web chat**: `/chat/[slug]` page + embeddable `public/widget.js` (`<script src=".../widget.js" data-business="slug">`), signed session tokens, same agent; asks for a phone before booking.
- **AI settings** `/dashboard/ai`: persona, tone, owner notes, WhatsApp auto-reply, number + Meta phone_number_id, widget snippet, live "test your receptionist" chat.
- **Evals** (`pnpm eval`): 36 scripted conversations (9 Arabic, 12 Arabizi, 11 English, 4 French incl. code-switching, returning customers, reschedule/cancel, emergencies, medical, injection, privacy, web chat). Each asserts tool calls per turn, reply language/content and the final DB outcome. Runs against a fresh copy of the dental clinic in an isolated DB; reports pass rate by language/category; `EVAL_PROVIDER=anthropic` runs the same suite against Claude.
  - **Result with the mock LLM: 36/36 (100%).** Honest caveat: the mock's rules were written alongside these scenarios, so this mainly proves the tools, harness, language handling and DB outcomes. **The suite has not been run against a real LLM** (no API key in this environment) — run `EVAL_PROVIDER=anthropic ANTHROPIC_API_KEY=… pnpm eval` before going live.
- Tests: core now 103 (adds NLU/spoken phrasing, Anthropic request-shape, WhatsApp channel incl. takeover/dedupe/reminder-1/signature, eval suite), web e2e 10 (adds WhatsApp simulator booking + takeover/hand-back, web chat).

## Phase 3 — what's done

- **`apps/voice`** (Fastify + `@fastify/websocket`, long-running): Twilio webhooks (`/twilio/voice`, `/twilio/after-dial`, `/twilio/gather`, `/twilio/voicemail`, `/twilio/recording`, `/twilio/status`), Media Streams WebSocket (`/twilio/stream`, 8 kHz µ-law, `media`/`mark`/`clear`), browser simulator WebSocket (`/browser/session`), `/health`, and a background job worker. `X-Twilio-Signature` validation (unsigned requests only accepted in dev without Twilio credentials).
- **One session model for every voice path** (`packages/core/src/voice/session.ts`): call row + voice conversation, incremental transcript, same agent + tools as WhatsApp (`channel: "voice"`, caller ID = verified phone), outcome derived from tool results (booked / rescheduled / cancelled / transferred / message_taken / info / abandoned), AI summary (LLM when configured, deterministic otherwise), voice-minute usage (phone calls only).
- **Pipelines** (chosen per business, degrading gracefully to what keys allow):
  - **A. Realtime speech-to-speech** — OpenAI Realtime (`gpt-realtime`, `audio/pcmu`, semantic VAD with interruption); function calls execute our tools. Shapes verified against the `openai` npm package's GA realtime types.
  - **B. Cascade** — OpenAI realtime *transcription* session (server VAD, `languages: [ar,en,fr]`, Lebanese prompt) → agent (streamed text) → sentence chunker → TTS (ElevenLabs `ulaw_8000`/`pcm_24000`, or OpenAI TTS with Lebanese-accent instructions). Barge-in: caller speech clears Twilio's buffer and aborts the in-flight LLM/TTS turn.
  - **C. `<Gather>` fallback** — Twilio speech recognition (`ar-LB`) + `<Say>`: the phone path works with **only Twilio credentials**.
  - **Browser text mode** — Chrome Web Speech API (`ar-LB` recognition + speech synthesis, client-side barge-in) with zero keys.
- **Voice behaviour**: Lebanese greeting ("أهلا وسهلا، [clinic]، معك Maya. كيف فيني ساعدك؟"), max 3 spoken options, times spoken naturally ("الساعة أربعة ونص بعد الضهر"), **read-back confirmation before booking/moving** ("بأكّدلك ياه؟"), Arabic script for TTS even if STT returns Arabizi, prices spoken ("80 دولار"), no lists/emojis/URLs, confused twice → offer message/transfer, handoff → Twilio transfer to the staff number after the reply finishes playing, voicemail recording when the AI is unavailable.
- **Routing**: `always`, `after_hours` (ring the business while open, AI otherwise) and `overflow` (ring staff N seconds, AI on no-answer) via `<Dial action>`; AI-blocked plans fall back to ringing the business / voicemail.
- **Dashboard**: `/dashboard/calls` (list, outcome, duration, summary) and `/dashboard/calls/[id]` (transcript, summary, recording playback via authenticated proxy, linked appointment/customer, AI tool calls); `/dashboard/voice/test` browser call simulator (text mode free; audio mode streams 24 kHz PCM16 through the real pipeline when keys exist); voice settings in AI settings (Fekerte number, transfer number, answer mode, ring time, pipeline).
- **Evals**: 10 voice scenarios through `VoiceCallSession` (read-back, decline, returning caller, reschedule, cancel, spoken prices, emergency, confusion → message, French, Arabizi STT → Arabic speech). **Mock: 46/46 total (36 chat + 10 voice).**
- **Tests**: core 111 (adds µ-law/resampler, sentence chunker, speakable text, Twilio signatures/TwiML, voice tokens), voice server 5 (Twilio gather booking end-to-end, unknown number, health, browser WS token rejection + booking), e2e 11 (adds browser call simulator booking in Arabic → call log).

### Manual live-call test checklist (needs Twilio + OpenAI and/or ElevenLabs keys)

1. Deploy `apps/voice` with a public HTTPS URL; set `VOICE_PUBLIC_URL`, `TWILIO_*`, `OPENAI_API_KEY`, `ELEVENLABS_*`.
2. Buy a Twilio number; set Voice webhook → `POST {VOICE_PUBLIC_URL}/twilio/voice`, status callback → `/twilio/status`. Put the number in Dashboard → AI receptionist → Voice → "Fekerte phone number".
3. Call it from a Lebanese mobile. Check: greeting in Lebanese Arabic within ~1 s; say "بدي موعد تنظيف بكرا الصبح" → 2–3 times offered naturally; pick one, give a name, hear the read-back, say "إيه" → appointment on the calendar + WhatsApp confirmation.
4. Barge-in: talk over the agent mid-sentence → it stops within ~300 ms and answers the new utterance.
5. Code-switching: "Hi, badde ghayer my appointment la bukra" → understands, answers in Lebanese Arabic.
6. Say "bade 7ake 7ada" / "I want a human" with a transfer number set → call is transferred after the agent's sentence.
7. Mumble twice → offered to leave a message; accept → message appears in the inbox.
8. `after_hours` and `overflow` modes: during opening hours the staff phone rings first; let it ring out → AI answers.
9. Call log shows transcript, summary, outcome, recording playback; usage shows voice minutes.
10. Measure latency (caller stops → first audio) for `realtime` vs `cascade`; target < 1.2 s. If cascade is slow, set `ANTHROPIC_MODEL` to a faster Claude model for the voice process and lower `VOICE_SILENCE_MS`.
11. Kill the OpenAI key → pipeline falls back to `<Gather>`; call still works (robotic Polly voice).

## Phase 4 — what's done

- **Plans & pricing** (`packages/core/src/billing/plans.ts`): Basic / Standard / Premium with setup + monthly fee (USD), included AI messages / voice minutes and per-unit overage — all editable by the super admin at `/admin/plans`. Price changes apply to new subscriptions; each business's subscription keeps its own (negotiable) fees, editable on its admin page.
- **Feature gating by tier** (`billing/features.ts`): WhatsApp AI + web chat + reviews/recalls/campaigns need Standard+, voice AI needs Premium; per-business overrides via feature flags. Enforced server-side in every AI channel (WhatsApp worker, web chat API, Twilio routing) and reflected in dashboard navigation.
- **Usage limits** (`billing/limits.ts`): AI messages (WhatsApp + web chat replies) and voice minutes (phone calls) are metered per business-local month. Usage beyond the included amount is **allowed and billed** as overage on the next invoice; a safety **hard cap** (default 3× included, `USAGE_HARD_CAP_MULTIPLIER`) pauses AI to prevent runaway cost. `checkAiAllowed()` = plan + billing status + trial + cap.
- **Manual billing** (`billing/invoices.ts`, `providers/payments.ts`): invoices numbered `FK-YYYY-NNNN` with lines for the monthly fee, unpaid setup fee and the previous month's overage. Admin marks paid with method (cash / bank transfer / wallet / card / other), reference and an optional receipt upload (image/PDF ≤ 5 MB, stored via the storage adapter — local disk or Supabase Storage). Paying activates the business and resumes AI. Void supported. Printable invoice page (browser print → PDF).
- **Payments adapter**: `manual` (default — payment instructions from `PAYMENT_INSTRUCTIONS`) and `mock_link` (demo only, never charges). No card processor / wallet API is faked; a real one implements `PaymentsProvider`.
- **Trial → pause**: 14-day trial (Premium features). A daily billing sweep (`billing/sweep.ts`, scheduled by `jobs/scheduler.ts` through the existing job queue) pauses AI for trials that ended unpaid (and issues their first invoice), pauses businesses with invoices overdue by `BILLING_GRACE_DAYS`, and on the 1st issues monthly invoices for active businesses (`BILLING_AUTO_INVOICE`). **The booking page keeps working** in every paused state (tested).
- **Owner billing page** `/dashboard/billing`: current plan + status, usage meters with included amounts and estimated overage, AI status per channel with the reason when off, plan comparison (switch instantly during trial; request → admin approval when active), invoice history, "how to pay" with reference, "Activate my plan now" (get the first invoice before the trial ends). Dashboard-wide banner for trial ending / paused / cap reached.
- **Admin**: `/admin/invoices` (MRR, outstanding, collected this month, status filter, generate this month's invoices, mark paid with receipt, void), `/admin/invoices/[id]` (printable + receipt link), business page now has subscription fees / setup-paid / approve-or-reject plan requests / new invoice / invoice list. Admin tier changes go through `applyPlanChange` (subscription fees follow the price list).
- **RLS hardening** (migration `0004_billing_rls`): owners can **read** their invoices/subscriptions but not write them; usage events are append-only for tenants; tenants may only write `deposit` payments; a trigger blocks non-admin changes to `plan_tier`, `status`, `trial_ends_at`, `feature_flags` on `businesses` (owner billing actions run narrowly on the system connection after an owner check).
- **Seed**: Demo Dental (Premium, active, last month paid, usage this month) and Demo Barber (Standard, active, last month paid, this month's invoice outstanding).
- **Tests**: core 120 (adds `test/db/billing.test.ts`: tier gating, overage + hard cap, invoice lines, trial expiry → pause → first invoice → booking still works → pay → active, overdue pause, void, monthly idempotency, plan change rules, admin pricing, RLS on billing tables), e2e 15 (adds `billing.spec.ts`: owner billing page, Standard tier gating + upgrade request, admin issues invoice + marks paid with reference and receipt upload, plans page). Login rate limit is now 30/min per IP + 10/min per account (was 10/min per IP — tripped by clinics sharing one IP, and by the e2e suite).

## Phase 5 — what's done

- **CRM**: segment chips on Customers (All · VIP · No visit in 6 months · No-shows · Upcoming · Marketing opt-in) on top of search/tags; "Message this segment" jumps to a campaign. Customer page has a full **timeline** (`crm/timeline.ts`): bookings (source, status, price, deposit), status changes, WhatsApp/web conversations, calls, every message we sent (reminders, recalls, campaigns), ratings + private feedback, deposits, consent/opt-out.
- **Deposits** (`booking/deposit-rules.ts`, `growth/deposits.ts`): required for services flagged "deposit", and for customers with ≥ N no-shows (setting; 0 = off; default amount = 30% of price rounded to $5, min $10). Public bookings (page, WhatsApp, web chat, phone) are held as **pending** with `deposit_due_at` (hold hours setting, never later than 1 h before the visit); a pending payment row + WhatsApp `deposit_request` (amount, business's own payment instructions or a payment link, deadline, reference `D-XXXXXX`). Staff mark **Deposit received** (method + reference) or **Waive** from the appointment sheet → confirmed + confirmation message. Unpaid holds auto-cancel (`deposit.expire` job) and free the slot. Staff bookings never require a deposit. The AI's `create_booking` result says `deposit_required` + amount + deadline and the prompt forbids calling it confirmed. Booking page and manage page show the deposit notice.
- **Payment-link adapter**: `PAYMENTS_PROVIDER=mock_link` issues signed links to `/pay/mock/[token]` (demo page, "simulate payment", disabled in production unless `ALLOW_MOCK_PAYMENTS=true`). No real processor is faked.
- **Reviews** (`growth/reviews.ts`): marking a visit **completed** schedules a rating request (2 h after the end, moved into 10:00–20:00; skipped for visits marked complete > 3 days late; max one ask per customer per 30 days). Replies are parsed **without the LLM** (`5`, `٤`, `4/5`, `⭐⭐⭐`): 4–5 → thanks + Google review link; 1–3 → apology + "what went wrong?", the next message is stored as **private feedback** (event in the inbox thread, list on Analytics, timeline). Works on any plan with reviews, even when AI is paused or staff took over.
- **Recalls** (`growth/recalls.ts`): per-service `recall_interval_days` (Services editor). Completing a visit schedules a `recall_reminder` with a booking link pre-selecting the service; skipped if the customer has an upcoming appointment, a later visit for that service, or opted out.
- **No-show reduction**: first reminder asks "reply 1 to confirm, 2 to reschedule" (setting); **"1" confirms and "2" sends the self-service reschedule link even on Basic (no AI)** — with AI, "2" starts the AI reschedule flow. No-show count per customer, segment, rate on Analytics, optional deposit for repeat no-shows.
- **Campaigns** (`growth/campaigns.ts`, `/dashboard/campaigns`): broadcast the approved MARKETING template `campaign_generic` to a segment (6-month lapsed, VIP, no-shows, all opted-in, or a tag). Live audience preview ("X of Y can receive it"). Only customers with marketing consent who haven't opted out; every message says "reply STOP"; STOP/وقف opts out instantly. Send now or schedule; batched job (50 per run) with one notification row per recipient (unique per campaign → retries never double-send); sent counts; cancel.
- **Analytics** (`growth/analytics.ts`, `/dashboard/analytics`, 7/30/90 days): hero "Booked by the AI" (+ value, + how many outside opening hours), new bookings, completed revenue (+ booked estimate), no-show rate, conversation → booking conversion, bookings per day (AI vs other, stacked), bookings by source, busiest hours heatmap (weekday × hour), AI-only vs staff-handled conversations, calls answered vs missed (+ booked by phone), reviews (avg, sent to Google), recalls (sent / rebooked), deposits (collected / expired), private feedback list. Dependency-free HTML/CSS charts following the data-viz rules (validated blue/orange categorical pair, single-hue sequential ramp, ≤ 24px bars, hover/focus tooltips, table view, RTL-safe).
- **Shared sending path** (`notifications/customer.ts`): every template (reminders, deposits, reviews, recalls, campaigns) goes through one function: consent + marketing-consent checks, customer language, notification row, send, mirror into the WhatsApp thread, usage metering.
- **Seed**: VIP tags, marketing consent, a $50 deposit on whitening, an appointment awaiting its deposit + one paid, 9 ratings incl. 2 private complaints, recalls, a sent + a draft campaign, WhatsApp conversations behind WhatsApp bookings, AI calls behind phone bookings, info-only chats and hang-ups; booking `created_at` spread realistically. Seeded history never triggers real sends on first `pnpm dev`.
- **Tests**: core 134 (adds `test/db/growth.test.ts`, 14 tests: deposit hold → request message → paid/confirmed; expiry frees the slot; staff bookings skip deposits; waive; repeat no-show rule; AI tool says held-not-confirmed; rating parser; 4–5 → Google link; 1–3 → private feedback with AI paused; recall scheduling + skip when rebooked; campaign consent/once/STOP; Basic-tier "1"/"2" without AI; analytics; timeline). e2e 19 (adds `growth.spec.ts`: analytics, segments + timeline, campaign send through the worker, online deposit booking → staff marks received). E2E helper now logs in once per account (login is rate-limited per account). Evals still 46/46 (mock).

## Phase 6 — what's done

- **Marketing site at `/`** (Arabic default with RTL, English, French — locale from `?lang`, cookie, then Accept-Language): sticky header with mobile menu, hero with an illustrative WhatsApp conversation (labelled as an example), the problem (missed calls / late WhatsApp replies / no-shows — **no invented statistics**), **ROI calculator** (missed calls/day × % who would have booked × average value × working days → monthly and yearly estimate, and how many times it covers Premium; the assumptions are stated on the page), how it works (3 steps), features, **pricing from the `plans` table** (admin-editable, setup + monthly in USD, features per tier, "most popular"), FAQ (Lebanese Arabic understanding, keeping your number, what if the AI doesn't know, double-booking, data, payment methods, contract), **"Book a demo" form** → lead (rate-limited per IP, honeypot, phone normalized, repeats within 24 h merged; pricing cards pre-select the plan).
- **Live demo `/demo`**: chat with the Demo Dental agent (same web-chat pipeline, per-IP limits) and a **browser call** (same call simulator, text mode with the browser's speech engines; tokens minted by a separate rate-limited action — 6 calls/hour/IP, 5-minute tokens, demo business only; paid audio pipeline only if `DEMO_ALLOW_AUDIO=true`).
- **Admin leads pipeline `/admin/leads`**: board with New → Demo scheduled → Demo done → Trial → Paying → Lost, WhatsApp contact button, stage changes, timestamped notes (author recorded), total + lead→paying conversion. Leads are super-admin-only under RLS (tested).
- **Seed**: 6 demo leads across stages.
- **Tests**: core 138 (adds `test/db/leads.test.ts`: normalize + merge repeats, validation, pipeline notes, RLS), e2e 22 (adds `marketing.spec.ts`: Arabic RTL home with DB pricing, ROI maths, FAQ, demo request → admin board → stage change, live demo chat + public demo call).

## Phase 7 — what's done

- **RLS verified with tests**: every public table has RLS enabled; every tenant table is isolated for reads, writes, deletes and "moving" rows to another tenant; billing tables read-only for tenants; leads super-admin-only; plan/status/trial/flags changeable only by super admins (trigger).
- **Prompt-injection guard** (`packages/core/src/agent/guard.ts`), independent of the model: multilingual detection (ar / arabizi / en / fr) → security note in the turn's prompt + audit (`ai.injection_attempt`); **output filter** that replaces any reply containing a phone number or e-mail that isn't the business's or the verified customer's (`ai.reply_redacted`). Tests (`test/db/security.test.ts`) use a **deliberately malicious scripted model** and prove: no other customer's contact data leaves the system; strict tool schemas reject attacker-chosen fields (`customer_phone`, `price`); appointment tools only touch the verified caller's bookings; prices always come from the DB; the cancellation window holds; invalid tool input is rejected. 3 new injection evals (Arabic, Arabizi, French).
- **Privacy fix found in the pass**: web chat used to look up the customer record by a *typed* (unverified) phone number, which would have let the AI greet someone by the name on that number. Only channel-verified phones (WhatsApp sender, caller ID) unlock customer details now.
- **Rate limiting**: shared **Postgres** store (UNLOGGED `rate_limits` table, fail-open to memory) used automatically in production — works on serverless/multi-instance; login per IP + per account, public booking/slots/chat/manage APIs, demo requests and demo calls. **AI caps**: per-conversation hourly AI reply cap on WhatsApp and web chat (then handed to staff with a polite message) and per-caller hourly AI call cap (then ring the business / voicemail).
- **Webhooks**: Meta `X-Hub-Signature-256` and Twilio `X-Twilio-Signature` verified (unsigned requests rejected in production; mock WhatsApp webhook disabled in production — verified with `next start`); Twilio media-stream WebSockets now require a signed parameter.
- **Headers**: `X-Frame-Options: DENY` + `frame-ancestors 'none'` except the embeddable `/chat/*`, HSTS in production, nosniff, referrer and permissions policies.
- **Input validation**: every API route and server action validates with Zod; tool inputs use strict schemas.
- **Secrets**: only in env; `.env` git-ignored; secret scan clean; `APP_SECRET` length enforced in production.
- **Observability**: structured JSON logs everywhere; **Sentry-ready** reporting without an SDK (`lib/error-reporting.ts`, envelope endpoint, customer content stripped) wired to `logger.error`, Next.js `instrumentation.ts` (`onRequestError`) and the voice server's error handler + unhandled rejections.
- **Health checks**: `/api/health` (web) and `/health` (voice) report DB status + latency, job-queue lag (degraded past `HEALTH_MAX_JOB_LAG_SECONDS`), failed jobs in 24 h, version; voice adds active calls and which providers are configured. 503 when the DB is down.
- **Deploy configs**: `apps/voice/Dockerfile`, `apps/voice/fly.toml`, `railway.json`, `apps/web/vercel.json` (cron). `next build` verified.
- **Docs**: full `README.md` (what it is, Mermaid architecture, quick start in 4 commands after cloning, every env var, connecting Claude / WhatsApp / Twilio + Lebanese forwarding / OpenAI / ElevenLabs / Supabase / Sentry, deploy guide Supabase + Vercel + Railway/Fly, onboarding a real business, security model, troubleshooting). Complete `.env.example`.
- **Tests**: core 172 (adds guard, security, hardening, rate-limit/AI-cap suites), voice 5, web 3; e2e 22; evals 49/49.

## What's mocked / needs keys

| Area | Now | To go live |
|---|---|---|
| WhatsApp | `MockWhatsAppProvider` (console + DB) + simulator | `WHATSAPP_PROVIDER=meta` + Meta app (token, app secret, verify token, phone_number_id) + approved templates. Adapter written from Meta's documented shapes; **not exercised against the live Graph API** (developers.facebook.com was unreachable from this environment; Graph version defaults to v24.0 — verify) |
| LLM | `MockLLMProvider` | `ANTHROPIC_API_KEY` (Claude, default `claude-opus-5-5`) or `LLM_PROVIDER=openai`. Request shape unit-tested against a stubbed SDK; not run live here |
| STT (voice notes) | Mock (replies "please type") | `STT_PROVIDER=openai` + key (`gpt-4o-transcribe` default; untested live) |
| Telephony | Twilio webhooks testable with unsigned POSTs in dev; browser simulator | Twilio account + number (`TWILIO_ACCOUNT_SID/AUTH_TOKEN`); a way to route the clinic's Lebanese number to it (carrier call-forwarding or a SIP trunk). **Untested against live Twilio** (twilio.com unreachable here) |
| Realtime / streaming STT | Not active without keys (browser text mode / `<Gather>` instead) | `OPENAI_API_KEY` (Realtime GA shapes verified from SDK types; untested live) |
| TTS | None (browser speech synthesis in simulator) | `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` (Lebanese/Levantine voice) or OpenAI TTS. **Untested live** (elevenlabs.io unreachable here) |
| Email (magic links) | Printed to server log / shown in dev | Use `AUTH_PROVIDER=supabase` (Supabase sends emails) |
| Deposits | Business's own instructions (Whish/OMT/cash) + staff mark received; `mock_link` demo page | A real payment-link provider implementing `PaymentsProvider.createPaymentLink` + a webhook that calls `markDepositPaid` (none faked) |
| WhatsApp templates | Rendered locally, sent through the mock | Submit the templates in `packages/core/src/notifications/templates.ts` (incl. `campaign_generic` MARKETING, `review_request`, `recall_reminder`, `deposit_request` UTILITY) for Meta approval in ar/en/fr with the same variable order |
| Payments | Manual invoicing (admin marks paid) | Nothing required — this is the intended Lebanon flow. For card/wallet collection, implement `PaymentsProvider` for the chosen processor (none faked) |
| Receipt storage | Local disk (`.data/uploads`) | `STORAGE_PROVIDER=supabase` + `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` + a private bucket (REST shape from docs; untested live) |
| Rate limiting | In-memory in dev, shared Postgres store in production | Nothing — works on Vercel/multi-instance as is |
| Error tracking | Structured logs to stdout | `SENTRY_DSN` (envelope sender, untested live) or the official SDK via `setErrorHook` |

## Decisions

- **Postgres anywhere, Supabase optional.** The app talks to Postgres via Drizzle + `postgres.js`; Supabase is a supported host (and auth provider) but local dev doesn't need the Supabase CLI. `pnpm dev` uses `DATABASE_URL`, or starts `docker compose` Postgres if unreachable.
- **RLS via role switching** rather than Supabase JWT claims: every tenant transaction runs `SET LOCAL ROLE fekerte_app` + `set_config('app.business_id', …)`. Works on any Postgres (incl. Supabase) and keeps PostgREST/anon access default-deny because every table has RLS on.
- **Availability semantics**: staff without their own hours inherit business hours; the *service time* must fit inside working windows (minus breaks/time off/holidays); the *blocked window* (with buffers) must not overlap other blocked windows — buffers may extend past closing. Exactly what the DB constraint enforces.
- **Dashboard override**: staff may book outside hours/notice from the dashboard (explicit checkbox) but never overlap. Public channels can never override.
- **Default trial = Premium for 14 days** so owners can try every feature; admin can change.
- **Phone identity**: E.164 via libphonenumber with Lebanon default (`03 123 456`, `70-123456`, `00961…`, Arabic-Indic digits all normalize).
- **Native `<select>`** in forms for best mobile/RTL UX; Radix only for dialogs/dropdowns.
- **TypeScript 5.9 / Vitest 3 / ESLint 9** (proven) instead of the very latest majors; Next.js 16.4 + React 19 + Tailwind 4 + Zod 4.
- **Catalog in the system prompt**: services/prices/hours come from the DB into the stable prompt (same source as the tools) to save a tool round-trip, especially for voice. Availability is *only* ever from `check_availability`.
- **Cross-turn history is plain text**; native content (incl. thinking blocks) is replayed only within one turn's tool loop, so Claude's preserved-thinking rules hold and the cached prefix stays stable.
- **WhatsApp profile name** is used as the customer's name when they have none on file.
- **Arabizi replies use English service names** ("Checkup", "Teeth cleaning") — that's how Lebanese people text.
- **Webhook processing**: inline via `after()` for speed (customers expect replies in seconds), with the job queue as the durable fallback.
- **Voice pipelines degrade, never fail**: business preference → what keys allow → Twilio `<Gather>` (works with Twilio only). The browser simulator's free mode uses the browser's own speech engines.
- **Read-back before booking on calls** (not on WhatsApp): mishearing is the main voice risk.
- **Call outcome is derived from tool results**, not model self-report.
- **Lebanese numbers**: Twilio may not sell +961 numbers; plan is call forwarding (always / on no-answer) from the clinic's existing line to a Twilio number, or a SIP trunk from a Lebanese carrier into Twilio Elastic SIP. Recorded as an open question for go-live.
- **Overage is billed, not blocked**; only a 3× safety cap pauses AI. Owners never get surprise silence from the AI in a busy month, and Fekerte is protected from runaway cost.
- **Trial expiry pauses rather than downgrades**: AI stops, booking/reminders continue, and the first invoice is issued automatically so the owner sees exactly what to pay.
- **Owner plan changes**: free switching during the trial; on paid subscriptions an upgrade/downgrade is a request the admin approves (pricing is often negotiated in Lebanon).
- **Billing state is admin-only at the database level** (RLS + trigger), not just in the UI.
- **Ratings and confirmations are parsed without the LLM** — cheap, instant, deterministic, and they work on Basic or with AI paused.
- **Deposits hold the slot as `pending`** (it blocks double booking) instead of letting the customer "own" an unpaid slot; staff stay in control (mark received / waive), AI never marks payments.
- **Campaign consent is opt-in** (marketing checkbox on booking, or staff toggle) — Meta requires it for MARKETING templates; recalls/reviews are service messages and only respect WhatsApp opt-out.
- **Charts are plain HTML/CSS** (no chart library): small, server-rendered, RTL-friendly, accessible tooltips + table view.
- **Marketing claims stay honest**: no made-up percentages; the ROI calculator shows its formula and says it's an estimate; the hero chat is labelled as an example.
- **Public demo is text-mode by default** (browser speech) so an anonymous visitor can't run up OpenAI/ElevenLabs costs; it uses the real agent and the real demo calendar.
- **Invoices as printable HTML** (browser "Save as PDF") instead of a PDF library — boring and dependency-free.
- Dashboard nav only shows sections that exist in the current build (`BUILT` set in `apps/web/src/lib/dashboard-data.ts`).

## Known issues / limitations

- Calendar drag on touch devices uses `touch-action: none` on appointment blocks (empty grid still scrolls); on phones, rescheduling via the appointment sheet is the main path.
- Week view with "all staff" shows overlapping appointments in lanes; text truncates when 3+ overlap.
- Staff role users currently see the same dashboard as owners (owner-only actions are refused server-side; the Billing page refuses staff, though its nav item is still shown).
- **Dev only**: if `next dev` is killed abruptly (e.g. container restart), Turbopack's persistent dev cache can make pages reload endlessly ("HMR hash mismatch"). `pnpm clean:next` and restart fixes it. A graceful stop/start does not trigger it (verified).
- The voice-server Docker image, Fly/Railway configs and Vercel cron were written from vendor docs but not deployed from this environment.
- Caller ID is used as the phone identity on calls; it can be spoofed (as with any phone line). Changes to existing bookings by phone are limited to that caller's own appointments and still follow the cancellation window.
- Real-LLM conversation quality is unmeasured here (no API key in this environment); the mock passes 49/49 but was built alongside the scenarios.
- Meta template approval is manual; until approved, reminders/reviews/recalls/campaigns can't be sent to customers who haven't messaged in the last 24 h.

## Exact next step

Follow **"Exact steps to put the first clinic live"** at the top of this file. The first concrete action: get an Anthropic API key and run `EVAL_PROVIDER=anthropic pnpm eval` to measure the real model on the 49 scenarios.
