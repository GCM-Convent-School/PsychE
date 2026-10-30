import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, CalendarDays, CalendarPlus, Check, CheckCheck, Inbox, MoreHorizontal, MousePointer2, Plus, Users, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useDocumentTitle } from '../lib/branding';
import { getAvailableCapacityForDateRange } from '../lib/capacity';
import { daysBetween, greeting, todayKey } from '../analytics/operationalDay';
import { Avatar } from '../components/Avatar';
import { Dashboard } from './Dashboard';
import type { NeedLevel, ReferralCategory, StudentJourney } from '../types';

// =============================================================================
//  Home: the counsellor's journey (Release 2 + Release 3).
//
//  One subject, after the SugarCRM journey reference:
//   strip    → who needs you, notched into the panel (bubbles: days late, + not booked)
//   journey  → four stages joined by connectors; every row a student with a
//              state glyph and its own round action
//   tasks    → next steps as tiles, the current one black
//   below    → Today (table) and Teacher notes
//  Built on PsychE_Student_Journey (V16). Without V16 the older day
//  dashboard shows instead, so nothing breaks before the migration runs.
// =============================================================================

const NEED_RANK: Record<NeedLevel, number> = { urgent: 0, support: 1, watch: 2 };
const NEED_LABEL: Record<NeedLevel, string> = { urgent: 'Urgent', support: 'Support', watch: 'Watch' };
const CATEGORY_LABEL: Record<ReferralCategory, string> = {
  behaviour: 'Behaviour', emotional: 'Emotional', academic: 'Academic', social: 'Friends and peers',
  attendance: 'Attendance', wellbeing: 'Wellbeing', other: 'Other',
};

interface NewReferral {
  id: string;
  student_uuid: string;
  referred_by: string;
  category: ReferralCategory;
  concern_level: 'concern' | 'serious';
  observation: string;
  created_at: string;
}
interface TodaySession { id: string; student_uuid: string; reason: string | null }
interface DrawerState { title: string; note: string; items: StudentJourney[] }
interface Step { key: string; done: boolean; title: string; sub: string; foot: string; onClick?: () => void }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const shortDate = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const addDays = (key: string, n: number) => {
  const d = new Date(`${key}T12:00:00`);
  d.setDate(d.getDate() + n);
  return todayKey(d);
};
const firstName = (name: string | null | undefined) => (name ?? '').split(/\s+/)[0];

function byPriority(a: StudentJourney, b: StudentJourney): number {
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  const na = a.need_level ? NEED_RANK[a.need_level] : 3;
  const nb = b.need_level ? NEED_RANK[b.need_level] : 3;
  if (na !== nb) return na - nb;
  return (a.next_due_on ?? '9999').localeCompare(b.next_due_on ?? '9999');
}

