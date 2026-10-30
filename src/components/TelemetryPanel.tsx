// =============================================================================
//  TelemetryPanel — presentational components for the Telemetry Analytics tab
//
//  Pure props-in / JSX-out. No Supabase calls, no page-level state (per
//  GUIDE_developer.md §2.1). All fetching lives in StudentProfile.tsx.
//
//  COLOR RULE (see GUIDE_developer.md §9): a single accent hue carries every
//  data mark; neutral grey carries context (peer bars, empty states); the
//  status colours (green/amber/red) are RESERVED for load/coverage bands and
//  are never used to distinguish one series from another. A two-hue
//  categorical palette was tested and rejected — blue↔purple scored a
//  normal-vision ΔE of 13.3, below the 15 floor, so identity is carried by
//  position, labels, and mark type instead of by hue.
// =============================================================================

import React from 'react';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts';
import {
  ResponsiveContainer as RC, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar
} from 'recharts';
import { AlertTriangle, TrendingUp, TrendingDown, Minus, Users, Gauge, Activity, ShieldCheck } from 'lucide-react';

const ACCENT = '#2F5BD3';          // every data mark
const NEUTRAL = 'rgb(var(--ink) / 0.176)'; // context / peers
const GOOD = '#157A52';
const WARN = '#B25E09';
const BAD = '#B42318';

const DOMAIN_LABELS: Record<string, string> = {
  BHV: 'Behavioural', SOC: 'Social', COG: 'Cognitive', EMH: 'Emotional',
  FAM: 'Family', CAR: 'Career', SEL: 'Self & Identity'
};

const card: React.CSSProperties = {};
const label: React.CSSProperties = {
  fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em',
  color: 'var(--color-text-muted)', fontWeight: 700
};

