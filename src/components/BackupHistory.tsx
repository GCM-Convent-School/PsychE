import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ExternalLink } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { supabase } from '../lib/supabase';

// Settings → Backups (admins). One row per run of the daily backup job
// (.github/workflows/daily_db_backup.yml), which writes PsychE_Backups with
// the service role. The point is to notice a missed or failed backup, so the
// header says plainly whether the last good one is recent enough.

type BackupRow = {
  id: number;
  started_at: string;
  finished_at: string;
  status: 'success' | 'failed';
  trigger: 'schedule' | 'manual';
  file_name: string | null;
  size_bytes: number | null;
  run_url: string | null;
  detail: string | null;
};

// The job runs daily; allow a few hours of slack before calling it overdue.
const OVERDUE_HOURS = 30;
const HISTORY_LIMIT = 60;

const formatSize = (bytes: number | null) => {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const cell: React.CSSProperties = { padding: '0.5rem', verticalAlign: 'top' };

export const BackupHistory: React.FC = () => {
  const [rows, setRows] = useState<BackupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadedAt, setLoadedAt] = useState(0);

  // setState only ever runs in the .then callback, never synchronously in the effect.
  const fetchRows = useCallback(() =>
    supabase
      .from('PsychE_Backups')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(HISTORY_LIMIT)
      .then(({ data, error }) => {
        if (error) {
          setError(error.code === '42P01' || /does not exist|schema cache/i.test(error.message)
            ? 'Backup tracking is not set up on this database yet. Run database/migrations/v17_backup_log.sql.'
            : `Could not load backups: ${error.message}`);
        } else {
          setError('');
          setRows((data ?? []) as BackupRow[]);
        }
        setLoadedAt(Date.now());
        setLoading(false);
      }), []);

  useEffect(() => { fetchRows(); }, [fetchRows]);
  const load = () => { setLoading(true); fetchRows(); };

  const lastGood = rows.find((r) => r.status === 'success');
  const latest = rows[0];
  const hoursSinceGood = lastGood ? (loadedAt - new Date(lastGood.finished_at).getTime()) / 36e5 : Infinity;

  let summary: { tone: 'green' | 'amber' | 'red'; title: string; body: string };
  if (!lastGood) {
    summary = { tone: 'red', title: 'No successful backup yet', body: 'The daily job has not completed a backup. Check the GitHub secrets and run it from the Actions tab.' };
  } else if (hoursSinceGood > OVERDUE_HOURS) {
    summary = { tone: 'red', title: 'Backups are overdue', body: `The last good backup was ${formatDistanceToNow(new Date(lastGood.finished_at))} ago. The daily job has stopped or is failing.` };
  } else if (latest && latest.status === 'failed') {
    summary = { tone: 'amber', title: 'Latest run failed', body: `The last good backup is from ${formatDistanceToNow(new Date(lastGood.finished_at))} ago, but the most recent run failed. Open it to see why.` };
  } else {
    summary = { tone: 'green', title: 'Backups are up to date', body: `Last good backup ${formatDistanceToNow(new Date(lastGood.finished_at))} ago (${lastGood.file_name ?? 'file'}, ${formatSize(lastGood.size_bytes)}).` };
  }

  return (
    <div className="bento-card" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2 className="text-h3" style={{ fontSize: '1rem' }}>Database backups</h2>
          <p className="text-muted" style={{ fontSize: '0.875rem' }}>
            The whole database is backed up every night at 3:30 AM, encrypted, and saved to the school&apos;s Google Drive.
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={load} disabled={loading} style={{ padding: '0.375rem 0.75rem' }}>
          <RefreshCw size={14} /> {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error ? (
        <p role="status" className="text-muted">{error}</p>
      ) : !loading && (
        <>
          <div role="status" className="row-card" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
            <span className={`pill pill--${summary.tone}`}>{summary.title}</span>
            <span className="text-muted" style={{ fontSize: '0.875rem' }}>{summary.body}</span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--color-text-muted)' }}>
                  <th style={cell}>When</th>
                  <th style={cell}>Result</th>
                  <th style={cell}>File</th>
                  <th style={cell}>Size</th>
                  <th style={cell}>Started by</th>
                  <th style={cell}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td style={{ ...cell, whiteSpace: 'nowrap' }}>{new Date(r.started_at).toLocaleString()}</td>
                    <td style={cell}>
                      <span className={`pill pill--${r.status === 'success' ? 'green' : 'red'}`}>{r.status === 'success' ? 'Saved' : 'Failed'}</span>
                      {r.detail && <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>{r.detail}</div>}
                    </td>
                    <td style={{ ...cell, fontFamily: 'monospace', fontSize: 12 }}>{r.file_name ?? '—'}</td>
                    <td style={cell}>{formatSize(r.size_bytes)}</td>
                    <td style={cell}>{r.trigger === 'schedule' ? 'Daily schedule' : 'Manual run'}</td>
                    <td style={{ ...cell, textAlign: 'right' }}>
                      {r.run_url && (
                        <a href={r.run_url} target="_blank" rel="noreferrer" className="text-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                          Log <ExternalLink size={12} />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="text-muted" style={cell}>No backup runs recorded yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};
