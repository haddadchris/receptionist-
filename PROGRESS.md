# Fekerte — build progress

_Last updated: Phase 1 complete._

## Status by phase

| Phase | Scope | Status |
|---|---|---|
| 1 | Foundation + Basic tier (online booking) | ✅ Done |
| 2 | Standard tier — AI WhatsApp receptionist | ⏳ Next |
| 3 | Premium tier — AI voice receptionist (Lebanese Arabic) | ⏳ |
| 4 | Billing, plans, limits | ⏳ |
| 5 | Growth layer (CRM, deposits, reviews, recalls, analytics, campaigns) | ⏳ |
| 6 | Marketing site + sales tools | ⏳ |
| 7 | Hardening + handoff | ⏳ |

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

## What's mocked / needs keys

| Area | Now | To go live |
|---|---|---|
| WhatsApp | `MockWhatsAppProvider` (console + DB) | Phase 2 adds the Meta Cloud API adapter (`WHATSAPP_PROVIDER=meta`) |
| Email (magic links) | Printed to server log / shown in dev | Use `AUTH_PROVIDER=supabase` (Supabase sends emails) |
| Rate limiting | In-memory per instance | Swap store for Redis/Upstash on multi-instance deploys (Phase 7) |

## Decisions

- **Postgres anywhere, Supabase optional.** The app talks to Postgres via Drizzle + `postgres.js`; Supabase is a supported host (and auth provider) but local dev doesn't need the Supabase CLI. `pnpm dev` uses `DATABASE_URL`, or starts `docker compose` Postgres if unreachable.
- **RLS via role switching** rather than Supabase JWT claims: every tenant transaction runs `SET LOCAL ROLE fekerte_app` + `set_config('app.business_id', …)`. Works on any Postgres (incl. Supabase) and keeps PostgREST/anon access default-deny because every table has RLS on.
- **Availability semantics**: staff without their own hours inherit business hours; the *service time* must fit inside working windows (minus breaks/time off/holidays); the *blocked window* (with buffers) must not overlap other blocked windows — buffers may extend past closing. Exactly what the DB constraint enforces.
- **Dashboard override**: staff may book outside hours/notice from the dashboard (explicit checkbox) but never overlap. Public channels can never override.
- **Default trial = Premium for 14 days** so owners can try every feature; admin can change.
- **Phone identity**: E.164 via libphonenumber with Lebanon default (`03 123 456`, `70-123456`, `00961…`, Arabic-Indic digits all normalize).
- **Native `<select>`** in forms for best mobile/RTL UX; Radix only for dialogs/dropdowns.
- **TypeScript 5.9 / Vitest 3 / ESLint 9** (proven) instead of the very latest majors; Next.js 16.4 + React 19 + Tailwind 4 + Zod 4.
- Dashboard nav only shows sections that exist in the current build (`BUILT` set in `apps/web/src/lib/dashboard-data.ts`).

## Known issues / limitations

- Calendar drag on touch devices uses `touch-action: none` on appointment blocks (empty grid still scrolls); on phones, rescheduling via the appointment sheet is the main path.
- Week view with "all staff" shows overlapping appointments in lanes; text truncates when 3+ overlap.
- Staff role users currently see the same dashboard as owners (owner-only actions are refused server-side).

## Exact next step

Phase 2: Meta WhatsApp Cloud API adapter + webhook, AI receptionist agent with tools, mock LLM, inbox with takeover, web chat widget, eval harness.
