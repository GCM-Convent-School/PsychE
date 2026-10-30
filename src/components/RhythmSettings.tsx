import React, { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { supabase } from '../lib/supabase';

// Settings → Follow-up rhythm (admins). Every school sets its own; the journey
// view reads these on every query, so a change shows on Home straight away.

type RhythmKey =
  | 'urgent_first_contact_days' | 'followup_days_urgent' | 'followup_days_support'
  | 'followup_days_watch' | 'post_closure_review_days' | 'routine_checkin_days';

const FIELDS: { key: RhythmKey; label: string; help: string; dot?: 'urgent' | 'support' | 'watch' }[] = [
  { key: 'urgent_first_contact_days', label: 'Urgent: first contact within', help: 'After an urgent case opens.', dot: 'urgent' },
  { key: 'followup_days_urgent', label: 'Urgent: then see every', help: 'Until the need level drops.', dot: 'urgent' },
  { key: 'followup_days_support', label: 'Support: see every', help: 'Regular follow-ups for support cases.', dot: 'support' },
  { key: 'followup_days_watch', label: 'Watch: see every', help: 'Light-touch check while you keep an eye out.', dot: 'watch' },
  { key: 'post_closure_review_days', label: 'Review after closing a case', help: 'One check-in to confirm the student is still all right. Not used for "all clear".' },
  { key: 'routine_checkin_days', label: 'Regular students: check in every', help: 'About one per term for students with no open case.' },
];

type Rhythm = Record<RhythmKey, number>;

export const RhythmSettings: React.FC = () => {
  const [values, setValues] = useState<Rhythm | null>(null);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from('PsychE_Settings').select(FIELDS.map((f) => f.key).join(', ')).eq('id', 1).maybeSingle()
      .then(({ data, error }) => {
        if (error) setNotice(`Could not load the rhythm: ${error.message}`);
        else if (data) setValues(data as unknown as Rhythm);
      });
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!values) return;
    setSaving(true);
    const { error } = await supabase.from('PsychE_Settings').update(values).eq('id', 1);
    setNotice(error ? `Could not save: ${error.message}` : 'Saved. Home uses the new rhythm now.');
    setSaving(false);
  };

  if (!values) return <div className="bento-card"><p className="text-muted">{notice || 'Loading…'}</p></div>;

  return (
    <form className="bento-card" onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div>
        <h2 className="text-h3" style={{ fontSize: '1rem' }}>Follow-up rhythm</h2>
        <p className="text-muted">How often each student should be seen. A student whose date passes shows as late on Home.</p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
        {FIELDS.map((f) => (
          <label key={f.key} className="row-card" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 8 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14 }}>
              {f.dot && <span className={`need-dot need-dot--${f.dot}`} aria-hidden="true" />}{f.label}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="number" min={1} max={365} required className="input" style={{ width: 96 }}
                value={values[f.key]} onChange={(e) => setValues({ ...values, [f.key]: parseInt(e.target.value) || 1 })} />
              <span className="text-muted">days</span>
            </span>
            <span className="text-muted" style={{ fontSize: 12 }}>{f.help}</span>
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button type="submit" className="btn btn-primary" disabled={saving}><Save size={16} /> {saving ? 'Saving…' : 'Save rhythm'}</button>
        {notice && <span role="status" className="text-muted">{notice}</span>}
      </div>
    </form>
  );
};
