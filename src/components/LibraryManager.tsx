import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen, Plus, Lock, Unlock, Search, X, ChevronRight,
  ToggleLeft, ToggleRight, Trash2, Save, AlertTriangle, Check
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Module, Question, ModuleType, QuestionLabels, Domain } from '../types';
import { DEFAULT_LABELS } from '../types';

// =============================================================================
//  Types
// =============================================================================

interface ModuleWithCount extends Module {
  question_count: number;
}

interface LockModalState {
  open: boolean;
  moduleId: string | null;
}

interface DeleteQModalState {
  open: boolean;
  question: Question | null;
}

// =============================================================================
//  Helpers
// =============================================================================

function moduleTypePillClass(type: ModuleType): string {
  switch (type) {
    case 'COMPE':    return 'pill pill--blue';
    case 'PsycheSPA': return 'pill pill--purple';
    case 'Custom':   return 'pill pill--amber';
    default:         return 'pill pill--muted';
  }
}

function moduleTypeLabel(type: ModuleType): string {
  switch (type) {
    case 'COMPE':    return 'COMPE';
    case 'PsycheSPA': return 'PsycheSPA';
    case 'Custom':   return 'Custom';
  }
}

// =============================================================================
//  QuestionCard sub-component
// =============================================================================

interface QuestionCardProps {
  question: Question;
  moduleIsLocked: boolean;
  showInactive: boolean;
  onSave: (q: Question, updates: Partial<Question>) => Promise<void>;
  onToggleActive: (q: Question) => Promise<void>;
  onDelete: (q: Question) => void;
}

