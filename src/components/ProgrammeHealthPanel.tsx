// =============================================================================
//  ProgrammeHealthPanel — presentational components for the school-wide
//  admin dashboard (/analytics).
//
//  Pure props-in / JSX-out. No Supabase, no page state (GUIDE §2.1).
//  Colour rule matches TelemetryPanel: ONE accent hue for data marks, neutral
//  grey for context/reference, status colours reserved for bands only.
//
//  The dashboard is split into MEASURED and MODELLED sections. Modelled panels
//  carry a visible assumption banner — a wrong capacity setting must never be
//  mistaken for an observation.
// =============================================================================

import React from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend,
  BarChart, Bar, ReferenceLine, Cell
} from 'recharts';
import {
  Scale, Users, Gauge, AlertTriangle, CalendarClock, Database, TrendingUp
} from 'lucide-react';
import type { StudentRollup, AllocationSummary, FeasibilityResult } from '../analytics/programmeHealth';

const ACCENT = '#2F5BD3';
const NEUTRAL = 'rgb(var(--ink) / 0.200)';
const GOOD = '#157A52';
const WARN = '#B25E09';
const BAD = '#B42318';

const label: React.CSSProperties = {
  fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em',
  color: 'var(--color-text-muted)', fontWeight: 700
};

const Stat: React.FC<{ k: string; v: React.ReactNode; sub?: string; tone?: string }> = ({ k, v, sub, tone }) => (
  <div style={{ backgroundColor: 'var(--color-bg)', padding: '0.75rem 0.875rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
    <p style={{ ...label, marginBottom: '0.3rem' }}>{k}</p>
    <p style={{ fontSize: '1.35rem', fontWeight: 800, lineHeight: 1.1, color: tone ?? 'var(--color-text)' }}>{v}</p>
    {sub && <p className="text-muted" style={{ fontSize: '0.7rem', marginTop: '0.25rem' }}>{sub}</p>}
  </div>
);

/** Marks a panel whose numbers depend on the self-reported capacity assumption. */
const ModelledBanner: React.FC<{ capacity: number; days: number; students: number }> = ({ capacity, days, students }) => (
  <div style={{
    display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.875rem',
    padding: '0.6rem 0.8rem', borderRadius: 'var(--radius-md)',
    backgroundColor: 'rgba(245,166,35,0.08)', border: '1px dashed rgba(245,166,35,0.35)',
    color: WARN, fontSize: '0.75rem'
  }}>
    <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
    <span>
      <strong>Modelled, not measured.</strong> Assumes {capacity} sessions/day · {days} working days/term ·
      {' '}{students} students. Capacity is a counsellor-reported planning figure — change it in Settings and
      every number here reflows.
    </span>
  </div>
);

// ---------------------------------------------------------------------------
//  1. Allocation Concentration — the headline. Capacity-independent.
// ---------------------------------------------------------------------------

export const AllocationPanel: React.FC<{ a: AllocationSummary }> = ({ a }) => {
  const curve = a.lorenzAll.map(p => ({ pop: Math.round(p.pop), actual: p.share, equal: p.pop }));
  const giniTone = (g: number | null) => g == null ? 'var(--color-text)' : g >= 0.6 ? BAD : g >= 0.4 ? WARN : GOOD;

  return (
    <div className="bento-card col-span-7">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
        <Scale size={18} style={{ color: ACCENT }} />
        <h3 className="text-h3" style={{ fontSize: '1rem', margin: 0 }}>Allocation Concentration</h3>
      </div>
      <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: '1rem' }}>
        How counselling time is distributed across students. Measured directly — independent of any capacity setting.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.6rem', marginBottom: '1rem' }}>
        <Stat k="Reach Gini" v={a.giniAll?.toFixed(3) ?? '—'} sub="incl. never-seen" tone={giniTone(a.giniAll)} />
        <Stat k="Depth Gini" v={a.giniSeen?.toFixed(3) ?? '—'} sub="among seen only" tone={giniTone(a.giniSeen)} />
        <Stat k="Busiest student" v={a.topStudentSharePct != null ? `${a.topStudentSharePct.toFixed(0)}%` : '—'} sub="of all sessions" />
        <Stat k="Never seen" v={a.neverSeen} sub={`of ${a.studentCount} students`} tone={a.neverSeen > 0 ? WARN : GOOD} />
      </div>

      <p style={{ ...label, marginBottom: '0.4rem' }}>Lorenz curve — session share vs student share</p>
      <div style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={curve} margin={{ top: 6, right: 10, bottom: 4, left: -18 }}>
            <XAxis dataKey="pop" type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
              tickLine={false} axisLine={false} label={{ value: '% of students', position: 'insideBottom', offset: -2, fontSize: 10, fill: 'var(--color-text-muted)' }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'rgb(var(--ink) / 0.120)', borderRadius: 8, fontSize: 12 }}
              formatter={(v, n) => [`${Number(v).toFixed(1)}%`, n === 'actual' ? 'Actual share' : 'Perfect equality']}
              labelFormatter={(l) => `${l}% of students`} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="equal" name="Perfect equality" stroke={NEUTRAL} strokeWidth={2} strokeDasharray="5 4" dot={false} />
            <Line type="monotone" dataKey="actual" name="Actual share" stroke={ACCENT} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-muted" style={{ fontSize: '0.7rem', marginTop: '0.4rem' }}>
        The further the solid line sags below the dashed diagonal, the more concentrated the counsellor's time.
        With capacity available, concentration is a <em>choice</em> — this shows which one is being made.
      </p>
    </div>
  );
};

