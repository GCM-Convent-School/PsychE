# Runbook: Release 1 (Trust)

Replaces the shared PIN with per-person sign-in (mobile number + personal 4-digit work code) and removes anonymous access to student data.

The plan is in `docs/PLAN_ui-ux-upgrade.md`; the design is in `docs/designs/sellable-ui-trust-coverage.md`.

> This repository is **public**. Never commit a mobile number, work code, API key or break-glass code. Every value below marked `<...>` is typed only in the Supabase dashboard or terminal.

## What ships

| Piece | File |
|---|---|
| Staff, work codes, branding, audit (additive, safe any time) | `v14_staff_auth.sql` |
| Anonymous access removed (maintenance window only) | `v15_rls_lockdown.sql` |
| Emergency undo of V15 | `v15_rollback.sql` |
| Fresh installs get both | `schema/install.sql` (Sections 5 and 7.5) |
| Sign-in / code sending | `supabase/functions/staff-login`, `supabase/functions/send-work-code` |
| Caller checks (staff session or cron service key, anon → 401) | `generate-ai-report`, `formalize-sessions`, `list-models` (admin only) |
| Proof | `node scripts/anon-probe.mjs <env file>` |

**Sign-in rules.**
- A wrong code 5 times in a row starts a 15-minute cooldown that clears by itself. There is no permanent lock.
- "Forgot your code?" on the login screen texts a new code. It works at most once every 10 minutes per number, and gives the same answer whether or not the number is staff.
- Principals cannot sign in until Release 3 (D12).

## Secrets (per Supabase project)

```bash
REF=<project-ref>   # staging: xbkusbhdxkzxtptyewtt · GCM production: gydhrtrthnwuhywhlyet
supabase secrets set --project-ref $REF \
  NOTIFY_API_URL=https://notify.gcmconventschool.in/api/v1/messages \
  NOTIFY_API_KEY=<notify api key> \
  ALLOWED_DOMAINS=gcmconventschool.in,theupliftco.com,thefedeli.com \
  BREAKGLASS_MOBILE=<admin mobile, 10 digits> \
  BREAKGLASS_CODE_SHA256=$(printf '%s' '<break-glass code>' | shasum -a 256 | cut -d' ' -f1)
```

- **Break-glass code:** choose one that is not `9999` or any obvious pattern. Six or more digits is better; the login accepts up to 12. It only works for the mobile in `BREAKGLASS_MOBILE`, only while that person is an active admin, and it counts toward the same 5-try cooldown.
- **`ALLOWED_DOMAINS`:** the websites allowed to call the functions from a browser. It replaces the list that used to be hard-coded in `_shared/cors.ts`. If it's missing, AI features fail from the deployed site but still work on localhost.

## Supabase dashboard settings (per project)

- **Authentication → Sign In / Providers:** turn **off** "Allow new users to sign up". Staff accounts are created by the `staff-login` function only.
  - ⚠ This setting covers the whole Supabase project. If another app shares the project (the names "HorizonExpStaging" and "Supabase Fleet Management Sys" suggest one might) and that app relies on public sign-up, **leave it on**. PsychE stays safe either way: a self-registered account has no active `PsychE_Staff` row, so RLS shows it nothing.
- Leave email confirmation as it is; staff never receive email.

## Deploy the functions

```bash
supabase functions deploy staff-login        --no-verify-jwt --project-ref $REF
supabase functions deploy send-work-code     --no-verify-jwt --project-ref $REF
supabase functions deploy generate-ai-report --project-ref $REF
supabase functions deploy formalize-sessions --project-ref $REF
supabase functions deploy list-models        --project-ref $REF
```

`staff-login` and `send-work-code` are public because the login screen calls them before anyone is signed in. Each checks everything itself.

On production, the last three go out **in the window** (step C2). Once deployed, they refuse the old PIN frontend's requests.

## Seed the first admin (SQL editor, per project)

```sql
-- school name (logo can be uploaded later in Settings → System Settings)
UPDATE "PsychE_Settings" SET school_name = '<School name>' WHERE id = 1;

INSERT INTO "PsychE_Staff" (full_name, mobile, role)
VALUES ('<Admin full name>', '<admin mobile, 10 digits>', 'admin');
```

The admin then signs in with "Forgot your code? Send me a new one", or with the break-glass code. Everyone else is added in **Settings → Staff**, which texts their code.

---

## A. Staging rehearsal (D11): do all of it before GCM's window

Note the start and end time of each step. Steps A7 and A10 set the window length.

1. Run `v14_staff_auth.sql` in the staging SQL editor.
2. Seed the admin and school name (above). Set the secrets and deploy all five functions to staging.
3. Turn off sign-ups (above).
4. Run `npm run dev:v2` and open http://localhost:5174:
   - [ ] Admin: "Forgot your code?" → the SMS arrives → sign in works.
   - [ ] Break-glass code signs the admin in.
   - [ ] 5 wrong codes → "wait 15 minutes" message. The right code is refused until the 15 minutes pass.
   - [ ] Settings → Staff: add a counsellor → their SMS arrives → they sign in. They see only the Question Library and Global Tags tabs.
   - [ ] Switch the counsellor off → their next click shows "Your access is not active".
   - [ ] Settings → System: set the school name and upload a logo → it shows on the login screen and in printed reports.