function Delta({ value, invert }: { value: number | null | undefined; invert?: boolean }) {
  if (value == null || Math.abs(value) < 0.05) {
    return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}><Minus size={12} /> no change</span>;
  }
  // invert = higher is worse (composite). Otherwise higher is better (ETI).
  const improving = invert ? value < 0 : value > 0;
  const color = improving ? GOOD : BAD;
  const Icon = value > 0 ? TrendingUp : TrendingDown;
  return (
    <span style={{ color, fontSize: '0.75rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
      <Icon size={12} />{value > 0 ? '+' : ''}{value.toFixed(1)}
    </span>
  );
}

// ---------------------------------------------------------------------------
//  1. Evidence strip — persistent confidence context for the whole page
// ---------------------------------------------------------------------------

export interface EvidenceStripProps {
  engineStatus?: string;
  measuredDomains: number;      // domains with a score for THIS student
  instrumentedDomains: number;  // domains that have any active question at all
  totalDomains: number;
  compositeConfidence?: number | null;
  lastAssessment?: string | null;
  uninstrumentedDomains: string[];
}

export const EvidenceStrip: React.FC<EvidenceStripProps> = ({
  engineStatus, measuredDomains, instrumentedDomains, totalDomains,
  compositeConfidence, lastAssessment, uninstrumentedDomains
}) => {
  const statusTone: Record<string, string> = {
    active: GOOD, warming: WARN, assessment_only: WARN, stale: BAD, cold_start: 'var(--color-text-muted)'
  };
  const tone = statusTone[engineStatus ?? ''] ?? 'var(--color-text-muted)';
  const cells = [
    { k: 'Engine status', v: (engineStatus ?? 'unknown').replace('_', ' '), tone },
    { k: 'Domains measured', v: `${measuredDomains} of ${totalDomains}`, tone: measuredDomains >= 4 ? GOOD : WARN },
    { k: 'Composite evidence', v: compositeConfidence != null ? `${Math.round(compositeConfidence * 4)} of 4 parts` : '—', tone: (compositeConfidence ?? 0) >= 0.5 ? GOOD : WARN },
    { k: 'Last assessment', v: lastAssessment ? new Date(lastAssessment).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'never', tone: 'var(--color-text)' }
  ];

  return (
    <div className="bento-card col-span-12" style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.875rem' }}>
        <ShieldCheck size={18} style={{ color: ACCENT }} />
        <h3 className="text-h3" style={{ fontSize: '1rem', margin: 0 }}>Evidence Coverage</h3>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
        {cells.map(c => (
          <div key={c.k} style={{ backgroundColor: 'var(--color-bg)', padding: '0.75rem 0.875rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
            <p style={{ ...label, marginBottom: '0.3rem' }}>{c.k}</p>
            <p style={{ fontSize: '1rem', fontWeight: 700, color: c.tone, textTransform: 'capitalize' }}>{c.v}</p>
          </div>
        ))}
      </div>

      {uninstrumentedDomains.length > 0 && (
        <div style={{
          marginTop: '0.875rem', padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)',
          backgroundColor: 'rgba(245, 166, 35, 0.10)', border: '1px solid rgba(245, 166, 35, 0.3)',
          color: WARN, fontSize: '0.8125rem', display: 'flex', alignItems: 'flex-start', gap: '0.6rem'
        }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
          <span>
            <strong>{uninstrumentedDomains.length} of {totalDomains} domains have no assessment items yet</strong>
            {' '}({uninstrumentedDomains.map(d => DOMAIN_LABELS[d] ?? d).join(', ')}).
            These can never be scored for any student until modules are built for them, so this profile is
            necessarily partial — read the shape below as incomplete, not as a finding.
            Only {instrumentedDomains} of {totalDomains} domains are measurable at all.
          </span>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
//  2. Domain profile — radar + ranked strengths/concerns
// ---------------------------------------------------------------------------

export interface DomainProfileProps {
  domainScores: Record<string, number | null>;
  instrumented: Record<string, boolean>;
  archetype?: string;
  isWarming?: boolean;
  confidenceMultiplier?: number;
}

export const DomainProfile: React.FC<DomainProfileProps> = ({
  domainScores, instrumented, isWarming, confidenceMultiplier = 1
}) => {
  const codes = Object.keys(DOMAIN_LABELS);
  const radarData = codes.map(c => ({
    domain: DOMAIN_LABELS[c],
    score: domainScores[c] != null ? Math.round((domainScores[c] as number) * 100) : 0
  }));

  const scored = codes
    .filter(c => domainScores[c] != null)
    .map(c => ({ code: c, pct: Math.round((domainScores[c] as number) * 100) }))
    .sort((a, b) => a.pct - b.pct); // weakest first

  return (
    <div className="bento-card col-span-7">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Activity size={18} style={{ color: ACCENT }} />
          <h3 className="text-h3" style={{ fontSize: '1rem', margin: 0 }}>Domain Profile</h3>
        </div>
        {isWarming && (
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: WARN, backgroundColor: 'rgba(245,166,35,0.15)', border: '1px solid rgba(245,166,35,0.3)', padding: '0.2rem 0.6rem', borderRadius: 'var(--radius-full)' }}>
            Building profile — {Math.round(confidenceMultiplier * 100)}% confidence
          </span>
        )}
      </div>
      <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: '0.75rem' }}>
        90-day rolling window. Higher is healthier.
      </p>

      <div style={{ height: 230, width: '100%' }}>
        <RC width="100%" height="100%">
          <RadarChart cx="50%" cy="50%" outerRadius="76%" data={radarData}>
            <PolarGrid stroke="rgb(var(--ink) / 0.096)" />
            <PolarAngleAxis dataKey="domain" tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} />
            <PolarRadiusAxis angle={30} domain={[0, 100]} stroke="rgb(var(--ink) / 0.120)" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} />
            <Radar dataKey="score" stroke={ACCENT} fill={ACCENT} fillOpacity={0.3} />
            <Tooltip contentStyle={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'rgb(var(--ink) / 0.120)', borderRadius: 8, fontSize: 12 }} formatter={(v) => [`${v}%`, 'Score']} />
          </RadarChart>
        </RC>
      </div>

      <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {scored.length === 0 && (
          <p className="text-muted" style={{ fontSize: '0.8125rem' }}>No domain has been scored yet.</p>
        )}
        {scored.map((d, i) => (
          <div key={d.code} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ fontSize: '0.75rem', width: 96, flexShrink: 0, color: i === 0 ? BAD : 'var(--color-text)', fontWeight: i === 0 ? 700 : 500 }}>
              {DOMAIN_LABELS[d.code]}
            </span>
            <div style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: 'rgb(var(--ink) / 0.056)', overflow: 'hidden' }}>
              <div style={{ width: `${d.pct}%`, height: '100%', borderRadius: 3, backgroundColor: ACCENT }} />
            </div>
            <span style={{ fontSize: '0.75rem', width: 34, textAlign: 'right', color: 'var(--color-text-muted)' }}>{d.pct}%</span>
          </div>
        ))}
        {codes.filter(c => domainScores[c] == null).map(c => (
          <div key={c} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', opacity: 0.5 }}>
            <span style={{ fontSize: '0.75rem', width: 96, flexShrink: 0, color: 'var(--color-text-muted)' }}>{DOMAIN_LABELS[c]}</span>
            <div style={{ flex: 1, height: 6, borderRadius: 3, border: '1px dashed rgb(var(--ink) / 0.120)' }} />
            <span style={{ fontSize: '0.6875rem', width: 90, textAlign: 'right', color: 'var(--color-text-muted)' }}>
              {instrumented[c] ? 'not assessed' : 'no items'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
//  3. Tension strip — signed diverging bars
// ---------------------------------------------------------------------------

export interface TensionAxis {
  key: string; left: string; right: string; label: string;
  value: number | null | undefined; positive: string; negative: string;
  available: boolean;
}

export const TensionStrip: React.FC<{ axes: TensionAxis[]; threshold: number; dominantKey?: string | null }> = ({ axes, threshold, dominantKey }) => (
  <div className="bento-card col-span-5">
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
      <AlertTriangle size={18} style={{ color: ACCENT }} />
      <h3 className="text-h3" style={{ fontSize: '1rem', margin: 0 }}>Cross-Domain Tension</h3>
    </div>
    <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: '1rem' }}>
      Where the profile disagrees with itself. Direction carries meaning — read which side the bar leans.
    </p>

    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
      {axes.map(a => {
        const v = a.value;
        const pct = v != null ? Math.min(50, Math.abs(v) * 100 / 2) : 0; // half-width scale
        const flagged = v != null && Math.abs(v) > threshold;
        const isDominant = dominantKey === a.key;
        return (
          <div key={a.key} style={{ opacity: a.available ? 1 : 0.4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.3rem' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: flagged ? WARN : 'var(--color-text)' }}>
                {a.label}{isDominant && <span style={{ color: ACCENT, fontWeight: 700 }}> · dominant</span>}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                {v != null ? `${v > 0 ? '+' : ''}${Math.round(v * 100)} pts` : (a.available ? 'not scored' : 'no items')}
              </span>
            </div>

            <div style={{ position: 'relative', height: 16, display: 'flex', alignItems: 'center' }}>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center' }}>
                <div style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgb(var(--ink) / 0.048)' }} />
              </div>
              {/* centre tick */}
              <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, backgroundColor: 'rgb(var(--ink) / 0.200)' }} />
              {v != null && (
                <div style={{
                  position: 'absolute',
                  left: v >= 0 ? '50%' : `${50 - pct}%`,
                  width: `${pct}%`, height: 8, borderRadius: 4,
                  backgroundColor: flagged ? WARN : ACCENT
                }} />
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.25rem' }}>
              <span style={{ fontSize: '0.625rem', color: 'var(--color-text-muted)' }}>← {a.left}</span>
              <span style={{ fontSize: '0.625rem', color: 'var(--color-text-muted)' }}>{a.right} →</span>
            </div>

            {flagged && (
              <p style={{ fontSize: '0.75rem', color: WARN, marginTop: '0.35rem', lineHeight: 1.45 }}>
                {(v as number) > 0 ? a.positive : a.negative}
              </p>
            )}
          </div>
        );
      })}
    </div>
  </div>
);

// ---------------------------------------------------------------------------
//  4. Engagement panel — ETI + sparkline + drivers
// ---------------------------------------------------------------------------

export interface EngagementPanelProps {
  eti?: number | null;
  attendance: number; followThrough: number; recency: number;
  avoidanceFlag?: boolean; avoidanceRatio?: number;
  history: { date: string; eti: number | null }[];
  delta?: number | null;
}

export const EngagementPanel: React.FC<EngagementPanelProps> = ({
  eti, attendance, followThrough, recency, avoidanceFlag, avoidanceRatio, history, delta
}) => {
  const points = history.filter(h => h.eti != null);
  // "Engagement driver" sentence — highest and lowest contributing ratio
  const parts = [
    { name: 'attendance', v: attendance },
    { name: 'follow-through', v: followThrough },
    { name: 'recency', v: recency }
  ].sort((a, b) => b.v - a.v);
  const driver = eti == null ? null
    : `${parts[0].v >= 70 ? 'Strong' : parts[0].v >= 40 ? 'Moderate' : 'Weak'} ${parts[0].name}, ${parts[2].v >= 70 ? 'strong' : parts[2].v >= 40 ? 'moderate' : 'weak'} ${parts[2].name}.`;

  return (
    <div className="bento-card col-span-12">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Activity size={18} style={{ color: ACCENT }} />
          <h3 className="text-h3" style={{ fontSize: '1rem', margin: 0 }}>Engagement (ETI)</h3>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem' }}>
          <span style={{ fontSize: '1.75rem', fontWeight: 700, lineHeight: 1 }}>
            {eti != null ? eti : '—'}<span style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', fontWeight: 500 }}> / 100</span>
          </span>
          <Delta value={delta} />
        </div>
      </div>

      {driver && <p className="text-muted" style={{ fontSize: '0.8125rem', marginTop: '0.35rem' }}>{driver}</p>}

      {avoidanceFlag && (
        <div style={{
          marginTop: '0.75rem', padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)',
          backgroundColor: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
          color: BAD, fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: '0.6rem', fontWeight: 600
        }}>
          <AlertTriangle size={16} /> Chronic no-show pattern ({avoidanceRatio ?? 0}% avoidance)
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.1fr)', gap: '1.25rem', marginTop: '1rem', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {[
            { k: 'Attendance', v: attendance },
            { k: 'Follow-through', v: followThrough },
            { k: 'Recency', v: recency }
          ].map(r => (
            <div key={r.k}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text)' }}>{r.k}</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{r.v}%</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, backgroundColor: 'rgb(var(--ink) / 0.056)', overflow: 'hidden' }}>
                <div style={{ width: `${r.v}%`, height: '100%', borderRadius: 3, backgroundColor: ACCENT }} />
              </div>
            </div>
          ))}
        </div>

        <div>
          <p style={{ ...label, marginBottom: '0.4rem' }}>30-day trend</p>
          {points.length < 2 ? (
            <div style={{
              height: 96, borderRadius: 'var(--radius-md)', border: '1px dashed var(--color-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 1rem'
            }}>
              <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                Not enough history yet — {points.length} snapshot{points.length === 1 ? '' : 's'} recorded.
                A trend appears once the nightly batch has run on at least two days.
              </span>
            </div>
          ) : (
            <div style={{ height: 96 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={points} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
                  <XAxis dataKey="date" hide />
                  <YAxis domain={[0, 100]} hide />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'rgb(var(--ink) / 0.120)', borderRadius: 8, fontSize: 12 }}
                    formatter={(v) => [`${v}`, 'ETI']}
                  />
                  <Line type="monotone" dataKey="eti" stroke={ACCENT} strokeWidth={2} dot={{ r: 3, fill: ACCENT }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
//  5. Composite contribution — what is actually driving the number
// ---------------------------------------------------------------------------

export interface CompositeContributionProps {
  score?: number | null;
  confidence: number;
  minConfidence: number;
  parts: { dd: number | null; wd: number | null; ts: number | null; ed: number | null };
  delta?: number | null;
}

const WEIGHTS = { dd: 0.44, wd: 0.28, ts: 0.17, ed: 0.11 };
const PART_LABELS = { dd: 'Breadth of difficulty', wd: 'Worst single domain', ts: 'Profile inconsistency', ed: 'Disengagement' };

export const CompositeContribution: React.FC<CompositeContributionProps> = ({
  score, confidence, minConfidence, parts, delta
}) => {
  if (score == null) return null;
  const gated = confidence < minConfidence;

  const active = (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[])
    .filter(k => parts[k] != null)
    .map(k => ({ k, label: PART_LABELS[k], raw: parts[k] as number, weight: WEIGHTS[k] }));
  const weightSum = active.reduce((s, a) => s + a.weight, 0) || 1;
  const rows = active
    .map(a => ({ ...a, contribution: (a.raw * a.weight) / weightSum }))
    .sort((a, b) => b.contribution - a.contribution);
  const maxContribution = Math.max(...rows.map(r => r.contribution), 1);

  let band = 'Low Load', bandColor = GOOD;
  if (score > 75) { band = 'High Load'; bandColor = BAD; }
  else if (score > 50) { band = 'Elevated Load'; bandColor = WARN; }
  else if (score > 25) { band = 'Moderate Load'; bandColor = ACCENT; }

  return (
    <div className="bento-card col-span-6">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
        <Gauge size={18} style={{ color: ACCENT }} />
        <h3 className="text-h3" style={{ fontSize: '1rem', margin: 0 }}>Composite Load</h3>
      </div>
      <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: '0.875rem' }}>
        Overall psychological load. Higher means more load.
      </p>

      {gated ? (
        <div style={{ padding: '1rem 1.25rem', borderRadius: 'var(--radius-md)', backgroundColor: 'rgb(var(--ink) / 0.024)', border: '1px dashed var(--color-border)', marginBottom: '0.875rem' }}>
          <p style={{ fontWeight: 600, fontSize: '0.925rem', marginBottom: '0.35rem' }}>Insufficient Assessment Data</p>
          <p className="text-muted" style={{ fontSize: '0.8125rem' }}>
            Only {Math.round(confidence * 4)} of 4 components available — at least 2 are needed before an
            overall load score can be reported. The contributions below show what little exists, and do not
            add up to a clinical picture on their own.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', marginBottom: '0.875rem' }}>
          <span style={{ fontSize: '2.25rem', fontWeight: 700, lineHeight: 1 }}>
            {score}<span style={{ fontSize: '1.1rem', color: 'var(--color-text-muted)', fontWeight: 500 }}> / 100</span>
          </span>
          <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: bandColor, padding: '0.2rem 0.6rem', borderRadius: 'var(--radius-full)', backgroundColor: `${bandColor}20` }}>{band}</span>
          <Delta value={delta} invert />
        </div>
      )}

      <p style={{ ...label, marginBottom: '0.5rem' }}>Weighted contribution</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
        {rows.map(r => (
          <div key={r.k}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.22rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text)' }}>{r.label}</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                {r.contribution.toFixed(1)} pts <span style={{ opacity: 0.6 }}>· raw {r.raw.toFixed(0)} × {Math.round(r.weight * 100)}%</span>
              </span>
            </div>
            <div style={{ height: 8, borderRadius: 4, backgroundColor: 'rgb(var(--ink) / 0.056)', overflow: 'hidden' }}>
              <div style={{ width: `${(r.contribution / maxContribution) * 100}%`, height: '100%', borderRadius: 4, backgroundColor: ACCENT }} />
            </div>
          </div>
        ))}
        {(Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).filter(k => parts[k] == null).map(k => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', opacity: 0.45 }}>
            <span style={{ fontSize: '0.75rem' }}>{PART_LABELS[k]}</span>
            <span style={{ fontSize: '0.75rem' }}>not available</span>
          </div>
        ))}
      </div>
      <p className="text-muted" style={{ fontSize: '0.6875rem', marginTop: '0.75rem' }}>
        Weights renormalise over available components. Contributions sum to the score above.
      </p>
    </div>
  );
};

