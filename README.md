# PsychE

Student counselling and wellbeing platform: React + TypeScript + Vite frontend, Supabase (Postgres, Edge Functions, Storage) backend. Each school gets its own clone: its own Supabase project and its own Coolify deployment.

## Repository layout

```
.
├── src/                    Frontend app (pages, components, lib, analytics, types)
├── public/                 Static assets served as-is
├── supabase/functions/     Edge Functions (staff-login, generate-ai-report, …) + _shared helpers
├── database/
│   ├── install.sql         Complete installer for a fresh Supabase project (source of truth)
│   ├── migrations/         Numbered upgrades for existing databases (vNN_*.sql)
│   └── archive/            Superseded SQL, kept for history. Do not run.
├── server/webhook.js       Standalone Express import server (inert since V15, see docs)
├── scripts/                Ops scripts (anon-probe.mjs); scripts/archive = one-off, already run
├── docs/                   Specs, runbooks, install guide, PRD, designs, release notes
├── .github/workflows/      Scheduled jobs (daily analytics, AI report batch)
├── agent.md                Entry point for AI coding agents
└── TODOS.md                Deferred work
```

## Quick start

```bash
npm install
npm run dev
```

Needs a `.env.development` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. `npm run build` type-checks and builds to `dist/`.

## Database

- **New clone:** run `database/install.sql`. See [docs/GUIDE_install.md](docs/GUIDE_install.md).
- **Existing database:** run the migrations it hasn't had yet, in order. See [database/README.md](database/README.md).

## Docs

| Need | Read |
|---|---|
| Install a new school | [docs/GUIDE_install.md](docs/GUIDE_install.md) |
| Developer guide | [docs/GUIDE_developer.md](docs/GUIDE_developer.md) |
| Schema and engine specs | [docs/ARCH_technical-specs.md](docs/ARCH_technical-specs.md) |
| Release 1 rollout | [docs/RUNBOOK_release1.md](docs/RUNBOOK_release1.md) |
| Product requirements | [docs/PRD.md](docs/PRD.md) |