5. Run `node scripts/anon-probe.mjs .env.staging`. It is expected to FAIL here, because V15 hasn't run yet.
6. Sign in as the counsellor and leave the tab open.
7. **Run `v15_rls_lockdown.sql`.**
8. Run `node scripts/anon-probe.mjs .env.staging`. It **must print PASS**.
9. In the open counsellor tab:
   - [ ] Dashboard loads.
   - [ ] A student profile loads.
   - [ ] Logging a session works.
   - [ ] Generating an AI report and a formal report works.
   - [ ] Kanban and Analytics load.
10. Cron path, which must still work with the service key:
    ```bash
    curl -s -X POST "https://$REF.supabase.co/functions/v1/generate-ai-report" \
      -H "Authorization: Bearer <staging service role key>" -H "Content-Type: application/json" \
      -d '{"studentUuid":"<a staging student uuid>","source":"cron"}'
    curl -s -X POST "https://$REF.supabase.co/rest/v1/rpc/psyche_run_daily_batch" \
      -H "apikey: <staging service role key>" -H "Authorization: Bearer <staging service role key>"
    ```
    Neither call may return 401.
11. **Rollback drill.** Run `v15_rollback.sql`, then the probe (it should FAIL, meaning data is open again). Then run `v15_rls_lockdown.sql` again and the probe (PASS). Time it.
12. Audit check: `SELECT action, table_name, at FROM "PsychE_Audit" ORDER BY at DESC LIMIT 20;` should list the logins and the session you logged, each with an `actor_user`.

Go ahead with GCM only when every box is ticked.

## B. Before GCM's window (no downtime)

1. Rotate the notify API key (it was shared in a chat) and use the new one in the secrets. *GCM, 2026-10-29: founder kept the existing key (accepted risk, see Known limits).*
2. Run `v14_staff_auth.sql` on production. It is additive, and the PIN app keeps working. If V14 was run before 2026-10-29, also run `v14_1_grants.sql` (explicit grants on the staff and audit tables; without them sign-in lands on "Your access is not active" on projects whose defaults don't grant new tables).
3. Seed the admin. Set the school name to `GCM Convent School`. Set the secrets. Turn off sign-ups.
4. Deploy **only** `staff-login` and `send-work-code` to production.
5. Tell the counsellors: from the window onward, they sign in with their mobile number and a code that arrives by SMS.

## C. GCM window (after school hours)

1. Merge the release to `main`. Coolify deploys the new frontend; wait for it to finish.
2. Deploy `generate-ai-report`, `formalize-sessions` and `list-models` to production.
3. The admin signs in on the live site and adds each counsellor in Settings → Staff (codes go out by SMS). Each counsellor signs in once.
4. **Run `v15_rls_lockdown.sql` on production.**
5. Run `node scripts/anon-probe.mjs .env.production` and check it prints **PASS**. Don't run the probe against production before this step: while data is still open, its first function check really runs the nightly batch.
6. Smoke test as a counsellor (the A9 list).
7. Save the probe output with the date in the release notes.

**Rollback, if C5 or C6 fails and can't be fixed in the window:**
1. Run `v15_rollback.sql` on production.
2. In Coolify, redeploy the previous commit.
3. Redeploy the three functions from the previous commit: `git checkout <previous sha> -- supabase/functions`, deploy, then `git checkout main -- supabase/functions`.

No data is deleted by any step. Re-run V15 once it's fixed. The old PIN app still unlocks: with the `allowed_pins` column gone, it falls back to its built-in PINs.

## D. New school (clone)

1. Create a new Supabase project. Run `schema/install.sql` (it includes V14 and V15).
2. Do the secrets, dashboard settings and function deploy (above), with that school's notify gateway and domain.
3. Seed its admin and school name.
4. Create a new Coolify app from this repo with that project's `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
5. Copy the two GitHub Actions workflows for its scheduler, pointing at its own `SUPABASE_URL` and service key secrets. Per-clone scheduling is still open for eng review (P17).
6. Run `node scripts/anon-probe.mjs <its env file>`. It must print PASS.

## Known limits in Release 1

- **Accepted risk: the break-glass code is 4 digits and easy to guess** (founder decision, 2026-10-29). Treat it as known to anyone who might target the admin mobile number. The 5-try cooldown and the active-admin requirement still apply. Mitigations, in order:
  - Watch `PsychE_Audit` for `login_failed` rows on the admin's staff record.
  - To change the code, re-run the `BREAKGLASS_CODE_SHA256` command. No redeploy is needed.
  - To turn break-glass off, remove the secret: `supabase secrets unset BREAKGLASS_CODE_SHA256`.

- **Accepted risk: the notify API key was not rotated** (founder decision, 2026-10-29). It was pasted into an AI chat session. Anyone holding it can send SMS through the school's gateway, though not read PsychE data. To rotate later, make a new key in the notify admin, then `supabase secrets set NOTIFY_API_KEY=<new key>` on each project. No redeploy is needed.
- A 4-digit code has 10,000 values. The cooldown slows guessing to about 20 tries an hour per number, so someone who knows a staff mobile number would need around 10 days on average. The audit table records every failed attempt (`login_failed`). Watch for runs of them.
- Opening a student record is not audited yet (P8, TODOS.md). Creates, edits, deletes and logins are.
- Rows written before Release 1 have `created_by = NULL`; treat them as "pre-auth (shared PIN)".
- `webhook.js` stops working after V15. It was left as is on purpose (D9). Don't re-enable it with the service-role key without its own caller check.