// ---------------------------------------------------------------------------
//  6. RSI panel — distribution when eligible, readiness otherwise
// ---------------------------------------------------------------------------

export interface RsiPanelProps {
  rsi?: number | null;
  reason?: string;
  cohortLevel?: string | null;
  cohortSize?: number | null;
  eligiblePeers: number;
  totalPeers: number;
  requiredPeers: number;
  peerScores: number[];      // composite scores of eligible peers
  studentComposite?: number | null;
  confidence: number;
  minConfidence: number;
}

export const RsiPanel: React.FC<RsiPanelProps> = ({
  rsi, reason, cohortLevel, cohortSize, eligiblePeers, totalPeers, requiredPeers,
  peerScores, studentComposite, confidence, minConfidence
}) => {
  const header = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
        <Users size={18} style={{ color: ACCENT }} />
        <h3 className="text-h3" style={{ fontSize: '1rem', margin: 0 }}>Relative Standing (RSI)</h3>
      </div>
      <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: '0.875rem' }}>
        Position within a comparable peer group. Relative only — never an absolute measure.
      </p>
    </>
  );

  // -- State A: gated by this student's own evidence --------------------------
  if (reason === 'insufficient_confidence' || (rsi == null && confidence < minConfidence)) {
    return (
      <div className="bento-card col-span-6">
        {header}
        <div style={{ padding: '1rem 1.25rem', borderRadius: 'var(--radius-md)', backgroundColor: 'rgb(var(--ink) / 0.024)', border: '1px dashed var(--color-border)' }}>
          <p style={{ fontWeight: 600, fontSize: '0.925rem', marginBottom: '0.4rem' }}>Profile not comparable yet</p>
          <p className="text-muted" style={{ fontSize: '0.8125rem', marginBottom: '0.75rem' }}>
            Ranking requires comparable evidence on both sides. This student's composite rests on
            {' '}{Math.round(confidence * 4)} of 4 components — below the {Math.round(minConfidence * 4)}-component minimum.
          </p>
          <div style={{ height: 6, borderRadius: 3, backgroundColor: 'rgb(var(--ink) / 0.056)', overflow: 'hidden' }}>
            <div style={{ width: `${(confidence / minConfidence) * 100}%`, height: '100%', borderRadius: 3, backgroundColor: WARN }} />
          </div>
          <p className="text-muted" style={{ fontSize: '0.6875rem', marginTop: '0.4rem' }}>
            {Math.round(confidence * 4)} of {Math.round(minConfidence * 4)} components needed
          </p>
        </div>
      </div>
    );
  }

  // -- State B: cohort not yet large enough -----------------------------------
  if (rsi == null) {
    // The SQL floor (n >= requiredPeers) counts this student too, so the cohort
    // is eligible peers + self. Display the same number the engine gates on.
    const cohortNow = eligiblePeers + 1;
    const stillNeeded = Math.max(0, requiredPeers - cohortNow);
    const pct = Math.min(100, (cohortNow / requiredPeers) * 100);
    return (
      <div className="bento-card col-span-6">
        {header}
        <div style={{ padding: '1rem 1.25rem', borderRadius: 'var(--radius-md)', backgroundColor: 'rgb(var(--ink) / 0.024)', border: '1px dashed var(--color-border)' }}>
          <p style={{ fontWeight: 600, fontSize: '0.925rem', marginBottom: '0.4rem' }}>Cohort not ready</p>
          <p className="text-muted" style={{ fontSize: '0.8125rem', marginBottom: '0.75rem' }}>
            A percentile needs at least {requiredPeers} students with a sufficiently complete profile.
            Below that the ranking is too coarse to mean anything.
          </p>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginBottom: '0.35rem' }}>
            <span style={{ fontSize: '1.5rem', fontWeight: 700, color: ACCENT }}>{cohortNow}</span>
            <span className="text-muted" style={{ fontSize: '0.8125rem' }}>of {requiredPeers} comparable students</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, backgroundColor: 'rgb(var(--ink) / 0.056)', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', borderRadius: 4, backgroundColor: ACCENT }} />
          </div>
          <p className="text-muted" style={{ fontSize: '0.6875rem', marginTop: '0.5rem' }}>
            {totalPeers + 1} students enrolled · {cohortNow} currently meet the evidence floor (this student included).
            {stillNeeded > 0 && ` ${stillNeeded} more needed.`}
          </p>
        </div>
      </div>
    );
  }

  // -- State C: computed — show the distribution ------------------------------
  const BIN = 10;
  // The top bin is inclusive of 100 — a composite of exactly 100 is reachable
  // (a fully-distressed single-domain profile) and must not fall through.
  const bins = Array.from({ length: 10 }, (_, i) => {
    const lo = i * BIN, hi = (i + 1) * BIN;
    const isTop = i === 9;
    return {
      bin: `${lo}`, lo, hi,
      count: peerScores.filter(s => s >= lo && (isTop ? s <= hi : s < hi)).length
    };
  });
  const studentBin = studentComposite != null ? Math.min(9, Math.floor(studentComposite / BIN)) : -1;

  let band = 'Significant Outlier', bandColor = BAD;
  if (rsi >= 75) { band = 'Relatively Thriving'; bandColor = GOOD; }
  else if (rsi >= 40) { band = 'Within Normal Range'; bandColor = ACCENT; }
  else if (rsi >= 15) { band = 'Below Peer Norm'; bandColor = WARN; }

  const levelLabel = cohortLevel === 'course' ? 'class section' : cohortLevel === 'grade' ? 'grade level' : 'whole school';

  return (
    <div className="bento-card col-span-6">
      {header}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <span style={{ fontSize: '2.25rem', fontWeight: 700, lineHeight: 1 }}>
          {rsi}<span style={{ fontSize: '1.1rem', color: 'var(--color-text-muted)', fontWeight: 500 }}> / 100</span>
        </span>
        <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: bandColor, padding: '0.2rem 0.6rem', borderRadius: 'var(--radius-full)', backgroundColor: `${bandColor}20` }}>{band}</span>
      </div>

      <p style={{ ...label, marginBottom: '0.4rem' }}>Peer composite distribution</p>
      <div style={{ height: 120 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bins} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <XAxis dataKey="bin" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} />
            <YAxis hide />
            <Tooltip
              cursor={{ fill: 'rgb(var(--ink) / 0.032)' }}
              contentStyle={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'rgb(var(--ink) / 0.120)', borderRadius: 8, fontSize: 12 }}
              formatter={(v) => [`${v} peer${Number(v) === 1 ? '' : 's'}`, 'Count']}
              labelFormatter={(l) => `Composite ${l}–${Number(l) + BIN}`}
            />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {bins.map((_, i) => (
                <Cell key={i} fill={i === studentBin ? ACCENT : NEUTRAL} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <p className="text-muted" style={{ fontSize: '0.6875rem', marginTop: '0.4rem' }}>
        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, backgroundColor: ACCENT, marginRight: 4 }} />
        This student's band. Bars count the {Math.max(0, (cohortSize ?? 1) - 1)} other students in the
        cohort ({cohortSize} including this one) at the {levelLabel} level.
        Always read alongside Composite Load — RSI is relative only.
      </p>
    </div>
  );
};
