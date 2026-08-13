import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Search, Printer, ArrowLeft, CheckSquare, Square, Calendar, ChevronDown, ChevronUp, X, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { parseISO } from 'date-fns';
import { supabase } from '../lib/supabase';
import { getAvailableCapacityForDateRange, toLocalDateStr } from '../lib/capacity';
import { getWeekdayName, isSunday } from '../utils/dateFormatter';

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.1 } }
};

const normalizeCourse = (course: string) => {
  if (!course) return '';
  const match = course.match(/^(\d+)(th|st|nd|rd)?/i);
  if (match) return `Grade ${match[1]}`;
  return course;
};

export const StudentDirectory: React.FC = () => {
  const navigate = useNavigate();
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Tag Filter State
  const [systemTags, setSystemTags] = useState<any[]>([]);
  const [selectedTagId, setSelectedTagId] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);

  // Advanced Filter State
  const [showFilters, setShowFilters] = useState(false);
  const [courseFilter, setCourseFilter] = useState<string>('');
  const [riskFilter, setRiskFilter] = useState<string>('');
  const [sessionDateFilter, setSessionDateFilter] = useState<string>('');

  // Selection State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Print State
  const [isPrinting, setIsPrinting] = useState(false);
  const [printData, setPrintData] = useState<any[]>([]);

  // ── Bulk Scheduler State ──
  const [isSchedulerOpen, setIsSchedulerOpen] = useState(false);
  const [schedStartDate, setSchedStartDate] = useState(toLocalDateStr(new Date()));
  const [schedSelectedIds, setSchedSelectedIds] = useState<Set<string>>(new Set());
  const [scheduling, setScheduling] = useState(false);
  const [schedSearchQuery, setSchedSearchQuery] = useState('');

  useEffect(() => {
    async function init() {
      const { data } = await supabase.from('PsychE_System_Tags').select('*');
      if (data) {
        setSystemTags(data);
        const categories = Array.from(new Set(data.map(tag => tag.tag_category).filter(Boolean))) as string[];
        setAvailableCategories(categories);
      }
    }
    init();
  }, []);

  useEffect(() => {
    fetchStudents();
  }, [selectedTagId]);

  async function fetchStudents() {
    setLoading(true);
    try {
      let query = supabase.from('PsychE_Students').select('*').order('full_name');

      if (selectedTagId) {
        const { data: taggedStudents } = await supabase
          .from('PsychE_Student_Tags')
          .select('student_uuid')
          .eq('tag_id', selectedTagId);

        if (taggedStudents && taggedStudents.length > 0) {
          const ids = taggedStudents.map(ts => ts.student_uuid);
          query = query.in('id', ids);
        } else {
          setStudents([]);
          setLoading(false);
          return;
        }
      }

      const { data, error } = await query;
      if (error) throw error;
      
      let fetchedStudents = data || [];

      if (fetchedStudents.length > 0) {
        const studentIds = fetchedStudents.map((s: any) => s.id);
        const { data: logsData } = await supabase
          .from('PsychE_Counseling_Logs')
          .select('student_uuid, session_date')
          .in('student_uuid', studentIds)
          .order('session_date', { ascending: false });

        if (logsData) {
          const latestLogs = new Map<string, string>();
          logsData.forEach(log => {
            if (!latestLogs.has(log.student_uuid)) {
              latestLogs.set(log.student_uuid, log.session_date);
            }
          });
          fetchedStudents = fetchedStudents.map((student: any) => ({
            ...student,
            last_session_date: latestLogs.get(student.id) || null
          }));
        }
      }

      setStudents(fetchedStudents);
    } catch (error) {
      console.error('Error fetching students:', error);
    } finally {
      setLoading(false);
    }
  }

  const availableCourses = Array.from(new Set(students.map(s => normalizeCourse(s.course)).filter(Boolean))).sort();

  const filteredStudents = students.filter(s => {
    const matchesSearch = s.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          s.student_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (s.course && s.course.toLowerCase().includes(searchQuery.toLowerCase()));
                          
    const matchesCourse = !courseFilter || normalizeCourse(s.course) === courseFilter;
    const matchesRisk = !riskFilter || (s.risk_level || 'Low') === riskFilter;
    
    let matchesDate = true;
    if (sessionDateFilter) {
      if (sessionDateFilter === 'Never') {
        matchesDate = !s.last_session_date;
      } else if (s.last_session_date) {
        const diffDays = (new Date().getTime() - new Date(s.last_session_date).getTime()) / (1000 * 3600 * 24);
        if (sessionDateFilter === 'Needs Attention (30+ Days)') {
          matchesDate = diffDays >= 30;
        } else if (sessionDateFilter === 'Recent (Last 7 Days)') {
          matchesDate = diffDays <= 7;
        }
      } else {
        if (sessionDateFilter === 'Needs Attention (30+ Days)') {
          matchesDate = true; // Include students with no sessions in "Needs Attention"
        } else {
          matchesDate = false;
        }
      }
    }

    return matchesSearch && matchesCourse && matchesRisk && matchesDate;
  });

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredStudents.length && filteredStudents.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredStudents.map(s => s.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const handleBulkPrint = async () => {
    if (selectedIds.size === 0) return;
    setIsPrinting(true);
    try {
      const selectedStudents = students.filter(s => selectedIds.has(s.id));
      const { data: logsData, error: logsError } = await supabase
        .from('PsychE_Counseling_Logs')
        .select('*')
        .in('student_uuid', Array.from(selectedIds))
        .order('session_date', { ascending: false });

      if (logsError) throw logsError;
      const logsByStudent: Record<string, any[]> = {};
      (logsData || []).forEach(log => {
        if (!logsByStudent[log.student_uuid]) logsByStudent[log.student_uuid] = [];
        logsByStudent[log.student_uuid].push(log);
      });
      const fullPrintData = selectedStudents.map(student => ({
        student,
        logs: logsByStudent[student.id] || []
      }));
      setPrintData(fullPrintData);
      setTimeout(() => { window.print(); setIsPrinting(false); }, 500);
    } catch (error) {
      console.error('Error preparing print data:', error);
      alert('Failed to prepare print documents.');
      setIsPrinting(false);
    }
  };

  // ── Bulk Scheduler Logic (preserved from BulkSchedule.tsx) ──
  const schedFilteredStudents = students.filter(s =>
    s.full_name.toLowerCase().includes(schedSearchQuery.toLowerCase()) ||
    s.student_id.toLowerCase().includes(schedSearchQuery.toLowerCase())
  );

  const schedToggleAll = () => {
    if (schedSelectedIds.size === schedFilteredStudents.length && schedFilteredStudents.length > 0) {
      setSchedSelectedIds(new Set());
    } else {
      setSchedSelectedIds(new Set(schedFilteredStudents.map(s => s.id)));
    }
  };

  const schedToggle = (id: string) => {
    const newSet = new Set(schedSelectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSchedSelectedIds(newSet);
  };

  const handleAutoSchedule = async () => {
    if (schedSelectedIds.size === 0) return;
    setScheduling(true);
    try {
      const initialSelectedStudents = students.filter(s => schedSelectedIds.has(s.id));
      const { data: conflicts, error: conflictError } = await supabase
        .from('PsychE_Counseling_Logs')
        .select('student_uuid')
        .in('student_uuid', initialSelectedStudents.map(s => s.id))
        .in('session_status', ['Scheduled', 'Pending']);

      if (conflictError) throw conflictError;
      const conflictedUuids = new Set(conflicts?.map(c => c.student_uuid) || []);
      const selectedStudents = initialSelectedStudents.filter(s => !conflictedUuids.has(s.id));
      const skippedCount = conflictedUuids.size;

      if (selectedStudents.length === 0) {
        alert(`Action Blocked: All ${skippedCount} selected students already have an active/future session.`);
        setScheduling(false);
        return;
      }

      // parseISO, not `new Date(str)` — schedStartDate is a bare YYYY-MM-DD from
      // the date input, which the native constructor parses as UTC midnight and
      // shifts to the previous local day for negative-offset timezones (BUG-001).
      const start = parseISO(schedStartDate);
      const capacityData = await getAvailableCapacityForDateRange(start, 30);
      const availableDays = Object.keys(capacityData).sort().map(date => ({
        date,
        available: capacityData[date].available
      }));

      const logsToInsert: any[] = [];
      let dayIndex = 0;
      let studentsScheduled = 0;

      for (const student of selectedStudents) {
        while (dayIndex < availableDays.length && availableDays[dayIndex].available <= 0) dayIndex++;
        if (dayIndex >= availableDays.length) {
          alert(`Not enough capacity in the next 30 days. Scheduled ${studentsScheduled} students.`);
          break;
        }
        const assignedDate = availableDays[dayIndex].date;
        availableDays[dayIndex].available--;
        studentsScheduled++;
        logsToInsert.push({
          student_uuid: student.id,
          counselor_name: 'System Auto-Scheduler',
          session_date: parseISO(assignedDate).toISOString(),
          scheduled_date: assignedDate,
          session_status: 'Scheduled',
          reason: 'Initial Assessment',
          interaction_type: 'Session'
        });
      }

      if (logsToInsert.length > 0) {
        const { error } = await supabase.from('PsychE_Counseling_Logs').insert(logsToInsert);
        if (error) throw error;
        let msg = `Successfully scheduled ${studentsScheduled} sessions!`;
        if (skippedCount > 0) msg += ` Skipped ${skippedCount} due to existing sessions.`;
        alert(msg);
        setSchedSelectedIds(new Set());
        setIsSchedulerOpen(false);
        navigate('/kanban');
      }
    } catch (error: any) {
      console.error('Scheduling error:', error);
      alert('Failed to auto-schedule: ' + error.message);
    } finally {
      setScheduling(false);
    }
  };

  return (
    <motion.div variants={container} initial="hidden" animate="show" style={{ padding: '1rem 0' }}>

      {/* --- UI View --- */}
      <div className="no-print">
        {/* Header */}
        <div className="flex justify-between items-center mb-6 mobile-stack mobile-stack-start" style={{ gap: '1rem' }}>
          <div>
            <button onClick={() => navigate(-1)} className="btn btn-secondary mb-4" style={{ padding: '0.25rem 0.5rem', fontSize: '0.875rem', backgroundColor: 'transparent', border: 'none' }}>
              <ArrowLeft size={16} /> Back
            </button>
            <h1 className="text-h1" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Users size={28} /> Student Directory
            </h1>
            <p className="text-muted">Manage, filter, and bulk-print student records.</p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                setIsSchedulerOpen(v => {
                  const next = !v;
                  if (next) {
                    // Carry the directory's current selection into the scheduler panel
                    // so the user doesn't have to re-pick the same students.
                    setSchedSelectedIds(new Set(selectedIds));
                    setSchedSearchQuery('');
                  }
                  return next;
                });
              }}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.625rem 1.125rem', borderRadius: 'var(--radius-md)', fontSize: '0.875rem', fontWeight: 600, border: '1px solid rgba(94,106,210,0.35)', backgroundColor: isSchedulerOpen ? 'rgba(94,106,210,0.18)' : 'rgba(94,106,210,0.08)', color: 'var(--color-primary)', cursor: 'pointer', transition: 'all 0.2s ease' }}
            >
              <Calendar size={16} />
              Bulk Schedule
              {isSchedulerOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="btn btn-primary"
              disabled={selectedIds.size === 0 || isPrinting}
              onClick={handleBulkPrint}
              style={{ background: 'linear-gradient(135deg, var(--color-primary), #8b5cf6)', border: 'none' }}
            >
              <Printer size={18} /> {isPrinting ? 'Preparing...' : `Print Selected (${selectedIds.size})`}
            </motion.button>
          </div>
        </div>

        {/* ── Bulk Scheduler Panel ── */}
        <AnimatePresence>
          {isSchedulerOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              style={{ overflow: 'hidden', marginBottom: '1.5rem' }}
            >
              <div className="bento-card" style={{ border: '1px solid rgba(94,106,210,0.25)', backgroundColor: 'rgba(94,106,210,0.04)' }}>
                {/* Panel Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                  <div>
                    <h2 style={{ fontSize: '1.125rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                      <Calendar size={18} style={{ color: 'var(--color-primary)' }} />
                      Bulk Auto-Scheduler
                    </h2>
                    <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                      Select students and auto-distribute their initial sessions across available capacity.
                    </p>
                  </div>
                  <button onClick={() => setIsSchedulerOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: '0.25rem' }}>
                    <X size={18} />
                  </button>
                </div>

                <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
                  {/* Config Column */}
                  <div style={{ width: '220px', flexShrink: 0 }}>
                    <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.4rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Start Date
                    </label>
                    <input
                      type="date"
                      className="input"
                      value={schedStartDate}
                      onChange={e => setSchedStartDate(e.target.value)}
                      style={{ marginBottom: '0.4rem' }}
                    />
                    {schedStartDate && (
                      <p style={{
                        display: 'flex', alignItems: 'center', gap: '0.3rem',
                        fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.75rem',
                        color: isSunday(schedStartDate) ? '#f87171' : 'var(--color-text-muted)'
                      }}>
                        {isSunday(schedStartDate) && <AlertTriangle size={13} />}
                        {getWeekdayName(schedStartDate)}
                        {isSunday(schedStartDate) ? ' — Sunday' : ''}
                      </p>
                    )}
                    <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '1.25rem', lineHeight: 1.5 }}>
                      The system will start from this date and cascade sessions forward through available capacity, including weekends and holidays — double-check the days it lands on.
                    </p>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', backgroundColor: 'rgba(94,106,210,0.1)', borderRadius: 'var(--radius-md)', marginBottom: '1rem', border: '1px solid rgba(94,106,210,0.2)' }}>
                      <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Selected</span>
                      <span style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-primary)' }}>{schedSelectedIds.size}</span>
                    </div>
                    <motion.button
                      disabled={schedSelectedIds.size === 0 || scheduling}
                      onClick={handleAutoSchedule}
                      whileHover={{ scale: schedSelectedIds.size === 0 ? 1 : 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)', fontSize: '0.875rem', fontWeight: 700, border: 'none', cursor: schedSelectedIds.size === 0 ? 'not-allowed' : 'pointer', background: schedSelectedIds.size === 0 ? 'rgba(94,106,210,0.2)' : 'linear-gradient(135deg, var(--color-primary), #8b5cf6)', color: schedSelectedIds.size === 0 ? 'rgba(255,255,255,0.3)' : 'white', transition: 'all 0.2s ease' }}
                    >
                      {scheduling ? 'Scheduling…' : 'Auto-Distribute Sessions'}
                    </motion.button>
                  </div>

                  {/* Divider */}
                  <div style={{ width: '1px', alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.07)', flexShrink: 0 }} />

                  {/* Student Table */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ position: 'relative', marginBottom: '0.75rem' }}>
                      <Search size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', pointerEvents: 'none' }} />
                      <input
                        type="text"
                        placeholder="Search students…"
                        className="input"
                        value={schedSearchQuery}
                        onChange={e => setSchedSearchQuery(e.target.value)}
                        style={{ paddingLeft: '36px', fontSize: '0.875rem', padding: '0.5rem 0.875rem 0.5rem 36px' }}
                      />
                    </div>
                    <div style={{ maxHeight: '280px', overflowY: 'auto', borderRadius: 'var(--radius-md)', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                        <colgroup>
                          <col style={{ width: '44px' }} />
                          <col style={{ width: '40%' }} />
                          <col style={{ width: '25%' }} />
                          <col />
                        </colgroup>
                        <thead>
                          <tr style={{ backgroundColor: 'rgba(0,0,0,0.25)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                            <th style={{ padding: '0.625rem 0.75rem', textAlign: 'center' }}>
                              <button onClick={schedToggleAll} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text)', display: 'flex', alignItems: 'center', margin: '0 auto' }}>
                                {schedSelectedIds.size === schedFilteredStudents.length && schedFilteredStudents.length > 0
                                  ? <CheckSquare size={17} style={{ color: 'var(--color-primary)' }} />
                                  : <Square size={17} />}
                              </button>
                            </th>
                            <th style={{ padding: '0.625rem 0.75rem', textAlign: 'left', fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>Student</th>
                            <th style={{ padding: '0.625rem 0.75rem', textAlign: 'left', fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>ID</th>
                            <th style={{ padding: '0.625rem 0.75rem', textAlign: 'left', fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>Course</th>
                          </tr>
                        </thead>
                        <tbody>
                          {schedFilteredStudents.map(student => (
                            <tr
                              key={student.id}
                              onClick={() => schedToggle(student.id)}
                              style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', backgroundColor: schedSelectedIds.has(student.id) ? 'rgba(94,106,210,0.08)' : 'transparent', cursor: 'pointer', transition: 'background-color 0.12s ease' }}
                              onMouseEnter={e => { if (!schedSelectedIds.has(student.id)) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)'; }}
                              onMouseLeave={e => { e.currentTarget.style.backgroundColor = schedSelectedIds.has(student.id) ? 'rgba(94,106,210,0.08)' : 'transparent'; }}
                            >
                              <td style={{ padding: '0.625rem 0.75rem', textAlign: 'center' }}>
                                {schedSelectedIds.has(student.id)
                                  ? <CheckSquare size={17} style={{ color: 'var(--color-primary)' }} />
                                  : <Square size={17} style={{ color: 'var(--color-text-muted)' }} />}
                              </td>
                              <td style={{ padding: '0.625rem 0.75rem', fontWeight: 600, fontSize: '0.875rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {student.full_name}
                              </td>
                              <td style={{ padding: '0.625rem 0.75rem', fontSize: '0.8125rem', color: 'var(--color-text-muted)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                                {student.student_id}
                              </td>
                              <td style={{ padding: '0.625rem 0.75rem', fontSize: '0.8125rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {normalizeCourse(student.course)}
                              </td>
                            </tr>
                          ))}
                          {schedFilteredStudents.length === 0 && (
                            <tr>
                              <td colSpan={4} style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>No students found.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Advanced Filters Engine */}
        <div className="bento-card mb-6" style={{ padding: '1rem' }}>
          {/* Primary Row */}
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', pointerEvents: 'none' }} size={18} />
              <input
                type="text"
                placeholder="Search by Name, ID, or Course..."
                className="input"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ paddingLeft: '48px', width: '100%', height: '2.5rem', backgroundColor: 'var(--color-background)', border: '1px solid var(--color-border)' }}
              />
            </div>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setShowFilters(!showFilters)}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0 1rem', height: '2.5rem', borderRadius: 'var(--radius-md)', fontSize: '0.875rem', fontWeight: 600, border: '1px solid var(--color-border)', backgroundColor: showFilters ? 'rgba(94,106,210,0.1)' : 'var(--color-surface)', color: showFilters ? 'var(--color-primary)' : 'var(--color-text)', cursor: 'pointer', transition: 'all 0.2s ease' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
              Filters
              {(selectedCategory || selectedTagId || courseFilter || riskFilter || sessionDateFilter) && (
                <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--color-primary)', marginLeft: 4 }} />
              )}
            </motion.button>
          </div>

          {/* Expandable Advanced Filters Panel */}
          <AnimatePresence>
            {showFilters && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                style={{ overflow: 'hidden' }}
              >
                <div style={{ paddingTop: '1.25rem', marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>Advanced Filters</span>
                    {(selectedCategory || selectedTagId || courseFilter || riskFilter || sessionDateFilter || searchQuery) && (
                      <button 
                        onClick={() => {
                          setSearchQuery('');
                          setSelectedCategory('');
                          setSelectedTagId('');
                          setCourseFilter('');
                          setRiskFilter('');
                          setSessionDateFilter('');
                        }}
                        style={{ background: 'none', border: 'none', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-primary)', cursor: 'pointer' }}
                      >
                        Clear All
                      </button>
                    )}
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                    {/* Category Filter */}
                    <select
                      className="input w-full"
                      value={selectedCategory}
                      onChange={e => { setSelectedCategory(e.target.value); setSelectedTagId(''); }}
                      style={{ height: '2.75rem', padding: '0 0.75rem', fontSize: '0.875rem', backgroundColor: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)' }}
                    >
                      <option value="">All Categories</option>
                      {availableCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </select>

                    {/* Tag Filter */}
                    <select
                      className="input w-full"
                      value={selectedTagId}
                      onChange={e => setSelectedTagId(e.target.value)}
                      disabled={!selectedCategory && systemTags.length > 0}
                      style={{ height: '2.75rem', padding: '0 0.75rem', fontSize: '0.875rem', backgroundColor: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)' }}
                    >
                      <option value="">All Tags {selectedCategory ? `in ${selectedCategory}` : ''}</option>
                      {systemTags
                        .filter(tag => !selectedCategory || tag.tag_category === selectedCategory)
                        .map(tag => <option key={tag.id} value={tag.id}>{tag.tag_name}</option>)}
                    </select>

                    {/* Course Filter */}
                    <select
                      className="input w-full"
                      value={courseFilter}
                      onChange={e => setCourseFilter(e.target.value)}
                      style={{ height: '2.75rem', padding: '0 0.75rem', fontSize: '0.875rem', backgroundColor: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)' }}
                    >
                      <option value="">All Courses</option>
                      {availableCourses.map(course => <option key={course} value={course as string}>{course as string}</option>)}
                    </select>

                    {/* Risk Level Filter */}
                    <select
                      className="input w-full"
                      value={riskFilter}
                      onChange={e => setRiskFilter(e.target.value)}
                      style={{ height: '2.75rem', padding: '0 0.75rem', fontSize: '0.875rem', backgroundColor: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)' }}
                    >
                      <option value="">All Risk Levels</option>
                      <option value="Low">Low</option>
                      <option value="Medium">Medium</option>
                      <option value="High">High</option>
                      <option value="Critical">Critical</option>
                    </select>

                    {/* Last Session Date Filter */}
                    <select
                      className="input w-full"
                      value={sessionDateFilter}
                      onChange={e => setSessionDateFilter(e.target.value)}
                      style={{ height: '2.75rem', padding: '0 0.75rem', fontSize: '0.875rem', backgroundColor: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)' }}
                    >
                      <option value="">Session: All Time</option>
                      <option value="Recent (Last 7 Days)">Recent (Last 7 Days)</option>
                      <option value="Needs Attention (30+ Days)">Needs Attention (30+ Days)</option>
                      <option value="Never">Never Had Session</option>
                    </select>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Main Directory Table */}
        <motion.div className="bento-card" style={{ padding: 0 }}>
          {loading ? (
            <p style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-text-muted)' }}>Loading directory...</p>
          ) : (
            <div className="table-scroll" style={{ overflowX: 'auto' }}>
              <table className="directory-table" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <colgroup>
                  <col className="col-checkbox" style={{ width: '56px' }} />
                  <col className="col-name" style={{ width: '25%' }} />
                  <col className="col-id" style={{ width: '15%' }} />
                  <col className="col-course" />
                  <col className="col-risk" style={{ width: '100px' }} />
                  <col className="col-enrolled" style={{ width: '110px' }} />
                </colgroup>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'rgba(0,0,0,0.15)' }}>
                    <th style={{ padding: '1rem 0.75rem', textAlign: 'center' }}>
                      <button onClick={toggleSelectAll} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text)', display: 'flex', alignItems: 'center', margin: '0 auto' }}>
                        {selectedIds.size === filteredStudents.length && filteredStudents.length > 0 ? <CheckSquare size={20} style={{ color: 'var(--color-primary)' }} /> : <Square size={20} />}
                      </button>
                    </th>
                    <th style={{ padding: '1rem 0.75rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>Student Name</th>
                    <th style={{ padding: '1rem 0.75rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>ID</th>
                    <th style={{ padding: '1rem 0.75rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>Course</th>
                    <th style={{ padding: '1rem 0.75rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>Risk</th>
                    <th style={{ padding: '1rem 0.75rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>Enrolled</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudents.map(student => (
                    <tr
                      key={student.id}
                      style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', backgroundColor: selectedIds.has(student.id) ? 'rgba(94,106,210,0.05)' : 'transparent', transition: 'background-color 0.15s ease' }}
                      onMouseEnter={e => { if (!selectedIds.has(student.id)) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)'; }}
                      onMouseLeave={e => { e.currentTarget.style.backgroundColor = selectedIds.has(student.id) ? 'rgba(94,106,210,0.05)' : 'transparent'; }}
                    >
                      <td style={{ padding: '1rem 0.75rem', textAlign: 'center' }}>
                        <button onClick={() => toggleSelect(student.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text)', display: 'flex', alignItems: 'center', margin: '0 auto' }}>
                          {selectedIds.has(student.id) ? <CheckSquare size={20} style={{ color: 'var(--color-primary)' }} /> : <Square size={20} />}
                        </button>
                      </td>
                      <td style={{ padding: '1rem 0.75rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <span onClick={() => navigate(`/student/${student.student_id || student.id}`)} style={{ cursor: 'pointer', color: 'var(--color-text)' }}
                          onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-primary)'; }}
                          onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text)'; }}>
                          {student.full_name}
                        </span>
                      </td>
                      <td style={{ padding: '1rem 0.75rem', color: 'var(--color-text-muted)', fontFamily: 'monospace', fontSize: '0.875rem' }}>{student.student_id}</td>
                      <td style={{ padding: '1rem 0.75rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{student.course}</td>
                      <td style={{ padding: '1rem 0.75rem' }}>
                        <span style={{
                          fontSize: '0.6875rem', padding: '0.2rem 0.5rem', borderRadius: '4px', fontWeight: 700,
                          backgroundColor: student.risk_level === 'High' ? 'rgba(239,68,68,0.1)' : student.risk_level === 'Medium' ? 'rgba(245,158,11,0.1)' : 'rgba(74,222,128,0.1)',
                          color: student.risk_level === 'High' ? '#ef4444' : student.risk_level === 'Medium' ? '#f59e0b' : '#4ade80'
                        }}>
                          {student.risk_level || 'Low'}
                        </span>
                      </td>
                      <td style={{ padding: '1rem 0.75rem', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
                        {student.enrolled_date ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(parseISO(student.enrolled_date)) : 'N/A'}
                      </td>
                    </tr>
                  ))}
                  {filteredStudents.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>No students match your filter.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      </div>

      {/* --- Print View --- */}
      {isPrinting && (
        <div className="print-only">
          {printData.map((data) => (
            <div key={data.student.id} className="page-break" style={{ display: 'block' }}>
              <div className="print-header">
                <h1>GCM Convent School</h1>
                <h2>Confidential Counseling Record</h2>
                <div className="print-meta">
                  <span><strong>Student:</strong> {data.student.full_name}</span>
                  <span><strong>ID:</strong> {data.student.student_id}</span>
                  <span><strong>Course:</strong> {data.student.course}</span>
                  <span><strong>Printed:</strong> {new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date())}</span>
                </div>
              </div>
              <div className="bento-card">
                <h3>Counseling History</h3>
                {data.logs.length === 0 ? (
                  <p className="text-muted">No counseling logs found for this student.</p>
                ) : (
                  data.logs.map((log: any) => (
                    <div key={log.id} className="print-timeline-item">
                      <h4 className="text-h3">{log.reason}</h4>
                      <p className="text-muted">{log.counselor_name} • {new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(log.session_date))}</p>
                      <div className="print-notes">
                        <p className="text-body" style={{ whiteSpace: 'pre-line' }}>{log.student_response || 'No notes provided.'}</p>
                      </div>
                      <div className="print-action">
                        <strong>Action:</strong> {log.recommended_action || 'None'}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

    </motion.div>
  );
};
