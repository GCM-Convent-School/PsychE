// =============================================================================
//  DashboardPanels — presentational components for the counsellor's homepage.
//
//  Pure props-in / JSX-out. No Supabase, no page state (GUIDE §2.1). All data
//  shaping happens in src/analytics/operationalDay.ts; all fetching and all
//  mutation handlers stay in Dashboard.tsx.
//
//  COLOUR RULE (matches TelemetryPanel / ProgrammeHealthPanel)
//  ---------------------------------------------------------
//  One accent hue for neutral data marks, grey for context, and status colour
//  used only where the status IS the message — late is amber/red, done is green.
//  Nothing is encoded by colour alone: every coloured mark carries a number or
//  a word beside it, so the panels survive both greyscale print and CVD.
// =============================================================================

import React from 'react';
import { motion } from 'framer-motion';
import { ResponsiveContainer, BarChart, Bar, XAxis, Tooltip, Cell, ReferenceLine } from 'recharts';
import {
  CalendarCheck, AlertTriangle, Clock, ChevronRight, Calendar, Trash, Check,
  XCircle, ArrowUpRight, Activity, Users, Wind, CheckCircle2, CalendarPlus
} from 'lucide-react';
import { formatDisplayDate } from '../utils/dateFormatter';
import { toSentenceCase } from '../utils/stringFormatter';
import type { StudentRollup } from '../analytics/programmeHealth';
import type {
  DatedRow, ScheduledRow, FollowUpRow, DayLoad, Momentum, FocusState
} from '../analytics/operationalDay';

const ACCENT = '#2F5BD3';
const GOOD = '#157A52';
const WARN = '#B25E09';
const BAD = '#B42318';

/**
 * Mount variant for every panel. Left un-driven on purpose: framer-motion
 * propagates the parent container's `show` state down through the plain
 * .bento-grid wrapper via context, so each card inherits the page's stagger
 * without the page needing to wrap these components.
 */
const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 300, damping: 24 } }
};

const label: React.CSSProperties = {
  fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em',
  color: 'var(--color-text-muted)', fontWeight: 700
};

const cardHead: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem'
};

const PanelTitle: React.FC<{ icon: React.ReactNode; text: string; right?: React.ReactNode }> =
  ({ icon, text, right }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
      <div style={cardHead}>
        {icon}
        <h3 className="text-h3" style={{ fontSize: '1rem', margin: 0 }}>{text}</h3>
      </div>
      {right}
    </div>
  );

const CountChip: React.FC<{ n: number; tone?: string }> = ({ n, tone = ACCENT }) => (
  <span style={{
    fontSize: '0.6875rem', fontWeight: 800, padding: '0.1rem 0.45rem', borderRadius: 'var(--radius-full)',
    backgroundColor: `${tone}1f`, color: tone, border: `1px solid ${tone}55`, flexShrink: 0
  }}>{n}</span>
);

const EmptyState: React.FC<{ icon: React.ReactNode; text: string; sub?: string }> = ({ icon, text, sub }) => (
  <div style={{
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: '0.5rem', padding: '2rem 1rem', textAlign: 'center'
  }}>
    <span style={{ color: 'var(--text-muted)' }}>{icon}</span>
    <p style={{ fontSize: '0.875rem', fontWeight: 600 }}>{text}</p>
    {sub && <p className="text-muted" style={{ fontSize: '0.75rem', maxWidth: '26ch' }}>{sub}</p>}
  </div>
);

/** Shared handlers for a scheduled-session row. Owned by the page, not here. */
export interface ScheduleControls {
  rescheduleId: string | null;
  newDate: string;
  onOpen: (id: string) => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
  onToggleReschedule: (id: string) => void;
  onNewDate: (v: string) => void;
  onConfirmReschedule: (e: React.MouseEvent, id: string) => void;
  onCancelReschedule: () => void;
}

// ---------------------------------------------------------------------------
//  Row primitives
// ---------------------------------------------------------------------------

