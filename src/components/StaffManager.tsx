import React, { useEffect, useState } from 'react';
import { UserPlus, Send, Power } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth, type StaffRole } from '../lib/auth';

// Settings → Staff (admins only; RLS enforces it too).
// Adding a person saves their row and texts them a personal 4-digit work code.
// Switching someone off takes effect on their next request: every RLS check
// requires an active staff row.

interface StaffRow {
  id: string;
  full_name: string;
  mobile: string;
  role: StaffRole;
  active: boolean;
  last_login_at: string | null;
}

const ROLE_LABEL: Record<StaffRole, string> = {
  counsellor: 'Counsellor',
  principal: 'Principal (from Release 3)',
  admin: 'Admin',
};

async function sendCode(staffId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('send-work-code', { body: { staffId } });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    try {
      const body = ctx ? await ctx.json() : null;
      return body?.error ?? 'Could not send the code.';
    } catch {
      return 'Could not send the code.';
    }
  }
  return data?.message ?? 'Code sent.';
}

function fetchStaff() {
  return supabase
    .from('PsychE_Staff')
    .select('id, full_name, mobile, role, active, last_login_at')
    .order('full_name')
    .returns<StaffRow[]>();
}

export const StaffManager: React.FC = () => {
  const { staff: me } = useAuth();
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [role, setRole] = useState<StaffRole>('counsellor');

  const load = async () => {
    const { data, error } = await fetchStaff();
    if (error) setNotice(`Could not load staff: ${error.message}`);
    setRows(data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    let alive = true;
    fetchStaff().then(({ data, error }) => {
      if (!alive) return;
      if (error) setNotice(`Could not load staff: ${error.message}`);
      setRows(data ?? []);
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  const mobileDigits = mobile.replace(/\D/g, '').slice(-10);
  const canAdd = name.trim().length > 1 && mobileDigits.length === 10 && busyId === null;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAdd) return;
    setBusyId('new');
    setNotice('');
    const { data, error } = await supabase
      .from('PsychE_Staff')
      .insert({ full_name: name.trim(), mobile: mobileDigits, role })
      .select('id')
      .single();
    if (error || !data) {
      setNotice(error?.code === '23505' ? 'That mobile number is already on the staff list.' : `Could not add: ${error?.message}`);
    } else {
      setNotice(`${name.trim()} added. ${await sendCode(data.id)}`);
      setName('');
      setMobile('');
      setRole('counsellor');
      await load();
    }
    setBusyId(null);
  };

  const handleSendCode = async (row: StaffRow) => {
    if (!window.confirm(`Send ${row.full_name} a new work code? Their current code will stop working.`)) return;
    setBusyId(row.id);
    setNotice(await sendCode(row.id));
    setBusyId(null);
  };

  const handleToggle = async (row: StaffRow) => {
    if (row.id === me?.id) {
      setNotice('You cannot switch off your own account.');
      return;
    }
    setBusyId(row.id);
    const { error } = await supabase.from('PsychE_Staff').update({ active: !row.active }).eq('id', row.id);
    setNotice(error ? `Could not update: ${error.message}` : `${row.full_name} is now ${row.active ? 'switched off' : 'active'}.`);
    await load();
    setBusyId(null);
  };

  return (
    <div className="bento-card" style={{ padding: '2rem' }}>
      <h2 className="text-h3" style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Add a staff member</h2>
      <p className="text-muted mb-4" style={{ fontSize: '0.875rem' }}>
        They sign in with this mobile number and a 4-digit work code, which is sent to them by SMS now.
      </p>
      <form onSubmit={handleAdd} className="flex gap-2 flex-wrap mb-6" style={{ alignItems: 'flex-end' }}>
        <input className="input" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} style={{ maxWidth: '220px' }} aria-label="Full name" />
        <input className="input" type="tel" inputMode="numeric" placeholder="10-digit mobile" value={mobile}
          onChange={(e) => setMobile(e.target.value)} style={{ maxWidth: '180px' }} aria-label="Mobile number" />
        <select className="input" value={role} onChange={(e) => setRole(e.target.value as StaffRole)} style={{ maxWidth: '160px' }} aria-label="Role">
          <option value="counsellor">Counsellor</option>
          <option value="admin">Admin</option>
        </select>
        <button type="submit" disabled={!canAdd} className="btn btn-primary" style={{ padding: '0.5rem 1rem', opacity: canAdd ? 1 : 0.6 }}>
          <UserPlus size={16} /> {busyId === 'new' ? 'Adding…' : 'Add & send code'}
        </button>
      </form>

      {notice && <p role="status" className="mb-4" style={{ fontSize: '0.875rem' }}>{notice}</p>}

      {loading ? (
        <p className="text-muted">Loading staff…</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--color-text-muted)' }}>
                <th style={{ padding: '0.5rem' }}>Name</th>
                <th style={{ padding: '0.5rem' }}>Mobile</th>
                <th style={{ padding: '0.5rem' }}>Role</th>
                <th style={{ padding: '0.5rem' }}>Last sign-in</th>
                <th style={{ padding: '0.5rem' }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} style={{ borderTop: '1px solid var(--color-border)', opacity: row.active ? 1 : 0.55 }}>
                  <td style={{ padding: '0.5rem' }}>{row.full_name}{row.id === me?.id ? ' (you)' : ''}</td>
                  <td style={{ padding: '0.5rem' }}>{row.mobile}</td>
                  <td style={{ padding: '0.5rem' }}>{ROLE_LABEL[row.role]}{row.active ? '' : ' · off'}</td>
                  <td style={{ padding: '0.5rem' }}>{row.last_login_at ? new Date(row.last_login_at).toLocaleString() : 'Never'}</td>
                  <td style={{ padding: '0.5rem', whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {row.active && (
                      <button type="button" className="btn btn-secondary" disabled={busyId !== null}
                        onClick={() => handleSendCode(row)} style={{ padding: '0.25rem 0.625rem', marginRight: '0.5rem' }}>
                        <Send size={14} /> New code
                      </button>
                    )}
                    {row.id !== me?.id && (
                      <button type="button" className="btn btn-secondary" disabled={busyId !== null}
                        onClick={() => handleToggle(row)} style={{ padding: '0.25rem 0.625rem' }}>
                        <Power size={14} /> {row.active ? 'Switch off' : 'Switch on'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={5} className="text-muted" style={{ padding: '0.5rem' }}>No staff yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