// ---------------------------------------------------------------------------
//  2. Coverage & Recency — capacity-independent.
// ---------------------------------------------------------------------------

export const CoveragePanel: React.FC<{
  buckets: ReturnType<typeof import('../analytics/programmeHealth').recencyBuckets>;
  total: number;
}> = ({ buckets, total }) => {
  const rows = [
    { k: 'Seen in last 30 days', v: buckets.within30, tone: GOOD },
    { k: '31–60 days', v: buckets.d31to60, tone: ACCENT },
    { k: '61–90 days', v: buckets.d61to90, tone: WARN },
    { k: 'Over 90 days', v: buckets.over90, tone: BAD },
    { k: 'Never contacted', v: buckets.never, tone: BAD }
  ];
  const max = Math.max(...rows.map(r => r.v), 1);
  return (
    <div className="bento-card col-span-5">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
        <CalendarClock size={18} style={{ color: ACCENT }} />
        <h3 className="text-h3" style={{ fontSize: '1rem', margin: 0 }}>Contact Recency</h3>
      </div>
      <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: '1rem' }}>
        Time since last completed session, across all {total} enrolled students.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {rows.map(r => (
          <div key={r.k}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.22rem' }}>
              <span style={{ fontSize: '0.78rem' }}>{r.k}</span>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: r.tone }}>{r.v}</span>
            </div>
            <div style={{ height: 7, borderRadius: 4, backgroundColor: 'rgb(var(--ink) / 0.056)', overflow: 'hidden' }}>
              <div style={{ width: `${(r.v / max) * 100}%`, height: '100%', borderRadius: 4, backgroundColor: ACCENT }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
//  3. Feasibility — MODELLED.
// ---------------------------------------------------------------------------

export const FeasibilityPanel: React.FC<{
  now: FeasibilityResult; projected: FeasibilityResult;
  capacity: number; workingDays: number; currentN: number; plannedN: number;
  observedDepth: number; depthIsObserved: boolean;
  frontier: { depth: number; students: number }[];
}> = ({ now, projected, capacity, workingDays, currentN, plannedN, observedDepth, depthIsObserved, frontier }) => {
  const tone = (pct: number) => pct > 100 ? BAD : pct > 85 ? WARN : GOOD;
  return (
    <div className="bento-card col-span-7">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
        <Gauge size={18} style={{ color: ACCENT }} />
        <h3 className="text-h3" style={{ fontSize: '1rem', margin: 0 }}>Capacity Feasibility</h3>
      </div>
      <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: '0.75rem' }}>
        What service level one counsellor can sustain — today, and at full rollout.
      </p>
      <ModelledBanner capacity={capacity} days={workingDays} students={plannedN} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem', marginBottom: '1rem' }}>
        <Stat k="Capacity / term" v={now.capacityPerTerm.toLocaleString()} sub={`${capacity}/day × ${workingDays} days`} />
        <Stat k="Sessions / student" v={projected.sessionsPerStudentPerTerm.toFixed(2)} sub={`at ${plannedN} students`} />
        <Stat k="Binding population" v={projected.bindingPopulation} sub={`at ${observedDepth.toFixed(1)} sessions each`}
          tone={projected.bindingPopulation < plannedN ? WARN : GOOD} />
        <Stat k="Needed for full depth" v={`${projected.requiredCapacityForFullDepth.toFixed(1)}/day`}
          sub={projected.requiredCapacityForFullDepth > capacity ? 'above current setting' : 'within capacity'}
          tone={projected.requiredCapacityForFullDepth > capacity ? WARN : GOOD} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1rem' }}>
        {[
          { k: `Today — ${currentN} students enrolled`, pct: now.fullDepthUtilisationPct },
          { k: `Full rollout — ${plannedN} students`, pct: projected.fullDepthUtilisationPct }
        ].map(r => (
          <div key={r.k}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
              <span style={{ fontSize: '0.78rem' }}>{r.k}</span>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: tone(r.pct) }}>{r.pct.toFixed(0)}% of capacity</span>
            </div>
            <div style={{ height: 8, borderRadius: 4, backgroundColor: 'rgb(var(--ink) / 0.056)', overflow: 'hidden', position: 'relative' }}>
              <div style={{ width: `${Math.min(100, r.pct)}%`, height: '100%', borderRadius: 4, backgroundColor: tone(r.pct) }} />
              {r.pct > 100 && (
                <div style={{ position: 'absolute', right: 4, top: -1, fontSize: '0.6rem', fontWeight: 800, color: '#fff' }}>
                  +{(r.pct - 100).toFixed(0)}%
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <p style={{ ...label, marginBottom: '0.4rem' }}>
        Depth frontier — with every student getting one baseline contact
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        {frontier.map(f => (
          <div key={f.depth} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem',
            padding: '0.4rem 0.6rem', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgb(var(--ink) / 0.024)' }}>
            <span className="text-muted">{f.depth} sessions each for…</span>
            <strong>{f.students} students</strong>
          </div>
        ))}
      </div>
      <p className="text-muted" style={{ fontSize: '0.7rem', marginTop: '0.5rem' }}>
        Depth of {observedDepth.toFixed(1)} sessions is {depthIsObserved
          ? 'measured from students actually seen so far'
          : 'a fallback estimate — too few students seen to measure it yet'}.
      </p>
    </div>
  );
};

// ---------------------------------------------------------------------------
//  4. Throughput — measured, with the assumption drawn only as a reference line.
// ---------------------------------------------------------------------------

export const ThroughputPanel: React.FC<{
  daily: { day: string; completed: number }[];
  summary: ReturnType<typeof import('../analytics/programmeHealth').throughputSummary>;
  capacity: number;
}> = ({ daily, summary, capacity }) => {
  const data = daily.slice(-30).map(d => ({ day: d.day.slice(5), completed: d.completed }));
  return (
    <div className="bento-card col-span-5">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
        <TrendingUp size={18} style={{ color: ACCENT }} />
        <h3 className="text-h3" style={{ fontSize: '1rem', margin: 0 }}>Actual Throughput</h3>
      </div>
      <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: '0.875rem' }}>
        Completed sessions per active day. The dashed line is the assumed capacity.
      </p>

      {summary.suspectedBulkEntry && (
        <div style={{ padding: '0.6rem 0.8rem', borderRadius: 'var(--radius-md)', marginBottom: '0.75rem',
          backgroundColor: 'rgba(245,166,35,0.10)', border: '1px solid rgba(245,166,35,0.3)', color: WARN,
          fontSize: '0.75rem', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            <strong>Busiest day shows {summary.busiestDay} sessions</strong>, above the {capacity}/day capacity.
            That is almost certainly backdated bulk entry rather than clinical work — treat throughput figures
            as provisional until sessions are logged the day they happen.
          </span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '0.5rem', marginBottom: '0.875rem' }}>
        <Stat k="Completed" v={summary.total} sub="in window" />
        <Stat k="Active days" v={summary.activeDays} />
        <Stat k="Mean / active day" v={summary.meanPerActiveDay?.toFixed(1) ?? '—'} sub={`of ${capacity} capacity`} />
      </div>

      {data.length === 0 ? (
        <p className="text-muted" style={{ fontSize: '0.8rem' }}>No completed sessions in this window.</p>
      ) : (
        <div style={{ height: 130 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 6, bottom: 0, left: -22 }}>
              <XAxis dataKey="day" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: 'rgb(var(--ink) / 0.032)' }}
                contentStyle={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'rgb(var(--ink) / 0.120)', borderRadius: 8, fontSize: 12 }}
                formatter={(v) => [`${v} sessions`, 'Completed']} />
              <ReferenceLine y={capacity} stroke={NEUTRAL} strokeDasharray="4 4"
                label={{ value: `capacity ${capacity}`, position: 'insideTopRight', fontSize: 9, fill: 'var(--color-text-muted)' }} />
              <Bar dataKey="completed" radius={[3, 3, 0, 0]}>
                {data.map((d, i) => <Cell key={i} fill={d.completed > capacity ? WARN : ACCENT} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
//  5. Triage — students with measured need who have gone quiet.
// ---------------------------------------------------------------------------

export const TriagePanel: React.FC<{
  students: StudentRollup[];
  alignment: { rho: number | null; n: number; minRequired: number };
  onOpen: (studentId: string | null) => void;
}> = ({ students, alignment, onOpen }) => (
  <div className="bento-card col-span-7">
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
      <Users size={18} style={{ color: ACCENT }} />
      <h3 className="text-h3" style={{ fontSize: '1rem', margin: 0 }}>Need Not Recently Served</h3>
    </div>
    <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: '0.875rem' }}>
      Students with a trustworthy composite score who have not been seen in 30+ days.
    </p>

    <div style={{ padding: '0.6rem 0.8rem', borderRadius: 'var(--radius-md)', marginBottom: '0.875rem',
      backgroundColor: 'rgb(var(--ink) / 0.024)', border: '1px solid var(--color-border)', fontSize: '0.75rem' }}>
      <strong>Need–service alignment: </strong>
      {alignment.rho == null
        ? <span className="text-muted">
            not reported yet — needs at least {alignment.minRequired} students with a trustworthy composite
            (currently {alignment.n}). Below that a rank correlation is noise that would read like a finding.
          </span>
        : <>
            <span style={{ color: ACCENT, fontWeight: 700 }}>ρ = {alignment.rho.toFixed(2)}</span>
            <span className="text-muted"> across {alignment.n} students. </span>
            <span className="text-muted">
              Treat with caution: effective counselling lowers composite, so a student who was helped now looks
              low-need. A weak value is not by itself evidence of poor triage.
            </span>
          </>}
    </div>

    {students.length === 0 ? (
      <p className="text-muted" style={{ fontSize: '0.8rem' }}>
        No student with a trustworthy composite has gone 30+ days without contact.
      </p>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        {students.slice(0, 12).map(s => (
          <button key={s.student_uuid} onClick={() => onOpen(s.student_id)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem',
              padding: '0.5rem 0.7rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', textAlign: 'left',
              background: 'rgb(var(--ink) / 0.024)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, flex: 1 }}>
              {s.full_name ?? s.student_id}
              <span className="text-muted" style={{ fontWeight: 400 }}> · {s.course ?? '—'}</span>
            </span>
            <span style={{ fontSize: '0.75rem', color: WARN, whiteSpace: 'nowrap' }}>
              load {s.composite_score?.toFixed(0)}
            </span>
            <span className="text-muted" style={{ fontSize: '0.72rem', whiteSpace: 'nowrap', minWidth: 78, textAlign: 'right' }}>
              {s.days_since_contact == null ? 'never seen' : `${s.days_since_contact}d ago`}
            </span>
          </button>
        ))}
      </div>
    )}
  </div>
);

// ---------------------------------------------------------------------------
//  6. Data integrity — every figure above inherits these.
// ---------------------------------------------------------------------------

export const IntegrityPanel: React.FC<{ i: ProgrammeIntegrity }> = ({ i }) => {
  const items = [
    { k: 'Logs still in Draft', v: i.draft_logs, bad: i.draft_logs > 0,
      note: 'Sessions recorded but never written up.' },
    { k: 'Open follow-ups', v: i.followups_open, bad: false,
      note: `${i.followups_overdue} past their due date.` },
    { k: 'Scheduled backlog', v: i.open_scheduled, bad: i.overdue_scheduled > 0,
      note: `${i.overdue_scheduled} overdue.` },
    { k: 'Counsellor names on record', v: i.distinct_counsellor_names, bad: i.distinct_counsellor_names > 1,
      note: i.distinct_counsellor_names > 1
        ? 'Free-text field — a single counsellor should appear once. Extra names are typos or test rows.'
        : 'Consistent.' }
  ];
  return (
    <div className="bento-card col-span-5">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
        <Database size={18} style={{ color: ACCENT }} />
        <h3 className="text-h3" style={{ fontSize: '1rem', margin: 0 }}>Data Integrity</h3>
      </div>
      <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: '0.875rem' }}>
        Every figure on this page inherits these. Shown rather than averaged over.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
        {items.map(it => (
          <div key={it.k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem',
            padding: '0.55rem 0.7rem', borderRadius: 'var(--radius-sm)', background: 'rgb(var(--ink) / 0.024)' }}>
            <span style={{ fontSize: '0.78rem' }}>
              {it.k}
              <span className="text-muted" style={{ display: 'block', fontSize: '0.68rem', marginTop: 2 }}>{it.note}</span>
            </span>
            <strong style={{ fontSize: '0.95rem', color: it.bad ? WARN : 'var(--color-text)' }}>{it.v}</strong>
          </div>
        ))}
      </div>
    </div>
  );
};

export interface ProgrammeIntegrity {
  draft_logs: number; open_scheduled: number; overdue_scheduled: number; total_logs: number;
  followups_open: number; followups_overdue: number; phantom_pending: number;
  distinct_counsellor_names: number;
}
