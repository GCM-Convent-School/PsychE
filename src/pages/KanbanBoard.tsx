import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LayoutDashboard, AlertCircle, CheckCircle2, XCircle, Trash2, Calendar, CalendarClock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { parseISO } from 'date-fns';
import { supabase } from '../lib/supabase';
import { getAvailableCapacityForDateRange, toLocalDateStr } from '../lib/capacity';
import { isOverdue, getWeekdayName, isSunday } from '../utils/dateFormatter';

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.1 } }
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 }
};

// ── Reschedule Modal ────────────────────────────────────────────────────────
interface RescheduleModalProps {
  studentName: string;
  currentDate: string;
  onConfirm: (newDate: string) => Promise<void>;
  onClose: () => void;
}

const RescheduleModal: React.FC<RescheduleModalProps> = ({ studentName, currentDate, onConfirm, onClose }) => {
  const [selectedDate, setSelectedDate] = useState(currentDate || '');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the date input on mount
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleConfirm = async () => {
    if (!selectedDate) return;
    setSaving(true);
    try {
      await onConfirm(selectedDate);
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 900,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.72)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)'
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.93, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0, transition: { type: 'spring', stiffness: 380, damping: 28 } }}
        exit={{ opacity: 0, scale: 0.93, y: 20 }}
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: '420px',
          backgroundColor: 'var(--color-surface)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
          overflow: 'hidden'
        }}
      >
        {/* Modal Header */}
        <div style={{
          padding: '1.5rem 1.75rem 1.25rem',
          borderBottom: '1px solid rgba(255,255,255,0.07)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.375rem' }}>
            <div style={{ padding: '0.5rem', borderRadius: '10px', backgroundColor: 'rgba(94,106,210,0.15)', display: 'flex' }}>
              <CalendarClock size={18} style={{ color: 'var(--color-primary)' }} />
            </div>
            <h2 style={{ fontSize: '1.0625rem', fontWeight: 700, margin: 0 }}>Reschedule Session</h2>
          </div>
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', paddingLeft: '2.75rem', lineHeight: 1.5 }}>
            Pick a new date for <strong style={{ color: 'var(--color-text)' }}>{studentName}</strong>'s session.
            The existing slot will be freed.
          </p>
        </div>

        {/* Date Picker Body */}
        <div style={{ padding: '1.5rem 1.75rem' }}>
          <label style={{
            display: 'block',
            fontSize: '0.75rem', fontWeight: 700,
            letterSpacing: '0.07em', textTransform: 'uppercase',
            color: 'var(--color-text-muted)',
            marginBottom: '0.625rem'
          }}>
            New Session Date
          </label>
          <input
            ref={inputRef}
            type="date"
            className="input"
            value={selectedDate}
            min={toLocalDateStr(new Date())}
            onChange={e => setSelectedDate(e.target.value)}
            style={{ fontSize: '1rem', padding: '0.75rem 1rem', letterSpacing: '0.03em' }}
          />
          {selectedDate && (
            <p style={{
              display: 'flex', alignItems: 'center', gap: '0.35rem',
              marginTop: '0.5rem', fontSize: '0.8125rem', fontWeight: isSunday(selectedDate) ? 700 : 400,
              color: isSunday(selectedDate) ? '#f87171' : 'var(--color-text-muted)'
            }}>
              {isSunday(selectedDate) && <AlertCircle size={13} />}
              {new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(selectedDate + 'T12:00:00'))}
              {isSunday(selectedDate) ? ' — Sunday' : ''}
            </p>
          )}
        </div>

        {/* Actions Footer */}
        <div style={{
          padding: '1.125rem 1.75rem 1.5rem',
          borderTop: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', gap: '0.75rem', justifyContent: 'flex-end'
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '0.625rem 1.25rem', borderRadius: 'var(--radius-md)',
              fontSize: '0.875rem', fontWeight: 600,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'var(--color-text-muted)', cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = 'var(--color-text)'; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedDate || saving}
            style={{
              padding: '0.625rem 1.375rem', borderRadius: 'var(--radius-md)',
              fontSize: '0.875rem', fontWeight: 700,
              background: !selectedDate ? 'rgba(94,106,210,0.3)' : 'linear-gradient(135deg, var(--color-primary), #8b5cf6)',
              border: 'none',
              color: !selectedDate ? 'rgba(255,255,255,0.35)' : 'white',
              cursor: !selectedDate ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease',
              display: 'flex', alignItems: 'center', gap: '0.4rem'
            }}
          >
            <CalendarClock size={15} />
            {saving ? 'Saving…' : 'Confirm Date'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

// ── Icon Action Button ───────────────────────────────────────────────────────
interface ActionIconProps {
  icon: React.ReactNode;
  tooltip: string;
  onClick: (e: React.MouseEvent) => void;
  variant?: 'default' | 'danger' | 'primary';
}

const ActionIcon: React.FC<ActionIconProps> = ({ icon, tooltip, onClick, variant = 'default' }) => {
  const colors = {
    default: { base: 'rgba(255,255,255,0)', hover: 'rgba(255,255,255,0.1)', icon: 'rgba(255,255,255,0.45)', iconHover: 'rgba(255,255,255,0.9)' },
    danger:  { base: 'rgba(239,68,68,0)', hover: 'rgba(239,68,68,0.15)', icon: 'rgba(239,68,68,0.55)', iconHover: '#f87171' },
    primary: { base: 'rgba(94,106,210,0)', hover: 'rgba(94,106,210,0.18)', icon: 'rgba(94,106,210,0.7)', iconHover: '#818cf8' },
  }[variant];

  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      title={tooltip}
      aria-label={tooltip}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: '30px', height: '30px',
        borderRadius: '8px',
        backgroundColor: hovered ? colors.hover : colors.base,
        border: 'none', cursor: 'pointer',
        color: hovered ? colors.iconHover : colors.icon,
        transition: 'all 0.18s ease',
        flexShrink: 0
      }}
    >
      {icon}
    </button>
  );
};