const RowShell: React.FC<{
  onClick?: () => void;
  tone?: string;
  children: React.ReactNode;
  flat?: boolean;
}> = ({ onClick, tone, children, flat }) => {
  const base = tone ? `${tone}0d` : 'rgb(var(--ink) / 0.016)';
  const hover = tone ? `${tone}1a` : 'rgb(var(--ink) / 0.040)';
  return (
    <div
      onClick={onClick}
      className="dash-row"
      style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        padding: '0.75rem 0.875rem',
        borderRadius: flat ? '0' : 'var(--radius-md)',
        backgroundColor: base,
        border: `1px solid ${tone ? `${tone}33` : 'rgb(var(--ink) / 0.048)'}`,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background-color 0.15s ease',
        minWidth: 0
      }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.backgroundColor = hover; }}
      onMouseLeave={e => { if (onClick) e.currentTarget.style.backgroundColor = base; }}
    >
      {children}
    </div>
  );
};

const Identity: React.FC<{ name: string; sub: string; strong?: boolean }> = ({ name, sub, strong }) => (
  <div className="dash-identity" style={{ flex: 1, minWidth: 0 }}>
    <p style={{
      fontWeight: strong ? 700 : 600, fontSize: '0.9375rem',
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
    }}>{name}</p>
    <p className="text-muted" style={{
      fontSize: '0.78rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
    }}>{sub}</p>
  </div>
);

const LateBadge: React.FC<{ days: number }> = ({ days }) => (
  <span style={{
    fontSize: '0.625rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
    padding: '0.15rem 0.45rem', borderRadius: '4px', whiteSpace: 'nowrap',
    backgroundColor: 'rgba(245,91,91,0.12)', color: BAD, border: '1px solid rgba(245,91,91,0.3)'
  }}>
    {days === 1 ? '1 day late' : `${days} days late`}
  </span>
);

const RiskDot: React.FC<{ level: string | null }> = ({ level }) => {
  if (level !== 'High' && level !== 'Medium') return null;
  const tone = level === 'High' ? BAD : WARN;
  return (
    <span title={`${level} risk`} style={{
      fontSize: '0.625rem', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase',
      padding: '0.15rem 0.45rem', borderRadius: '4px', whiteSpace: 'nowrap',
      backgroundColor: `${tone}1f`, color: tone, border: `1px solid ${tone}4d`
    }}>{level}</span>
  );
};

const IconAction: React.FC<{
  onClick: (e: React.MouseEvent) => void;
  title: string;
  danger?: boolean;
  children: React.ReactNode;
}> = ({ onClick, title, danger, children }) => (
  <button
    onClick={onClick}
    title={title}
    aria-label={title}
    className="no-print"
    style={{
      background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)',
      display: 'flex', alignItems: 'center', padding: '0.375rem', borderRadius: '6px',
      transition: 'color 0.15s, background-color 0.15s'
    }}
    onMouseEnter={e => {
      e.currentTarget.style.color = danger ? BAD : 'var(--color-text)';
      e.currentTarget.style.backgroundColor = danger ? 'rgba(245,91,91,0.08)' : 'rgb(var(--ink) / 0.048)';
    }}
    onMouseLeave={e => {
      e.currentTarget.style.color = 'var(--color-text-muted)';
      e.currentTarget.style.backgroundColor = 'transparent';
    }}
  >
    {children}
  </button>
);

/** The inline date editor shared by every reschedulable row. */
const RescheduleRow: React.FC<{ id: string; c: ScheduleControls }> = ({ id, c }) => (
  <div style={{
    display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '0.5rem 0.875rem',
    backgroundColor: 'rgb(var(--ink) / 0.024)', borderRadius: '0 0 var(--radius-md) var(--radius-md)',
    border: '1px solid rgb(var(--ink) / 0.048)', borderTop: 'none', marginTop: '-4px'
  }}>
    <input
      type="date"
      className="input"
      aria-label="New session date"
      style={{ flex: 1, padding: '0.375rem 0.625rem', fontSize: '0.875rem' }}
      value={c.newDate}
      min={new Date().toISOString().split('T')[0]}
      onChange={e => c.onNewDate(e.target.value)}
    />
    <IconAction onClick={e => c.onConfirmReschedule(e, id)} title="Confirm new date">
      <Check size={18} color={GOOD} />
    </IconAction>
    <IconAction onClick={e => { e.stopPropagation(); c.onCancelReschedule(); }} title="Cancel">
      <XCircle size={18} />
    </IconAction>
  </div>
);

// ===========================================================================
//  1. Focus hero — the answer to "what is today?"
// ===========================================================================

