import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Save, Sparkles, CheckCircle, Calendar as CalendarIcon, FileText, AlertTriangle } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { parseISO } from 'date-fns';
import { supabase } from '../lib/supabase';
import { getAvailableCapacityForDateRange, toLocalDateStr } from '../lib/capacity';
import { toSentenceCase } from '../utils/stringFormatter';
import { getWeekdayName, isSunday } from '../utils/dateFormatter';
import { AssessmentWizard } from '../components/AssessmentWizard';
import { NextTimeNote, NotePrompt } from '../components/MiniNotes';
import { createNote, fetchOpenNotes, setNoteDone } from '../lib/studentNotes';
import type { NoteKind, StudentNote } from '../types';
import { useDocumentTitle } from '../lib/branding';

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.1 } }
};

export const AddLog: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const prefilledStudentId = searchParams.get('student');
  const scheduleId = searchParams.get('schedule_id');

  const [students, setStudents] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  
  // Form State
  const [studentUuid, setStudentUuid] = useState(prefilledStudentId || '');
  const [counselorName, setCounselorName] = useState('');
  const [interactionType, setInteractionType] = useState('');
  const [reason, setReason] = useState('');
  const [studentResponse, setStudentResponse] = useState('');
  const [recommendedAction, setRecommendedAction] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  
  // Custom Date Picker State
  const [useCustomDate, setUseCustomDate] = useState(false);
  const [capacityData, setCapacityData] = useState<any[]>([]);

  // Smart Engine State
  const [masterLibrary, setMasterLibrary] = useState<any[]>([]);
  const [matchedAssessments, setMatchedAssessments] = useState<string[]>([]);
  const [activeWizardId, setActiveWizardId] = useState<string | null>(null); // To manage full-screen wizard
  const [cooldownDays, setCooldownDays] = useState(30);
  const [pastAssessments, setPastAssessments] = useState<any[]>([]);
  
  // Wizard Progress State
  const [completedAssessments, setCompletedAssessments] = useState<Set<string>>(new Set());
  const [draftLogId, setDraftLogId] = useState<string | null>(null);

  // Conflict Guard State
  const [hasConflict, setHasConflict] = useState(false);
  const [conflictDate, setConflictDate] = useState('');

  // ---- V9 Mini Notes -----------------------------------------------------
  const [openNotes, setOpenNotes] = useState<StudentNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);
  const [newNoteError, setNewNoteError] = useState<string | null>(null);
  const [notesAdded, setNotesAdded] = useState<StudentNote[]>([]);

  useEffect(() => {
    async function checkConflict() {
      if (!studentUuid) {
        setHasConflict(false);
        return;
      }
      
      const { data } = await supabase
        .from('PsychE_Counseling_Logs')
        .select('id, scheduled_date')
        .eq('student_uuid', studentUuid)
        .in('session_status', ['Scheduled', 'Pending']);
        
      const activeConflicts = data?.filter(log => log.id !== scheduleId) || [];
      if (activeConflicts.length > 0) {
        setHasConflict(true);
        setConflictDate(activeConflicts[0].scheduled_date || 'future date');
      } else {
        setHasConflict(false);
        setConflictDate('');
      }
    }
    checkConflict();
  }, [studentUuid, scheduleId]);

  useDocumentTitle('Log Session');

  useEffect(() => {
    async function fetchInitialData() {
      // 1. Fetch Students
      const { data: sData } = await supabase.from('PsychE_Students').select('id, full_name, student_id');
      if (sData) setStudents(sData);

      // 2. Fetch Scheduled or Draft Log Info
      if (scheduleId) {
        const { data: schData } = await supabase.from('PsychE_Counseling_Logs').select('*').eq('id', scheduleId).single();
        if (schData) {
          setStudentUuid(schData.student_uuid);
          setReason(schData.reason);
          setCounselorName(schData.counselor_name || 'Counselor');
          if (schData.session_status === 'Draft') {
            if (schData.interaction_type) setInteractionType(schData.interaction_type);
            if (schData.student_response && schData.student_response !== 'Draft Assessment') setStudentResponse(schData.student_response);
            if (schData.recommended_action) setRecommendedAction(schData.recommended_action);
            if (schData.follow_up_date) setFollowUpDate(schData.follow_up_date);
            setDraftLogId(schData.id);
          }
        }
      }

      // 3. Fetch Active Modules
      const { data: mlData, error: mlError } = await supabase.from('PsychE_Modules').select('id, name, type, description, smart_keywords').eq('is_locked', false);
      if (mlError && (mlError.message.includes('description') || mlError.message.includes('smart_keywords'))) {
        // Fallback if schema hasn't updated yet
        const { data: fallbackData } = await supabase.from('PsychE_Modules').select('id, name, type').eq('is_locked', false);
        if (fallbackData) setMasterLibrary(fallbackData);
      } else if (mlData) {
        setMasterLibrary(mlData);
      }

      // 4. Fetch Config
      const { data: configData } = await supabase.from('PsychE_Settings').select('assessment_cooldown_days').limit(1).single();
      if (configData && configData.assessment_cooldown_days) {
        setCooldownDays(configData.assessment_cooldown_days);
      }

      // 5. Fetch Capacity
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const cap = await getAvailableCapacityForDateRange(today, 7);
      
      const arr = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() + i);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const dStr = `${y}-${m}-${day}`;
        arr.push({
          dateStr: dStr,
          label: i === 0 ? `Today · ${getWeekdayName(dStr, 'short')}` : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
          isSundayCol: isSunday(dStr),
          capacity: cap[dStr] || { total: 7, booked: 0, available: 7 }
        });
      }
      setCapacityData(arr);
    }
    fetchInitialData();
  }, [scheduleId]);

  /**
   * Open Mini Notes for the selected student (V9).
   *
   * This is the point of the whole feature: the reminders the counsellor left
   * themselves appear the moment a student is picked, above the intake field,
   * while there is still time to act on them. On the profile they are a record;
   * here they are a briefing.
   *
   * Notes written during this write-up are cleared on a student switch — they
   * belong to the student they were written about, and leaving them on screen
   * after the selection changes would suggest otherwise.
   */
  useEffect(() => {
    let cancelled = false;
    setNotesAdded([]);
    setNewNoteError(null);

    if (!studentUuid) {
      setOpenNotes([]);
      setNotesError(null);
      return;
    }

    (async () => {
      setNotesLoading(true);
      const { data, error } = await fetchOpenNotes(studentUuid);
      if (cancelled) return;
      setOpenNotes(data);
      setNotesError(error);
      setNotesLoading(false);
    })();

    return () => { cancelled = true; };
  }, [studentUuid]);

  /** Tick a note off from the strip — you just acted on it. */
  const handleResolveNote = async (note: StudentNote) => {
    setNoteBusy(true);
    const { error } = await setNoteDone(note.id, true);
    setNoteBusy(false);
    if (error) { setNotesError(error); return; }
    setNotesError(null);
    setOpenNotes(prev => prev.filter(n => n.id !== note.id));
  };

  /**
   * Write a note for next time. Saved immediately, not on form submit: a note
   * is an independent object, and binding it to the session save would mean an
   * abandoned write-up silently discards the one line worth keeping.
   */
  const handleAddNextTimeNote = async (body: string, kind: NoteKind) => {
    setNoteBusy(true);
    setNewNoteError(null);
    const { data, error } = await createNote({
      studentUuid,
      body,
      kind,
      author: counselorName,
    });
    setNoteBusy(false);
    if (error || !data) { setNewNoteError(error ?? 'Could not save that note.'); return; }
    setNotesAdded(prev => [data, ...prev]);
  };

  // Fetch past assessments when student changes
  useEffect(() => {
    async function fetchPastAssessments() {
      if (!studentUuid) return;
      const { data } = await supabase
        .from('PsychE_Counseling_Logs')
        .select('session_date, assessment_data')
        .eq('student_uuid', studentUuid)
        .not('assessment_data', 'is', null);

      if (data) setPastAssessments(data);
    }
    fetchPastAssessments();
  }, [studentUuid]);

  // Deterministic Suggestion Logic (Smart Engine)
  const handleIntakeChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setReason(text);

    if (!text.trim()) {
      setMatchedAssessments([]);
      return;
    }

    const cleanText = text.toLowerCase().replace(/[^\w\s]/gi, '');
    const words = new Set(cleanText.split(' '));
    
    const newMatches = new Set<string>();
    const now = new Date();

    masterLibrary.forEach(module => {
      let isMatch = false;
      const targetString = `${module.name || ''} ${module.description || ''}`.toLowerCase();
      const keywords = Array.isArray(module.smart_keywords) ? module.smart_keywords : [];
      
      for (const word of words) {
        if (word.length > 2 && (targetString.includes(word) || keywords.some((kw: string) => kw.toLowerCase().includes(word)))) {
          isMatch = true;
          break;
        }
      }

      if (isMatch) {
        // Smart Engine Cooldown Check
        const isCoolingDown = pastAssessments.some(log => {
          if (!log.assessment_data || !Array.isArray(log.assessment_data)) return false;
          
          const taken = new Date(log.session_date);
          const diffDays = (now.getTime() - taken.getTime()) / (1000 * 3600 * 24);
          
          if (diffDays <= cooldownDays) {
            return log.assessment_data.some((a: any) => a.module_id === module.id);
          }
          return false;
        });

        if (!isCoolingDown) {
          newMatches.add(module.id);
        }
      }
    });
    
    setMatchedAssessments(Array.from(newMatches));
  };



  const handleEmbeddedWizardComplete = (payload: any) => {
    if (payload.logId) {
      setDraftLogId(payload.logId);
    }
    setCompletedAssessments(prev => {
      const next = new Set(prev);
      next.add(payload.moduleId || 'daily_mix');
      return next;
    });
    setActiveWizardId(null);
  };



  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // 1. Conflict Guard (Single-Session Rule)
    if (hasConflict && followUpDate) {
      alert("Action Blocked: Student already has an active follow-up. Please edit the existing session instead.");
      return;
    }

    // Meaningful Data Enforcement (BUG-008)
    if (reason.trim().length < 15) {
      alert("Please provide at least 15 characters of meaningful context for the Reason.");
      return;
    }
    if (studentResponse.trim().length < 15) {
      alert("Please provide at least 15 characters of meaningful context for Summary Notes.");
      return;
    }

    setSaving(true);
    
    try {
      let finalLogId = draftLogId || scheduleId;
      
      const logUpdateData = {
        session_status: 'Completed',
        session_date: new Date().toISOString(),
        counselor_name: counselorName,
        reason: toSentenceCase(reason),
        student_response: toSentenceCase(studentResponse),
        recommended_action: toSentenceCase(recommendedAction),
        interaction_type: interactionType,
        follow_up_date: followUpDate || null,
        follow_up_status: followUpDate ? 'Pending' : null,
      };

      if (finalLogId) {
        // Pre-emptive Draft Commit path: update the existing draft/schedule log
        const { error } = await supabase.from('PsychE_Counseling_Logs')
          .update(logUpdateData)
          .eq('id', finalLogId);
        if (error) throw error;
      } else {
        // No embedded assessments were done, create a brand new log
        const { data, error } = await supabase.from('PsychE_Counseling_Logs').insert([
          {
            student_uuid: studentUuid,
            scheduled_date: toLocalDateStr(new Date()),
            ...logUpdateData
          }
        ]).select().single();
        if (error) throw error;
        finalLogId = data.id;
      }
      
      // 3. Handle Auto-Scheduling for follow-up
      if (followUpDate) {
        // parseISO, not `new Date(followUpDate)` — a bare YYYY-MM-DD parses as
        // UTC midnight natively, shifting to the previous local day for
        // negative-offset timezones (BUG-001).
        const followUpIso = parseISO(followUpDate).toISOString();
        const { error: followUpError } = await supabase.from('PsychE_Counseling_Logs').insert([
          {
            student_uuid: studentUuid,
            counselor_name: counselorName,
            session_date: followUpIso,
            scheduled_date: followUpDate,
            reason: 'Follow-up for: ' + (reason || 'General Session'),
            session_status: 'Scheduled',
            interaction_type: 'Session'
          }
        ]);
        if (followUpError) {
          console.error('Follow-up scheduling failed:', followUpError);
          alert('Log saved, but the follow-up session could not be scheduled. Please schedule it manually.');
        }
      }
      
      const savedStudent = students.find(s => s.id === studentUuid);
      const profileRoute = savedStudent?.student_id || studentUuid;
      navigate(studentUuid ? `/student/${profileRoute}` : '/');
    } catch (error) {
      console.error('Error saving log:', error);
      alert('Failed to save log. See console for details.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div variants={container} initial="hidden" animate="show" style={{ padding: '1rem 0', maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem', paddingBottom: '6rem' }}>
      
      <div className="flex justify-between items-center mobile-stack mobile-stack-start" style={{ gap: '1rem' }}>
        <div>
          <button onClick={() => navigate(-1)} className="btn btn-secondary mb-2" style={{ padding: '0.25rem 0.5rem', fontSize: '0.875rem', backgroundColor: 'transparent', border: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ArrowLeft size={16} /> Back to Dashboard
          </button>
          <h1 className="text-h1 flex items-center gap-2">{scheduleId ? 'Complete Scheduled Session' : 'Log a Counseling Session'}</h1>
          <p className="text-muted">Record session details. The Smart Engine will suggest tests as you type.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        
        {hasConflict && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }} 
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-3 p-4" 
            style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: 'var(--radius-md)', color: '#f59e0b' }}
          >
            <AlertTriangle size={24} style={{ flexShrink: 0 }} />
            <div>
              <p style={{ fontWeight: 600 }}>Action Required</p>
              <p style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>
                {students.find(s => s.id === studentUuid)?.full_name || 'This student'} already has a session scheduled for {conflictDate}. Please update the existing session's notes or select a different date.
              </p>
            </div>
          </motion.div>
        )}
        
        {/* TOP BENTO: Meta Info */}
        <motion.div className="bento-card" style={{ padding: '2rem' }}>
          <div className="flex gap-4 mobile-stack">
            <div style={{ flex: 1 }}>
              <label className="text-h3" style={{ fontSize: '0.875rem', display: 'block', marginBottom: '0.5rem' }}>Select Student *</label>
              <select 
                required
                className="input"
                value={studentUuid}
                onChange={(e) => setStudentUuid(e.target.value)}
                style={{ appearance: 'auto' }}
                disabled={!!scheduleId}
              >
                <option value="" disabled>-- Select a Student --</option>
                {students.map(s => (
                  <option key={s.id} value={s.id}>{s.full_name} ({s.student_id})</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label className="text-h3" style={{ fontSize: '0.875rem', display: 'block', marginBottom: '0.5rem' }}>Counselor Name *</label>
              <input 
                required
                type="text" 
                className="input" 
                value={counselorName}
                onChange={(e) => setCounselorName(e.target.value)}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="text-h3" style={{ fontSize: '0.875rem', display: 'block', marginBottom: '0.5rem' }}>Interaction Type</label>
              <select 
                required
                className="input"
                value={interactionType}
                onChange={(e) => setInteractionType(e.target.value)}
                style={{ appearance: 'auto' }}
              >
                <option value="" disabled>-- Select --</option>
                <option value="Session">Session</option>
                <option value="Quick Note">Quick Note</option>
                <option value="Parent Contact">Parent Contact</option>
              </select>
            </div>
          </div>
        </motion.div>

        {/* NOTES BRIEFING — what you told yourself last time, before you write */}
        <AnimatePresence>
          {studentUuid && (
            <NotePrompt
              notes={openNotes}
              studentName={students.find(s => s.id === studentUuid)?.full_name}
              loading={notesLoading}
              error={notesError}
              busy={noteBusy}
              onToggleDone={handleResolveNote}
            />
          )}
        </AnimatePresence>

        {/* MIDDLE BENTO: Intake & Trigger */}
        <motion.div className="bento-card" style={{ padding: '2rem' }}>
          <div>
            <label className="text-h3" style={{ fontSize: '1rem', display: 'block', marginBottom: '0.5rem' }}>Primary Reason / Intake Notes *</label>
            <textarea 
              required
              className="input resize-y" 
              rows={4}
              placeholder="e.g. Student is feeling extremely anxious about upcoming exams..."
              value={reason}
              onChange={handleIntakeChange}
              minLength={15}
            />
          </div>

          {/* ASSESSMENT AREA */}
          <AnimatePresence>
            {matchedAssessments.length > 0 && !activeWizardId && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                style={{ marginTop: '1.5rem' }}
              >
                <div style={{ backgroundColor: 'rgba(94, 106, 210, 0.05)', border: '1px solid rgba(94, 106, 210, 0.2)', borderRadius: 'var(--radius-md)', padding: '1rem' }}>
                  <h4 className="text-h3 flex items-center gap-2 mb-3" style={{ fontSize: '0.875rem', color: 'var(--color-primary)' }}>
                    <Sparkles size={16} /> Smart Suggestions
                  </h4>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {matchedAssessments.map(id => {
                      const module = masterLibrary.find(a => a.id === id);
                      if (!module) return null;
                      const isCompleted = completedAssessments.has(id);

                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => {
                            if (isCompleted) {
                              // Un-complete to edit
                              setCompletedAssessments(prev => {
                                const next = new Set(prev);
                                next.delete(id);
                                return next;
                              });
                            }
                            setActiveWizardId(id);
                          }}
                          style={{
                            padding: '0.5rem 1rem',
                            borderRadius: '20px',
                            backgroundColor: isCompleted ? 'rgba(16, 185, 129, 0.1)' : 'var(--color-surface)',
                            border: `1px solid ${isCompleted ? 'rgba(16, 185, 129, 0.3)' : 'var(--color-border)'}`,
                            color: isCompleted ? '#10b981' : 'inherit',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            cursor: 'pointer',
                            fontSize: '0.875rem',
                            transition: 'all 0.2s'
                          }}
                        >
                          {isCompleted ? <CheckCircle size={14} /> : <FileText size={14} className="text-muted" />}
                          {module.name} <span style={{ opacity: 0.7, fontSize: '0.75rem' }}>({module.type})</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* UNIVERSAL WIZARD OVERLAY */}
          {activeWizardId && (
            <AssessmentWizard
              moduleId={activeWizardId}
              studentUuid={studentUuid}
              counselorName={counselorName}
              existingLogId={draftLogId || scheduleId || undefined}
              onEmbeddedComplete={handleEmbeddedWizardComplete}
              onComplete={() => {}}
              onClose={() => setActiveWizardId(null)}
            />
          )}
        </motion.div>

        {/* BOTTOM BENTO: Notes & Action */}
        <motion.div className="bento-card" style={{ padding: '2rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div>
              <label className="text-h3" style={{ fontSize: '1rem', display: 'block', marginBottom: '0.5rem' }}>Summary Notes & Student Response</label>
              <textarea 
                className="input resize-y" 
                rows={4}
                placeholder="Synthesize the session, noting student reactions and overall takeaways..."
                value={studentResponse}
                onChange={(e) => setStudentResponse(e.target.value)}
                minLength={15}
              />
            </div>

            <div>
              <label className="text-h3" style={{ fontSize: '1rem', display: 'block', marginBottom: '0.5rem' }}>Recommended Action</label>
              <input 
                type="text" 
                className="input" 
                placeholder="e.g. Discussed study habits, Notified parents"
                value={recommendedAction}
                onChange={(e) => setRecommendedAction(e.target.value)}
              />
            </div>
            
            {/* ACTION / CUSTOM DATE PICKER */}
            <div>
              <div className="flex justify-between items-center mb-3 mobile-stack mobile-stack-start" style={{ gap: '0.5rem' }}>
                <label className="text-h3" style={{ fontSize: '1rem', margin: 0 }}>Schedule Next Touchpoint (Optional)</label>
                <button 
                  type="button"
                  onClick={() => {
                    setUseCustomDate(!useCustomDate);
                    setFollowUpDate(''); // Reset when switching
                  }}
                  style={{ background: 'transparent', border: 'none', color: 'var(--color-primary)', fontSize: '0.875rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                >
                  <CalendarIcon size={14} /> {useCustomDate ? 'Use Capacity Grid' : 'Select Custom Date'}
                </button>
              </div>

              {useCustomDate ? (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <input
                    type="date"
                    className="input"
                    style={{ width: '100%', padding: '0.75rem' }}
                    value={followUpDate}
                    onChange={(e) => setFollowUpDate(e.target.value)}
                    min={toLocalDateStr(new Date())}
                  />
                  {followUpDate && (
                    <p style={{
                      display: 'flex', alignItems: 'center', gap: '0.3rem',
                      fontSize: '0.8125rem', fontWeight: isSunday(followUpDate) ? 700 : 400,
                      marginTop: '0.4rem',
                      color: isSunday(followUpDate) ? '#f87171' : 'var(--color-text-muted)'
                    }}>
                      {isSunday(followUpDate) && <AlertTriangle size={13} />}
                      {getWeekdayName(followUpDate)}
                      {isSunday(followUpDate) ? ' — Sunday' : ''}
                    </p>
                  )}
                </motion.div>
              ) : (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '0.5rem' }}>
                  {capacityData.map((day) => {
                    const isFull = day.capacity.booked >= day.capacity.total;
                    const isSelected = followUpDate === day.dateStr;
                    
                    return (
                      <div 
                        key={day.dateStr}
                        onClick={() => {
                          if (isSelected) setFollowUpDate('');
                          else {
                            if (isFull && !window.confirm(`This day is at full capacity (${day.capacity.booked}/${day.capacity.total}). Overbook?`)) return;
                            setFollowUpDate(day.dateStr);
                          }
                        }}
                        style={{
                          padding: '0.75rem',
                          borderRadius: 'var(--radius-md)',
                          border: `1px solid ${isSelected ? 'var(--color-primary)' : isFull ? 'rgba(239, 68, 68, 0.3)' : day.isSundayCol ? 'rgba(245,158,11,0.3)' : 'var(--color-border)'}`,
                          backgroundColor: isSelected ? 'rgba(94, 106, 210, 0.2)' : isFull ? 'rgba(239, 68, 68, 0.05)' : day.isSundayCol ? 'rgba(245,158,11,0.06)' : 'rgba(24, 27, 33, 0.5)',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          textAlign: 'center'
                        }}
                      >
                        <span style={{ fontSize: '0.875rem', fontWeight: isSelected ? 600 : 400, color: isFull && !isSelected ? 'var(--color-danger)' : day.isSundayCol && !isSelected ? '#f59e0b' : 'inherit' }}>{day.label}</span>
                        <span style={{ fontSize: '0.75rem', color: isFull && !isSelected ? 'var(--color-danger)' : 'var(--color-text-muted)', marginTop: '4px' }}>{day.capacity.booked}/{day.capacity.total}</span>
                      </div>
                    );
                  })}
                </motion.div>
              )}
            </div>

            {/* ── Note for next time (V9) ───────────────────────────────────
                Sits directly after the follow-up scheduler because that is
                where the counsellor is already thinking about the next
                contact — "I'll see her in a fortnight, and when I do…". */}
            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1.5rem' }}>
              <NextTimeNote
                disabled={!studentUuid}
                saving={noteBusy}
                error={newNoteError}
                justAdded={notesAdded}
                onCreate={handleAddNextTimeNote}
              />
            </div>

          </div>
        </motion.div>

        <div className="flex justify-end mt-4 mb-12">
          <motion.button 
            type="submit"
            disabled={saving || !reason || activeWizardId !== null}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="btn btn-primary"
            style={{ 
              background: 'linear-gradient(135deg, var(--color-primary), #8b5cf6)', 
              border: 'none', 
              padding: '1rem 3rem',
              fontSize: '1.1rem',
              opacity: (saving || !reason || activeWizardId !== null) ? 0.5 : 1 
            }}
          >
            {saving ? 'Saving...' : <><Save size={20} /> Save Session Record</>}
          </motion.button>
        </div>
      </form>
    </motion.div>
  );
};
