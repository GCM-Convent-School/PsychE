#!/usr/bin/env node
// =============================================================================
//  PsychE Release 1 — anonymous-access probe (P13)
//
//  Proves, against a real Supabase project, that someone holding only the
//  public anon key (it ships in every browser bundle) can reach nothing but
//  the school's name and logo.
//
//  Usage:   node scripts/anon-probe.mjs .env.staging
//           node scripts/anon-probe.mjs .env.production
//  Reads VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from that file.
//  Exit code 0 = PASS, 1 = at least one FAIL.
//
//  Run it: after V15 in the cutover window, after every migration, and on
//  every new clone. It writes nothing: write checks insert an EMPTY array,
//  which needs INSERT privilege but adds zero rows.
// =============================================================================

import { readFileSync } from 'node:fs';

const envFile = process.argv[2];
if (!envFile) {
  console.error('Usage: node scripts/anon-probe.mjs <env file>');
  process.exit(2);
}
const env = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);
const URL_BASE = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
if (!URL_BASE || !ANON) {
  console.error(`${envFile} must define VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.`);
  process.exit(2);
}

const headers = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' };
const DENIED = new Set([401, 403, 404]);

const KNOWN_TABLES = [
  'PsychE_Students', 'PsychE_Settings', 'PsychE_Domains', 'PsychE_Modules', 'PsychE_System_Tags',
  'PsychE_Questions', 'PsychE_Counseling_Logs', 'PsychE_Student_Tags', 'PsychE_Responses',
  'PsychE_Student_Telemetry', 'PsychE_Student_Notes', 'PsychE_AI_Reports',
  'PsychE_Sanitized_Session_Reports', 'PsychE_Model_Usage_Log', 'PsychE_Formalized_Sessions',
  'PsychE_Courses', 'PsychE_Staff', 'PsychE_Staff_Secrets', 'PsychE_Audit',
];
// Real argument names: PostgREST answers 404 for a signature mismatch even when
// anon COULD execute the function, so a bare {} would pass for the wrong reason.
// Nothing here can change data once anon is locked out; before V15 the first
// call really runs the nightly batch, so run this against production only
// after the lockdown.
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const KNOWN_FUNCTIONS = {
  psyche_run_daily_batch: {},
  psyche_programme_health: { p_window_days: 1 },
  psyche_ai_report_eligible_students: {},
  psyche_get_engine_status: { p_student_uuid: ZERO_UUID },
  calculate_student_telemetry: { target_student_uuid: ZERO_UUID },
  psyche_check_work_code: { p_mobile: '0000000000', p_code: '0000', p_breakglass: false },
  psyche_set_work_code: { p_staff_id: ZERO_UUID, p_code: '0000' },
  psyche_log_event: { p_action: 'anon_probe', p_record_id: 'anon_probe' },
  psyche_has_student_access: {},
  psyche_is_admin: {},
  psyche_current_role: {},
};
const PROTECTED_EDGE_FUNCTIONS = ['generate-ai-report', 'formalize-sessions', 'list-models'];

const results = [];
const record = (ok, what, detail) => results.push({ ok, what, detail });

async function req(path, init = {}) {
  const res = await fetch(`${URL_BASE}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  let body = null;
  try { body = await res.json(); } catch { /* empty */ }
  return { status: res.status, body };
}

// Tables anon can still see in the API schema are exactly the dangerous ones,
// so probe those too, not just the list above.
async function discoverTables() {
  const { status, body } = await req('/rest/v1/');
  if (status !== 200 || !body?.paths) return [];
  return Object.keys(body.paths)
    .map((p) => p.replace(/^\//, ''))
    .filter((p) => /^psyche_/i.test(p) && !p.startsWith('rpc/'));
}

const tables = [...new Set([...KNOWN_TABLES, ...(await discoverTables())])]
  .filter((t) => t !== 'PsychE_Public_Branding');

for (const t of tables) {
  const read = await req(`/rest/v1/${t}?select=*&limit=1`);
  const rows = Array.isArray(read.body) ? read.body.length : 0;
  record(DENIED.has(read.status) || (read.status === 200 && rows === 0), `read  ${t}`,
    `HTTP ${read.status}${read.status === 200 ? `, ${rows} row(s)` : ''}`);

  const write = await req(`/rest/v1/${t}`, { method: 'POST', body: '[]', headers: { Prefer: 'return=minimal' } });
  record(DENIED.has(write.status), `write ${t}`, `HTTP ${write.status}${write.body?.code ? ` (${write.body.code})` : ''}`);
}

for (const [fn, args] of Object.entries(KNOWN_FUNCTIONS)) {
  const r = await req(`/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
  record(DENIED.has(r.status), `rpc   ${fn}`, `HTTP ${r.status}${r.body?.code ? ` (${r.body.code})` : ''}`);
}

for (const fn of PROTECTED_EDGE_FUNCTIONS) {
  const r = await req(`/functions/v1/${fn}`, {
    method: 'POST', body: JSON.stringify({ studentUuid: '00000000-0000-0000-0000-000000000000' }),
  });
  record(r.status === 401, `edge  ${fn}`, `HTTP ${r.status} (expect 401)`);
}

const branding = await req('/rest/v1/PsychE_Public_Branding?select=*');
const brandingRows = Array.isArray(branding.body) ? branding.body : [];
const brandingKeys = brandingRows[0] ? Object.keys(brandingRows[0]).sort().join(',') : '';
record(branding.status === 200 && brandingRows.length === 1 && brandingKeys === 'accent_color,school_logo_url,school_name',
  'read  PsychE_Public_Branding', `HTTP ${branding.status}, ${brandingRows.length} row(s), fields: ${brandingKeys || 'none'}`);

const upload = await fetch(`${URL_BASE}/storage/v1/object/branding/anon-probe.png`, {
  method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'image/png' },
  body: new Uint8Array([137, 80, 78, 71]),
});
record(upload.status >= 400, 'write storage branding/', `HTTP ${upload.status}`);

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.what.padEnd(48)} ${r.detail}`);
console.log(`\n${failed.length === 0 ? 'PASS' : 'FAIL'}: ${results.length - failed.length}/${results.length} checks passed against ${URL_BASE}`);
process.exit(failed.length === 0 ? 0 : 1);
