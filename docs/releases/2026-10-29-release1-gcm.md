# Release 1 (Trust): GCM production cutover, 2026-10-29

- Frontend: commit fb9fe6f, deployed by Coolify from GCM-Convent-School/PsychE at 18:54 IST.
- Edge Functions: staff-login, send-work-code (17:35, staff-login redeployed 17:43); generate-ai-report, formalize-sessions, list-models (18:54).
- SQL: v14_staff_auth.sql, v14_1_grants.sql, v15_rls_lockdown.sql.
- Smoke test (admin, after V15): dashboard, directory (282 students), Programme Health, Planner, Settings load; no console errors.
- Counsellors: to be added in Settings → Staff after cutover.

## Anon probe, 2026-10-29 20:43 IST

```
PASS  read  PsychE_Students                            HTTP 401
PASS  write PsychE_Students                            HTTP 401 (42501)
PASS  read  PsychE_Settings                            HTTP 401
PASS  write PsychE_Settings                            HTTP 401 (42501)
PASS  read  PsychE_Domains                             HTTP 401
PASS  write PsychE_Domains                             HTTP 401 (42501)
PASS  read  PsychE_Modules                             HTTP 401
PASS  write PsychE_Modules                             HTTP 401 (42501)
PASS  read  PsychE_System_Tags                         HTTP 401
PASS  write PsychE_System_Tags                         HTTP 401 (42501)
PASS  read  PsychE_Questions                           HTTP 401
PASS  write PsychE_Questions                           HTTP 401 (42501)
PASS  read  PsychE_Counseling_Logs                     HTTP 401
PASS  write PsychE_Counseling_Logs                     HTTP 401 (42501)
PASS  read  PsychE_Student_Tags                        HTTP 401
PASS  write PsychE_Student_Tags                        HTTP 401 (42501)
PASS  read  PsychE_Responses                           HTTP 401
PASS  write PsychE_Responses                           HTTP 401 (42501)
PASS  read  PsychE_Student_Telemetry                   HTTP 401
PASS  write PsychE_Student_Telemetry                   HTTP 401 (42501)
PASS  read  PsychE_Student_Notes                       HTTP 401
PASS  write PsychE_Student_Notes                       HTTP 401 (42501)
PASS  read  PsychE_AI_Reports                          HTTP 401
PASS  write PsychE_AI_Reports                          HTTP 401 (42501)
PASS  read  PsychE_Sanitized_Session_Reports           HTTP 401
PASS  write PsychE_Sanitized_Session_Reports           HTTP 401 (42501)
PASS  read  PsychE_Model_Usage_Log                     HTTP 401
PASS  write PsychE_Model_Usage_Log                     HTTP 401 (42501)
PASS  read  PsychE_Formalized_Sessions                 HTTP 401
PASS  write PsychE_Formalized_Sessions                 HTTP 401 (42501)
PASS  read  PsychE_Courses                             HTTP 401
PASS  write PsychE_Courses                             HTTP 401 (42501)
PASS  read  PsychE_Staff                               HTTP 401
PASS  write PsychE_Staff                               HTTP 401 (42501)
PASS  read  PsychE_Staff_Secrets                       HTTP 401
PASS  write PsychE_Staff_Secrets                       HTTP 401 (42501)
PASS  read  PsychE_Audit                               HTTP 401
PASS  write PsychE_Audit                               HTTP 401 (42501)
PASS  rpc   psyche_run_daily_batch                     HTTP 401 (42501)
PASS  rpc   psyche_programme_health                    HTTP 401 (42501)
PASS  rpc   psyche_ai_report_eligible_students         HTTP 401 (42501)
PASS  rpc   psyche_get_engine_status                   HTTP 401 (42501)
PASS  rpc   calculate_student_telemetry                HTTP 401 (42501)
PASS  rpc   psyche_check_work_code                     HTTP 401 (42501)
PASS  rpc   psyche_set_work_code                       HTTP 401 (42501)
PASS  rpc   psyche_log_event                           HTTP 401 (42501)
PASS  rpc   psyche_has_student_access                  HTTP 401 (42501)
PASS  rpc   psyche_is_admin                            HTTP 401 (42501)
PASS  rpc   psyche_current_role                        HTTP 401 (42501)
PASS  edge  generate-ai-report                         HTTP 401 (expect 401)
PASS  edge  formalize-sessions                         HTTP 401 (expect 401)
PASS  edge  list-models                                HTTP 401 (expect 401)
PASS  read  PsychE_Public_Branding                     HTTP 200, 1 row(s), fields: accent_color,school_logo_url,school_name
PASS  write storage branding/                          HTTP 400

PASS: 54/54 checks passed against https://gydhrtrthnwuhywhlyet.supabase.co
```