/**
 * Segmented slot meter. Each pip is one session slot of the counsellor's stated
 * daily capacity, so the day's commitment is legible at a glance rather than
 * requiring the reader to divide two numbers.
 */
const SlotMeter: React.FC<{ load: DayLoad }> = ({ load }) => {
  const pips = load.capacity + load.overBy;
  // Above ~30 slots the pips stop being countable and a proportional bar reads
  // better. Capacity is counsellor-editable, so this is a real possibility.
  if (pips > 30 || load.capacity === 0) {
    const pct = Math.min(100, load.utilisationPct);
    return (
      <div>
        <div style={{ height: 10, borderRadius: 5, backgroundColor: 'rgb(var(--ink) / 0.064)', overflow: 'hidden' }}>
          <div style={{
            width: `${pct}%`, height: '100%',
            background: `linear-gradient(90deg, ${GOOD}, ${ACCENT})`
          }} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {Array.from({ length: pips }).map((_, i) => {
        const isCompleted = i < load.completed;
        const isBooked = !isCompleted && i < load.total;
        const isOver = i >= load.capacity;
        const bg = isCompleted ? GOOD : isBooked ? (isOver ? WARN : ACCENT) : 'transparent';
        const border = isCompleted ? GOOD : isBooked ? (isOver ? WARN : ACCENT) : 'rgb(var(--ink) / 0.144)';
        return (
          <span key={i} style={{
            width: 16, height: 10, borderRadius: 3,
            backgroundColor: bg, border: `1px solid ${border}`, flexShrink: 0
          }} />
        );
      })}
    </div>
  );
};

const toneColour = (t: FocusState['tone']) => t === 'behind' ? WARN : t === 'steady' ? ACCENT : GOOD;

export const FocusHero: React.FC<{
  now: Date;
  greeting: string;
  focus: FocusState;
  load: DayLoad;
  capacityKnown: boolean;
  onPrimary: () => void;
  onSchedule: () => void;
}> = ({ now, greeting, focus, load, capacityKnown, onPrimary, onSchedule }) => {
  const tone = toneColour(focus.tone);
  return (
    <motion.div variants={item} className="bento-card col-span-12" style={{ position: 'relative', overflow: 'hidden' }}>
      {/* Ambient wash, tinted by the day's state. Decorative only — the same
          information is carried by the headline text beside it. */}
      <div aria-hidden style={{
        position: 'absolute', top: '-60%', right: '-8%', width: 420, height: 420,
        background: `radial-gradient(circle, ${tone}26 0%, rgba(0,0,0,0) 68%)`,
        borderRadius: '50%', pointerEvents: 'none'
      }} />

      <div className="dash-hero" style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: '1.5rem', position: 'relative', minWidth: 0
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ ...label, color: tone, marginBottom: '0.4rem' }}>
            {new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(now)}
          </p>
          <h1 className="text-h1 break-words" style={{ marginBottom: '0.3rem' }}>
            {greeting}, Counsellor
          </h1>
          <p style={{ fontSize: '1rem', fontWeight: 600, color: tone, marginBottom: '0.2rem' }}>
            {focus.headline}
          </p>
          <p className="text-muted" style={{ fontSize: '0.85rem' }}>
            {focus.parts.length ? focus.parts.join(' · ') : 'No sessions booked, no follow-ups outstanding.'}
          </p>
        </div>

        <div className="dash-hero-actions no-print" style={{ display: 'flex', gap: '0.6rem', flexShrink: 0, flexWrap: 'wrap' }}>
          <button onClick={onPrimary} className="btn btn-primary" style={{
            background: 'var(--color-primary)', border: 'none',
            padding: '0.7rem 1.25rem', fontSize: '0.9375rem', fontWeight: 600
          }}>
            <CalendarCheck size={18} /> Log a session
          </button>
          <button onClick={onSchedule} className="btn btn-secondary" style={{ padding: '0.7rem 1.1rem', fontSize: '0.9375rem' }}>
            <CalendarPlus size={18} /> Schedule
          </button>
        </div>
      </div>

      {/* Capacity strip */}
      <div style={{
        marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border)',
        position: 'relative'
      }}>
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          gap: '1rem', marginBottom: '0.5rem', flexWrap: 'wrap'
        }}>
          <p style={label}>Today's load</p>
          <p className="text-muted" style={{ fontSize: '0.78rem' }}>
            {capacityKnown ? (
              load.overBy > 0
                ? <><strong style={{ color: WARN }}>{load.total}</strong> committed against a stated capacity of {load.capacity} — {load.overBy} over</>
                : <><strong style={{ color: 'var(--color-text)' }}>{load.total}</strong> of {load.capacity} slots used · {load.freeSlots} free</>
            ) : 'Capacity setting unavailable'}
          </p>
        </div>
        <SlotMeter load={load} />
        <div style={{ display: 'flex', gap: '1.1rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
          <LegendKey colour={GOOD} text={`${load.completed} completed`} />
          <LegendKey colour={ACCENT} text={`${load.booked} still to see`} />
          <LegendKey colour="rgb(var(--ink) / 0.144)" text={`${load.freeSlots} free`} hollow />
        </div>
      </div>
    </motion.div>
  );
};