// ── Main Component ───────────────────────────────────────────────────────────
export const KanbanBoard: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [boardDays, setBoardDays] = useState<any[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  // Reschedule modal state
  const [rescheduleTarget, setRescheduleTarget] = useState<{ id: string; studentName: string; currentDate: string } | null>(null);

  useEffect(() => {
    document.title = 'UPsych : GCM Edition | Planner';
  }, []);

  useEffect(() => {
    async function fetchBoardData() {
      // Build a local-timezone-safe ISO date string (YYYY-MM-DD)
      // IMPORTANT: toISOString() is UTC-based and shifts day in +05:30 timezones.
      // We use local year/month/day components instead.
      const toLocalDateStr = (d: Date): string => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      };

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const endDate = new Date(today);
      endDate.setDate(endDate.getDate() + 6);
      const endStr = toLocalDateStr(endDate);

      const capacityData = await getAvailableCapacityForDateRange(today, 7);

      const { data: logsData, error: logsError } = await supabase
        .from('PsychE_Counseling_Logs')
        .select(`id, scheduled_date, reason, student_uuid, PsychE_Students (full_name, risk_level, engagement_modifier, student_id)`)
        .eq('session_status', 'Scheduled')
        .order('scheduled_date', { ascending: true });

      if (logsError) console.error('Error fetching logs:', logsError);

      const daysArray: any[] = [];

      const overdueLogs = (logsData || []).filter(log => isOverdue(log.scheduled_date));
      if (overdueLogs.length > 0) {
        daysArray.push({
          dateStr: 'overdue', label: 'Overdue', isOverdue: true,
          // Overdue column has no capacity limit
          capacity: { booked: overdueLogs.length, total: overdueLogs.length },
          logs: overdueLogs
        });
      }

      for (let i = 0; i < 7; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() + i);
        const dStr = toLocalDateStr(d);
        const dayLogs = (logsData || []).filter(log => log.scheduled_date === dStr);
        // Null-guard: capacityData[dStr] may be undefined if Supabase errored
        const cap = capacityData[dStr] ?? { total: 7, booked: dayLogs.length, available: Math.max(0, 7 - dayLogs.length) };
        daysArray.push({
          dateStr: dStr,
          label: i === 0
            ? `Today · ${getWeekdayName(dStr, 'short')}`
            : `${getWeekdayName(dStr, 'short')} · ${new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d)}`,
          isOverdue: false,
          isSundayCol: isSunday(dStr),
          capacity: cap,
          logs: dayLogs
        });
      }

      const laterLogs = (logsData || []).filter(log => !isOverdue(log.scheduled_date) && log.scheduled_date > endStr);
      if (laterLogs.length > 0 || true) {
        daysArray.push({
          dateStr: 'later',
          label: 'Scheduled for later',
          isOverdue: false,
          capacity: { booked: laterLogs.length, total: laterLogs.length },
          logs: laterLogs
        });
      }

      setBoardDays(daysArray);
      setLoading(false);
    }
    fetchBoardData();
  }, [refreshKey]);

  // ── Drag & Drop ──
  const handleDragStart = (e: React.DragEvent, logId: string) => {
    e.dataTransfer.setData('text/plain', logId);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => { (e.target as HTMLElement).style.opacity = '0.5'; }, 0);
  };
  const handleDragEnd = (e: React.DragEvent) => { (e.target as HTMLElement).style.opacity = '1'; };
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };

  const handleDrop = async (e: React.DragEvent, targetDateStr: string, isOverdueCol: boolean, booked: number, total: number) => {
    e.preventDefault();
    const logId = e.dataTransfer.getData('text/plain');
    if (!logId) return;
    if (isOverdueCol || targetDateStr === 'later') { alert("Cannot drop a session into this column. Please select a specific date."); return; }
    if (booked >= total && !window.confirm(`This day is at full capacity (${booked}/${total}). Overbook?`)) return;

    setLoading(true);
    try {
      const { error } = await supabase.from('PsychE_Counseling_Logs').update({ scheduled_date: targetDateStr }).eq('id', logId);
      if (error) throw error;
      setRefreshKey(prev => prev + 1);
    } catch (error) {
      alert('Failed to move the session.');
      setLoading(false);
    }
  };

  // ── Actions ──
  const handleNoShow = async (e: React.MouseEvent, logId: string, studentUuid: string, currentEngagement: number = 0) => {
    e.stopPropagation();
    setLoading(true);
    try {
      const { error: logError } = await supabase.from('PsychE_Counseling_Logs').update({ session_status: 'No_Show' }).eq('id', logId);
      if (logError) throw logError;
      const { error: studentError } = await supabase.from('PsychE_Students').update({ engagement_modifier: currentEngagement - 1 }).eq('id', studentUuid);
      if (studentError) throw studentError;
      setRefreshKey(prev => prev + 1);
    } catch (error) {
      alert('Failed to mark session as No-Show.');
      setLoading(false);
    }
  };

  const handleDeleteSession = async (e: React.MouseEvent, logId: string) => {
    e.stopPropagation();
    if (!window.confirm('Permanently delete this session? This cannot be undone.')) return;
    setLoading(true);
    try {
      const { error } = await supabase.from('PsychE_Counseling_Logs').delete().eq('id', logId);
      if (error) throw error;
      setRefreshKey(prev => prev + 1);
    } catch (error) {
      alert('Failed to delete session.');
      setLoading(false);
    }
  };

  const handleRescheduleConfirm = async (newDate: string) => {
    if (!rescheduleTarget) return;

    const selectedDate = parseISO(newDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (selectedDate < today) {
      alert("You cannot reschedule a session to a past date.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.from('PsychE_Counseling_Logs').update({ scheduled_date: newDate }).eq('id', rescheduleTarget.id);
      if (error) throw error;
      setRescheduleTarget(null);
      setRefreshKey(prev => prev + 1);
    } catch (error) {
      alert('Failed to reschedule session.');
      setLoading(false);
    }
  };

  if (loading) return <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading Planner...</div>;

  return (
    <motion.div variants={container} initial="hidden" animate="show" style={{ padding: '1rem 0' }}>

      {/* ── Reschedule Modal (portal-style, covers entire viewport) ── */}
      <AnimatePresence>
        {rescheduleTarget && (
          <RescheduleModal
            studentName={rescheduleTarget.studentName}
            currentDate={rescheduleTarget.currentDate}
            onConfirm={handleRescheduleConfirm}
            onClose={() => setRescheduleTarget(null)}
          />
        )}
      </AnimatePresence>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 className="text-h1" style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <LayoutDashboard size={28} /> 7-Day Planner
          </h1>
          <p className="text-muted">Manage your upcoming scheduled sessions. Drag cards to reschedule.</p>
        </div>
      </div>

      {/* Horizontal Scroll Kanban Container */}
      <div style={{ display: 'flex', gap: '1.25rem', overflowX: 'auto', paddingBottom: '1.5rem', minHeight: '60vh' }}>

        {boardDays.map((day) => {
          const isFull = (day.capacity?.booked ?? 0) >= (day.capacity?.total ?? 7);

          return (
            <motion.div
              key={day.dateStr}
              variants={item}
              style={{
                minWidth: '300px', width: '300px', flexShrink: 0,
                backgroundColor: 'rgba(24, 27, 33, 0.45)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                border: day.isOverdue
                  ? '1px solid rgba(239,68,68,0.2)'
                  : day.isSundayCol ? '1px solid rgba(245,158,11,0.25)' : '1px solid rgba(255,255,255,0.06)',
                borderRadius: 'var(--radius-lg)',
                display: 'flex', flexDirection: 'column',
                boxShadow: '0 4px 24px rgba(0,0,0,0.15)'
              }}
            >
              {/* Column Header */}
              <div style={{
                padding: '1rem 1.25rem',
                borderBottom: '1px solid rgba(255,255,255,0.07)',
                backgroundColor: day.isOverdue
                  ? 'rgba(239,68,68,0.12)'
                  : day.isSundayCol ? 'rgba(245,158,11,0.08)' : 'rgba(0,0,0,0.15)',
                borderTopLeftRadius: 'var(--radius-lg)',
                borderTopRightRadius: 'var(--radius-lg)'
              }}>
                <h3 style={{
                  display: 'flex', alignItems: 'center', gap: '0.4rem',
                  fontWeight: 700, fontSize: '1rem', marginBottom: '0.5rem',
                  color: day.isOverdue ? '#f87171' : day.isSundayCol ? '#f59e0b' : 'var(--color-text)'
                }}>
                  {day.isSundayCol && <AlertCircle size={14} />}
                  {day.label}
                </h3>
                {!day.isOverdue && day.dateStr !== 'later' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                    <div style={{ flex: 1, height: '3px', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${Math.min(100, (day.capacity.booked / day.capacity.total) * 100)}%`,
                        backgroundColor: isFull ? 'var(--color-danger)' : 'var(--color-primary)',
                        transition: 'width 0.35s ease'
                      }} />
                    </div>
                    <span style={{
                      fontSize: '0.6875rem', fontWeight: 700,
                      padding: '0.15rem 0.5rem', borderRadius: '4px',
                      backgroundColor: isFull ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.06)',
                      color: isFull ? '#f59e0b' : 'var(--color-text-muted)',
                      whiteSpace: 'nowrap'
                    }}>
                      {day.capacity.booked} / {day.capacity.total}
                    </span>
                  </div>
                )}
                {day.dateStr === 'later' && (
                  <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
                    {day.logs.length} Upcoming Session{day.logs.length !== 1 ? 's' : ''}
                  </p>
                )}
                {day.isOverdue && (
                  <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#f87171' }}>
                    {day.logs.length} Missed Session{day.logs.length !== 1 ? 's' : ''}
                  </p>
                )}
              </div>

              {/* Cards Container */}
              <div
                style={{ padding: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', flex: 1, overflowY: 'auto' }}
                onDragOver={handleDragOver}
                onDrop={e => handleDrop(e, day.dateStr, day.isOverdue, day.capacity?.booked || 0, day.capacity?.total || 0)}
              >
                {day.logs.length === 0 ? (
                  <div style={{
                    textAlign: 'center', padding: '2.5rem 1rem',
                    color: 'var(--color-text-muted)', fontSize: '0.8125rem',
                    border: '1px dashed rgba(255,255,255,0.07)', borderRadius: 'var(--radius-md)'
                  }}>
                    No sessions scheduled
                  </div>
                ) : (
                  day.logs.map((log: any) => {
                    const student = log.PsychE_Students;
                    const riskLevel = student?.risk_level || 'Low';

                    return (
                      <div
                        key={log.id}
                        draggable={true}
                        onDragStart={e => handleDragStart(e, log.id)}
                        onDragEnd={handleDragEnd}
                        style={{
                          backgroundColor: day.isOverdue ? 'rgba(239,68,68,0.06)' : 'rgba(30,33,42,0.85)',
                          border: `1px solid ${day.isOverdue ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.08)'}`,
                          borderRadius: 'var(--radius-md)',
                          padding: '0.875rem 1rem',
                          display: 'flex', flexDirection: 'column',
                          transition: 'transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                          cursor: 'grab'
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.transform = 'translateY(-2px)';
                          e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.3)';
                          e.currentTarget.style.borderColor = day.isOverdue ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.14)';
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.transform = 'none';
                          e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
                          e.currentTarget.style.borderColor = day.isOverdue ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.08)';
                        }}
                      >
                        {/* Card Top Row: Name + Actions */}
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.5rem' }}>
                          {/* Left: Name + Risk */}
                          <div
                            style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                            onClick={() => navigate(`/student/${student?.student_id || log.student_uuid}`)}
                          >
                            <p style={{ fontWeight: 700, fontSize: '0.9375rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {student?.full_name}
                            </p>
                            {riskLevel !== 'Low' && (
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: '3px',
                                marginTop: '0.25rem',
                                fontSize: '0.625rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                                padding: '0.15rem 0.45rem', borderRadius: '4px',
                                backgroundColor: riskLevel === 'High' ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.12)',
                                color: riskLevel === 'High' ? '#f87171' : '#fbbf24',
                              }}>
                                <AlertCircle size={9} /> {riskLevel} Risk
                              </span>
                            )}
                          </div>

                          {/* Right: Action Icons */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
                            <ActionIcon
                              icon={<Calendar size={14} />}
                              tooltip="Reschedule session"
                              variant="primary"
                              onClick={e => {
                                e.stopPropagation();
                                setRescheduleTarget({
                                  id: log.id,
                                  studentName: student?.full_name || 'Student',
                                  currentDate: log.scheduled_date || ''
                                });
                              }}
                            />
                            <ActionIcon
                              icon={<Trash2 size={14} />}
                              tooltip="Cancel & delete session"
                              variant="danger"
                              onClick={e => handleDeleteSession(e, log.id)}
                            />
                          </div>
                        </div>

                        {/* Reason */}
                        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', lineHeight: 1.45, marginBottom: '0.875rem' }}>
                          {log.reason}
                        </p>

                        {/* CTA Buttons */}
                        <div style={{ marginTop: 'auto', paddingTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                          <button
                            onClick={e => { e.stopPropagation(); navigate(`/add-log?schedule_id=${log.id}`); }}
                            style={{
                              width: '100%', padding: '0.5rem 0.75rem',
                              borderRadius: 'var(--radius-full)',
                              fontSize: '0.75rem', fontWeight: 700,
                              backgroundColor: 'rgba(74,222,128,0.12)',
                              color: '#86efac',
                              border: '1px solid rgba(74,222,128,0.25)',
                              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.375rem',
                              transition: 'all 0.15s ease'
                            }}
                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(74,222,128,0.2)'; e.currentTarget.style.color = '#4ade80'; }}
                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'rgba(74,222,128,0.12)'; e.currentTarget.style.color = '#86efac'; }}
                          >
                            <CheckCircle2 size={13} /> Complete Session
                          </button>

                          <button
                            onClick={e => handleNoShow(e, log.id, log.student_uuid, student?.engagement_modifier)}
                            style={{
                              width: '100%', padding: '0.5rem 0.75rem',
                              borderRadius: 'var(--radius-full)',
                              fontSize: '0.75rem', fontWeight: 700,
                              backgroundColor: 'rgba(239,68,68,0.08)',
                              color: 'rgba(248,113,113,0.8)',
                              border: '1px solid rgba(239,68,68,0.2)',
                              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.375rem',
                              transition: 'all 0.15s ease'
                            }}
                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.18)'; e.currentTarget.style.color = '#f87171'; }}
                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.08)'; e.currentTarget.style.color = 'rgba(248,113,113,0.8)'; }}
                          >
                            <XCircle size={13} /> Mark No-Show
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
};
