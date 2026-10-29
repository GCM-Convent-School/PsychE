import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Users, Clock, Download, FileText, ChevronRight, Calendar } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import Papa from 'papaparse';
import { parseISO } from 'date-fns';
import { formatDisplayDate, parseInputDate } from '../utils/dateFormatter';
import { toSentenceCase, toTitleCase } from '../utils/stringFormatter';
import { isValidStudentId, STUDENT_ID_HINT } from '../utils/studentId';
import { getDailyCapacity } from '../lib/capacity';
import { MIN_COMPOSITE_CONFIDENCE } from '../types';
import { underServed } from '../analytics/programmeHealth';
import type { ProgrammeHealthPayload, StudentRollup } from '../analytics/programmeHealth';
import {
  bucketScheduled, bucketFollowUps, dedupeFollowUps, dayLoad, momentum,
  focusState, greeting, dateKey, todayKey, localDayBounds
} from '../analytics/operationalDay';
import type { ScheduledRow, FollowUpRow } from '../analytics/operationalDay';
import {
  FocusHero, TodayLineUp, AttentionPanel, DriftPanel, MomentumPanel,
  AheadPanel, WatchlistPanel
} from '../components/DashboardPanels';
import type { ScheduleControls } from '../components/DashboardPanels';
import { useDocumentTitle } from '../lib/branding';

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06
    }
  }
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 300, damping: 24 } }
};

/** Trailing window for the momentum sparkline. */
const MOMENTUM_DAYS = 14;
/** Window handed to psyche_programme_health for the triage list. Matches /analytics. */
const TRIAGE_WINDOW_DAYS = 180;

interface WatchlistStudent {
  id: string;
  full_name: string;
  student_id: string | null;
  course: string | null;
}

/**
 * Dashboard — the counsellor's operational day.
 *
 * Ordered by urgency rather than by data source: what is on today's plate, what
 * has slipped, who is drifting, then the practice's pulse and the bulk tools.
 * Presentation lives in components/DashboardPanels.tsx and all date arithmetic
 * in analytics/operationalDay.ts; this file owns fetching and mutation only.
 *
 * Two deliberate choices worth knowing about:
 *  · Today's figures are counted on the LOCAL clock, not from
 *    psyche_programme_health's session_date::date buckets (which are in the
 *    database's timezone). A dashboard that is a day out is worse than none.
 *  · The triage list reuses the V6 underServed() logic and its confidence floor
 *    verbatim, so /analytics and this page can never disagree about who needs
 *    seeing.
 */