export const Home: React.FC = () => {
  const navigate = useNavigate();
  const { staff } = useAuth();
  useDocumentTitle('Home');

  const today = todayKey();
  const [journey, setJourney] = useState<StudentJourney[] | null>(null);
  const [noJourney, setNoJourney] = useState(false);
  const [referrals, setReferrals] = useState<NewReferral[]>([]);
  const [referrerNames, setReferrerNames] = useState<Record<string, string>>({});
  const [todaySessions, setTodaySessions] = useState<TodaySession[]>([]);
  const [freeToday, setFreeToday] = useState(0);
  const [freeThisWeek, setFreeThisWeek] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);

  const load = useCallback(async () => {
    const { data, error: jErr } = await supabase.from('PsychE_Student_Journey').select('*');
    if (jErr) {
      // 42P01 / PGRST205: the view does not exist yet (V16 not run here).
      if (jErr.code === '42P01' || jErr.code === 'PGRST205') setNoJourney(true);
      else setError(`Could not load students: ${jErr.message}`);
      return;
    }
    setJourney((data ?? []) as StudentJourney[]);

    const now = new Date();
    // Days left in the school week, Monday to Saturday.
    const daysLeft = now.getDay() === 0 ? 7 : 7 - now.getDay();
    const [refs, sessions, cap, staffRows] = await Promise.all([
      supabase.from('PsychE_Referrals')
        .select('id, student_uuid, referred_by, category, concern_level, observation, created_at')
        .eq('status', 'new').order('created_at'),
      supabase.from('PsychE_Counseling_Logs')
        .select('id, student_uuid, reason')
        .eq('session_status', 'Scheduled').eq('scheduled_date', today),
      getAvailableCapacityForDateRange(now, daysLeft).catch(() => ({} as Record<string, { available: number }>)),
      // Counsellors may only read their own staff row; admins see everyone.
      // A teacher we can't name shows as "a teacher".
      supabase.from('PsychE_Staff').select('user_id, full_name'),
    ]);
    setReferrals((refs.data ?? []) as NewReferral[]);
    setTodaySessions((sessions.data ?? []) as TodaySession[]);
    setFreeToday(cap[today]?.available ?? 0);
    setFreeThisWeek(Object.values(cap).reduce((s, d) => s + d.available, 0));
    setReferrerNames(Object.fromEntries((staffRows.data ?? []).filter((r) => r.user_id).map((r) => [r.user_id, r.full_name])));
  }, [today]);

  useEffect(() => { load(); }, [load]);

  const view = useMemo(() => {
    const all = journey ?? [];
    const byId = new Map(all.map((j) => [j.student_uuid, j]));
    const stage = (s: StudentJourney['stage']) => all.filter((j) => j.stage === s);
    const booked = (j: StudentJourney) => !!j.next_scheduled_on && j.next_scheduled_on >= today;
    const open = stage('open').sort(byPriority);
    const reviews = stage('review_due').sort(byPriority);
    const notSeen = stage('not_seen').sort((a, b) => Number(booked(a)) - Number(booked(b)) || (a.course ?? '').localeCompare(b.course ?? '') || a.full_name.localeCompare(b.full_name));
    const regular = stage('regular').sort(byPriority);
    const urgent = open.filter((j) => j.need_level === 'urgent');
    const late = open.filter((j) => j.overdue);
    const reviewsSoon = reviews.filter((j) => j.overdue || (j.next_due_on ?? '9999') <= addDays(today, 7));
    const notSeenUnbooked = notSeen.filter((j) => !booked(j));
    const regularSoon = regular.filter((j) => j.overdue || (j.next_due_on ?? '9999') <= addDays(today, 30));
    const firstMeetingTarget = Math.min(notSeenUnbooked.length, Math.max(0, freeThisWeek - late.length - reviewsSoon.length));
    const bookedToday = new Set(todaySessions.map((s) => s.student_uuid));
    const suggestions = [...urgent, ...late, ...reviewsSoon, ...notSeenUnbooked]
      .filter((j, i, arr) => !booked(j) && !bookedToday.has(j.student_uuid) && arr.indexOf(j) === i)
      .slice(0, Math.min(freeToday, 3));
    return { all, byId, open, reviews, notSeen, regular, booked, urgent, late, reviewsSoon, notSeenUnbooked, regularSoon, firstMeetingTarget, suggestions };
  }, [journey, today, freeThisWeek, freeToday, todaySessions]);

  if (noJourney) return <Dashboard />;

  const daysLate = (j: StudentJourney) => (j.overdue && j.next_due_on ? daysBetween(j.next_due_on, today) : 0);
  const dueText = (j: StudentJourney): string => {
    if (!j.next_due_on) return j.stage === 'not_seen' ? 'not booked' : 'no date set';
    const d = daysBetween(today, j.next_due_on);
    if (d < 0 && j.stage === 'not_seen') return `missed booking ${plural(-d, 'day')} ago`;
    if (d < 0 && j.stage === 'regular') return `overdue since ${shortDate(j.next_due_on)}`;
    if (d < 0) return `${plural(-d, 'day')} late`;
    if (d === 0) return 'due today';
    if (d === 1) return 'due tomorrow';
    return `due ${shortDate(j.next_due_on)}`;
  };
  const isFirstContact = (j: StudentJourney) =>
    !j.last_session_at || (!!j.case_opened_at && j.last_session_at < j.case_opened_at);
  const whatIsDue = (j: StudentJourney): string => {
    if (j.stage === 'review_due') return '90-day review';
    if (j.stage === 'not_seen') return 'First meeting';
    if (j.stage === 'regular') return 'Check-in';
    return isFirstContact(j) ? 'First contact' : 'Follow-up';
  };
  const subLine = (j: StudentJourney) => {
    if (j.stage === 'not_seen') return [j.course, view.booked(j) ? `booked ${shortDate(j.next_scheduled_on!)}` : 'not booked'].filter(Boolean).join(' · ');
    if (j.stage === 'regular') return j.overdue && j.next_due_on ? `overdue since ${shortDate(j.next_due_on)}` : `check-in ${dueText(j)}`;
    return `${whatIsDue(j)} · ${dueText(j)}`;
  };

  const openStudent = (j: StudentJourney) => navigate(`/student/${j.student_id}`);
  const logSession = (j: StudentJourney) => navigate(`/add-log?student=${j.student_uuid}`);
  const showList = (title: string, note: string, items: StudentJourney[]) => setDrawer({ title, note, items });

  // ---- teacher notes --------------------------------------------------------
  const openCaseFromReferral = async (r: NewReferral) => {
    setBusy(r.id);
    setError('');
    const existing = view.byId.get(r.student_uuid);
    let caseId = existing?.stage === 'open' ? existing.case_id : null;
    if (!caseId) {
      const { data, error: cErr } = await supabase.from('PsychE_Cases')
        .insert({ student_uuid: r.student_uuid, need_level: r.concern_level === 'serious' ? 'urgent' : 'support', source: 'teacher_referral' })
        .select('id').single();
      if (cErr || !data) { setError(`Could not open the case: ${cErr?.message}`); setBusy(null); return; }
      caseId = data.id;
    }
    const { error: rErr } = await supabase.from('PsychE_Referrals')
      .update({ status: existing?.stage === 'open' ? 'added_to_case' : 'case_opened', case_id: caseId })
      .eq('id', r.id);
    if (rErr) setError(`Case saved, but the note was not marked as handled: ${rErr.message}`);
    setBusy(null);
    await load();
  };

  const noActionOnReferral = async (r: NewReferral) => {
    const reply = window.prompt('Reply to the teacher (they will see this):', 'Thank you. I have noted this and will keep an eye out.');
    if (reply === null) return;
    setBusy(r.id);
    const { error: rErr } = await supabase.from('PsychE_Referrals')
      .update({ status: 'no_action', reply_to_teacher: reply.trim() || null }).eq('id', r.id);
    if (rErr) setError(`Could not save: ${rErr.message}`);
    setBusy(null);
    await load();
  };

  const title = (
    <div className="page-head">
      <div>
        <div className="eyebrow">{greeting()}{staff?.full_name ? `, ${firstName(staff.full_name)}` : ''} · {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        <h1 className="page-title">Student Journeys</h1>
      </div>
    </div>
  );

  if (!journey) {
    return (
      <div className="home" aria-busy="true">
        {title}
        {error
          ? <div className="panel" role="alert" style={{ color: 'var(--accent-red)' }}>{error}</div>
          : <div className="panel"><div className="journey">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton" style={{ height: 300, borderRadius: 24 }} />)}</div></div>}
      </div>
    );
  }

  const { open, reviews, notSeen, regular, urgent, late, reviewsSoon, notSeenUnbooked, regularSoon, firstMeetingTarget, suggestions, booked } = view;
  const nextUrgent = urgent.find((j) => !booked(j)) ?? null;
  const lateBreakdown = (['urgent', 'support', 'watch'] as NeedLevel[])
    .map((l) => [l, late.filter((j) => j.need_level === l).length] as const).filter(([, n]) => n > 0)
    .map(([l, n]) => `${n} ${l}`).join(', ');

  // Next steps, in the order to do them. Short labels; the first open one is black.
  const steps: Step[] = [
    nextUrgent
      ? { key: 'urgent', done: false, title: `See ${firstName(nextUrgent.full_name)} first`, sub: `Urgent · ${dueText(nextUrgent)}`, foot: '', onClick: () => logSession(nextUrgent) }
      : { key: 'urgent', done: true, title: 'Urgent covered', sub: 'All booked', foot: '' },
    late.length
      ? { key: 'late', done: false, title: `${plural(late.length, 'late follow-up')}`, sub: lateBreakdown, foot: '', onClick: () => showList('Late follow-ups', 'Open cases past their follow-up date, most pressing first.', late) }
      : { key: 'late', done: true, title: 'Nothing late', sub: 'On rhythm', foot: '' },
    reviewsSoon.length
      ? { key: 'reviews', done: false, title: `Book ${plural(reviewsSoon.length, 'review')}`, sub: '90 days after closing', foot: '', onClick: () => showList('Reviews due', '90 days after a case closed, check the student is still all right.', reviewsSoon) }
      : { key: 'reviews', done: true, title: 'No reviews due', sub: 'This week', foot: '' },
    firstMeetingTarget
      ? { key: 'first', done: false, title: `${plural(firstMeetingTarget, 'first meeting')}`, sub: `${plural(freeThisWeek, 'free slot')} this week`, foot: '', onClick: () => navigate('/bulk-schedule') }
      : { key: 'first', done: true, title: notSeenUnbooked.length ? 'Week is full' : 'Everyone met', sub: notSeenUnbooked.length ? `${notSeenUnbooked.length} next week` : 'No one waiting', foot: '' },
  ];
  // Open moves first, so the black tile leads; finished ones settle after.
  const orderedSteps = [...steps.filter((s) => !s.done), ...steps.filter((s) => s.done)];
  const leadKey = orderedSteps.find((s) => !s.done)?.key;

  // Who needs you, in order: the strip notched into the journey panel.
  const people = [...urgent, ...late, ...reviewsSoon, ...notSeenUnbooked]
    .filter((j, i, arr) => arr.indexOf(j) === i).slice(0, 8);
  const bubble = (j: StudentJourney) => {
    const d = daysLate(j);
    if (j.stage === 'not_seen') return { text: '+', tone: 'plain' };
    if (d) return { text: String(d), tone: j.need_level ?? 'support' };
    return { text: '', tone: j.need_level ?? 'plain' };
  };

  // Two to four words per row; the state is a glyph, not a sentence.
  const rowSub = (j: StudentJourney): string => {
    const d = j.next_due_on ? daysBetween(today, j.next_due_on) : null;
    if (j.stage === 'not_seen') return booked(j) ? `Booked ${shortDate(j.next_scheduled_on!)}` : 'Not booked yet';
    if (j.stage === 'regular') return j.overdue ? 'Check-in overdue' : `Check-in ${j.next_due_on ? shortDate(j.next_due_on) : ''}`;
    if (d !== null && d < 0) return `${plural(-d, 'day')} late`;
    if (booked(j)) return `Booked ${shortDate(j.next_scheduled_on!)}`;
    return `${whatIsDue(j)} ${d === 0 ? 'today' : d === 1 ? 'tomorrow' : j.next_due_on ? shortDate(j.next_due_on) : ''}`;
  };
  const needsMove = (j: StudentJourney) =>
    !booked(j) && (j.stage === 'not_seen' || (j.stage !== 'regular' && (j.overdue || j.need_level === 'urgent')));

  const row = (j: StudentJourney) => {
    const lateBy = daysLate(j);
    const urgentRow = j.stage === 'open' || j.stage === 'review_due';
    const glyph = booked(j)
      ? <MoreHorizontal size={16} aria-label="Booked" />
      : !j.overdue && j.stage !== 'not_seen' ? <CheckCheck size={16} aria-label="On track" /> : null;
    const book = j.stage === 'not_seen';
    return (
      <div key={j.student_uuid} className={`jrow${needsMove(j) ? ' jrow--live' : ''}${j.overdue && urgentRow ? ' jrow--late' : ''}`}>
        <Avatar name={j.full_name} need={j.stage === 'open' ? j.need_level : null} badge={lateBy && urgentRow ? String(lateBy) : undefined} />
        <button type="button" className="jrow-text" onClick={() => openStudent(j)} title={[j.full_name, j.course, subLine(j)].filter(Boolean).join(' · ')}>
          <span className="jrow-name">{j.full_name}</span>
          <span className="jrow-sub">{rowSub(j)}</span>
        </button>
        {glyph && <span className="jrow-glyph">{glyph}</span>}
        <button type="button" className="round round--sm" data-tip={book ? 'Book' : 'Log session'}
          aria-label={book ? `Book ${j.full_name}` : `Log a session for ${j.full_name}`}
          onClick={() => (book ? navigate('/bulk-schedule') : logSession(j))}>
          {book ? <CalendarPlus size={14} /> : <Check size={14} />}
        </button>
      </div>
    );
  };

  const stage = (label: string, list: StudentJourney[], emptyText: string, onAll: () => void, more?: React.ReactNode) => (
    <div className="jstage">
      <div className="jcol">
        {list.length === 0 && <div className="jempty"><span className="round round--sm round--ghost" aria-hidden="true"><Check size={14} /></span>{emptyText}</div>}
        {list.slice(0, 5).map(row)}
        {list.length > 5 && <button type="button" className="jmore" onClick={onAll}>+{list.length - 5} more</button>}
        {more}
      </div>
      <button type="button" className="jlabel" onClick={onAll}>{label}<span className="count">{list.length}</span></button>
    </div>
  );

  return (
    <div className="home">
      {title}
      {error && <div className="panel" role="alert" style={{ color: 'var(--accent-red)' }}>{error}</div>}

      <section className="panel journey-panel rise" aria-labelledby="journey-title">
        <div className="panel-head">
          <h2 id="journey-title" className="panel-title">Case management</h2>
          {people.length > 0 && (
            <div className="notch" role="group" aria-label="Who needs you">
              {people.map((j) => {
                const b = bubble(j);
                return (
                  <button key={j.student_uuid} type="button" className="notch-person" onClick={() => openStudent(j)}
                    title={`${j.full_name} · ${subLine(j)}`} aria-label={`${j.full_name}, ${subLine(j)}`}>
                    <Avatar name={j.full_name} />
                    {b.text && <span className={`bubble bubble--${b.tone}`}>{b.text}</span>}
                  </button>
                );
              })}
            </div>
          )}
          <div className="panel-actions">
            <button type="button" className="round" data-tip="Log a session" aria-label="Log a session" onClick={() => navigate('/add-log')}><Plus size={16} /></button>
            <button type="button" className="round" data-tip="All students" aria-label="All students" onClick={() => navigate('/directory')}><Users size={16} /></button>
            <button type="button" className="round" data-tip="Book sessions" aria-label="Book sessions" onClick={() => navigate('/bulk-schedule')}><CalendarPlus size={16} /></button>
          </div>
        </div>

        <div className="journey">
          {stage('Not seen yet', notSeen, 'Everyone has met you', () => showList('Not seen yet', 'Students who have not had a first meeting.', notSeen))}
          {stage('Open cases', open, 'No open cases', () => showList('Open cases', 'Most pressing first: late, then urgent, support, watch.', open))}
          {stage('Review due', reviews, 'No reviews due', () => showList('Reviews due', '90 days after a case closed.', reviews))}
          {stage('Regular', regular, 'No regular students', () => showList('Check-ins due', 'Regular students due a termly check-in in the next 30 days.', regularSoon))}

          <div className="jstage jstage--tasks">
            <div className="tasks">
              {orderedSteps.map((s) => (
                <button key={s.key} type="button" disabled={s.done} onClick={s.onClick}
                  className={`task${s.key === leadKey ? ' task--lead' : ''}${s.done ? ' task--done' : ''}`}>
                  <span className="task-title">{s.title}</span>
                  <span className="task-sub">{s.done ? <><CheckCheck size={13} aria-hidden="true" /> {s.sub}</> : s.sub}</span>
                  {s.key === leadKey && <MousePointer2 className="task-cursor" size={18} aria-hidden="true" />}
                </button>
              ))}
            </div>
            <div className="jlabel jlabel--static">Next steps</div>
          </div>
        </div>
      </section>

      <div className="home-row">
        <section className="panel rise" style={{ '--i': 1 } as React.CSSProperties} aria-labelledby="today-title">
          <div className="panel-head">
            <h2 id="today-title" className="panel-title">Today <span className="count">{todaySessions.length}</span></h2>
            <div className="panel-actions">
              <button type="button" className="round" data-tip="Log a session" aria-label="Log a session" onClick={() => navigate('/add-log')}><Plus size={16} /></button>
              <button type="button" className="round" data-tip="Day view" aria-label="Day view" onClick={() => navigate('/day')}><CalendarDays size={16} /></button>
              <button type="button" className="round" data-tip="Book sessions" aria-label="Book sessions" onClick={() => navigate('/bulk-schedule')}><CalendarPlus size={16} /></button>
            </div>
          </div>
          <div className="ttable" role="table" aria-label="Today">
            <div className="ttable-head" role="row">
              <span role="columnheader">Student</span><span role="columnheader">For</span><span role="columnheader">Status</span><span role="columnheader" aria-label="Action" />
            </div>
            {todaySessions.map((s) => {
              const j = view.byId.get(s.student_uuid);
              return (
                <div key={s.id} className="ttable-row" role="row">
                  <span className="ttable-who" role="cell"><Avatar name={j?.full_name} need={j?.stage === 'open' ? j.need_level : null} /><span>{j?.full_name ?? 'Student'}</span></span>
                  <span role="cell" className="text-muted">{j ? whatIsDue(j) : 'Session'}</span>
                  <span role="cell">{j?.stage === 'open' && j.need_level ? <span className={`status status--${j.need_level}`}>{NEED_LABEL[j.need_level]}</span> : <span className="status status--info">Booked</span>}</span>
                  <span role="cell"><button type="button" className="round round--sm" data-tip="Start" aria-label={`Start session with ${j?.full_name ?? 'student'}`}
                    onClick={() => navigate(`/add-log?schedule_id=${s.id}&student=${s.student_uuid}`)}><ArrowUpRight size={14} /></button></span>
                </div>
              );
            })}
            {suggestions.map((j) => (
              <div key={`free-${j.student_uuid}`} className="ttable-row ttable-row--free" role="row">
                <span className="ttable-who" role="cell"><Avatar name={j.full_name} need={j.stage === 'open' ? j.need_level : null} /><span>{j.full_name}</span></span>
                <span role="cell" className="text-muted">{whatIsDue(j)}</span>
                <span role="cell"><span className="status status--free">Free slot</span></span>
                <span role="cell"><button type="button" className="round round--sm round--dark" data-tip={`See ${firstName(j.full_name)}`} aria-label={`See ${j.full_name} in a free slot`} onClick={() => logSession(j)}><Plus size={14} /></button></span>
              </div>
            ))}
            {todaySessions.length === 0 && suggestions.length === 0 && <div className="jempty" style={{ padding: 28 }}>Nothing booked today</div>}
          </div>
          <div className="panel-foot">{plural(freeToday, 'free slot')} today · {plural(freeThisWeek, 'slot')} this week</div>
        </section>

        <section className="panel rise" style={{ '--i': 2 } as React.CSSProperties} aria-labelledby="notes-title">
          <div className="panel-head">
            <h2 id="notes-title" className="panel-title">Teacher notes <span className="count">{referrals.length}</span></h2>
          </div>
          <div className="list">
            {referrals.length === 0 && <div className="jempty" style={{ padding: 28 }}><span className="round round--sm round--ghost" aria-hidden="true"><Inbox size={14} /></span>No new notes</div>}
            {referrals.map((r, i) => {
              const j = view.byId.get(r.student_uuid);
              const hasOpenCase = j?.stage === 'open';
              const ageDays = daysBetween(todayKey(new Date(r.created_at)), today);
              return (
                <article key={r.id} className="note">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Avatar name={j?.full_name} need={r.concern_level === 'serious' ? 'urgent' : null} />
                    <div className="list-row-main">
                      <div className="list-row-title">{j?.full_name ?? 'Student'}{j?.course ? ` · ${j.course}` : ''}</div>
                      <div className="list-row-sub">
                        {referrerNames[r.referred_by] ?? 'A teacher'} · {ageDays === 0 ? 'today' : ageDays === 1 ? 'yesterday' : `${ageDays} days ago`} · {CATEGORY_LABEL[r.category]}
                      </div>
                    </div>
                    {r.concern_level === 'serious' && <span className="status status--urgent">Serious</span>}
                  </div>
                  <p className="note-body">{r.observation}</p>
                  <div className="note-actions">
                    <button type="button" className={`btn ${i === 0 ? 'btn-primary' : 'btn-secondary'}`} disabled={busy === r.id} onClick={() => openCaseFromReferral(r)}>
                      {hasOpenCase ? 'Add to open case' : r.concern_level === 'serious' ? 'Open urgent case' : 'Open a case'}
                    </button>
                    <button type="button" className="btn btn-quiet" disabled={busy === r.id} onClick={() => noActionOnReferral(r)}>No action, reply</button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>

      {drawer && (
        <div className="drawer-overlay" role="presentation" onClick={() => setDrawer(null)}>
          <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" onClick={(e) => e.stopPropagation()}>
            <div className="panel-head" style={{ marginBottom: 0, alignItems: 'flex-start' }}>
              <div>
                <h2 id="drawer-title" className="panel-title" style={{ fontSize: 17 }}>{drawer.title} <span className="count">{drawer.items.length}</span></h2>
                <p className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>{drawer.note}</p>
              </div>
              <button type="button" className="round" onClick={() => setDrawer(null)} aria-label="Close"><X size={16} /></button>
            </div>
            <ul className="list">
              {drawer.items.length === 0 && <li className="jempty" style={{ padding: 28 }}>Nobody here right now</li>}
              {drawer.items.map((j) => (
                <li key={j.student_uuid} className="list-row">
                  <Avatar name={j.full_name} need={j.stage === 'open' ? j.need_level : null} badge={daysLate(j) ? String(daysLate(j)) : undefined} />
                  <div className="list-row-main">
                    <div className="list-row-title">{j.full_name}</div>
                    <div className="list-row-sub">{[j.course, subLine(j)].filter(Boolean).join(' · ')}</div>
                  </div>
                  <button type="button" className="round round--sm" title="Open profile" aria-label={`Open ${j.full_name}`} onClick={() => openStudent(j)}><ArrowUpRight size={14} /></button>
                  <button type="button" className="btn btn-secondary" onClick={() => logSession(j)}>Log session</button>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      )}
    </div>
  );
};
