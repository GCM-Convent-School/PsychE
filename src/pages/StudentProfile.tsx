import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Edit2, Calendar, Phone, Mail, BookOpen, ArrowLeft, Eye, EyeOff, User, BrainCircuit, FileDown, X, Tag, Plus, Activity, Sparkles, AlertTriangle, FileText } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import { parseISO } from 'date-fns';
import { supabase } from '../lib/supabase';
import { AssessmentWizard } from '../components/AssessmentWizard';
import type { AIReport, FormalizedSession, NoteKind, StudentNote, TelemetryPayload } from '../types';
import { MIN_COMPOSITE_CONFIDENCE } from '../types';
import { MiniNotesPanel } from '../components/MiniNotes';
import {
  createNote, deleteNote, fetchStudentNotes, setNoteDone, setNotePinned, sortNotes, updateNoteBody
} from '../lib/studentNotes';
import { AIReportPanel } from '../components/AIReportPanel';
import { fetchLatestReport, generateReport } from '../lib/aiReports';
import { AISummaryCard } from '../components/AISummaryCard';
import { TimelineEntry } from '../components/TimelineEntry';
import { fetchFormalizedSessions, formalizeSessions } from '../lib/formalizedSessions';
import {
  EvidenceStrip, DomainProfile, TensionStrip, EngagementPanel,
  CompositeContribution, RsiPanel
} from '../components/TelemetryPanel';
import type { TensionAxis } from '../components/TelemetryPanel';
import type { EngineStatus } from '../analytics/ColdStart';
import { calculateConfidenceMultiplier } from '../analytics/ColdStart';
import { useDocumentTitle } from '../lib/branding';

/** One prior telemetry snapshot, for trend + delta */
interface TelemetryHistoryRow {
  date: string;
  eti: number | null;
  composite: number | null;
}

interface CohortInfo {
  eligiblePeers: number;
  totalPeers: number;
  peerScores: number[];
}

/** Shape of the nested telemetry rows returned by the peer cohort query */
interface PeerTelemetryRow {
  composite_score: number | null;
  composite_confidence: number | null;
  calculated_at: string;
}

const DOMAIN_CODES = ['BHV', 'SOC', 'COG', 'EMH', 'FAM', 'CAR', 'SEL'];
const RSI_MIN_COHORT = 8;

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.1 } }
};

const item = {
  hidden: { opacity: 0, scale: 0.95, y: 20 },
  show: { opacity: 1, scale: 1, y: 0, transition: { type: 'spring' as const, stiffness: 300, damping: 24 } }
};

