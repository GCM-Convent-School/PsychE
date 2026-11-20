-- =============================================================================
--  PsychE V16 backfill — OPTIONAL. Opens a case for students who are a current
--  concern today, so they show as "open" on the journey instead of "regular".
--
--  Nothing runs until you remove the comment markers in step 2. Run step 1
--  first and have a counsellor check the list: risk_level was set by hand
--  over time and may be stale.
--
--  Mapping: risk High → need "support", Medium → need "watch". Nobody is
--  backfilled as "urgent"; a counsellor raises that by hand after a check.
-- =============================================================================

-- 1. Preview: who would get a case.
SELECT s.student_id, s.full_name, s.course, s.risk_level,
       CASE s.risk_level WHEN 'High' THEN 'support' ELSE 'watch' END AS proposed_need
FROM "PsychE_Students" s
WHERE s.risk_level IN ('High','Medium')
  AND NOT EXISTS (SELECT 1 FROM "PsychE_Cases" c WHERE c.student_uuid = s.id AND c.status = 'open')
ORDER BY (s.risk_level = 'High') DESC, s.course, s.full_name;

-- 2. Open the cases (uncomment to run).
-- INSERT INTO "PsychE_Cases" (student_uuid, need_level, source, opened_at)
-- SELECT s.id, CASE s.risk_level WHEN 'High' THEN 'support' ELSE 'watch' END, 'other',
--        COALESCE((SELECT MAX(l.session_date) FROM "PsychE_Counseling_Logs" l
--                  WHERE l.student_uuid = s.id AND l.session_status = 'Completed'), NOW())
-- FROM "PsychE_Students" s
-- WHERE s.risk_level IN ('High','Medium')
--   AND NOT EXISTS (SELECT 1 FROM "PsychE_Cases" c WHERE c.student_uuid = s.id AND c.status = 'open');
--
-- Note: opening a case sets risk_level from the need (support → Medium, watch → Low),
-- so former "High" students show as Medium until a counsellor sets them to urgent.