const LegendKey: React.FC<{ colour: string; text: string; hollow?: boolean }> = ({ colour, text, hollow }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
    <span style={{
      width: 14, height: 9, borderRadius: 3,
      backgroundColor: hollow ? 'transparent' : colour, border: `1px solid ${colour}`
    }} />
    {text}
  </span>
);

// ===========================================================================
//  2. Today's line-up
// ===========================================================================

export const TodayLineUp: React.FC<{
  rows: DatedRow<ScheduledRow>[];
  undated: DatedRow<ScheduledRow>[];
  completedToday: number;
  controls: ScheduleControls;
  onSchedule: () => void;
  onOpenStudent: (sid: string) => void;
}> = ({ rows, undated, completedToday, controls, onSchedule, onOpenStudent }) => (
  <motion.div variants={item} className="bento-card col-span-7">
    <PanelTitle
      icon={<CalendarCheck size={18} style={{ color: ACCENT }} />}
      text="Today's line-up"
      right={rows.length > 0 ? <CountChip n={rows.length} /> : undefined}
    />
    <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: '1rem' }}>
      Sessions dated today and still open. Click a row to log it.
    </p>

    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: 0 }}>
      {rows.length === 0 ? (
        completedToday > 0 ? (
          <EmptyState
            icon={<CheckCircle2 size={40} color={GOOD} />}
            text={`All ${completedToday} of today's sessions are logged`}
            sub="Nothing further is booked for today."
          />
        ) : (
          <EmptyState
            icon={<Calendar size={40} />}
            text="Nothing booked for today"
            sub="Use the Bulk Auto-Scheduler to distribute initial sessions across the coming days."
          />
        )
      ) : (
        rows.map((r, i) => (
          <div key={r.id}>
            <RowShell onClick={() => controls.onOpen(r.id)}>
              <span style={{
                ...label, width: 22, textAlign: 'right', flexShrink: 0,
                fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)'
              }}>{i + 1}</span>
              <Identity name={r.student_name} sub={toSentenceCase(r.reason)} strong />
              <RiskDot level={r.risk_level} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.15rem', flexShrink: 0 }}>
                <IconAction
                  onClick={e => { e.stopPropagation(); controls.onToggleReschedule(r.id); }}
                  title="Reschedule"
                ><Calendar size={15} /></IconAction>
                <IconAction onClick={e => controls.onDelete(e, r.id)} title="Delete session" danger>
                  <Trash size={15} />
                </IconAction>
              </div>
            </RowShell>
            {controls.rescheduleId === r.id && <RescheduleRow id={r.id} c={controls} />}
          </div>
        ))
      )}

      {rows.length === 0 && completedToday === 0 && (
        <button onClick={onSchedule} className="btn btn-secondary" style={{ alignSelf: 'center', marginTop: '-0.5rem' }}>
          <CalendarPlus size={16} /> Open Bulk Auto-Scheduler
        </button>
      )}

      {undated.length > 0 && (
        <div style={{
          marginTop: '0.5rem', padding: '0.6rem 0.8rem', borderRadius: 'var(--radius-md)',
          backgroundColor: 'rgba(245,166,35,0.07)', border: '1px dashed rgba(245,166,35,0.32)',
          display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.75rem', color: WARN
        }}>
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            <strong>{undated.length} scheduled {undated.length === 1 ? 'session has' : 'sessions have'} no date.</strong>{' '}
            They will never appear on any day's list until one is set.{' '}
            {undated.slice(0, 3).map((u, i) => (
              <React.Fragment key={u.id}>
                {i > 0 && ', '}
                <button
                  onClick={() => u.student_sid && onOpenStudent(u.student_sid)}
                  style={{ color: WARN, textDecoration: 'underline', background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer' }}
                >{u.student_name}</button>
              </React.Fragment>
            ))}
            {undated.length > 3 && ` and ${undated.length - 3} more`}
          </span>
        </div>
      )}
    </div>
  </motion.div>
);

// ===========================================================================
//  3. Needs attention — commitments that have slipped
// ===========================================================================

export const AttentionPanel: React.FC<{
  overdueSessions: DatedRow<ScheduledRow>[];
  overdueFollowUps: DatedRow<FollowUpRow>[];
  followUpsToday: DatedRow<FollowUpRow>[];
  controls: ScheduleControls;
  onOpenStudent: (sid: string) => void;
}> = ({ overdueSessions, overdueFollowUps, followUpsToday, controls, onOpenStudent }) => {
  const total = overdueSessions.length + overdueFollowUps.length + followUpsToday.length;
  // Long lists are truncated for legibility, but the hidden remainder is always
  // stated: a panel that silently caps at five teaches the counsellor to trust
  // a number that is not the whole story.
  const CAP = 5;
  const sessions = overdueSessions.slice(0, CAP);
  const dueFollowUps = [...overdueFollowUps, ...followUpsToday];
  const shownFollowUps = dueFollowUps.slice(0, CAP);
  const hidden = (overdueSessions.length - sessions.length) + (dueFollowUps.length - shownFollowUps.length);

  return (
    <motion.div variants={item} className="bento-card col-span-5" style={total > 0 ? { borderColor: 'rgba(245,166,35,0.28)' } : undefined}>
      <PanelTitle
        icon={<AlertTriangle size={18} style={{ color: total > 0 ? WARN : 'var(--text-muted)' }} />}
        text="Needs attention"
        right={total > 0 ? <CountChip n={total} tone={WARN} /> : undefined}
      />
      <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: '1rem' }}>
        Sessions past their date and follow-ups you committed to.
      </p>

      {total === 0 ? (
        <EmptyState
          icon={<CheckCircle2 size={40} color={GOOD} />}
          text="Nothing has slipped"
          sub="No overdue sessions and no follow-ups past their date."
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {overdueSessions.length > 0 && (
            <div>
              <p style={{ ...label, marginBottom: '0.45rem' }}>Sessions past their date</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {sessions.map(r => (
                  <div key={r.id}>
                    <RowShell onClick={() => controls.onOpen(r.id)} tone={BAD}>
                      <Identity name={r.student_name} sub={toSentenceCase(r.reason)} />
                      <LateBadge days={r.daysLate} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.15rem', flexShrink: 0 }}>
                        <IconAction
                          onClick={e => { e.stopPropagation(); controls.onToggleReschedule(r.id); }}
                          title="Reschedule"
                        ><Calendar size={15} /></IconAction>
                        <IconAction onClick={e => controls.onDelete(e, r.id)} title="Delete session" danger>
                          <Trash size={15} />
                        </IconAction>
                      </div>
                    </RowShell>
                    {controls.rescheduleId === r.id && <RescheduleRow id={r.id} c={controls} />}
                  </div>
                ))}
              </div>
            </div>
          )}

          {dueFollowUps.length > 0 && (
            <div>
              <p style={{ ...label, marginBottom: '0.45rem' }}>Follow-ups due</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {shownFollowUps.map(f => (
                  <RowShell
                    key={f.id}
                    onClick={() => f.student_sid && onOpenStudent(f.student_sid)}
                    tone={f.daysLate > 0 ? WARN : undefined}
                  >
                    <Identity name={f.student_name} sub={toSentenceCase(f.reason)} />
                    {f.daysLate > 0
                      ? <LateBadge days={f.daysLate} />
                      : <span style={{ fontSize: '0.72rem', fontWeight: 700, color: ACCENT, whiteSpace: 'nowrap' }}>Due today</span>}
                    <ChevronRight size={15} className="text-muted" style={{ flexShrink: 0 }} />
                  </RowShell>
                ))}
              </div>
              <p className="text-muted" style={{ fontSize: '0.7rem', marginTop: '0.5rem' }}>
                A follow-up closes itself once a session is completed on or after its due date. Open the
                student's timeline to close one by hand.
              </p>
            </div>
          )}

          {hidden > 0 && (
            <p className="text-muted" style={{ fontSize: '0.72rem' }}>
              {hidden} more not shown. Open <strong>Activity Logs</strong> for the full backlog.
            </p>
          )}
        </div>
      )}
    </motion.div>
  );
};

