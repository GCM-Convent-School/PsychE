// =============================================================================
//  PsychE V12 — TimelineEntry (presentational)
//
//  One card in a session timeline. Shared by BOTH the Raw Timeline and the
//  Formal Timeline (History tab's Raw ↔ Formal toggle) — this is the direct
//  implementation of "Formal Reports are simply the formal version of Raw
//  timeline, same version in a more formal manner": one component renders
//  both, fed different text. Every non-text field (date, counsellor, status,
//  assessment data, follow-up) always comes from the raw log — only
//  reason/notes/action are ever overridden.
// =============================================================================

import React from 'react';
import { motion } from 'framer-motion';
import { parseISO } from 'date-fns';
import { BrainCircuit, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';

export interface TimelineEntryProps {
  log: any;
  overrideReason?: string | null;
  overrideNotes?: string | null;
  overrideAction?: string | null;
  /**
   * `undefined` (Raw Timeline) shows neither badge. `true`/`false` (Formal
   * Timeline) shows "Formalized" or "Not yet formalized" — a session in range
   * that hasn't been formalized yet is still rendered, with its raw text and
   * this badge, never hidden.
   */
  isFormalized?: boolean;
  isExpanded: boolean;
  onToggleExpand: (logId: string) => void;
  /** Raw-only — the Formal Timeline never shows Drafts (nothing to formalize). */
  onResumeDraft?: (log: any) => void;
  onFollowUpStatus?: (logId: string, status: 'Done' | 'Cancelled') => void;
  index: number;
}

export const TimelineEntry: React.FC<TimelineEntryProps> = ({
  log: item, overrideReason, overrideNotes, overrideAction, isFormalized,
  isExpanded, onToggleExpand, onResumeDraft, onFollowUpStatus, index,
}) => {
  const isDraft = item.session_status === 'Draft';
  const hasAssessments = item.assessment_data && item.assessment_data.length > 0;

  const reason = overrideReason !== undefined ? overrideReason : item.reason;
  const notes = overrideNotes !== undefined ? overrideNotes : item.student_response;
  const action = overrideAction !== undefined ? overrideAction : item.recommended_action;

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.1, type: 'spring', stiffness: 300 }}
      className="print-timeline-item"
      style={{ position: 'relative', paddingLeft: '2rem' }}
    >
      {/* Timeline Dot */}
      <div className="no-print" style={{
        position: 'absolute', left: '-21px', top: '5px', width: '12px', height: '12px', borderRadius: '50%',
        backgroundColor: isDraft ? 'var(--accent-amber)' : hasAssessments ? 'var(--accent-green)' : 'var(--color-primary)',
        border: '2px solid var(--color-surface)'
      }}></div>

      <div className="flex justify-between items-start mb-2">
        <div>
          <div className="flex items-center gap-2 mb-1">
            {isDraft && (
              <span style={{ fontSize: '0.75rem', padding: '0.1rem 0.5rem', backgroundColor: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: '4px', color: 'var(--accent-amber)' }}>
                Draft
              </span>
            )}
            <span style={{ fontSize: '0.75rem', padding: '0.1rem 0.5rem', backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '4px', color: 'var(--color-primary)' }}>
              {item.interaction_type || 'Session'}
            </span>
            {hasAssessments && !isDraft && (
              <span style={{ fontSize: '0.75rem', padding: '0.1rem 0.5rem', backgroundColor: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '4px', color: 'var(--accent-green)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <BrainCircuit size={10} /> Assessment
              </span>
            )}
            {isFormalized === true && (
              <span style={{ fontSize: '0.75rem', padding: '0.1rem 0.5rem', backgroundColor: 'rgba(155, 89, 245, 0.1)', border: '1px solid rgba(155, 89, 245, 0.2)', borderRadius: '4px', color: 'var(--accent-purple)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Sparkles size={10} /> Formalized
              </span>
            )}
            {isFormalized === false && (
              <span style={{ fontSize: '0.75rem', padding: '0.1rem 0.5rem', backgroundColor: 'rgb(var(--ink) / 0.040)', border: '1px solid var(--border-subtle)', borderRadius: '4px', color: 'var(--text-muted)' }}>
                Not yet formalized
              </span>
            )}
          </div>
          <h4 className="text-h3" style={{ fontSize: '1.25rem' }}>{reason}</h4>
          <p className="text-muted" style={{ fontSize: '0.875rem' }}>{item.counselor_name} • {new Date(item.session_date).toLocaleString()}</p>
        </div>

        {/* Action Button: Resume Draft or Expand Assessments */}
        {isDraft && onResumeDraft ? (
          <button
            onClick={() => onResumeDraft(item)}
            className="btn btn-secondary"
            style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem', color: 'var(--accent-amber)', borderColor: 'transparent', backgroundColor: 'rgba(245, 158, 11, 0.1)' }}
          >
            Resume Draft
          </button>
        ) : hasAssessments ? (
          <button
            onClick={() => onToggleExpand(item.id)}
            className="btn btn-secondary"
            style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem', backgroundColor: 'transparent', border: '1px solid var(--color-border)' }}
          >
            {isExpanded ? <><ChevronUp size={14} /> Collapse</> : <><ChevronDown size={14} /> Expand</>}
          </button>
        ) : null}
      </div>

      {/* Collapsed Assessment View */}
      {!isDraft && hasAssessments && !isExpanded && (
        <div style={{ backgroundColor: 'rgba(16, 185, 129, 0.05)', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(16, 185, 129, 0.2)', display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
          {(item.assessment_data as any[]).map((a: any, i: number) => {
            const rawScoreValues = Object.values(a.responses) as number[];
            const totalScore = rawScoreValues.reduce((sum, val) => sum + (val || 0), 0);
            const totalQs = a.total_questions || 8;
            const maxPossible = (a.type === 'COMPE' || a.type === 'MIX') ? totalQs * 4 : 'N/A';
            const percentage = maxPossible !== 'N/A' && maxPossible > 0 ? Math.round((totalScore / (maxPossible as number)) * 100) : null;
            return (
              <span key={i} style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--accent-green)' }}>
                {a.title}: {percentage !== null ? `${percentage}%` : totalScore}
              </span>
            );
          })}
        </div>
      )}

      {/* Expanded Notes and Receipt */}
      {(!hasAssessments || isExpanded) && !isDraft && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="print-notes"
          style={{ backgroundColor: 'var(--color-bg)', padding: '1.25rem', borderRadius: 'var(--radius-md)', marginTop: '0.5rem', border: '1px solid var(--color-border)', overflow: 'hidden' }}
        >
          <div className="mb-4">
            <p className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '0.5rem', letterSpacing: '0.05em' }}>Session Notes & Student Response</p>
            <p className="text-body" style={{ whiteSpace: 'pre-line', lineHeight: '1.6' }}>{notes || 'No notes provided.'}</p>
          </div>

          {hasAssessments && (
            <div className="mb-4">
              <p className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '0.5rem', letterSpacing: '0.05em' }}>Full Assessment Receipt</p>
              {(item.assessment_data as any[]).map((a: any, i: number) => (
                <div key={i} style={{ backgroundColor: 'var(--bg-tertiary)', padding: '1rem', borderRadius: 'var(--radius-sm)', marginBottom: '0.5rem' }}>
                  <h5 style={{ fontSize: '0.875rem', color: 'var(--color-primary)', marginBottom: '0.75rem' }}>{a.title}</h5>
                  {Object.entries(a.responses).map(([q, ans]: any, j) => (
                    <div key={j} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', backgroundColor: 'rgb(var(--ink) / 0.016)', borderRadius: '4px', fontSize: '0.875rem', marginBottom: '2px' }}>
                      <span style={{ color: 'var(--color-text-muted)', flex: 1, paddingRight: '1rem' }}>{q}</span>
                      <strong style={{ color: 'var(--accent-green)', minWidth: '30px', textAlign: 'right' }}>{ans}</strong>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-4 flex-wrap">
            <div className="print-action" style={{ flex: 1, backgroundColor: 'rgba(74, 222, 128, 0.1)', color: 'var(--color-success)', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', fontSize: '0.875rem', fontWeight: 500, minWidth: '200px' }}>
              <span style={{ fontSize: '0.75rem', display: 'block', opacity: 0.8, marginBottom: '4px', letterSpacing: '0.05em' }}>RECOMMENDED ACTION</span>
              {action || 'None'}
            </div>
            {item.follow_up_date && (() => {
              const st = item.follow_up_status || 'Pending';
              const closed = st === 'Done' || st === 'Cancelled';
              const tone = st === 'Done' ? { bg: 'rgba(63, 201, 143, 0.1)', fg: 'var(--color-success)' }
                : st === 'Cancelled' ? { bg: 'rgb(var(--ink) / 0.032)', fg: 'var(--color-text-muted)' }
                  : { bg: 'rgba(245, 158, 11, 0.1)', fg: 'var(--accent-amber)' };
              return (
                <div className="print-action" style={{ flex: 1, backgroundColor: tone.bg, color: tone.fg, padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', fontSize: '0.875rem', fontWeight: 500, minWidth: '200px' }}>
                  <span style={{ fontSize: '0.75rem', display: 'block', opacity: 0.8, marginBottom: '4px', letterSpacing: '0.05em' }}>FOLLOW-UP ({st})</span>
                  {parseISO(item.follow_up_date).toLocaleDateString()}
                  {!closed && onFollowUpStatus && (
                    <div className="no-print" style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); onFollowUpStatus(item.id, 'Done'); }}
                        style={{ cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, padding: '0.2rem 0.6rem', borderRadius: 'var(--radius-full)', border: '1px solid rgba(63,201,143,0.4)', background: 'rgba(63,201,143,0.12)', color: 'var(--color-success)' }}
                        title="Mark this follow-up as completed — restores the student's follow-through score"
                      >✓ Mark Done</button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onFollowUpStatus(item.id, 'Cancelled'); }}
                        style={{ cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, padding: '0.2rem 0.6rem', borderRadius: 'var(--radius-full)', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)' }}
                        title="No longer required"
                      >Cancel</button>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
};
