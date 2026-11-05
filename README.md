# Fekerte

AI receptionist SaaS for appointment-based businesses in Lebanon: online booking, an AI WhatsApp receptionist and an AI voice receptionist that speaks Lebanese Arabic.

> Full documentation (architecture, env vars, connecting real providers, deploy guide) lands in Phase 7. See [PROGRESS.md](./PROGRESS.md) for current status.

## Quick start

Requirements: Node 22+, pnpm 10, and either Docker or a local Postgres 15+.

```bash
pnpm install
pnpm dev          # creates .env, starts Postgres (docker) if needed, migrates, seeds, runs the app
```

Open http://localhost:3000

| Who | Login |
|---|---|
| Super admin | `admin@fekerte.app` / `admin12345` |
| Demo Dental Clinic owner | `owner@demo-dental.com` / `demo12345` |
| Demo Barber Shop owner | `owner@demo-barber.com` / `demo12345` |

Public booking pages: http://localhost:3000/b/demo-dental and http://localhost:3000/b/demo-barber

## Useful commands

```bash
pnpm typecheck && pnpm lint && pnpm test   # all packages
pnpm test:e2e                              # Playwright critical flows (needs seeded DB)
pnpm db:reset                              # drop, migrate, seed (local only)
pnpm db:generate                           # new Drizzle migration after editing schema.ts
```