const QuestionCard: React.FC<QuestionCardProps> = ({
  question, moduleIsLocked, showInactive, onSave, onToggleActive, onDelete
}) => {
  const [localPrompt, setLocalPrompt] = useState(question.prompt_text);
  const [localLabels, setLocalLabels] = useState<QuestionLabels>({ ...question.custom_labels });
  const [localReverse, setLocalReverse] = useState(question.is_reverse_scored);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Derived: is this question fully locked (module locked AND already edited)?
  const fullyLocked = moduleIsLocked && question.has_been_edited;
  // Can be edited once more (module locked but not yet edited)?
  const oneTimeEditable = moduleIsLocked && !question.has_been_edited;

  // Reset local state when question changes
  useEffect(() => {
    setLocalPrompt(question.prompt_text);
    setLocalLabels({ ...question.custom_labels });
    setLocalReverse(question.is_reverse_scored);
    setDirty(false);
  }, [question.id]);

  const handleSave = async () => {
    if (!dirty) return;
    setSaving(true);
    await onSave(question, {
      prompt_text: localPrompt,
      custom_labels: localLabels,
      is_reverse_scored: localReverse,
    });
    setSaving(false);
    setDirty(false);
  };

  const cardClass = [
    'question-card',
    fullyLocked ? 'locked' : '',
    !question.is_active ? 'inactive' : '',
  ].filter(Boolean).join(' ');

  if (!question.is_active && !showInactive) return null;

  return (
    <motion.div
      className={cardClass}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
    >
      {/* Card Header Row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.625rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {fullyLocked && (
            <span className="lock-indicator" title="One-time-edit limit reached">
              <Lock size={12} />
              Locked
            </span>
          )}
          {oneTimeEditable && (
            <span style={{ fontSize: '0.7rem', color: 'var(--accent-amber)', fontWeight: 600 }}>
              ⚡ One edit remaining
            </span>
          )}
          {!question.is_active && (
            <span className="pill pill--muted">Inactive</span>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
          {dirty && !fullyLocked && (
            <button
              className="icon-btn success"
              onClick={handleSave}
              disabled={saving}
              title="Save changes"
            >
              {saving ? <span style={{ fontSize: '0.65rem' }}>…</span> : <Save size={14} />}
            </button>
          )}
          <button
            className="icon-btn"
            onClick={() => onToggleActive(question)}
            title={question.is_active ? 'Deactivate question' : 'Restore question'}
          >
            {question.is_active ? <ToggleRight size={16} style={{ color: 'var(--accent-green)' }} /> : <ToggleLeft size={16} />}
          </button>
          {!question.is_active && !moduleIsLocked && (
            <button
              className="icon-btn danger"
              onClick={() => onDelete(question)}
              title="Permanently delete inactive question"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Prompt Text */}
      <textarea
        className="question-prompt-input"
        value={localPrompt}
        disabled={fullyLocked}
        onChange={e => { setLocalPrompt(e.target.value); setDirty(true); }}
        onBlur={handleSave}
        placeholder="Question prompt text..."
        rows={2}
      />

      {/* Reverse-score + Labels row */}
      <div style={{ marginTop: '0.625rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        {/* Reverse-score toggle */}
        <label className="toggle-switch" style={{ cursor: fullyLocked ? 'not-allowed' : 'pointer' }}>
          <input
            type="checkbox"
            checked={localReverse}
            disabled={fullyLocked}
            onChange={e => { setLocalReverse(e.target.checked); setDirty(true); }}
          />
          <span className="toggle-track">
            <span className="toggle-thumb" />
          </span>
          <span style={{ color: localReverse ? 'var(--accent-amber)' : 'var(--text-muted)' }}>
            Reverse-scored
          </span>
        </label>

        {/* Label grid */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Scale Labels
          </div>
          <div className="label-grid">
            {(['1', '2', '3', '4'] as const).map(key => (
              <input
                key={key}
                className="label-input"
                value={localLabels[key]}
                disabled={fullyLocked}
                onChange={e => {
                  setLocalLabels(prev => ({ ...prev, [key]: e.target.value }));
                  setDirty(true);
                }}
                onBlur={handleSave}
                placeholder={`Label ${key}`}
              />
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
};

// =============================================================================
//  Main LibraryManager Component
// =============================================================================

export const LibraryManager: React.FC = () => {
  // --- Module list state ---
  const [modules, setModules] = useState<ModuleWithCount[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [filteredModules, setFilteredModules] = useState<ModuleWithCount[]>([]);
  const [moduleFilter, setModuleFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modulesLoading, setModulesLoading] = useState(true);

  // --- Selected module editing state ---
  const [selectedModule, setSelectedModule] = useState<Module | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  // --- Module field editing ---
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState<ModuleType>('COMPE');
  const [editDomainCode, setEditDomainCode] = useState<string>('');
  const [editDescription, setEditDescription] = useState('');
  const [editDomainWeight, setEditDomainWeight] = useState<number>(1.0);
  const [editScaleMin, setEditScaleMin] = useState<number>(1);
  const [editScaleMax, setEditScaleMax] = useState<number>(4);

  // --- Keywords ---
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState('');

  // --- Modals ---
  const [lockModal, setLockModal] = useState<LockModalState>({ open: false, moduleId: null });
  const [deleteQModal, setDeleteQModal] = useState<DeleteQModalState>({ open: false, question: null });
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const keywordInputRef = useRef<HTMLInputElement>(null);

  // ==========================================================================
  //  Data fetching
  // ==========================================================================

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const fetchDomains = useCallback(async () => {
    const { data, error } = await supabase
      .from('PsychE_Domains')
      .select('*')
      .order('code', { ascending: true });

    if (error) {
      console.warn('PsychE_Domains table query warning:', error.message);
    } else if (data) {
      setDomains(data);
    }
  }, []);

  const fetchModules = useCallback(async () => {
    setModulesLoading(true);
    const { data: modulesData, error: modErr } = await supabase
      .from('PsychE_Modules')
      .select('*')
      .order('created_at', { ascending: false });

    if (modErr || !modulesData) {
      showToast('Failed to load modules', 'error');
      setModulesLoading(false);
      return;
    }

    // Get question counts per module
    const { data: counts } = await supabase
      .from('PsychE_Questions')
      .select('module_id')
      .eq('is_active', true);

    const countMap: Record<string, number> = {};
    (counts ?? []).forEach(q => {
      countMap[q.module_id] = (countMap[q.module_id] || 0) + 1;
    });

    const withCounts: ModuleWithCount[] = modulesData.map(m => ({
      ...m,
      question_count: countMap[m.id] || 0,
    }));

    setModules(withCounts);
    setFilteredModules(withCounts);
    setModulesLoading(false);
  }, [showToast]);

  const fetchQuestions = useCallback(async (moduleId: string) => {
    setQuestionsLoading(true);
    const { data, error } = await supabase
      .from('PsychE_Questions')
      .select('*')
      .eq('module_id', moduleId)
      .order('created_at', { ascending: true });

    if (error) { showToast('Failed to load questions', 'error'); }
    else { setQuestions(data ?? []); }
    setQuestionsLoading(false);
  }, [showToast]);

  useEffect(() => {
    fetchDomains();
    fetchModules();
  }, [fetchDomains, fetchModules]);

  // Filter modules by name
  useEffect(() => {
    const q = moduleFilter.trim().toLowerCase();
    setFilteredModules(q ? modules.filter(m => m.name.toLowerCase().includes(q)) : modules);
  }, [moduleFilter, modules]);

  // Load module detail when selection changes
  const handleSelectModule = useCallback(async (moduleId: string) => {
    setSelectedId(moduleId);
    const mod = modules.find(m => m.id === moduleId);
    if (!mod) return;
    setSelectedModule(mod);
    setEditName(mod.name);
    setEditType(mod.type);
    setEditDomainCode(mod.domain_code ?? '');
    setEditDescription(mod.description ?? '');
    setEditDomainWeight(mod.domain_weight ?? 1.0);
    setEditScaleMin(mod.scale_min ?? 1);
    setEditScaleMax(mod.scale_max ?? 4);
    setKeywords(mod.smart_keywords ?? []);
    setShowInactive(false);
    await fetchQuestions(moduleId);
  }, [modules, fetchQuestions]);

  // ==========================================================================
  //  Module mutations
  // ==========================================================================

  const handleCreateModule = async () => {
    const defaultDomain = domains.length > 0 ? domains[0].code : null;
    const { data, error } = await supabase
      .from('PsychE_Modules')
      .insert({ name: 'New Module', type: 'COMPE', domain_code: defaultDomain, smart_keywords: [] })
      .select()
      .single();

    if (error || !data) { showToast('Failed to create module', 'error'); return; }
    await fetchModules();
    handleSelectModule(data.id);
  };

  const patchModule = async (updates: Partial<Module>) => {
    if (!selectedId) return;
    const { error } = await supabase
      .from('PsychE_Modules')
      .update(updates)
      .eq('id', selectedId);
    if (error) { showToast('Save failed: ' + error.message, 'error'); }
    else {
      setSelectedModule(prev => prev ? { ...prev, ...updates } : prev);
      // Merge into the already-loaded list locally — these fields never
      // affect question_count, so there's no need to refetch every module
      // (and its counts) from the network on every field blur.
      setModules(prev => prev.map(m => m.id === selectedId ? { ...m, ...updates } : m));
    }
  };

  const handleNameBlur = async () => {
    if (editName.trim() && editName !== selectedModule?.name) {
      await patchModule({ name: editName.trim() });
    }
  };

  const handleTypeChange = async (newType: ModuleType) => {
    setEditType(newType);
    await patchModule({ type: newType });
  };

  const handleDomainChange = async (newDomainCode: string) => {
    setEditDomainCode(newDomainCode);
    await patchModule({ domain_code: newDomainCode || null });
  };

  const handleDescriptionBlur = async () => {
    if (editDescription !== selectedModule?.description) {
      await patchModule({ description: editDescription });
    }
  };

  const handleDomainWeightBlur = async () => {
    const clamped = Number.isFinite(editDomainWeight) && editDomainWeight > 0 ? editDomainWeight : 1.0;
    setEditDomainWeight(clamped);
    if (clamped !== (selectedModule?.domain_weight ?? 1.0)) {
      await patchModule({ domain_weight: clamped });
    }
  };

  const handleScaleRangeBlur = async () => {
    if (!Number.isFinite(editScaleMin) || !Number.isFinite(editScaleMax) || editScaleMax <= editScaleMin) {
      showToast('Scale Max must be greater than Scale Min', 'error');
      setEditScaleMin(selectedModule?.scale_min ?? 1);
      setEditScaleMax(selectedModule?.scale_max ?? 4);
      return;
    }
    if (editScaleMin !== (selectedModule?.scale_min ?? 1) || editScaleMax !== (selectedModule?.scale_max ?? 4)) {
      await patchModule({ scale_min: editScaleMin, scale_max: editScaleMax });
    }
  };

  // --- Keywords ---
  const handleAddKeyword = async () => {
    const kw = keywordInput.trim().toLowerCase();
    if (!kw || keywords.includes(kw)) { setKeywordInput(''); return; }
    const newKeywords = [...keywords, kw];
    setKeywords(newKeywords);
    setKeywordInput('');
    await patchModule({ smart_keywords: newKeywords });
    keywordInputRef.current?.focus();
  };

  const handleRemoveKeyword = async (kw: string) => {
    const newKeywords = keywords.filter(k => k !== kw);
    setKeywords(newKeywords);
    await patchModule({ smart_keywords: newKeywords });
  };

  // --- Lock ---
  const handleConfirmLock = async () => {
    if (!lockModal.moduleId) return;
    const { error } = await supabase
      .from('PsychE_Modules')
      .update({ is_locked: true })
      .eq('id', lockModal.moduleId);
    if (error) { showToast('Lock failed', 'error'); }
    else {
      showToast('Module locked successfully');
      setSelectedModule(prev => prev ? { ...prev, is_locked: true } : prev);
      setModules(prev => prev.map(m => m.id === lockModal.moduleId ? { ...m, is_locked: true } : m));
    }
    setLockModal({ open: false, moduleId: null });
  };

  // ==========================================================================
  //  Question mutations
  // ==========================================================================

  const handleSaveQuestion = async (q: Question, updates: Partial<Question>) => {
    if (!selectedModule) return;

    // One-time-edit enforcement
    if (selectedModule.is_locked && q.has_been_edited) {
      showToast('This question is locked — it has already been edited once.', 'error');
      return;
    }

    const payload: Partial<Question> = { ...updates };
    if (selectedModule.is_locked && !q.has_been_edited) {
      payload.has_been_edited = true;
    }

    const { error } = await supabase
      .from('PsychE_Questions')
      .update(payload)
      .eq('id', q.id);

    if (error) { showToast('Save failed: ' + error.message, 'error'); return; }

    setQuestions(prev => prev.map(item =>
      item.id === q.id ? { ...item, ...payload } : item
    ));
    showToast('Question saved');
  };

  const handleToggleActive = async (q: Question) => {
    const newVal = !q.is_active;
    // Optimistic update
    setQuestions(prev => prev.map(item =>
      item.id === q.id ? { ...item, is_active: newVal } : item
    ));
    const { error } = await supabase
      .from('PsychE_Questions')
      .update({ is_active: newVal })
      .eq('id', q.id);
    if (error) {
      // Revert
      setQuestions(prev => prev.map(item =>
        item.id === q.id ? { ...item, is_active: !newVal } : item
      ));
      showToast('Toggle failed', 'error');
    } else if (selectedId) {
      // Adjust the active-question count locally instead of refetching
      // every module + recomputing all counts from the network.
      setModules(prev => prev.map(m =>
        m.id === selectedId ? { ...m, question_count: m.question_count + (newVal ? 1 : -1) } : m
      ));
    }
  };

  const handleDeleteQuestion = async () => {
    const q = deleteQModal.question;
    if (!q) return;
    const { error } = await supabase
      .from('PsychE_Questions')
      .delete()
      .eq('id', q.id);
    if (error) { showToast('Delete failed', 'error'); }
    else {
      // Deletion is only ever offered for inactive questions, so
      // question_count (active-only) never changes — no refetch needed.
      setQuestions(prev => prev.filter(item => item.id !== q.id));
      showToast('Question deleted');
    }
    setDeleteQModal({ open: false, question: null });
  };

  const handleAddQuestion = async () => {
    if (!selectedId || selectedModule?.is_locked) return;
    const { data, error } = await supabase
      .from('PsychE_Questions')
      .insert({
        module_id: selectedId,
        prompt_text: 'New question prompt...',
        is_reverse_scored: false,
        custom_labels: DEFAULT_LABELS,
        is_active: true,
        has_been_edited: false,
      })
      .select()
      .single();

    if (error || !data) { showToast('Failed to add question', 'error'); return; }
    setQuestions(prev => [...prev, data]);
    setModules(prev => prev.map(m =>
      m.id === selectedId ? { ...m, question_count: m.question_count + 1 } : m
    ));
  };

  // ==========================================================================
  //  Render
  // ==========================================================================

  const activeQuestions = questions.filter(q => q.is_active);
  const inactiveQuestions = questions.filter(q => !q.is_active);

  return (
    <div className="page-animate" style={{ padding: '1.5rem', height: '100%' }}>
      {/* Page title */}
      <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div style={{
          width: 36, height: 36, borderRadius: 'var(--radius-md)',
          background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <BookOpen size={18} color="white" />
        </div>
        <div>
          <h1 style={{ fontSize: '1.1rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
            Assessment Library
          </h1>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Manage modules, questions, and smart keywords
          </p>
        </div>
      </div>

      {/* Master-Detail Layout */}
      <div className="master-detail">

        {/* ── Master Pane ── */}
        <div className="master-pane">
          <div className="master-pane-header">
            <h2>Modules</h2>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.625rem' }}>
              <div style={{ flex: 1, position: 'relative' }}>
                <Search size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                <input
                  className="master-pane-search"
                  style={{ paddingLeft: '26px' }}
                  placeholder="Filter modules..."
                  value={moduleFilter}
                  onChange={e => setModuleFilter(e.target.value)}
                />
              </div>
              <button
                className="btn btn-primary"
                style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                onClick={handleCreateModule}
                title="Create new module"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          <div className="master-pane-list">
            {modulesLoading ? (
              <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                Loading…
              </div>
            ) : filteredModules.length === 0 ? (
              <div style={{ padding: '1.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                No modules found.
              </div>
            ) : (
              filteredModules.map(mod => (
                <div
                  key={mod.id}
                  className={`master-item ${selectedId === mod.id ? 'active' : ''}`}
                  onClick={() => handleSelectModule(mod.id)}
                >
                  <div className="master-item-name">{mod.name}</div>
                  <div className="master-item-meta">
                    <span className={moduleTypePillClass(mod.type)}>{moduleTypeLabel(mod.type)}</span>
                    {mod.domain_code ? (
                      <span className="pill pill--domain" title={domains.find(d => d.code === mod.domain_code)?.name ?? mod.domain_code}>
                        {mod.domain_code}
                      </span>
                    ) : (
                      <span className="pill pill--muted" style={{ opacity: 0.6, fontSize: '0.65rem' }}>
                        No Domain
                      </span>
                    )}
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {mod.question_count}Q
                    </span>
                    {mod.is_locked && <Lock size={11} style={{ color: 'var(--accent-amber)' }} />}
                    <ChevronRight size={12} style={{ color: 'var(--text-muted)', marginLeft: 'auto' }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Detail Pane ── */}
        <div className="detail-pane">
          <AnimatePresence mode="wait">
            {!selectedModule ? (
              <motion.div
                key="empty"
                className="detail-empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="detail-empty-icon">
                  <BookOpen size={24} />
                </div>
                <div>
                  <p style={{ fontWeight: 600, marginBottom: '0.25rem', color: 'var(--text-primary)' }}>
                    Select a Module
                  </p>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Choose a module from the list, or create a new one.
                  </p>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key={selectedModule.id}
                className="detail-pane-inner"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {/* ── Module Header ── */}
                <div className="module-header">
                  <input
                    className="module-name-input"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onBlur={handleNameBlur}
                    placeholder="Module name..."
                    disabled={selectedModule.is_locked}
                  />

                  <div className="module-meta-row">
                    <select
                      className="module-type-select"
                      value={editType}
                      disabled={selectedModule.is_locked}
                      onChange={e => handleTypeChange(e.target.value as ModuleType)}
                    >
                      <option value="COMPE">COMPE (Likert)</option>
                      <option value="PsycheSPA">PsycheSPA (Formal)</option>
                      <option value="Custom">Custom</option>
                    </select>

                    <select
                      className="module-type-select"
                      value={editDomainCode}
                      disabled={selectedModule.is_locked}
                      onChange={e => handleDomainChange(e.target.value)}
                      required
                      title="Assign a Master Domain to this module"
                    >
                      <option value="" disabled>-- Select Master Domain --</option>
                      {domains.map(d => (
                        <option key={d.code} value={d.code}>
                          {d.code} - {d.name}
                        </option>
                      ))}
                    </select>

                    {selectedModule.is_locked ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--accent-amber)', fontSize: '0.8rem', fontWeight: 600 }}>
                        <Lock size={14} /> Locked Module
                      </span>
                    ) : (
                      <button
                        className="btn"
                        style={{ padding: '0.35rem 0.875rem', background: 'rgba(245, 166, 35, 0.1)', border: '1px solid rgba(245, 166, 35, 0.3)', color: 'var(--accent-amber)', fontSize: '0.78rem', fontWeight: 600 }}
                        onClick={() => setLockModal({ open: true, moduleId: selectedModule.id })}
                        title="Lock this module — limits each question to one edit"
                      >
                        <Unlock size={13} /> Lock Module
                      </button>
                    )}
                  </div>

                  {/* Domain Scoring Configuration (V6 — w_m weight + scale range for cross-instrument normalization) */}
                  <div className="module-meta-row" style={{ marginTop: '0.625rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Domain Weight
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        className="module-type-select"
                        style={{ width: '80px' }}
                        value={editDomainWeight}
                        disabled={selectedModule.is_locked}
                        onChange={e => setEditDomainWeight(parseFloat(e.target.value))}
                        onBlur={handleDomainWeightBlur}
                        title="How strongly this module's score counts toward its domain, relative to other modules in the same domain (w_m)"
                      />
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Scale Min–Max
                      <input
                        type="number"
                        step="1"
                        className="module-type-select"
                        style={{ width: '60px' }}
                        value={editScaleMin}
                        disabled={selectedModule.is_locked}
                        onChange={e => setEditScaleMin(parseFloat(e.target.value))}
                        onBlur={handleScaleRangeBlur}
                        title="Theoretical minimum raw score for this instrument (used for min-max normalization)"
                      />
                      <span>–</span>
                      <input
                        type="number"
                        step="1"
                        className="module-type-select"
                        style={{ width: '60px' }}
                        value={editScaleMax}
                        disabled={selectedModule.is_locked}
                        onChange={e => setEditScaleMax(parseFloat(e.target.value))}
                        onBlur={handleScaleRangeBlur}
                        title="Theoretical maximum raw score for this instrument (used for min-max normalization)"
                      />
                    </label>
                  </div>

                  {/* Description */}
                  <div style={{ marginTop: '0.875rem' }}>
                    <div className="section-label">Description</div>
                    <textarea
                      className="question-prompt-input"
                      style={{ minHeight: '52px', fontSize: '0.8rem' }}
                      value={editDescription}
                      onChange={e => setEditDescription(e.target.value)}
                      onBlur={handleDescriptionBlur}
                      disabled={selectedModule.is_locked}
                      placeholder="Optional module description..."
                      rows={2}
                    />
                  </div>

                  {/* Smart Keywords */}
                  <div className="keywords-area">
                    <div className="keywords-area-label">Smart Keywords</div>
                    <div className="keywords-wrap" onClick={() => keywordInputRef.current?.focus()}>
                      {keywords.map(kw => (
                        <span key={kw} className="keyword-pill">
                          {kw}
                          {!selectedModule.is_locked && (
                            <button
                              onClick={e => { e.stopPropagation(); handleRemoveKeyword(kw); }}
                              title={`Remove "${kw}"`}
                            >
                              <X size={11} />
                            </button>
                          )}
                        </span>
                      ))}
                      {!selectedModule.is_locked && (
                        <input
                          ref={keywordInputRef}
                          className="keyword-add-input"
                          value={keywordInput}
                          onChange={e => setKeywordInput(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ',') {
                              e.preventDefault();
                              handleAddKeyword();
                            }
                          }}
                          placeholder={keywords.length === 0 ? 'Add keywords (press Enter)…' : ''}
                        />
                      )}
                    </div>
                    <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                      Triggered when counselor types matching words in the "Reason" field during Add Log.
                    </p>
                  </div>
                </div>

                {/* ── Questions List ── */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
                    <div className="section-label" style={{ margin: 0, flex: 1 }}>
                      Questions ({activeQuestions.length} active
                      {inactiveQuestions.length > 0 ? `, ${inactiveQuestions.length} inactive` : ''})
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginLeft: '1rem' }}>
                      {inactiveQuestions.length > 0 && (
                        <button
                          className="btn"
                          style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem', background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
                          onClick={() => setShowInactive(p => !p)}
                        >
                          {showInactive ? 'Hide Inactive' : 'Show Inactive'}
                        </button>
                      )}
                      <button
                        className="btn btn-primary"
                        style={{ padding: '0.35rem 0.875rem', fontSize: '0.8rem', opacity: selectedModule.is_locked ? 0.4 : 1 }}
                        disabled={selectedModule.is_locked}
                        onClick={handleAddQuestion}
                        title={selectedModule.is_locked ? 'Cannot add questions to a locked module' : 'Add question'}
                      >
                        <Plus size={14} /> Add Question
                      </button>
                    </div>
                  </div>

                  {questionsLoading ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                      Loading questions…
                    </div>
                  ) : questions.length === 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', border: '1px dashed var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                      <p style={{ marginBottom: '0.5rem', fontWeight: 500 }}>No questions yet</p>
                      {!selectedModule.is_locked && (
                        <p style={{ fontSize: '0.8rem' }}>Click "Add Question" to get started.</p>
                      )}
                    </div>
                  ) : (
                    <div>
                      {/* Active questions */}
                      {activeQuestions.map(q => (
                        <QuestionCard
                          key={q.id}
                          question={q}
                          moduleIsLocked={selectedModule.is_locked}
                          showInactive={showInactive}
                          onSave={handleSaveQuestion}
                          onToggleActive={handleToggleActive}
                          onDelete={q => setDeleteQModal({ open: true, question: q })}
                        />
                      ))}
                      {/* Inactive questions (shown when toggled) */}
                      {showInactive && inactiveQuestions.length > 0 && (
                        <>
                          <div style={{ marginTop: '1rem', marginBottom: '0.5rem', fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                            Inactive Questions
                          </div>
                          {inactiveQuestions.map(q => (
                            <QuestionCard
                              key={q.id}
                              question={q}
                              moduleIsLocked={selectedModule.is_locked}
                              showInactive={showInactive}
                              onSave={handleSaveQuestion}
                              onToggleActive={handleToggleActive}
                              onDelete={q => setDeleteQModal({ open: true, question: q })}
                            />
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Lock Confirmation Modal ── */}
      <AnimatePresence>
        {lockModal.open && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="modal-panel"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.875rem' }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(245, 166, 35, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <AlertTriangle size={18} style={{ color: 'var(--accent-amber)' }} />
                </div>
                <h3 style={{ margin: 0 }}>Lock This Module?</h3>
              </div>
              <p>
                Locking this module will limit each question to <strong>one edit only</strong>. Once a question has been edited in a locked module, it cannot be changed again.
                <br /><br />
                <strong>This action cannot be undone.</strong>
              </p>
              <div className="modal-actions">
                <button
                  className="btn"
                  style={{ padding: '0.5rem 1.25rem', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
                  onClick={() => setLockModal({ open: false, moduleId: null })}
                >
                  Cancel
                </button>
                <button
                  className="btn"
                  style={{ padding: '0.5rem 1.25rem', background: 'var(--accent-amber)', color: '#000', fontWeight: 600 }}
                  onClick={handleConfirmLock}
                >
                  <Lock size={14} /> Lock Module
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Delete Question Modal ── */}
      <AnimatePresence>
        {deleteQModal.open && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="modal-panel"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
            >
              <h3>Delete Question?</h3>
              <p>
                This will <strong>permanently delete</strong> the question:
                <br />
                <em style={{ color: 'var(--text-primary)' }}>"{deleteQModal.question?.prompt_text}"</em>
                <br /><br />
                Any associated responses will also be deleted (cascade). This cannot be undone.
              </p>
              <div className="modal-actions">
                <button
                  className="btn"
                  style={{ padding: '0.5rem 1.25rem', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
                  onClick={() => setDeleteQModal({ open: false, question: null })}
                >
                  Cancel
                </button>
                <button
                  className="btn"
                  style={{ padding: '0.5rem 1.25rem', background: 'var(--accent-red)', color: '#fff', fontWeight: 600 }}
                  onClick={handleDeleteQuestion}
                >
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Toast ── */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 16, x: '-50%' }}
            style={{
              position: 'fixed',
              bottom: '1.5rem',
              left: '50%',
              transform: 'translateX(-50%)',
              background: toast.type === 'success' ? 'rgba(63, 201, 143, 0.15)' : 'rgba(245, 91, 91, 0.15)',
              border: `1px solid ${toast.type === 'success' ? 'rgba(63,201,143,0.4)' : 'rgba(245,91,91,0.4)'}`,
              color: toast.type === 'success' ? 'var(--accent-green)' : 'var(--accent-red)',
              padding: '0.625rem 1.25rem',
              borderRadius: 'var(--radius-full)',
              fontSize: '0.85rem',
              fontWeight: 600,
              backdropFilter: 'blur(12px)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              zIndex: 300,
              whiteSpace: 'nowrap',
            }}
          >
            {toast.type === 'success' ? <Check size={15} /> : <AlertTriangle size={15} />}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