export const Dashboard: React.FC = () => {
  const navigate = useNavigate();

  // ---- core (fast) -------------------------------------------------------
  const [recentLogs, setRecentLogs] = useState<any[]>([]);
  const [totalStudents, setTotalStudents] = useState<number>(0);
  const [sessionsThisMonth, setSessionsThisMonth] = useState<number>(0);
  const [scheduled, setScheduled] = useState<ScheduledRow[]>([]);
  const [followUps, setFollowUps] = useState<FollowUpRow[]>([]);
  const [completedByDay, setCompletedByDay] = useState<{ day: string; completed: number }[]>([]);
  const [highRiskStudents, setHighRiskStudents] = useState<WatchlistStudent[]>([]);
  const [capacity, setCapacity] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // ---- triage (slower, non-blocking) ------------------------------------
  const [health, setHealth] = useState<ProgrammeHealthPayload | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [newDate, setNewDate] = useState('');
  const [importing, setImporting] = useState(false);

  useDocumentTitle('Dashboard');

  useEffect(() => {
    fetchDashboardData();
    fetchTriage();
  }, []);

  async function fetchDashboardData() {
    try {
      const now = new Date();
      // Upper bound for every "has already happened" filter below. Taken from
      // the local day so a session logged this evening is never excluded.
      const { end: tomorrowStart } = localDayBounds(now);

      // Fetch total students
      const { count: studentCount } = await supabase
        .from('PsychE_Students')
        .select('*', { count: 'exact', head: true });

      if (studentCount !== null) setTotalStudents(studentCount);

      // Sessions completed this month. Scoped to Completed deliberately —
      // counting Scheduled and Draft rows here inflated the figure with work
      // that had not happened yet.
      const startOfMonth = new Date(now);
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const { count: sessionCount } = await supabase
        .from('PsychE_Counseling_Logs')
        .select('*', { count: 'exact', head: true })
        .eq('session_status', 'Completed')
        .gte('session_date', startOfMonth.toISOString())
        .lt('session_date', tomorrowStart);

      if (sessionCount !== null) setSessionsThisMonth(sessionCount);

      // Completed sessions across the momentum window. Fetched as rows rather
      // than aggregated in SQL so the day buckets are cut on the LOCAL clock —
      // session_date::date in the database would bucket in the DB's timezone
      // and can shift an evening session to the previous day.
      const windowStart = new Date(now);
      windowStart.setHours(0, 0, 0, 0);
      windowStart.setDate(windowStart.getDate() - (MOMENTUM_DAYS - 1));

      const { data: completedRows } = await supabase
        .from('PsychE_Counseling_Logs')
        .select('session_date')
        .eq('session_status', 'Completed')
        .gte('session_date', windowStart.toISOString())
        .lt('session_date', tomorrowStart);

      const tally = new Map<string, number>();
      (completedRows ?? []).forEach(r => {
        const k = dateKey(r.session_date);
        if (k) tally.set(k, (tally.get(k) ?? 0) + 1);
      });
      setCompletedByDay(Array.from(tally, ([day, completed]) => ({ day, completed })));

      // Fetch recent logs (Exclude future logs using Timeline Query Guard BUG-004)
      const { data: logsData } = await supabase
        .from('PsychE_Counseling_Logs')
        .select(`
          id,
          reason,
          session_date,
          student_uuid,
          PsychE_Students (full_name, student_id)
        `)
        .lte('session_date', new Date().toISOString())
        .order('session_date', { ascending: false })
        .limit(5);

      if (logsData) {
        const formattedLogs = logsData.map((log: any) => ({
          id: log.id,
          student_uuid: log.student_uuid,
          student_sid: log.PsychE_Students?.student_id,
          student: log.PsychE_Students?.full_name || 'Unknown Student',
          reason: toSentenceCase(log.reason),
          date: formatDisplayDate(log.session_date),
          color: getColorForReason(log.reason)
        }));
        setRecentLogs(formattedLogs);
      }

      // All open scheduled sessions. Bucketed client-side into today / late /
      // ahead / undated so a single query serves three panels.
      const { data: scheduledData } = await supabase
        .from('PsychE_Counseling_Logs')
        .select(`
          id, reason, scheduled_date, student_uuid,
          PsychE_Students (full_name, student_id, risk_level)
        `)
        .eq('session_status', 'Scheduled');

      if (scheduledData) {
        setScheduled(scheduledData.map((r: any) => ({
          id: r.id,
          reason: r.reason,
          scheduled_date: r.scheduled_date,
          student_uuid: r.student_uuid,
          student_name: r.PsychE_Students?.full_name || 'Unknown Student',
          student_sid: r.PsychE_Students?.student_id ?? null,
          risk_level: r.PsychE_Students?.risk_level ?? null
        })));
      }

      // Outstanding follow-ups. The NOT NULL date filter is essential: the
      // column's DEFAULT 'Pending' means a NULL date is the default firing, not
      // a commitment the counsellor made (v7_2).
      const { data: followUpData } = await supabase
        .from('PsychE_Counseling_Logs')
        .select(`
          id, reason, follow_up_date, student_uuid,
          PsychE_Students (full_name, student_id)
        `)
        .eq('follow_up_status', 'Pending')
        .not('follow_up_date', 'is', null)
        .order('follow_up_date', { ascending: true })
        .limit(60);

      if (followUpData) {
        setFollowUps(followUpData.map((r: any) => ({
          id: r.id,
          reason: r.reason,
          follow_up_date: r.follow_up_date,
          student_uuid: r.student_uuid,
          student_name: r.PsychE_Students?.full_name || 'Unknown Student',
          student_sid: r.PsychE_Students?.student_id ?? null
        })));
      }

      // Fetch High Risk Students
      const { data: riskData } = await supabase
        .from('PsychE_Students')
        .select('id, full_name, student_id, course')
        .eq('risk_level', 'High')
        .limit(4);

      if (riskData) {
        setHighRiskStudents(riskData as WatchlistStudent[]);
      }

      setCapacity(await getDailyCapacity());
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  }

  /**
   * Triage feed. Runs in parallel with the core fetch and never blocks the
   * header: if psyche_programme_health is missing (a database that has not had
   * v8 applied) the rest of the dashboard still works and only this panel
   * reports the failure.
   */
  async function fetchTriage() {
    const { data, error } = await supabase
      .rpc('psyche_programme_health', { p_window_days: TRIAGE_WINDOW_DAYS });
    if (error) setHealthError(error.message);
    else setHealth(data as ProgrammeHealthPayload);
    setHealthLoading(false);
  }

  const getColorForReason = (reason: string) => {
    if (reason.toLowerCase().includes('stress')) return '#3b82f6'; // Neutral blue, reserved red for high risk
    if (reason.toLowerCase().includes('career')) return '#5e6ad2';
    if (reason.toLowerCase().includes('conflict')) return '#f59e0b';
    return '#4ade80';
  };

  /**
   * Bulk CSV onboarding.
   *
   * Validates the WHOLE file before writing anything. The previous version threw
   * on the first bad row from inside a forEach, so a 400-row file with one typo
   * imported nothing and reported a single ID with no row number. All-or-nothing
   * is kept — a half-loaded roll is worse than none — but the counsellor now
   * gets every problem at once, located by row, and can fix the file in one pass.
   */
  const handleBulkUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;

    setImporting(true);

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      // Excel and Google Sheets routinely leave a stray space (or a BOM) on a
      // header. Untreated, the column reads as undefined for every row and the
      // file is reported as empty rather than as malformed — which looks
      // identical to "the import is broken".
      transformHeader: h => h.replace(/^﻿/, '').trim().toLowerCase(),
      complete: async (results) => {
        try {
          const errors: string[] = [];
          const studentsMap = new Map<string, any>();
          const logsToCreate: any[] = [];

          results.data.forEach((row, i) => {
            // +2: one for the header line, one because humans count from 1.
            const rowNo = i + 2;
            const get = (k: string) => (row[k] ?? '').toString().trim();
            const fail = (msg: string) => errors.push(`Row ${rowNo}: ${msg}`);

            const studentId = get('student_id') || get('id');
            if (!studentId) {
              // A genuinely blank line is skipped; a populated line with no ID
              // is an error, because silently dropping it loses a student.
              if (Object.values(row).some(v => (v ?? '').toString().trim() !== '')) {
                fail('no student_id');
              }
              return;
            }
            if (!isValidStudentId(studentId)) {
              fail(`student_id "${studentId}" should look like ${STUDENT_ID_HINT}`);
              return;
            }

            const fullName = get('full_name') || get('name');
            if (!fullName) {
              fail(`"${studentId}" has no full_name`);
              return;
            }

            const course = get('course');
            if (course && !/^[\w\s\-./()&,]+$/.test(course)) {
              fail(`course "${course}" contains unsupported characters`);
              return;
            }

            const rawEnrolled = get('enrolled_date');
            const enrolledDate = rawEnrolled ? parseInputDate(rawEnrolled) : null;
            if (rawEnrolled && !enrolledDate) {
              fail(`enrolled_date "${rawEnrolled}" is not DD/MM/YYYY or YYYY-MM-DD`);
              return;
            }

            // 1. Prepare Student Data. Names are title-cased to match the
            //    normalisation AddStudent applies, so an ALL-CAPS register
            //    export does not sit in the UI shouting.
            if (!studentsMap.has(studentId)) {
              studentsMap.set(studentId, {
                student_id: studentId,
                full_name: toTitleCase(fullName),
                // Left NULL rather than the string 'Unknown': course is the
                // first cohort key for RSI, and a literal "Unknown" course
                // would form a bogus peer group instead of falling back.
                course: course || null,
                email: get('email') || null,
                mobile: get('mobile') || get('phone') || null,
                fathers_name: toTitleCase(get('fathers_name')) || null,
                mothers_name: toTitleCase(get('mothers_name')) || null,
                enrolled_date: enrolledDate
              });
            }

            // 2. Prepare Log Data if present
            const reason = get('reason');
            if (reason || get('counselor_name') || get('student_response')) {
              const rawSession = get('session_date');
              let sessionIso = new Date().toISOString();
              if (rawSession) {
                const dateOnly = parseInputDate(rawSession);
                if (dateOnly) {
                  sessionIso = new Date(`${dateOnly}T00:00:00`).toISOString();
                } else {
                  const t = Date.parse(rawSession); // full ISO timestamps
                  if (Number.isNaN(t)) {
                    fail(`session_date "${rawSession}" is not a date this app recognises`);
                    return;
                  }
                  sessionIso = new Date(t).toISOString();
                }
              }

              logsToCreate.push({
                _temp_student_id: studentId,
                counselor_name: get('counselor_name') || 'System Import',
                session_date: sessionIso,
                reason: toSentenceCase(reason) || 'Imported Log',
                student_response: toSentenceCase(get('student_response')),
                recommended_action: toSentenceCase(get('recommended_action'))
              });
            }
          });

          if (errors.length > 0) {
            const shown = errors.slice(0, 12).join('\n');
            const more = errors.length > 12 ? `\n\n…and ${errors.length - 12} more.` : '';
            alert(
              `Import cancelled — ${errors.length} problem${errors.length === 1 ? '' : 's'} found. ` +
              `Nothing was imported.\n\n${shown}${more}`
            );
            return;
          }

          const uniqueStudents = Array.from(studentsMap.values());
          if (uniqueStudents.length === 0) {
            alert(
              'No student rows found in that file.\n\n' +
              'The first line must be a header row containing at least ' +
              '"student_id" and "full_name".'
            );
            return;
          }

          // Upsert overwrites existing students that share an ID, so say so
          // before touching live records.
          const logNote = logsToCreate.length
            ? ` and ${logsToCreate.length} session record${logsToCreate.length === 1 ? '' : 's'}`
            : '';
          if (!window.confirm(
            `Import ${uniqueStudents.length} student${uniqueStudents.length === 1 ? '' : 's'}${logNote}?\n\n` +
            'Any student already on the roll with a matching ID will be updated with the values in this file.'
          )) return;

          // 3. Upsert Students
          const { data: upsertedStudents, error: studentError } = await supabase
            .from('PsychE_Students')
            .upsert(uniqueStudents, { onConflict: 'student_id' })
            .select('id, student_id');

          if (studentError) throw studentError;

          // 4. Map UUIDs and Insert Logs
          if (logsToCreate.length > 0 && upsertedStudents) {
            const idMap: Record<string, string> = {};
            upsertedStudents.forEach(s => { idMap[s.student_id] = s.id; });

            const finalLogs = logsToCreate
              .filter(log => idMap[log._temp_student_id])
              .map(log => ({
                student_uuid: idMap[log._temp_student_id],
                counselor_name: log.counselor_name,
                session_date: log.session_date,
                reason: log.reason,
                student_response: log.student_response,
                recommended_action: log.recommended_action,
                // Imported rows are historical records, so they must land as
                // Completed. Without this the column DEFAULT made every one a
                // 'Scheduled' session that never happened — permanently open on
                // the dashboard and excluded from every completed-session count.
                session_status: 'Completed',
                // Explicit NULL, not the column DEFAULT of 'Pending': a Pending
                // status with no date is the phantom follow-up that v7_2 exists
                // to stop, and it silently depresses ETI and Composite.
                follow_up_status: null
              }));

            if (finalLogs.length > 0) {
              const { error: logsError } = await supabase.from('PsychE_Counseling_Logs').insert(finalLogs);
              if (logsError) throw logsError;
            }
          }

          alert(`Success! Imported ${uniqueStudents.length} students and ${logsToCreate.length} counseling records.`);
          fetchDashboardData(); // Refresh stats
        } catch (error: any) {
          console.error(error);
          alert(`Error uploading CSV: ${error.message}`);
        } finally {
          setImporting(false);
          // Clearing the input matters: without it, re-picking the SAME file
          // after fixing nothing fires no change event, so the import appears
          // to do nothing at all.
          input.value = '';
        }
      },
      error: (err) => {
        console.error(err);
        alert(`Could not read that file: ${err.message}`);
        setImporting(false);
        input.value = '';
      }
    });
  };

  const downloadCsvTemplate = () => {
    const templateData = [
      // student_id MUST match utils/studentId.ts. The old template shipped
      // 'STU-101', which the importer itself rejected — downloading the
      // template and re-importing it was guaranteed to fail.
      {
        student_id: 'STU-2026-101',
        full_name: 'John Doe',
        course: '10th Grade Section A',
        email: 'john.doe@example.com',
        mobile: '+91 9876543210',
        fathers_name: 'Robert Doe',
        mothers_name: 'Jane Doe',
        enrolled_date: '2026-01-01',
        counselor_name: 'Dr. Sarah Smith',
        session_date: '2026-05-09T10:00:00Z',
        reason: 'Academic Stress',
        student_response: 'Student felt overwhelmed with upcoming exams.',
        recommended_action: 'Scheduled a follow-up session next week.'
      },
      // Roll-only row: every session column may be left blank.
      {
        student_id: 'STU-2026-102',
        full_name: 'Asha Verma',
        course: '9TH A',
        email: 'asha.verma@example.com',
        mobile: '+91 9000000000',
        fathers_name: 'Rakesh Verma',
        mothers_name: 'Sunita Verma',
        enrolled_date: '',
        counselor_name: '',
        session_date: '',
        reason: '',
        student_response: '',
        recommended_action: ''
      }
    ];
    const csv = Papa.unparse(templateData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'UPsych_Student_Import_Template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const generateMonthlyReport = async () => {
    try {
      alert('Generating report...');
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const { data, error } = await supabase
        .from('PsychE_Counseling_Logs')
        .select(`
          id,
          session_date,
          counselor_name,
          reason,
          student_response,
          recommended_action,
          PsychE_Students (full_name, student_id)
        `)
        .gte('session_date', startOfMonth.toISOString())
        .order('session_date', { ascending: false });

      if (error) throw error;

      if (!data || data.length === 0) {
        alert('No sessions found for this month.');
        return;
      }

      const csvData = data.map((log: any) => {
        const student = log.PsychE_Students;
        return {
          'Date': new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(log.session_date)),
          'Student Name': student?.full_name || 'Unknown',
          'Student ID': student?.student_id || 'Unknown',
          'Counselor': log.counselor_name,
          'Reason': log.reason,
          'Notes': log.student_response,
          'Action Taken': log.recommended_action
        };
      });

      const csv = Papa.unparse(csvData);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `monthly_report_${new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(new Date()).replace(' ', '_')}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error: any) {
      console.error(error);
      alert('Failed to generate report.');
    }
  };

  const handleDeleteSession = async (e: React.MouseEvent, logId: string) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to permanently delete this session? This action cannot be undone.")) return;

    setLoading(true);
    try {
      const { error } = await supabase.from('PsychE_Counseling_Logs').delete().eq('id', logId);
      if (error) throw error;
      fetchDashboardData();
    } catch (error) {
      console.error('Error deleting session:', error);
      alert('Failed to delete session.');
      setLoading(false);
    }
  };

  const handleReschedule = async (e: React.MouseEvent, logId: string) => {
    e.stopPropagation();
    if (!newDate) {
      alert("Please select a new date.");
      return;
    }

    // parseISO, not `new Date(newDate)` — newDate is a bare YYYY-MM-DD from the
    // date input, which the native constructor parses as UTC midnight and
    // shifts to the previous local day for negative-offset timezones (BUG-001).
    const selectedDate = parseISO(newDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (selectedDate < today) {
      alert("You cannot reschedule a session to a past date.");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.from('PsychE_Counseling_Logs').update({ scheduled_date: newDate }).eq('id', logId);
      if (error) throw error;
      setRescheduleId(null);
      setNewDate('');
      fetchDashboardData();
    } catch (error) {
      console.error('Error rescheduling session:', error);
      alert('Failed to reschedule session.');
      setLoading(false);
    }
  };

  // -----------------------------------------------------------------------
  //  Derived view state — all pure, all from operationalDay.ts
  // -----------------------------------------------------------------------

  const now = new Date();
  const buckets = useMemo(() => bucketScheduled(scheduled), [scheduled]);
  // Follow-ups that already have a Scheduled session booked for them are
  // dropped first — AddLog writes both, and showing both would list the same
  // commitment twice on this page and double-count it in the header.
  const fu = useMemo(
    () => bucketFollowUps(dedupeFollowUps(followUps, scheduled)),
    [followUps, scheduled]
  );
  const mo = useMemo(() => momentum(completedByDay, MOMENTUM_DAYS), [completedByDay]);

  const completedToday = useMemo(() => {
    const t = todayKey();
    return completedByDay.find(d => d.day === t)?.completed ?? 0;
  }, [completedByDay]);

  const load = dayLoad(buckets.today.length, completedToday, capacity ?? 0);

  const drifting: StudentRollup[] = useMemo(
    () => health ? underServed(health.students ?? [], MIN_COMPOSITE_CONFIDENCE, 30).slice(0, 6) : [],
    [health]
  );

  const focus = focusState({
    todaySessions: buckets.today.length,
    overdueSessions: buckets.overdue.length,
    followUpsOverdue: fu.overdue.length,
    followUpsToday: fu.today.length,
    drifting: drifting.length
  });

  const controls: ScheduleControls = {
    rescheduleId,
    newDate,
    onOpen: (id) => navigate(`/add-log?schedule_id=${id}`),
    onDelete: handleDeleteSession,
    onToggleReschedule: (id) => { setRescheduleId(id === rescheduleId ? null : id); setNewDate(''); },
    onNewDate: setNewDate,
    onConfirmReschedule: handleReschedule,
    onCancelReschedule: () => { setRescheduleId(null); setNewDate(''); }
  };

  const openStudent = (sid: string) => navigate(`/student/${sid}`);

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      style={{ padding: '1rem 0' }}
    >
      <div className="bento-grid">
        {/* ── 1. Focus hero — what today is ─────────────────────────────── */}
        <FocusHero
          now={now}
          greeting={greeting(now)}
          focus={focus}
          load={load}
          capacityKnown={capacity != null}
          onPrimary={() => navigate('/add-log')}
          onSchedule={() => navigate('/bulk-schedule')}
        />

        {/* ── 2. Today ─────────────────────────────────────────────────── */}
        <TodayLineUp
          rows={buckets.today}
          undated={buckets.undated}
          completedToday={completedToday}
          controls={controls}
          onSchedule={() => navigate('/bulk-schedule')}
          onOpenStudent={openStudent}
        />

        <AttentionPanel
          overdueSessions={buckets.overdue}
          overdueFollowUps={fu.overdue}
          followUpsToday={fu.today}
          controls={controls}
          onOpenStudent={openStudent}
        />

        {/* ── 3. Who needs seeing ──────────────────────────────────────── */}
        <DriftPanel
          students={drifting}
          windowDays={TRIAGE_WINDOW_DAYS}
          loading={healthLoading}
          error={healthError}
          onOpenStudent={openStudent}
          onViewAll={() => navigate('/analytics')}
        />

        <WatchlistPanel
          students={highRiskStudents}
          onOpenStudent={openStudent}
          onViewAll={() => navigate('/directory')}
        />

        {/* ── 4. The week, and what just happened ──────────────────────── */}
        <AheadPanel
          rows={buckets.ahead}
          followUps={fu.soon}
          onOpen={(id) => navigate(`/add-log?schedule_id=${id}`)}
          onOpenStudent={openStudent}
        />

        <motion.div variants={item} className="bento-card col-span-7">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-h3 flex items-center gap-2" style={{ fontSize: '1rem' }}>
              <Clock size={18} className="text-muted" /> Recent activity
            </h3>
            <button onClick={() => navigate('/logs')} className="text-muted" style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center' }}>
              View all <ChevronRight size={16} />
            </button>
          </div>

          <div className="flex" style={{ flexDirection: 'column', gap: '0.75rem', minWidth: 0 }}>
            {loading ? (
              <p className="text-muted text-center" style={{ padding: '1rem 0' }}>Loading recent logs...</p>
            ) : recentLogs.length === 0 ? (
              <p className="text-muted text-center" style={{ padding: '1rem 0' }}>No recent counseling logs found.</p>
            ) : (
              recentLogs.map((log) => (
                <motion.div
                  key={log.id}
                  onClick={() => navigate(`/student/${log.student_sid || log.student_uuid}`)}
                  whileHover={{ x: 5, backgroundColor: 'rgba(255,255,255,0.03)' }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.6rem 0.75rem',
                    borderRadius: 'var(--radius-md)',
                    transition: 'background-color 0.2s',
                    cursor: 'pointer',
                    border: '1px solid transparent'
                  }}
                >
                  <div className="flex items-center gap-4" style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: log.color, flexShrink: 0 }}></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{log.student}</p>
                      <p className="text-muted" style={{ fontSize: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{log.reason}</p>
                    </div>
                  </div>
                  <div className="text-right text-muted" style={{ fontSize: '0.8rem', flexShrink: 0, marginLeft: '0.5rem' }}>
                    {log.date}
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </motion.div>

        {/* ── 5. Pulse and bulk tools ──────────────────────────────────── */}
        <MomentumPanel
          m={mo}
          capacity={capacity ?? 0}
          capacityKnown={capacity != null}
          sessionsThisMonth={sessionsThisMonth}
          totalStudents={totalStudents}
          onStudents={() => navigate('/directory')}
          onLogs={() => navigate('/logs')}
        />

        <motion.div variants={item} className="bento-card col-span-8">
          <h3 className="text-h3 mb-4" style={{ fontSize: '1rem' }}>Bulk tools</h3>

          <input
            type="file"
            accept=".csv"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={handleBulkUpload}
          />

          <div className="dash-tools no-print" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
            gap: '0.75rem'
          }}>
            <ToolButton
              onClick={() => fileInputRef.current?.click()}
              icon={<Users size={20} color="var(--color-primary)" />}
              tint="rgba(91, 138, 245, 0.12)"
              title="Bulk onboard"
              sub={importing ? 'Reading file…' : 'Upload student CSV'}
              busy={importing}
            />
            <ToolButton
              onClick={downloadCsvTemplate}
              icon={<Download size={20} className="text-muted" />}
              tint="rgba(255, 255, 255, 0.05)"
              title="Template"
              sub="Download CSV format"
            />
            <ToolButton
              onClick={generateMonthlyReport}
              icon={<FileText size={20} color="var(--color-success)" />}
              tint="rgba(63, 201, 143, 0.12)"
              title="Monthly report"
              sub="Export this month's sessions"
            />
            <ToolButton
              onClick={() => navigate('/bulk-schedule')}
              icon={<Calendar size={20} color="var(--color-primary)" />}
              tint="rgba(91, 138, 245, 0.12)"
              title="Auto-scheduler"
              sub="Distribute initial sessions"
            />
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
};

/** One bulk-tool tile. Kept local — nothing else in the app needs this shape. */
const ToolButton: React.FC<{
  onClick: () => void;
  icon: React.ReactNode;
  tint: string;
  title: string;
  sub: string;
  busy?: boolean;
}> = ({ onClick, icon, tint, title, sub, busy }) => (
  <motion.button
    onClick={onClick}
    disabled={busy}
    whileHover={busy ? undefined : { scale: 1.02 }}
    whileTap={busy ? undefined : { scale: 0.98 }}
    className="btn btn-secondary"
    style={{
      justifyContent: 'flex-start', padding: '0.875rem', border: '1px solid var(--color-border)',
      cursor: busy ? 'progress' : 'pointer', textAlign: 'left', minWidth: 0,
      opacity: busy ? 0.6 : 1
    }}
  >
    <span style={{ background: tint, padding: '0.5rem', borderRadius: '8px', marginRight: '0.6rem', display: 'flex', flexShrink: 0 }}>
      {icon}
    </span>
    <span style={{ minWidth: 0 }}>
      <span style={{ fontWeight: 600, display: 'block' }}>{title}</span>
      <span className="text-muted" style={{ fontSize: '0.72rem', display: 'block' }}>{sub}</span>
    </span>
  </motion.button>
);
