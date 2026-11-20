# database/

| Path | What it is | When to run |
|---|---|---|
| `install.sql` | Full schema for a fresh Supabase project. Already includes every migration below. | Once, on a blank project. Then `node scripts/anon-probe.mjs <env file>` must print PASS. |
| `migrations/vNN_*.sql` | Incremental upgrades for a database that already exists. | In version order, only the ones that database hasn't had yet. |
| `archive/` | Superseded files (`psyche_v3_master_schema.sql`, `fix_rls.sql`). | **Never.** `fix_rls.sql` re-opens anonymous access. |

## Migrations

File names are zero-padded (`v05` … `v16`) so they sort in run order. `_1`, `_2` suffixes are follow-up fixes to the same version.

| Version | Files | Notes |
|---|---|---|
| V5 | `v05_migration.sql`, `v05_analytics_migration.sql` | Domains + telemetry tables, cold start, ETI |
| V6 | `v06_domain_scoring_engine.sql`, `v06_1_telemetry_upsert_fix.sql` | Domain scoring rewrite + cross-engine fix |
| V7 | `v07_composite_rsi_engine.sql`, `v07_1_…`, `v07_2_…`, `v07_3_…` | Composite/RSI, confidence floor, ETI fix, follow-up autoclose |
| V8 | `v08_programme_health.sql` | School-wide analytics |
| V9–V13 | `v09_student_notes.sql` … `v13_ai_model_settings.sql` | Notes, AI reports, formalized sessions, AI model settings |
| V14 | `v14_staff_auth.sql`, `v14_1_grants.sql` | Staff sign-in, branding, audit |
| V15 | `v15_rls_lockdown.sql` (undo: `v15_rollback.sql`) | Removes anonymous access. Maintenance window only, see `docs/RUNBOOK_release1.md` |
| V16 | `v16_journey.sql`, then `v16_backfill.sql` | Journey model (Release 3) |

## Adding a change

1. Add `migrations/vNN_short_name.sql` (next number, two digits).
2. Fold the same change into `install.sql` so new clones get it.
3. Run `node scripts/anon-probe.mjs <env file>` after applying it.

## Backups

`.github/workflows/daily_db_backup.yml` runs every day at 03:30 IST (and on demand from the Actions tab). It dumps roles, schema and data with the Supabase CLI, packs them into `psyche-db-YYYY-MM-DD.tar.gz.gpg` (AES-256, passphrase in the `BACKUP_PASSPHRASE` secret) and uploads it to the Google Apps Script endpoint in `BACKUP_UPLOAD_URL`. Storage files (branding logos) are not included. Old backups are not deleted automatically, so prune the Drive folder from time to time.

To restore into a project:

```bash
mkdir -p restore && gpg -d psyche-db-2026-11-20.tar.gz.gpg | tar -xzf - -C restore/
psql "$TARGET_DB_URL" -f restore/roles.sql -f restore/schema.sql -c 'SET session_replication_role = replica' -f restore/data.sql
```
