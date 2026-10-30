import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { daysBetween, todayKey } from '../analytics/operationalDay';
import type { CaseOutcome, NeedLevel, StudentJourney } from '../types';

// Student profile → where this student is on the journey, and the two moves a
// counsellor makes here: open a case (with a need level) or close it (with an
// outcome). Closing sets the 90-day review on its own (V16 trigger), except for
// "all clear" and "left school". Renders nothing before V16 is installed.

const STAGE_LABEL: Record<StudentJourney['stage'], string> = {
  not_seen: 'Not seen yet', open: 'Open case', review_due: 'Review due', regular: 'Regular',
};
const NEEDS: NeedLevel[] = ['urgent', 'support', 'watch'];
const NEED_LABEL: Record<NeedLevel, string> = { urgent: 'Urgent', support: 'Support', watch: 'Watch' };
const OUTCOMES: { value: CaseOutcome; label: string }[] = [
  { value: 'all_clear', label: 'All clear' },
  { value: 'improved', label: 'Improved' },
  { value: 'referred_out', label: 'Referred to a specialist' },
  { value: 'no_longer_needed', label: 'No longer needed' },
  { value: 'parent_declined', label: 'Parent declined' },
  { value: 'left_school', label: 'Left school' },
];

export const JourneyStrip: React.FC<{ studentUuid: string }> = ({ studentUuid }) => {
  const [row, setRow] = useState<StudentJourney | null>(null);
  const [missing, setMissing] = useState(false);
  const [mode, setMode] = useState<'idle' | 'open' | 'close'>('idle');
  const [need, setNeed] = useState<NeedLevel>('support');
  const [outcome, setOutcome] = useState<CaseOutcome>('improved');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('PsychE_Student_Journey').select('*').eq('student_uuid', studentUuid).maybeSingle();
    if (error) { setMissing(true); return; }
    setRow(data as StudentJourney | null);
  }, [studentUuid]);

  useEffect(() => { load(); }, [load]);

  if (missing || !row) return null;

  const today = todayKey();
  let due = '';
  if (row.next_due_on) {
    const d = daysBetween(today, row.next_due_on);
    due = d < 0 ? `${-d} day${d === -1 ? '' : 's'} late` : d === 0 ? 'due today' : `next due ${new Date(`${row.next_due_on}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
  }

  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>, done: string) => {
    setBusy(true);
    setNotice('');
    const { error } = await fn();
    setBusy(false);
    if (error) { setNotice(`Could not save: ${error.message}`); return; }
    setNotice(done);
    setMode('idle');
    setNote('');
    await load();
  };

  const openCase = () => run(
    () => supabase.from('PsychE_Cases').insert({ student_uuid: studentUuid, need_level: need, source: 'counsellor' }),
    `Case opened at ${NEED_LABEL[need].toLowerCase()} level.`,
  );
  const changeNeed = (lvl: NeedLevel) => row.case_id && run(
    () => supabase.from('PsychE_Cases').update({ need_level: lvl }).eq('id', row.case_id!),
    `Need level is now ${NEED_LABEL[lvl].toLowerCase()}.`,
  );
  const closeCase = () => row.case_id && run(
    () => supabase.from('PsychE_Cases').update({ status: 'closed', outcome, closure_note: note.trim() || null }).eq('id', row.case_id!),
    outcome === 'all_clear' || outcome === 'left_school' ? 'Case closed.' : 'Case closed. A review is booked in for 90 days.',
  );

  return (
    <section className="glass no-print" style={{ marginBottom: '1.25rem', padding: 14, borderRadius: 24, display: 'flex', flexDirection: 'column', gap: 12 }} aria-label="Journey">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <span className="chip chip--plain">{STAGE_LABEL[row.stage]}</span>
        {row.stage === 'open' && row.need_level && (
          <span className={`chip chip--${row.need_level}`}><span className={`need-dot need-dot--${row.need_level}`} aria-hidden="true" />{NEED_LABEL[row.need_level]}</span>
        )}
        {due && <span className={row.overdue && (row.stage === 'open' || row.stage === 'review_due') ? 'chip chip--late' : 'chip chip--plain'}>{row.stage === 'regular' && row.overdue ? 'check-in overdue' : due}</span>}
        {row.new_referrals > 0 && <span className="chip chip--support">{row.new_referrals} teacher note{row.new_referrals === 1 ? '' : 's'} waiting</span>}
        <span style={{ flex: 1 }} />
        {row.stage === 'open' ? (
          <>
            <label className="text-muted" htmlFor="need-level" style={{ fontSize: 13 }}>Need</label>
            <select id="need-level" className="input" style={{ width: 'auto', borderRadius: 999, minHeight: 40 }} disabled={busy}
              value={row.need_level ?? 'support'} onChange={(e) => changeNeed(e.target.value as NeedLevel)}>
              {NEEDS.map((n) => <option key={n} value={n}>{NEED_LABEL[n]}</option>)}
            </select>
            <button type="button" className="btn btn-secondary" onClick={() => setMode(mode === 'close' ? 'idle' : 'close')}>Close case</button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => setMode(mode === 'open' ? 'idle' : 'open')}>Open a case</button>
        )}
      </div>

      {mode === 'open' && (
        <div className="row-card">
          <span style={{ fontWeight: 700, fontSize: 14 }}>How much support?</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} role="radiogroup" aria-label="Need level">
            {NEEDS.map((n) => (
              <button key={n} type="button" role="radio" aria-checked={need === n} onClick={() => setNeed(n)}
                className={`chip chip--${need === n ? n : 'plain'}`} style={{ minHeight: 36, cursor: 'pointer' }}>
                <span className={`need-dot need-dot--${n}`} aria-hidden="true" />{NEED_LABEL[n]}
              </button>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-primary" disabled={busy} onClick={openCase}>{busy ? 'Opening…' : 'Open case'}</button>
        </div>
      )}

      {mode === 'close' && (
        <div className="row-card" style={{ alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 600 }}>
            Outcome
            <select className="input" style={{ minWidth: 200 }} value={outcome} onChange={(e) => setOutcome(e.target.value as CaseOutcome)}>
              {OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 600, flex: '1 1 220px' }}>
            Closing note (optional)
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed" />
          </label>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={closeCase}>{busy ? 'Closing…' : 'Close case'}</button>
        </div>
      )}

      {notice && <p role="status" style={{ fontSize: 13, color: notice.startsWith('Could') ? 'var(--accent-red)' : 'var(--accent-green)' }}>{notice}</p>}
    </section>
  );
};