// ===========================================================================
//  4. Drifting students — measured need, no recent contact
// ===========================================================================

/** Horizontal need bar. The number is printed beside it, never implied by width alone. */
const NeedBar: React.FC<{ score: number }> = ({ score }) => {
  const pct = Math.max(0, Math.min(100, score));
  const tone = pct >= 70 ? BAD : pct >= 45 ? WARN : ACCENT;
  return (
    <div className="dash-needbar" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: 116, flexShrink: 0 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: 'rgb(var(--ink) / 0.064)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', backgroundColor: tone }} />
      </div>
      <span style={{
        fontSize: '0.78rem', fontWeight: 800, color: tone, width: 26, textAlign: 'right',
        fontVariantNumeric: 'tabular-nums'
      }}>{Math.round(pct)}</span>
    </div>
  );
};

export const DriftPanel: React.FC<{
  students: StudentRollup[];
  windowDays: number;
  loading: boolean;
  error: string | null;
  onOpenStudent: (sid: string) => void;
  onViewAll: () => void;
}> = ({ students, windowDays, loading, error, onOpenStudent, onViewAll }) => (
  <motion.div variants={item} className="bento-card col-span-8">
    <PanelTitle
      icon={<Wind size={18} style={{ color: ACCENT }} />}
      text="Drifting students"
      right={
        <button onClick={onViewAll} className="text-muted" style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
          Programme Health <ArrowUpRight size={14} />
        </button>
      }
    />
    <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: '1rem' }}>
      Carrying measured need but not seen for 30 days or more. Ranked by composite need, then by staleness.
    </p>

    {loading ? (
      <p className="text-muted" style={{ padding: '1.5rem 0', textAlign: 'center', fontSize: '0.85rem' }}>
        Reading telemetry…
      </p>
    ) : error ? (
      <div style={{
        padding: '0.7rem 0.85rem', borderRadius: 'var(--radius-md)', fontSize: '0.78rem',
        backgroundColor: 'rgba(245,91,91,0.08)', border: '1px solid rgba(245,91,91,0.28)', color: BAD
      }}>
        Could not read triage data: {error}
      </div>
    ) : students.length === 0 ? (
      <EmptyState
        icon={<CheckCircle2 size={40} color={GOOD} />}
        text="No student with measured need is overdue for contact"
        sub="Every student whose composite score is trustworthy has been seen within the last 30 days."
      />
    ) : (
      <div className="table-scroll">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', minWidth: 400 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0 0.875rem 0.25rem' }}>
            <span style={{ ...label, flex: 1 }}>Student</span>
            <span style={{ ...label, width: 116, textAlign: 'center' }}>Need</span>
            <span style={{ ...label, width: 92, textAlign: 'right' }}>Last seen</span>
            <span style={{ width: 15, flexShrink: 0 }} />
          </div>
          {students.map(s => (
            <RowShell key={s.student_uuid} onClick={() => s.student_id && onOpenStudent(s.student_id)}>
              <Identity
                name={s.full_name ?? 'Unknown student'}
                sub={[s.course, s.student_id].filter(Boolean).join(' · ') || '—'}
              />
              <NeedBar score={s.composite_score ?? 0} />
              <span style={{
                width: 92, textAlign: 'right', flexShrink: 0, fontSize: '0.78rem',
                color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums'
              }}>
                {s.days_since_contact == null
                  ? `${windowDays}d+`
                  : `${s.days_since_contact}d ago`}
              </span>
              <ChevronRight size={15} className="text-muted" style={{ flexShrink: 0 }} />
            </RowShell>
          ))}
        </div>
      </div>
    )}

    <p className="text-muted" style={{ fontSize: '0.7rem', marginTop: '0.75rem' }}>
      Only students whose composite confidence clears the evidential floor appear here — a score built on
      too little assessment data is excluded rather than shown as a low need. “{windowDays}d+” means no
      completed session inside the {windowDays}-day window, not necessarily never.
    </p>
  </motion.div>
);