export const StudentProfile: React.FC = () => {
  const { studentId } = useParams();
  const navigate = useNavigate();
  const [student, setStudent] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Privacy States
  const [showPhone, setShowPhone] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  
  // Assessment Selection & Wizard States

  
  // Active Wizard State
  const [activeAssessmentId, setActiveAssessmentId] = useState<string | null>(null);
  const [activeDraftLogId, setActiveDraftLogId] = useState<string | undefined>(undefined);
  const [activeDraftData, setActiveDraftData] = useState<Record<string, any>>({});

  // Tags States
  const [allTags, setAllTags] = useState<any[]>([]);
  const [studentTags, setStudentTags] = useState<any[]>([]);
  const [isTagModalOpen, setIsTagModalOpen] = useState(false);
  const [tagSearchQuery, setTagSearchQuery] = useState('');
  
  // Timeline States
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());

  // Telemetry State
  const [telemetry, setTelemetry] = useState<TelemetryPayload | null>(null);
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
  const [activeTab, setActiveTab] = useState<'profile' | 'history' | 'telemetry' | 'summary'>('profile');
  const [historyView, setHistoryView] = useState<'raw' | 'formal'>('raw');
  const [summaryView, setSummaryView] = useState<'quick' | 'technical'>('quick');

  // V7.2 — supporting evidence for the redesigned telemetry tab
  const [telemetryHistory, setTelemetryHistory] = useState<TelemetryHistoryRow[]>([]);
  const [cohort, setCohort] = useState<CohortInfo>({ eligiblePeers: 0, totalPeers: 0, peerScores: [] });
  const [instrumented, setInstrumented] = useState<Record<string, boolean>>({});

  // Date Range Report States
  // ---- V9 Mini Notes -----------------------------------------------------
  const [notes, setNotes] = useState<StudentNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteComposerError, setNoteComposerError] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<StudentNote | null>(null);

  // ---- V10 AI Technical Report --------------------------------------------
  const [aiReport, setAiReport] = useState<AIReport | null>(null);
  const [aiReportLoading, setAiReportLoading] = useState(true);
  const [aiReportError, setAiReportError] = useState<string | null>(null);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiGenerateError, setAiGenerateError] = useState<string | null>(null);
  const [aiInsufficientData, setAiInsufficientData] = useState(false);
  const [aiCooldownActive, setAiCooldownActive] = useState(false);
  const [aiCooldownEndsAt, setAiCooldownEndsAt] = useState<string | null>(null);

  // ---- V12 Formal Timeline (per-session) -----------------------------------
  const [formalizedSessions, setFormalizedSessions] = useState<FormalizedSession[]>([]);
  const [formalizedLoading, setFormalizedLoading] = useState(true);
  const [formalizedError, setFormalizedError] = useState<string | null>(null);
  const [formalizing, setFormalizing] = useState(false);
  const [formalizeError, setFormalizeError] = useState<string | null>(null);

  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportKind, setReportKind] = useState<'raw' | 'formal'>('raw');
  const [reportType, setReportType] = useState('custom');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reportIncludeTelemetry, setReportIncludeTelemetry] = useState(false);
  const [reportIncludeSummary, setReportIncludeSummary] = useState(false);
  useDocumentTitle('Student Profile');

  useEffect(() => {
    async function fetchStudentProfile() {
      if (!studentId) return;
      try {
        const { data: studentData, error: studentError } = await supabase
          .from('PsychE_Students')
          .select('*')
          .eq('student_id', studentId)
          .single();

        if (studentError) throw studentError;
        setStudent(studentData);

        const { data: logsData, error: logsError } = await supabase
          .from('PsychE_Counseling_Logs')
          .select('*')
          .eq('student_uuid', studentData.id)
          .order('session_date', { ascending: false });

        if (logsError) throw logsError;
        
        setLogs(logsData || []);

        // Fetch Telemetry
        const { data: telemetryRow } = await supabase
          .from('PsychE_Student_Telemetry')
          .select('*')
          .eq('student_uuid', studentData.id)
          .order('calculated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (telemetryRow) {
          const payload = {
            ...(telemetryRow.metrics_payload || {}),
            engine_status: telemetryRow.engine_status,
            confidence_multiplier: telemetryRow.confidence_multiplier,
            eti_score: telemetryRow.eti_score,
            eti_data: telemetryRow.eti_data,
            composite_score: telemetryRow.composite_score,
            composite_confidence: telemetryRow.composite_confidence,
            composite_data: telemetryRow.composite_data,
            rsi_score: telemetryRow.rsi_score,
            rsi_data: telemetryRow.rsi_data
          };
          setTelemetry(payload as TelemetryPayload);
        }

        const { data: engineStatusStr, error: engineError } = await supabase
          .rpc('psyche_get_engine_status', { p_student_uuid: studentData.id });
        if (!engineError && engineStatusStr) {
          setEngineStatus(engineStatusStr as EngineStatus);
        }

        // --- V7.2 supporting evidence -------------------------------------
        // (a) 30-day snapshot history for the trend line and deltas
        const since = new Date();
        since.setDate(since.getDate() - 30);
        const { data: histRows, error: histError } = await supabase
          .from('PsychE_Student_Telemetry')
          .select('calculated_at, eti_score, composite_score')
          .eq('student_uuid', studentData.id)
          .gte('calculated_at', since.toISOString())
          .order('calculated_at', { ascending: true });
        if (histError) console.warn('Telemetry history unavailable:', histError.message);
        else setTelemetryHistory((histRows ?? []).map(r => ({
          date: new Date(r.calculated_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
          eti: r.eti_score,
          composite: r.composite_score
        })));

        // (b) Cohort readiness — mirrors the SQL fallback (course → grade → school).
        //     Recomputed client-side purely for display; the authoritative RSI
        //     still comes from psyche_compute_rsi_for_student().
        const grade = (studentData.course ?? '').split(' - ')[0];
        const { data: peerRows, error: peerError } = await supabase
          .from('PsychE_Students')
          .select('id, course, PsychE_Student_Telemetry(composite_score, composite_confidence, calculated_at)')
          .neq('id', studentData.id);
        if (peerError) console.warn('Cohort data unavailable:', peerError.message);
        else {
          const today = new Date().toISOString().slice(0, 10);
          const latestOf = (rows: PeerTelemetryRow[] | null) => (rows ?? [])
            .filter(r => (r.calculated_at ?? '').slice(0, 10) === today)
            .sort((a, b) => (b.calculated_at ?? '').localeCompare(a.calculated_at ?? ''))[0];

          const scoped = (level: 'course' | 'grade' | 'school') => (peerRows ?? []).filter(p =>
            level === 'course' ? p.course === studentData.course
              : level === 'grade' ? (p.course ?? '').split(' - ')[0] === grade
                : true);

          const eligibleIn = (level: 'course' | 'grade' | 'school') => scoped(level)
            .map(p => latestOf(p.PsychE_Student_Telemetry as PeerTelemetryRow[]))
            .filter(t => t?.composite_score != null && (t?.composite_confidence ?? 0) >= MIN_COMPOSITE_CONFIDENCE);

          let eligible = eligibleIn('course');
          for (const level of ['grade', 'school'] as const) {
            if (eligible.length + 1 >= RSI_MIN_COHORT) break;
            eligible = eligibleIn(level);
          }
          setCohort({
            eligiblePeers: eligible.length,
            totalPeers: (peerRows ?? []).length,
            peerScores: eligible.map(t => t.composite_score as number)
          });
        }

        // (c) Which domains have any active assessment item at all
        const { data: modRows, error: modError } = await supabase
          .from('PsychE_Modules')
          .select('domain_code, PsychE_Questions(is_active)');
        if (modError) console.warn('Instrument coverage unavailable:', modError.message);
        else {
          const cover: Record<string, boolean> = {};
          for (const code of DOMAIN_CODES) cover[code] = false;
          for (const m of modRows ?? []) {
            const active = ((m.PsychE_Questions as { is_active: boolean }[]) ?? []).some(q => q.is_active);
            if (m.domain_code && active) cover[m.domain_code] = true;
          }
          setInstrumented(cover);
        }

        // Fetch Tags
        const { data: sysTags } = await supabase.from('PsychE_System_Tags').select('*');
        if (sysTags) setAllTags(sysTags);

        const { data: stTags } = await supabase
          .from('PsychE_Student_Tags')
          .select('tag_id, PsychE_System_Tags(*)')
          .eq('student_uuid', studentData.id);
        
        if (stTags) {
          setStudentTags(stTags.map((st: any) => st.PsychE_System_Tags).filter(Boolean));
        }

      } catch (error) {
        console.error('Error fetching student profile:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchStudentProfile();
  }, [studentId]);

  /**
   * Mini Notes (V9).
   *
   * Deliberately its own effect rather than a step inside fetchStudentProfile:
   * that function wraps everything in one try/catch, so a missing
   * PsychE_Student_Notes table — a database that has not had the 6.2 installer
   * run against it — would throw and take the entire profile down with it. A
   * counsellor should never lose the student record because a notes table is
   * absent. Here the failure is contained and reported inside the notes card.
   */
  useEffect(() => {
    if (!student?.id) return;
    let cancelled = false;

    (async () => {
      setNotesLoading(true);
      const { data, error } = await fetchStudentNotes(student.id);
      if (cancelled) return;
      setNotes(data);
      setNotesError(error);
      setNotesLoading(false);
    })();

    return () => { cancelled = true; };
  }, [student?.id]);

  /** Replace one note in place, preserving the pinned-first / newest-first order. */
  const mergeNote = (updated: StudentNote) =>
    setNotes(prev => sortNotes(prev.map(n => (n.id === updated.id ? updated : n))));

  const handleCreateNote = async (body: string, kind: NoteKind) => {
    if (!student?.id) return;
    setNoteSaving(true);
    setNoteComposerError(null);
    const { data, error } = await createNote({ studentUuid: student.id, body, kind });
    setNoteSaving(false);
    if (error || !data) { setNoteComposerError(error ?? 'Could not save that note.'); return; }
    setNotes(prev => sortNotes([data, ...prev]));
  };

  const handleUpdateNote = async (note: StudentNote, body: string, kind: NoteKind) => {
    setNoteSaving(true);
    setNoteComposerError(null);
    const { data, error } = await updateNoteBody(note.id, body, kind);
    setNoteSaving(false);
    if (error || !data) { setNoteComposerError(error ?? 'Could not save that note.'); return; }
    mergeNote(data);
    setEditingNote(null);
  };

  const handleToggleNoteDone = async (note: StudentNote) => {
    const { data, error } = await setNoteDone(note.id, !note.is_done);
    if (error || !data) { setNotesError(error ?? 'Could not update that note.'); return; }
    setNotesError(null);
    mergeNote(data);
  };

  const handleToggleNotePin = async (note: StudentNote) => {
    const { data, error } = await setNotePinned(note.id, !note.is_pinned);
    if (error || !data) { setNotesError(error ?? 'Could not update that note.'); return; }
    setNotesError(null);
    mergeNote(data);
  };

  const handleDeleteNote = async (note: StudentNote) => {
    // Resolving is the normal path and is reversible; deleting is not, so it
    // gets the same confirm gate as deleting a session.
    if (!window.confirm('Delete this note permanently? Marking it done keeps it in the archive instead.')) return;
    const { error } = await deleteNote(note.id);
    if (error) { setNotesError(error); return; }
    setNotesError(null);
    setNotes(prev => prev.filter(n => n.id !== note.id));
    if (editingNote?.id === note.id) setEditingNote(null);
  };

  /**
   * AI Technical Report (V10).
   *
   * Own effect, same reasoning as Mini Notes above: a database that hasn't had
   * the 6.3 migration run against it must not take the whole profile down
   * just because PsychE_AI_Reports doesn't exist yet.
   */
  useEffect(() => {
    if (!student?.id) return;
    let cancelled = false;

    (async () => {
      setAiReportLoading(true);
      const { data, error } = await fetchLatestReport(student.id);
      if (cancelled) return;
      setAiReport(data);
      setAiReportError(error);
      setAiReportLoading(false);
    })();

    return () => { cancelled = true; };
  }, [student?.id]);

  const handleGenerateAIReport = async () => {
    if (!student?.id) return;
    setAiGenerating(true);
    setAiGenerateError(null);
    setAiInsufficientData(false);
    setAiCooldownActive(false);
    setAiCooldownEndsAt(null);

    const { data, error, insufficientData, cooldownActive, cooldownEndsAt } = await generateReport(student.id);
    setAiGenerating(false);

    if (error) { setAiGenerateError(error); return; }
    if (insufficientData) { setAiInsufficientData(true); return; }
    if (cooldownActive) {
      setAiCooldownActive(true);
      setAiCooldownEndsAt(cooldownEndsAt ?? null);
      if (data) setAiReport(data);
      return;
    }
    if (data) setAiReport(data);
  };

  /** Formal Timeline (V12) — own effect, same isolation reasoning as the two above. */
  useEffect(() => {
    if (!student?.id) return;
    let cancelled = false;

    (async () => {
      setFormalizedLoading(true);
      const { data, error } = await fetchFormalizedSessions(student.id);
      if (cancelled) return;
      setFormalizedSessions(data);
      setFormalizedError(error);
      setFormalizedLoading(false);
    })();

    return () => { cancelled = true; };
  }, [student?.id]);

  /** The only async AI call left in this feature — tops up whatever's pending, once, in one batched call. */
  const handleFormalizeSessions = async () => {
    if (!student?.id) return;
    setFormalizing(true);
    setFormalizeError(null);
    const { formalizedSessions: newRows, error, alreadyCurrent } = await formalizeSessions(student.id);
    setFormalizing(false);
    if (error) { setFormalizeError(error); return; }
    if (!alreadyCurrent && newRows.length > 0) {
      setFormalizedSessions(prev => [...prev, ...newRows]);
    }
  };

  /**
   * Close (or cancel) a scheduled follow-up.
   *
   * Until V6 there was NO write path that set follow_up_status to anything but
   * 'Pending' — so ETI's follow-through term, `1 - (pending / total_logs)`,
   * could only ever fall. Every follow-up a counselor scheduled permanently
   * depressed that student's ETI (and therefore Composite Score and RSI) with
   * no way to earn it back by actually doing the follow-up. The SQL was
   * correct — it counts only 'Pending' — so restoring this write path is the
   * whole fix; no migration is needed.
   */
  const setFollowUpStatus = async (logId: string, status: 'Done' | 'Cancelled') => {
    const previous = logs;
    // optimistic — simple status toggle, reverted on error (GUIDE §3)
    setLogs(prev => prev.map(l => (l.id === logId ? { ...l, follow_up_status: status } : l)));
    const { error } = await supabase
      .from('PsychE_Counseling_Logs')
      .update({ follow_up_status: status })
      .eq('id', logId);
    if (error) {
      setLogs(previous);
      alert(`Could not update follow-up: ${error.message}`);
    }
  };

  const toggleExpand = (logId: string) => {
    setExpandedLogs(prev => {
      const next = new Set(prev);
      if (next.has(logId)) next.delete(logId);
      else next.add(logId);
      return next;
    });
  };

  const maskPhone = (phone: string | null) => {
    if (!phone) return 'N/A';
    if (showPhone) return phone;
    if (phone.length <= 8) return '****';
    return phone.substring(0, 4) + '******' + phone.substring(phone.length - 4);
  };

  const maskEmail = (email: string | null) => {
    if (!email) return 'N/A';
    if (showEmail) return email;
    const parts = email.split('@');
    if (parts.length !== 2) return '****';
    const name = parts[0];
    const maskedName = name.length > 2 ? name.substring(0, 2) + '****' : '****';
    return `${maskedName}@${parts[1]}`;
  };

  // Generation and printing are fully decoupled now (V12) — this is a pure
  // navigate for BOTH Raw and Formal. Formalizing happens ahead of time, from
  // the History → Formal Timeline tab; printing just reads what's already
  // there (or the raw text with a "not yet formalized" note), so there is no
  // Edge Function call in this modal at all anymore.
  const handleGenerateReport = () => {
    if (reportType !== 'allTime' && (!startDate || !endDate)) {
      alert("Please select both start and end dates.");
      return;
    }
    const range = reportType === 'allTime' ? 'allTime=true' : `start=${startDate}&end=${endDate}`;
    const flags = `includeTelemetry=${reportIncludeTelemetry}&includeSummary=${reportIncludeSummary}`;
    const path = reportKind === 'raw' ? '/report' : '/formal-report';
    setIsReportModalOpen(false);
    navigate(`${path}?studentId=${student.id}&${range}&${flags}`);
  };

  const handleToggleTag = async (tag: any) => {
    const hasTag = studentTags.some(t => t.id === tag.id);
    if (hasTag) {
      const { error } = await supabase.from('PsychE_Student_Tags').delete().eq('student_uuid', student.id).eq('tag_id', tag.id);
      if (error) { alert(`Could not remove tag: ${error.message}`); return; }
      setStudentTags(studentTags.filter(t => t.id !== tag.id));
    } else {
      const { error } = await supabase.from('PsychE_Student_Tags').insert([{ student_uuid: student.id, tag_id: tag.id }]);
      if (error) { alert(`Could not add tag: ${error.message}`); return; }
      setStudentTags([...studentTags, tag]);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}>
          <BookOpen size={32} color="var(--color-primary)" />
        </motion.div>
      </div>
    );
  }

  if (!student) return <div style={{ padding: '2rem', textAlign: 'center' }}>Student not found.</div>;

  return (
    <motion.div variants={container} initial="hidden" animate="show" style={{ padding: '1rem 0' }}>
      
      {/* Header Actions */}
      <motion.div variants={item} className="flex justify-between items-center mb-6 no-print mobile-stack mobile-stack-start" style={{ gap: '1rem' }}>
        <div>
          <button onClick={() => navigate(-1)} className="btn btn-secondary mb-4" style={{ padding: '0.25rem 0.5rem', fontSize: '0.875rem', backgroundColor: 'transparent', border: 'none' }}>
            <ArrowLeft size={16} /> Back
          </button>
          <h1 className="text-h1 flex items-center gap-3">
            {student.profile_image ? (
              <img src={student.profile_image} alt={student.full_name} style={{ width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover' }} />
            ) : (
              <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><User size={24} /></div>
            )}
            {student.full_name}
            <span style={{ fontSize: '0.875rem', padding: '0.25rem 0.75rem', backgroundColor: 'rgba(94, 106, 210, 0.1)', color: 'var(--color-primary)', borderRadius: 'var(--radius-full)' }}>Active</span>
            <span style={{ 
              fontSize: '0.875rem', 
              padding: '0.25rem 0.75rem', 
              backgroundColor: student.risk_level === 'High' ? 'rgba(239, 68, 68, 0.1)' : student.risk_level === 'Medium' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(74, 222, 128, 0.1)',
              color: student.risk_level === 'High' ? '#ef4444' : student.risk_level === 'Medium' ? '#f59e0b' : '#4ade80',
              borderRadius: 'var(--radius-full)',
              fontWeight: 600
            }}>Risk: {student.risk_level || 'Low'}</span>
          </h1>
          <p className="text-muted">{student.course} • ID: {student.student_id}</p>
        </div>
        <div className="flex gap-4">

          <motion.button 
            whileHover={{ scale: 1.05 }} 
            whileTap={{ scale: 0.95 }} 
            className="btn btn-secondary" 
            onClick={() => setIsReportModalOpen(true)}
            style={{ backgroundColor: 'rgba(94, 106, 210, 0.1)', color: 'var(--color-primary)', borderColor: 'transparent' }}
          >
            <FileDown size={18} /> Generate Report
          </motion.button>

          <motion.button 
            whileHover={{ scale: 1.05 }} 
            whileTap={{ scale: 0.95 }} 
            className="btn btn-secondary no-print" 
            onClick={() => {
              setActiveAssessmentId('daily_mix');
              setActiveDraftLogId(undefined);
              setActiveDraftData({});
            }}
            style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981', borderColor: 'transparent' }}
          >
            <BrainCircuit size={18} /> Live Assessment
          </motion.button>
          
          <motion.button 
            onClick={() => navigate(`/edit-student/${student.id}`)}
            whileHover={{ scale: 1.05 }} 
            whileTap={{ scale: 0.95 }} 
            className="btn btn-primary" 
            style={{ background: 'linear-gradient(135deg, var(--color-primary), #8b5cf6)', border: 'none', boxShadow: '0 4px 12px rgba(94, 106, 210, 0.3)' }}
          >
            <Edit2 size={18} /> Edit Profile
          </motion.button>
        </div>
      </motion.div>

      {/* Tabs — Profile (static reference) / History (what happened) / Telemetry
          (the numbers) / Summary (what the AI thinks). History and Summary each
          carry their own Raw-vs-Formal / Quick-vs-Technical toggle rather than
          becoming yet more top-level tabs — one "fast view / deep view" pattern,
          reused twice, is easier to learn than a flat pile of destinations. */}
      <div className="flex gap-4 mb-6" style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
        <button
          onClick={() => setActiveTab('profile')}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '0.5rem 1rem',
            fontWeight: 600, color: activeTab === 'profile' ? 'var(--color-text)' : 'var(--color-text-muted)',
            borderBottom: activeTab === 'profile' ? '2px solid var(--color-primary)' : '2px solid transparent',
            transition: 'all 0.2s'
          }}
        >
          <User size={16} style={{ display: 'inline', marginRight: '0.5rem', marginBottom: '2px' }} />
          Profile
        </button>
        <button
          onClick={() => setActiveTab('history')}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '0.5rem 1rem',
            fontWeight: 600, color: activeTab === 'history' ? 'var(--color-text)' : 'var(--color-text-muted)',
            borderBottom: activeTab === 'history' ? '2px solid var(--color-primary)' : '2px solid transparent',
            transition: 'all 0.2s'
          }}
        >
          <BookOpen size={16} style={{ display: 'inline', marginRight: '0.5rem', marginBottom: '2px' }} />
          History
        </button>
        <button
          onClick={() => setActiveTab('telemetry')}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '0.5rem 1rem',
            fontWeight: 600, color: activeTab === 'telemetry' ? 'var(--color-text)' : 'var(--color-text-muted)',
            borderBottom: activeTab === 'telemetry' ? '2px solid var(--color-primary)' : '2px solid transparent',
            transition: 'all 0.2s'
          }}
        >
          <Activity size={16} style={{ display: 'inline', marginRight: '0.5rem', marginBottom: '2px' }} />
          Telemetry
        </button>
        <button
          onClick={() => setActiveTab('summary')}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '0.5rem 1rem',
            fontWeight: 600, color: activeTab === 'summary' ? 'var(--color-text)' : 'var(--color-text-muted)',
            borderBottom: activeTab === 'summary' ? '2px solid var(--color-primary)' : '2px solid transparent',
            transition: 'all 0.2s'
          }}
        >
          <Sparkles size={16} style={{ display: 'inline', marginRight: '0.5rem', marginBottom: '2px' }} />
          Summary
        </button>
      </div>

      <div className="bento-grid">
        {activeTab === 'profile' && (
          <>
            {/* Personal Details */}
            <motion.div variants={item} className="bento-card col-span-12">
          <h3 className="text-h3 mb-4">Personal Details</h3>
          <div className="flex" style={{ flexDirection: 'column', gap: '1.25rem' }}>
            
            {/* Phone with Privacy Toggle — hidden if no data */}
            {student.mobile && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div style={{ padding: '0.5rem', backgroundColor: 'var(--color-bg)', borderRadius: 'var(--radius-md)' }}><Phone size={16} className="text-primary"/></div>
                <div>
                  <p className="text-muted" style={{ fontSize: '0.75rem' }}>Phone</p>
                  <p style={{ fontWeight: 500, fontFamily: showPhone ? 'inherit' : 'monospace' }}>{maskPhone(student.mobile)}</p>
                </div>
              </div>
              <button onClick={() => setShowPhone(!showPhone)} className="btn btn-secondary no-print" style={{ padding: '0.25rem', border: 'none', background: 'transparent' }}>
                {showPhone ? <EyeOff size={16} className="text-muted" /> : <Eye size={16} className="text-muted" />}
              </button>
            </div>
            )}

            {/* Email with Privacy Toggle — hidden if no data */}
            {student.email && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div style={{ padding: '0.5rem', backgroundColor: 'var(--color-bg)', borderRadius: 'var(--radius-md)' }}><Mail size={16} className="text-primary"/></div>
                <div>
                  <p className="text-muted" style={{ fontSize: '0.75rem' }}>Email</p>
                  <p style={{ fontWeight: 500 }}>{maskEmail(student.email)}</p>
                </div>
              </div>
              <button onClick={() => setShowEmail(!showEmail)} className="btn btn-secondary no-print" style={{ padding: '0.25rem', border: 'none', background: 'transparent' }}>
                {showEmail ? <EyeOff size={16} className="text-muted" /> : <Eye size={16} className="text-muted" />}
              </button>
            </div>
            )}

            {/* Father — hidden if no data */}
            {student.fathers_name && (
            <div className="flex items-center gap-3">
              <div style={{ padding: '0.5rem', backgroundColor: 'var(--color-bg)', borderRadius: 'var(--radius-md)' }}><User size={16} className="text-primary"/></div>
              <div><p className="text-muted" style={{ fontSize: '0.75rem' }}>Father's Name</p><p style={{ fontWeight: 500 }}>{student.fathers_name}</p></div>
            </div>
            )}

            {/* Mother — hidden if no data */}
            {student.mothers_name && (
            <div className="flex items-center gap-3">
              <div style={{ padding: '0.5rem', backgroundColor: 'var(--color-bg)', borderRadius: 'var(--radius-md)' }}><User size={16} className="text-primary"/></div>
              <div><p className="text-muted" style={{ fontSize: '0.75rem' }}>Mother's Name</p><p style={{ fontWeight: 500 }}>{student.mothers_name}</p></div>
            </div>
            )}


            {/* Enrolled — hidden if no data */}
            {student.enrolled_date && (
            <div className="flex items-center gap-3">
              <div style={{ padding: '0.5rem', backgroundColor: 'var(--color-bg)', borderRadius: 'var(--radius-md)' }}><Calendar size={16} className="text-primary"/></div>
              <div><p className="text-muted" style={{ fontSize: '0.75rem' }}>Enrolled</p><p style={{ fontWeight: 500 }}>{parseISO(student.enrolled_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p></div>
            </div>
            )}

          </div>


          {/* ── Tags Section (inside left card) ── */}
          <div className="no-print" style={{ marginTop: '1.5rem', paddingTop: '1.25rem', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
                <Tag size={12} /> Tags
              </span>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => { setIsTagModalOpen(true); setTagSearchQuery(''); }}
                style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.25rem 0.6rem', fontSize: '0.6875rem', fontWeight: 600, borderRadius: 'var(--radius-full)', backgroundColor: 'rgba(94,106,210,0.12)', color: 'var(--color-primary)', border: '1px solid rgba(94,106,210,0.25)', cursor: 'pointer' }}
              >
                <Plus size={10} /> Manage
              </motion.button>
            </div>

            {studentTags.length === 0 ? (
              <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>No tags assigned yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                {Object.entries(
                  studentTags.reduce((acc: Record<string, any[]>, tag: any) => {
                    const cat = tag.tag_category || 'General';
                    if (!acc[cat]) acc[cat] = [];
                    acc[cat].push(tag);
                    return acc;
                  }, {})
                ).map(([cat, catTags]) => (
                  <div key={cat}>
                    <p style={{ fontSize: '0.625rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: '0.4rem' }}>{cat}</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                      {(catTags as any[]).map((tag: any) => (
                        <span
                          key={tag.id}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.2rem 0.55rem', fontSize: '0.71875rem', fontWeight: 600, borderRadius: 'var(--radius-full)', backgroundColor: `${tag.color_hex}18`, color: tag.color_hex, border: `1px solid ${tag.color_hex}30` }}
                        >
                          <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: tag.color_hex, flexShrink: 0 }} />
                          {tag.tag_name}
                          <button
                            onClick={() => handleToggleTag(tag)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: tag.color_hex, opacity: 0.55, display: 'flex', alignItems: 'center', padding: 0, marginLeft: '0.05rem' }}
                            title="Remove tag"
                          >
                            <X size={9} />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>

        {/* ── Mini Notes (V9) ──────────────────────────────────────────────
            Placed above the history timeline on purpose: what you told
            yourself to do next is more useful than what already happened. */}
        <motion.div variants={item} className="bento-card col-span-12">
          <MiniNotesPanel
            notes={notes}
            loading={notesLoading}
            error={notesError}
            saving={noteSaving}
            composerError={noteComposerError}
            editing={editingNote}
            onCreate={handleCreateNote}
            onUpdate={handleUpdateNote}
            onToggleDone={handleToggleNoteDone}
            onTogglePin={handleToggleNotePin}
            onDelete={handleDeleteNote}
            onStartEdit={(n) => { setEditingNote(n); setNoteComposerError(null); }}
          />
        </motion.div>

          </>
        )}

        {/* ── History tab: Raw Timeline ↔ Formal Timeline ──────────────────
            Two renderings of the SAME sessions — verbatim, or with reason /
            notes / action rewritten in formal clinical language. Same
            component (TimelineEntry) renders both; only the text differs.
            Same toggle idiom as Summary below, so a counsellor learns "fast
            view / deep view" once. */}
        {activeTab === 'history' && (() => {
          const completedLogs = logs.filter(l => l.session_status === 'Completed');
          const formalizedByLogId = new Map(formalizedSessions.map(f => [f.log_id, f]));
          const pendingCount = completedLogs.filter(l => !formalizedByLogId.has(l.id)).length;

          return (
          <motion.div variants={item} className="bento-card col-span-12">
            <div className="sub-toggle no-print">
              <button
                type="button"
                className={`sub-toggle-btn ${historyView === 'raw' ? 'sub-toggle-btn--active' : ''}`}
                onClick={() => setHistoryView('raw')}
              >
                Raw Timeline
              </button>
              <button
                type="button"
                className={`sub-toggle-btn ${historyView === 'formal' ? 'sub-toggle-btn--active' : ''}`}
                onClick={() => setHistoryView('formal')}
              >
                <FileText size={13} /> Formal Timeline
                {pendingCount > 0 && <span className="pill pill--amber">{pendingCount} pending</span>}
              </button>
            </div>

            <div className="flex justify-between items-center mb-6 mobile-stack mobile-stack-start" style={{ gap: '1rem' }}>
              <h3 className="text-h3">{historyView === 'raw' ? 'Counseling History' : 'Formal Timeline'}</h3>
              {historyView === 'raw' ? (
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => navigate(`/add-log?student=${student.id}`)}
                  className="btn btn-secondary no-print"
                  style={{ padding: '0.5rem 1rem', fontSize: '0.875rem', borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
                >
                  + Log Session
                </motion.button>
              ) : (
                <button
                  onClick={handleFormalizeSessions}
                  className="btn btn-secondary no-print"
                  disabled={formalizing || pendingCount === 0}
                  style={{ padding: '0.5rem 1rem', fontSize: '0.875rem', borderColor: 'var(--color-primary)', color: 'var(--color-primary)', opacity: pendingCount === 0 ? 0.6 : 1 }}
                >
                  <Sparkles size={14} />
                  {formalizing ? 'Formalizing…' : pendingCount === 0 ? 'Up to date' : `Formalize ${pendingCount} pending`}
                </button>
              )}
            </div>

            {formalizedError && historyView === 'formal' && (
              <p className="mini-note-error mb-4">Could not load formalized sessions: {formalizedError}</p>
            )}
            {formalizeError && <p className="mini-note-error mb-4">{formalizeError}</p>}

            <div style={{ position: 'relative', paddingLeft: '1rem' }}>
              <div className="no-print" style={{ position: 'absolute', left: 0, top: '1rem', bottom: 0, width: '2px', backgroundColor: 'var(--color-border)' }}></div>

              <AnimatePresence>
                <div className="flex" style={{ flexDirection: 'column', gap: '2rem' }}>
                  {historyView === 'formal' && formalizedLoading ? (
                    <p className="text-muted py-4">Loading formalized sessions…</p>
                  ) : (historyView === 'raw' ? logs : completedLogs).length === 0 ? (
                    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-muted py-4">
                      {historyView === 'raw' ? 'No counseling logs found for this student.' : 'No completed sessions to formalize yet.'}
                    </motion.p>
                  ) : (
                    (historyView === 'raw' ? logs : completedLogs).map((item, index) => {
                      const formalized = historyView === 'formal' ? formalizedByLogId.get(item.id) : undefined;
                      return (
                        <TimelineEntry
                          key={item.id}
                          log={item}
                          index={index}
                          isExpanded={expandedLogs.has(item.id)}
                          onToggleExpand={toggleExpand}
                          onResumeDraft={historyView === 'raw' ? (log) => {
                            if (log.interaction_type === 'Session' && (!log.student_response || log.student_response === 'Draft Assessment')) {
                              navigate(`/add-log?schedule_id=${log.id}&student=${student.id}`);
                            } else {
                              setActiveAssessmentId('draft');
                              setActiveDraftLogId(log.id);
                            }
                          } : undefined}
                          onFollowUpStatus={setFollowUpStatus}
                          overrideReason={historyView === 'formal' ? (formalized?.reason_formal ?? item.reason) : undefined}
                          overrideNotes={historyView === 'formal' ? (formalized?.student_response_formal ?? item.student_response) : undefined}
                          overrideAction={historyView === 'formal' ? (formalized?.recommended_action_formal ?? item.recommended_action) : undefined}
                          isFormalized={historyView === 'formal' ? Boolean(formalized) : undefined}
                        />
                      );
                    })
                  )}
                </div>
              </AnimatePresence>
            </div>
          </motion.div>
          );
        })()}

        {/* ── Summary tab: Quick ↔ Technical ──────────────────────────────
            Same toggle idiom as History above — Quick is the crisp derived
            read (AISummaryCard, no LLM call), Technical is the full AI
            Technical Report view (unchanged from V10/V11). */}
        {activeTab === 'summary' && (
          <motion.div variants={item} className="bento-card col-span-12">
            <div className="sub-toggle no-print">
              <button
                type="button"
                className={`sub-toggle-btn ${summaryView === 'quick' ? 'sub-toggle-btn--active' : ''}`}
                onClick={() => setSummaryView('quick')}
              >
                Quick
              </button>
              <button
                type="button"
                className={`sub-toggle-btn ${summaryView === 'technical' ? 'sub-toggle-btn--active' : ''}`}
                onClick={() => setSummaryView('technical')}
              >
                <BrainCircuit size={13} /> Technical
              </button>
            </div>

            {summaryView === 'quick' ? (
              <AISummaryCard report={aiReport} loading={aiReportLoading} loadError={aiReportError} />
            ) : (
              <AIReportPanel
                report={aiReport}
                loading={aiReportLoading}
                loadError={aiReportError}
                generating={aiGenerating}
                generateError={aiGenerateError}
                insufficientData={aiInsufficientData}
                cooldownActive={aiCooldownActive}
                cooldownEndsAt={aiCooldownEndsAt}
                onGenerate={handleGenerateAIReport}
              />
            )}
          </motion.div>
        )}

        {activeTab === 'telemetry' && (() => {
          // ---- derived evidence -------------------------------------------
          const ds = (telemetry?.domain_scores ?? {}) as Record<string, number | null>;
          const measuredDomains = DOMAIN_CODES.filter(c => ds[c] != null).length;
          const instrumentedDomains = DOMAIN_CODES.filter(c => instrumented[c]).length;
          const uninstrumented = DOMAIN_CODES.filter(c => instrumented[c] === false);

          const completedLogs = logs.filter(l => l.session_status === 'Completed');
          const lastAssessment = completedLogs.length > 0 ? completedLogs[0].session_date : null;

          const etiSeries = telemetryHistory.filter(h => h.eti != null);
          const compSeries = telemetryHistory.filter(h => h.composite != null);
          const etiDelta = etiSeries.length >= 2
            ? (etiSeries[etiSeries.length - 1].eti as number) - (etiSeries[etiSeries.length - 2].eti as number) : null;
          const compDelta = compSeries.length >= 2
            ? (compSeries[compSeries.length - 1].composite as number) - (compSeries[compSeries.length - 2].composite as number) : null;

          const etiData = telemetry?.eti_data;
          const confidence = telemetry?.composite_confidence ?? 0;

          let confidenceMultiplier = 1;
          if (engineStatus === 'warming') {
            let daysSinceFirst = 0;
            if (completedLogs.length > 0) {
              const firstLogDate = new Date(completedLogs[completedLogs.length - 1].session_date);
              daysSinceFirst = Math.max(0, Math.floor((Date.now() - firstLogDate.getTime()) / (1000 * 3600 * 24)));
            }
            confidenceMultiplier = calculateConfidenceMultiplier(daysSinceFirst, completedLogs.length);
          }

          const t = telemetry?.tensions;
          const axes: TensionAxis[] = [
            {
              key: 'COG_EMH', label: 'Masking axis', left: 'Emotional', right: 'Cognitive',
              value: t?.T_cognitive_emotional, available: !!(instrumented.COG && instrumented.EMH),
              positive: 'Cognitively intact but emotionally struggling — a masking pattern. Students like this are least likely to be caught by academic monitoring alone.',
              negative: 'Cognitively strained relative to emotional state — consider a learning or attention pathway rather than a mental-health one.'
            },
            {
              key: 'SOC_FAM', label: 'Escape-valve axis', left: 'Family', right: 'Social',
              value: t?.T_social_home, available: !!(instrumented.SOC && instrumented.FAM),
              positive: 'Finds more stability among peers than at home — home may be the stressor being compensated for.',
              negative: 'More stable at home than socially — a peer or social stressor despite a supportive home.'
            },
            {
              key: 'CAR_SEL', label: 'Authenticity axis', left: 'Self & Identity', right: 'Career',
              value: t?.T_career_identity, available: !!(instrumented.CAR && instrumented.SEL),
              positive: 'Career direction clearer than identity coherence — worth checking whether the path is self-chosen or imposed.',
              negative: 'Strong sense of self without a settled direction — often developmental rather than a concern.'
            },
            {
              key: 'BHV_EMH', label: 'Internalizing axis', left: 'Emotional', right: 'Behavioural',
              value: t?.T_behavioral_emotional, available: !!(instrumented.BHV && instrumented.EMH),
              positive: 'Outwardly regulated but distressed underneath — an internalizing pattern.',
              negative: 'Behavioural regulation strained relative to emotional state — an externalizing pattern.'
            }
          ];

          return (
          <>
          <EvidenceStrip
            engineStatus={engineStatus ?? undefined}
            measuredDomains={measuredDomains}
            instrumentedDomains={instrumentedDomains}
            totalDomains={DOMAIN_CODES.length}
            compositeConfidence={telemetry?.composite_confidence}
            lastAssessment={lastAssessment}
            uninstrumentedDomains={uninstrumented}
          />

          {(engineStatus === 'cold_start' || !engineStatus) ? (
            <div className="bento-card col-span-12" style={{ textAlign: 'center', padding: '2.5rem 1.5rem' }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.05)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
                <Activity size={24} />
              </div>
              <p style={{ fontWeight: 600, fontSize: '0.925rem', marginBottom: '0.75rem' }}>
                No assessments yet. Schedule a first session to begin tracking.
              </p>
              <button className="btn btn-primary" style={{ padding: '0.5rem 1.25rem', fontSize: '0.8125rem' }}
                onClick={() => navigate(`/add-log?student=${student.id}`)}>
                + Schedule Baseline Assessment
              </button>
            </div>
          ) : (
            <>
              {engineStatus === 'stale' && (
                <div className="bento-card col-span-12" style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', color: '#ef4444', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <AlertTriangle size={18} /> Data is expired (90+ days old) — schedule a re-assessment.
                </div>
              )}

              {telemetry?.archetype && telemetry.archetype !== 'Pending Baseline Assessment' && (
                <div className="bento-card col-span-12" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <Sparkles size={16} style={{ color: '#818cf8' }} />
                  <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)', fontWeight: 700 }}>Archetype</span>
                  <span style={{ fontSize: '0.925rem', fontWeight: 700 }}>{telemetry.archetype}</span>
                  <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                    — derived from the highest-scoring measured domain; re-read it as domain coverage improves.
                  </span>
                </div>
              )}

              <DomainProfile
                domainScores={ds}
                instrumented={instrumented}
                isWarming={engineStatus === 'warming'}
                confidenceMultiplier={confidenceMultiplier}
              />

              <TensionStrip
                axes={axes}
                threshold={0.3}
                dominantKey={telemetry?.tensions?.dominant_tension?.pair ?? null}
              />

              <EngagementPanel
                eti={telemetry?.eti_score}
                attendance={etiData?.attendance_ratio ?? 0}
                followThrough={etiData?.follow_through_ratio ?? 0}
                recency={etiData?.recency_factor ?? 0}
                avoidanceFlag={etiData?.avoidance_flag}
                avoidanceRatio={etiData?.avoidance_ratio}
                history={telemetryHistory.map(h => ({ date: h.date, eti: h.eti }))}
                delta={etiDelta}
              />

              <CompositeContribution
                score={telemetry?.composite_score}
                confidence={confidence}
                minConfidence={MIN_COMPOSITE_CONFIDENCE}
                parts={{
                  dd: telemetry?.composite_data?.dd ?? null,
                  wd: telemetry?.composite_data?.wd ?? null,
                  ts: telemetry?.composite_data?.ts ?? null,
                  ed: telemetry?.composite_data?.ed ?? null
                }}
                delta={compDelta}
              />

              <RsiPanel
                rsi={telemetry?.rsi_score}
                reason={telemetry?.rsi_data?.reason}
                cohortLevel={telemetry?.rsi_data?.cohort_level}
                cohortSize={telemetry?.rsi_data?.cohort_size}
                eligiblePeers={cohort.eligiblePeers}
                totalPeers={cohort.totalPeers}
                requiredPeers={RSI_MIN_COHORT}
                peerScores={cohort.peerScores}
                studentComposite={telemetry?.composite_score}
                confidence={confidence}
                minConfidence={MIN_COMPOSITE_CONFIDENCE}
              />
            </>
          )}
          {/* End of Telemetry tab */}
          </>
          );
        })()}
      </div>


      {/* ── Tag Assignment Modal ── */}
      <AnimatePresence>
        {isTagModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsTagModalOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              onClick={(e) => e.stopPropagation()}
              style={{ width: '100%', maxWidth: '480px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--color-surface)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}
            >
              {/* Modal Header */}
              <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <Tag size={16} style={{ color: 'var(--color-primary)' }} />
                  <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Manage Tags</h3>
                </div>
                <button onClick={() => setIsTagModalOpen(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex' }}>
                  <X size={18} />
                </button>
              </div>

              {/* Search */}
              <div style={{ padding: '0.875rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
                <input
                  type="text"
                  className="input"
                  placeholder="Search tags..."
                  value={tagSearchQuery}
                  onChange={(e) => setTagSearchQuery(e.target.value)}
                  style={{ fontSize: '0.875rem', padding: '0.5rem 0.875rem' }}
                  autoFocus
                />
              </div>

              {/* Scrollable Tag List */}
              <div style={{ overflowY: 'auto', flex: 1, padding: '1rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {(() => {
                  const filtered = allTags.filter(t =>
                    t.tag_name.toLowerCase().includes(tagSearchQuery.toLowerCase()) ||
                    (t.tag_category || '').toLowerCase().includes(tagSearchQuery.toLowerCase())
                  );
                  const grouped = filtered.reduce((acc: Record<string, any[]>, tag: any) => {
                    const cat = tag.tag_category || 'General';
                    if (!acc[cat]) acc[cat] = [];
                    acc[cat].push(tag);
                    return acc;
                  }, {});
                  if (Object.keys(grouped).length === 0) return (
                    <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', textAlign: 'center', padding: '2rem 0' }}>No tags found.</p>
                  );
                  return Object.entries(grouped).map(([cat, catTags]) => (
                    <div key={cat}>
                      <p style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: '0.6rem' }}>{cat}</p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        {(catTags as any[]).map((tag: any) => {
                          const isAssigned = studentTags.some(t => t.id === tag.id);
                          return (
                            <button
                              key={tag.id}
                              onClick={() => handleToggleTag(tag)}
                              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.625rem 0.75rem', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', backgroundColor: isAssigned ? `${tag.color_hex}15` : 'transparent', transition: 'background-color 0.15s ease' }}
                              onMouseEnter={e => { if (!isAssigned) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)'; }}
                              onMouseLeave={e => { e.currentTarget.style.backgroundColor = isAssigned ? `${tag.color_hex}15` : 'transparent'; }}
                            >
                              <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: tag.color_hex, flexShrink: 0 }} />
                                <span style={{ fontSize: '0.875rem', fontWeight: 500, color: isAssigned ? tag.color_hex : 'var(--color-text)' }}>{tag.tag_name}</span>
                              </span>
                              {isAssigned && (
                                <span style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.05em', padding: '0.15rem 0.5rem', borderRadius: '4px', backgroundColor: `${tag.color_hex}25`, color: tag.color_hex }}>ASSIGNED</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ));
                })()}
                {allTags.length === 0 && <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', textAlign: 'center', padding: '2rem 0' }}>No system tags have been created yet.</p>}
              </div>

              {/* Footer */}
              <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid rgba(255,255,255,0.07)', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{studentTags.length} tag{studentTags.length !== 1 ? 's' : ''} assigned</span>
                <button onClick={() => setIsTagModalOpen(false)} className="btn btn-primary" style={{ padding: '0.5rem 1.25rem', fontSize: '0.875rem' }}>Done</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Date Range Report Modal */}
      {isReportModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bento-card"
            style={{ width: '100%', maxWidth: '400px', padding: '2rem', backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', position: 'relative' }}
          >
            <button onClick={() => setIsReportModalOpen(false)} style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
              <X size={20} />
            </button>
            <h3 className="text-h2 mb-4" style={{ fontSize: '1.25rem' }}>Generate Report</h3>
            <p className="text-muted mb-6" style={{ fontSize: '0.875rem' }}>Select your export preferences.</p>

            <div className="mb-6" style={{ display: 'flex', gap: '1rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', cursor: 'pointer' }}>
                <input type="radio" name="reportKind" value="raw" checked={reportKind === 'raw'} onChange={() => setReportKind('raw')} />
                Raw Statement
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', cursor: 'pointer' }}>
                <input type="radio" name="reportKind" value="formal" checked={reportKind === 'formal'} onChange={() => setReportKind('formal')} />
                Formal (AI, Redacted)
              </label>
            </div>
            <p className="text-muted mb-4" style={{ fontSize: '0.78rem', marginTop: '-0.75rem' }}>
              {reportKind === 'raw'
                ? 'Verbatim session log, exactly as recorded — the original export.'
                : 'The same timeline, entry by entry, with reason/notes/action rewritten in formal clinical language. Formalize sessions first from the History tab — anything not yet formalized prints with a note, not a blend.'}
            </p>

            <div className="mb-6" style={{ display: 'flex', gap: '1rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', cursor: 'pointer' }}>
                <input type="radio" name="reportType" value="custom" checked={reportType === 'custom'} onChange={() => setReportType('custom')} />
                Custom Date Range
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', cursor: 'pointer' }}>
                <input type="radio" name="reportType" value="allTime" checked={reportType === 'allTime'} onChange={() => setReportType('allTime')} />
                Full Profile (All Time)
              </label>
            </div>

            {reportType === 'custom' && (
              <>
                <div className="mb-4">
                  <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem' }}>Start Date</label>
                  <input type="date" className="input" style={{ width: '100%' }} value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div className="mb-6">
                  <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem' }}>End Date</label>
                  <input type="date" className="input" style={{ width: '100%' }} value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
              </>
            )}

            {/* Print-composition add-ons — pure rendering, never sent to an LLM,
                so they apply the same way to Raw or Formal. */}
            <div className="mb-6" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={reportIncludeTelemetry} onChange={e => setReportIncludeTelemetry(e.target.checked)} />
                Include telemetry data (dashboard charts, printable)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={reportIncludeSummary} onChange={e => setReportIncludeSummary(e.target.checked)} />
                Include current AI Summary (at the top of the report)
              </label>
            </div>

            <button
              onClick={handleGenerateReport}
              className="btn btn-primary"
              style={{ width: '100%', padding: '0.75rem' }}
            >
              {reportKind === 'raw' ? 'Compile Report' : 'Generate Formal Report'}
            </button>
          </motion.div>
        </div>
      )}

      {/* Universal Wizard */}
      {activeAssessmentId && (
        <AssessmentWizard
          moduleId={activeAssessmentId === 'draft' || activeAssessmentId === 'daily_mix' ? undefined : activeAssessmentId}
          studentUuid={student.id}
          counselorName="Counselor" // Ideally from auth context
          isQuickAssessment={!activeDraftLogId}
          existingLogId={activeDraftLogId}
          existingData={activeDraftData}
          onComplete={() => {
            setActiveAssessmentId(null);
            setActiveDraftLogId(undefined);
            setActiveDraftData({});
            window.location.reload();
          }}
          onClose={() => {
            setActiveAssessmentId(null);
            window.location.reload(); // Refresh to show draft in timeline
          }}
        />
      )}
    </motion.div>
  );
};
