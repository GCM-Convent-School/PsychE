// =============================================================================
//  PsychE V12 — PrintSessionCard
//
//  One session's card in a print export. Extracted, unchanged in layout, from
//  ReportExport.tsx's original inline map body — used by BOTH ReportExport.tsx
//  (raw) and FormalReportExport.tsx (formal), which is why reason/notes/action
//  are overridable: the formal export passes the rewritten text; the raw
//  export passes nothing and gets the log's own fields.
// =============================================================================

import React from 'react';
import { parseISO } from 'date-fns';

export interface PrintSessionCardProps {
  log: any;
  reasonText?: string | null;
  notesText?: string | null;
  actionText?: string | null;
  /** Shown only by the Formal export, for a session that has no formalized row yet. */
  notFormalizedNote?: boolean;
}

export const PrintSessionCard: React.FC<PrintSessionCardProps> = ({
  log, reasonText, notesText, actionText, notFormalizedNote = false,
}) => {
  const hasAssessments = log.assessment_data && log.assessment_data.length > 0;
  const reason = reasonText !== undefined ? reasonText : log.reason;
  const notes = notesText !== undefined ? notesText : log.student_response;
  const action = actionText !== undefined ? actionText : log.recommended_action;

  return (
    <div style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed #ccc', paddingBottom: '0.5rem', marginBottom: '1rem' }}>
        <div>
          <span style={{ fontWeight: 'bold', fontSize: '1.1rem', display: 'block' }}>{new Date(log.session_date).toLocaleDateString()} - {log.interaction_type}</span>
          <span style={{ fontSize: '0.875rem', color: '#555' }}>Counselor: {log.counselor_name}</span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ fontWeight: 'bold', display: 'block' }}>Ref: {log.id.split('-')[0].toUpperCase()}</span>
        </div>
      </div>

      <div style={{ paddingLeft: '1rem', borderLeft: '3px solid #eee' }}>
        <p style={{ margin: '0 0 1rem 0', fontWeight: 'bold' }}>Reason: {reason}</p>

        {notFormalizedNote && (
          <p style={{ margin: '0 0 1rem 0', fontSize: '0.8rem', fontStyle: 'italic', color: '#a05a00' }}>
            (Not yet formalized — showing raw text)
          </p>
        )}

        {notes && (
          <div style={{ marginBottom: '1rem' }}>
            <strong style={{ fontSize: '0.875rem', display: 'block', marginBottom: '0.25rem' }}>
              {notFormalizedNote ? 'Synthesis Notes:' : 'Synthesis Notes:'}
            </strong>
            <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: '1.5', whiteSpace: 'pre-line' }}>{notes}</p>
          </div>
        )}

        {hasAssessments && (
          <div style={{ marginTop: '1.5rem' }}>
            <strong style={{ fontSize: '0.875rem', display: 'block', marginBottom: '0.5rem', borderBottom: '1px solid #ddd', paddingBottom: '0.25rem' }}>Assessment Receipts</strong>

            {log.assessment_data.map((a: any, i: number) => {
              const rawScoreValues = Object.values(a.responses) as number[];
              const totalScore = rawScoreValues.reduce((sum, val) => sum + (val || 0), 0);
              const totalQs = a.total_questions || 8;
              const maxPossible = (a.type === 'COMPE' || a.type === 'MIX') ? totalQs * 4 : 'N/A';
              const percentage = maxPossible !== 'N/A' && maxPossible > 0 ? Math.round((totalScore / (maxPossible as number)) * 100) : null;

              return (
                <div key={i} className="table-scroll" style={{ overflowX: 'auto', marginBottom: '1.5rem', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-md)', padding: '1rem', border: '1px solid var(--color-border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <strong style={{ fontSize: '1rem' }}>{a.title}</strong>
                    <strong>Score: {percentage !== null ? `${percentage}%` : totalScore}</strong>
                  </div>

                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                    <tbody>
                      {Object.entries(a.responses).map(([q, ans]: any, j) => (
                        <tr key={j} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={{ padding: '0.4rem 0', color: '#444' }}>{q}</td>
                          <td style={{ padding: '0.4rem 0', textAlign: 'right', fontWeight: 'bold', width: '50px' }}>{ans}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}

        {(action || log.follow_up_date) && (
          <div style={{ display: 'flex', gap: '2rem', marginTop: '1rem', fontSize: '0.875rem', backgroundColor: '#f9f9f9', padding: '0.75rem', borderLeft: '2px solid #ccc' }}>
            {action && <div><strong>Action:</strong> {action}</div>}
            {log.follow_up_date && <div><strong>Scheduled Follow-up:</strong> {parseISO(log.follow_up_date).toLocaleDateString()}</div>}
          </div>
        )}
      </div>
    </div>
  );
};