// ===========================================================================
//  5. Momentum — is the practice actually running?
// ===========================================================================

export const MomentumPanel: React.FC<{
  m: Momentum;
  capacity: number;
  capacityKnown: boolean;
  sessionsThisMonth: number;
  totalStudents: number;
  onStudents: () => void;
  onLogs: () => void;
}> = ({ m, capacity, capacityKnown, sessionsThisMonth, totalStudents, onStudents, onLogs }) => {
  const deltaTone = m.deltaPct == null ? 'var(--color-text-muted)' : m.deltaPct >= 0 ? GOOD : WARN;
  const half = Math.floor(m.series.length / 2);

  return (
    <motion.div variants={item} className="bento-card col-span-4">
      <PanelTitle icon={<Activity size={18} style={{ color: ACCENT }} />} text="Momentum" />
      <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: '1rem' }}>
        Completed sessions over the last {m.series.length} days.
      </p>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', marginBottom: '0.75rem' }}>
        <span style={{ fontSize: '2rem', fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
          {m.recent}
        </span>
        <span className="text-muted" style={{ fontSize: '0.78rem' }}>
          in the last {m.series.length - half} days
        </span>
      </div>
      <p style={{ fontSize: '0.78rem', color: deltaTone, fontWeight: 600, marginBottom: '1rem' }}>
        {m.deltaPct == null
          ? 'No prior period to compare against'
          : `${m.deltaPct >= 0 ? '▲' : '▼'} ${Math.abs(m.deltaPct).toFixed(0)}% vs the ${half} days before`}
      </p>

      <div style={{ height: 92 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={m.series} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
            <XAxis dataKey="label" hide />
            <Tooltip
              contentStyle={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'rgb(var(--ink) / 0.120)', borderRadius: 8, fontSize: 12 }}
              formatter={(v: unknown) => [`${v} completed`, '']}
              labelFormatter={(l: unknown) => String(l)}
            />
            {capacityKnown && capacity > 0 && (
              <ReferenceLine y={capacity} stroke="rgb(var(--ink) / 0.200)" strokeDasharray="4 3" />
            )}
            {/* minPointSize keeps an idle day visible as a faint stub. A
                zero-height bar is indistinguishable from a missing day, which
                would make a quiet fortnight look like a data gap. */}
            <Bar dataKey="completed" radius={[2, 2, 0, 0]} minPointSize={2}>
              {m.series.map(p => (
                <Cell key={p.day} fill={p.isToday ? GOOD : ACCENT} fillOpacity={p.completed === 0 ? 0.22 : 1} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-muted" style={{ fontSize: '0.68rem', marginTop: '0.3rem' }}>
        {capacityKnown && capacity > 0
          ? <>Dashed line marks the stated daily capacity of {capacity}. Today is green.</>
          : <>Today is green.</>}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginTop: '1rem' }}>
        <MiniStat k="Completed this month" v={sessionsThisMonth} onClick={onLogs} />
        <MiniStat k="Students on roll" v={totalStudents} onClick={onStudents} />
      </div>
      <p className="text-muted" style={{ fontSize: '0.68rem', marginTop: '0.6rem' }}>
        Counts completed sessions only — scheduled and draft rows are excluded, so this is work done
        rather than work planned.
      </p>
    </motion.div>
  );
};

const MiniStat: React.FC<{ k: string; v: React.ReactNode; onClick?: () => void }> = ({ k, v, onClick }) => (
  <div
    onClick={onClick}
    style={{
      backgroundColor: 'var(--color-bg)', padding: '0.7rem 0.8rem', borderRadius: 'var(--radius-md)',
      border: '1px solid var(--color-border)', cursor: onClick ? 'pointer' : 'default',
      transition: 'background-color 0.15s, border-color 0.15s'
    }}
    onMouseEnter={e => { if (onClick) { e.currentTarget.style.backgroundColor = 'rgb(var(--ink) / 0.032)'; e.currentTarget.style.borderColor = 'var(--border-active)'; } }}
    onMouseLeave={e => { if (onClick) { e.currentTarget.style.backgroundColor = 'var(--color-bg)'; e.currentTarget.style.borderColor = 'var(--color-border)'; } }}
  >
    <p style={{ ...label, marginBottom: '0.25rem' }}>{k}</p>
    <p style={{ fontSize: '1.4rem', fontWeight: 800, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
      {v}{onClick && <ChevronRight size={14} style={{ display: 'inline', marginLeft: 2, color: 'var(--text-muted)' }} />}
    </p>
  </div>
);

// ===========================================================================
//  6. What's ahead — the next few days, so the week is not a surprise
// ===========================================================================

export const AheadPanel: React.FC<{
  rows: DatedRow<ScheduledRow>[];
  followUps: DatedRow<FollowUpRow>[];
  onOpen: (id: string) => void;
  onOpenStudent: (sid: string) => void;
}> = ({ rows, followUps, onOpen, onOpenStudent }) => {
  const merged = [
    ...rows.slice(0, 5).map(r => ({ kind: 'session' as const, id: r.id, key: `s-${r.id}`, dayKey: r.dayKey!, name: r.student_name, reason: r.reason, sid: r.student_sid })),
    ...followUps.slice(0, 5).map(f => ({ kind: 'followup' as const, id: f.id, key: `f-${f.id}`, dayKey: f.dayKey!, name: f.student_name, reason: f.reason, sid: f.student_sid }))
  ].sort((a, b) => (a.dayKey < b.dayKey ? -1 : a.dayKey > b.dayKey ? 1 : 0)).slice(0, 6);

  return (
    <motion.div variants={item} className="bento-card col-span-5">
      <PanelTitle icon={<Clock size={18} style={{ color: ACCENT }} />} text="Coming up" />
      <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: '1rem' }}>
        The next scheduled sessions and follow-ups falling due.
      </p>

      {merged.length === 0 ? (
        <EmptyState icon={<Calendar size={40} />} text="Nothing scheduled ahead" sub="The diary is empty from tomorrow onwards." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {merged.map(x => (
            <RowShell
              key={x.key}
              onClick={() => x.kind === 'session' ? onOpen(x.id) : (x.sid && onOpenStudent(x.sid))}
            >
              <span style={{
                fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                color: x.kind === 'session' ? ACCENT : 'var(--text-muted)', width: 62, flexShrink: 0
              }}>
                {x.kind === 'session' ? 'Session' : 'Follow-up'}
              </span>
              <Identity name={x.name} sub={toSentenceCase(x.reason)} />
              <span className="text-muted" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {formatDisplayDate(x.dayKey)}
              </span>
            </RowShell>
          ))}
        </div>
      )}
    </motion.div>
  );
};

// ===========================================================================
//  7. High-risk watchlist — the counsellor's own flag, kept distinct from
//     the measured composite in DriftPanel. They answer different questions.
// ===========================================================================

export const WatchlistPanel: React.FC<{
  students: { id: string; full_name: string; student_id: string | null; course: string | null }[];
  onOpenStudent: (sid: string) => void;
  onViewAll: () => void;
}> = ({ students, onOpenStudent, onViewAll }) => (
  <motion.div variants={item} className="bento-card col-span-4" style={students.length > 0 ? { borderColor: 'rgba(245,91,91,0.22)' } : undefined}>
    <PanelTitle
      icon={<Users size={18} style={{ color: students.length ? BAD : 'var(--text-muted)' }} />}
      text="High-risk watchlist"
      right={students.length > 0 ? <CountChip n={students.length} tone={BAD} /> : undefined}
    />
    <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: '1rem' }}>
      Flagged by hand on the student record — independent of any computed score.
    </p>

    {students.length === 0 ? (
      <EmptyState icon={<CheckCircle2 size={40} color={GOOD} />} text="No student is flagged high risk" />
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {students.map(s => (
          <RowShell key={s.id} onClick={() => onOpenStudent(s.student_id ?? s.id)} tone={BAD}>
            <Identity name={s.full_name} sub={s.course ?? '—'} />
            <ChevronRight size={15} className="text-muted" style={{ flexShrink: 0 }} />
          </RowShell>
        ))}
        <button onClick={onViewAll} className="text-muted" style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.2rem', alignSelf: 'flex-start', marginTop: '0.3rem' }}>
          Open directory <ChevronRight size={14} />
        </button>
      </div>
    )}
  </motion.div>
);
