import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, FileText, Plus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fetchAssessmentQuestions, type AssessmentQuestion } from '../lib/assessmentEngine';

interface AssessmentWizardProps {
  moduleId?: string; // If undefined, it acts as a Daily Mix
  moduleTitle?: string;
  studentUuid: string;
  counselorName: string;
  isQuickAssessment?: boolean;
  existingLogId?: string;
  existingData?: Record<string, any>;
  onComplete: () => void;
  onEmbeddedComplete?: (payload: any) => void;
  onClose: () => void;
}

export const AssessmentWizard: React.FC<AssessmentWizardProps> = ({
  moduleId,
  moduleTitle = 'Assessment',
  studentUuid,
  counselorName,
  isQuickAssessment = false,
  existingLogId,
  existingData = {},
  onComplete,
  onEmbeddedComplete,
  onClose
}) => {
  const [sampledQuestions, setSampledQuestions] = useState<AssessmentQuestion[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>(existingData);
  const [saving, setSaving] = useState(false);
  const [logId, setLogId] = useState<string | undefined>(existingLogId);
  const [isCompleted, setIsCompleted] = useState(false);
  
  const logIdRef = useRef(logId);
  const isCompletedRef = useRef(isCompleted);

  useEffect(() => {
    logIdRef.current = logId;
  }, [logId]);

  useEffect(() => {
    isCompletedRef.current = isCompleted;
  }, [isCompleted]);
  
  // Dry Well - Add Fresh Question state
  const [dryWell, setDryWell] = useState(false);
  const [showAddQuestion, setShowAddQuestion] = useState(false);
  const [newQuestionPrompt, setNewQuestionPrompt] = useState('');
  const [newQuestionReverse, setNewQuestionReverse] = useState(false);
  const [newQuestionModuleId, setNewQuestionModuleId] = useState('');
  const [availableModules, setAvailableModules] = useState<any[]>([]);

  const isFetchingRef = useRef(false);
  const isSavingDraftRef = useRef(false);
  
  // Keep track of latest state for unmount saving
  const latestAnswers = useRef(answers);
  const latestQuestions = useRef(sampledQuestions);
  
  useEffect(() => {
    latestAnswers.current = answers;
  }, [answers]);

  useEffect(() => {
    latestQuestions.current = sampledQuestions;
  }, [sampledQuestions]);

  const loadQuestions = async () => {
    setDryWell(false);
    
    let questions: AssessmentQuestion[] = [];

    // 1. If resuming a draft, fetch the EXACT questions that were already drafted for this module
    if (existingLogId) {
      const { data: existingResponses } = await supabase.from('PsychE_Responses').select('question_id, score_value').eq('log_id', existingLogId);
      if (existingResponses && existingResponses.length > 0) {
        const qIds = existingResponses.map((r: any) => r.question_id);
        
        let query = supabase
          .from('PsychE_Questions')
          .select(`
            id, module_id, prompt_text, is_reverse_scored, custom_labels, is_active,
            PsychE_Modules!inner ( name, type, is_locked )
          `)
          .in('id', qIds);
          
        if (moduleId) {
          query = query.eq('module_id', moduleId);
        }
        
        const { data: exactQs } = await query;
        if (exactQs && exactQs.length > 0) {
          questions = exactQs.map((q: any) => ({
            id: q.id,
            module_id: q.module_id,
            module_name: q.PsychE_Modules.name,
            prompt_text: q.prompt_text,
            is_reverse_scored: q.is_reverse_scored,
            custom_labels: q.custom_labels || { "1": "1", "2": "2", "3": "3", "4": "4" },
          }));
        }
      }
    }

    // 2. If no questions loaded from draft, fetch fresh ones via smart fetch engine
    if (questions.length === 0) {
      questions = await fetchAssessmentQuestions(studentUuid, moduleId, 8);
    }
    
    if (questions.length === 0) {
      setDryWell(true);
      // Fetch COMPE modules for the "Add New Question" dropdown
      const { data: mods } = await supabase.from('PsychE_Modules').select('*').eq('type', 'COMPE').eq('is_locked', false);
      if (mods) setAvailableModules(mods);
      return;
    }

    let fetchedAnswers: Record<string, number> = { ...existingData };

    // If resuming a draft, fetch existing relational responses
    if (existingLogId) {
      const { data: responses } = await supabase.from('PsychE_Responses').select('*').eq('log_id', existingLogId);
      if (responses && responses.length > 0) {
        responses.forEach((r: any) => {
          const q = questions.find(question => question.id === r.question_id);
          if (q) {
            // Un-invert the math to populate the UI buttons correctly
            fetchedAnswers[q.id] = q.is_reverse_scored ? (5 - r.score_value) : r.score_value;
          }
        });
      }
      setAnswers(fetchedAnswers);
      
      // Auto-advance to the first unanswered question
      const firstUnansweredIdx = questions.findIndex(q => fetchedAnswers[q.id] === undefined);
      if (firstUnansweredIdx !== -1) {
        setCurrentStep(firstUnansweredIdx);
      } else {
        setCurrentStep(questions.length - 1);
      }
    }

    // Instant Loading: Mount UI with all questions immediately
    setSampledQuestions(questions);
  };

  useEffect(() => {
    if (!isFetchingRef.current) {
      isFetchingRef.current = true;
      loadQuestions().finally(() => {
        isFetchingRef.current = false;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentUuid, moduleId, existingLogId]);



  const saveDraft = async (answersToSave = answers, questionsToSave = sampledQuestions) => {
    if (Object.keys(answersToSave).length === 0) return;
    if (isSavingDraftRef.current) return;
    
    isSavingDraftRef.current = true;
    
    try {
      let finalLogId = logIdRef.current;
      let existingAssessmentData: any[] = [];
      
      if (finalLogId) {
        const { data: existingLog } = await supabase.from('PsychE_Counseling_Logs').select('assessment_data').eq('id', finalLogId).single();
        if (existingLog && Array.isArray(existingLog.assessment_data)) {
          existingAssessmentData = existingLog.assessment_data;
        }
      }

      const logTitle = moduleId ? moduleTitle : `Daily Mix Assessment - ${new Date().toLocaleDateString()}`;
      
      const packagedModule = {
        title: logTitle,
        type: moduleId ? 'COMPE' : 'MIX',
        module_id: moduleId || 'daily_mix',
        total_questions: questionsToSave.length,
        responses: Object.fromEntries(
          Object.entries(answersToSave).map(([qid, val]) => {
            const q = questionsToSave.find(x => x.id === qid);
            const scored = q?.is_reverse_scored ? 5 - val : val;
            return [q ? q.prompt_text : qid, scored];
          })
        )
      };

      const newAssessmentData = [
        ...existingAssessmentData.filter((a: any) => a.module_id !== packagedModule.module_id),
        packagedModule
      ];

      const logData: any = {
        assessment_data: newAssessmentData
      };

      if (!finalLogId) {
        logData.student_uuid = studentUuid;
        logData.counselor_name = counselorName;
        logData.session_date = new Date().toISOString();
        logData.reason = logTitle;
        logData.student_response = isQuickAssessment ? 'System: Quick Assessment administered on profile.' : 'Draft Assessment';
        logData.interaction_type = 'Session';
        logData.session_status = 'Draft';
      }

      if (finalLogId) {
        await supabase.from('PsychE_Counseling_Logs').update(logData).eq('id', finalLogId);
      } else {
        const { data } = await supabase.from('PsychE_Counseling_Logs').insert([logData]).select().single();
        if (data) {
          finalLogId = data.id;
          setLogId(data.id);
          logIdRef.current = data.id;
        }
      }
      
      // Relational Draft Saving
      if (finalLogId) {
        const responsesToInsert = Object.entries(answersToSave).map(([questionId, rawScore]) => {
          const question = questionsToSave.find(q => q.id === questionId);
          let finalScore = rawScore;
          if (question && question.is_reverse_scored) {
            finalScore = 5 - rawScore;
          }
          return {
            log_id: finalLogId,
            question_id: questionId,
            score_value: finalScore
          };
        });

        if (responsesToInsert.length > 0) {
          // Strict Delete only for the questions being overwritten, preserving other assessments on same log
          const questionIds = responsesToInsert.map(r => r.question_id);
          await supabase.from('PsychE_Responses').delete().eq('log_id', finalLogId).in('question_id', questionIds);
          await supabase.from('PsychE_Responses').insert(responsesToInsert);
        }
      }
    } catch (error) {
      console.error("Failed to save draft", error);
    } finally {
      isSavingDraftRef.current = false;
    }
  };

  // Persist whatever's been answered if the wizard unmounts some way other
  // than its own close button (e.g. a parent-level navigation change) —
  // otherwise in-progress answers vanish with no warning.
  useEffect(() => {
    return () => {
      if (Object.keys(latestAnswers.current).length > 0 && !isCompletedRef.current) {
        saveDraft(latestAnswers.current, latestQuestions.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFinalSubmit = async () => {
    if (sampledQuestions.length === 0) return;
    setSaving(true);
    setIsCompleted(true);
    isCompletedRef.current = true;
    
    try {
      let finalLogId = logIdRef.current || existingLogId;
      let existingAssessmentData: any[] = [];
      
      if (finalLogId) {
        const { data: existingLog } = await supabase.from('PsychE_Counseling_Logs').select('assessment_data').eq('id', finalLogId).single();
        if (existingLog && Array.isArray(existingLog.assessment_data)) {
          existingAssessmentData = existingLog.assessment_data;
        }
      }

      const logTitle = moduleId ? moduleTitle : `Daily Mix Assessment - ${new Date().toLocaleDateString()}`;
      
      const packagedModule = {
        title: logTitle,
        type: moduleId ? 'COMPE' : 'MIX',
        module_id: moduleId || 'daily_mix',
        total_questions: sampledQuestions.length,
        responses: Object.fromEntries(
          Object.entries(answers).map(([qid, val]) => {
            const q = sampledQuestions.find(x => x.id === qid);
            const scored = q?.is_reverse_scored ? 5 - val : val;
            return [q ? q.prompt_text : qid, scored];
          })
        )
      };

      const newAssessmentData = [
        ...existingAssessmentData.filter((a: any) => a.module_id !== packagedModule.module_id),
        packagedModule
      ];

      const logData: any = {
        assessment_data: newAssessmentData
      };

      if (!finalLogId) {
        logData.student_uuid = studentUuid;
        logData.counselor_name = counselorName;
        logData.session_date = new Date().toISOString();
        logData.reason = logTitle;
        logData.student_response = isQuickAssessment ? 'System: Quick Assessment administered on profile.' : (onEmbeddedComplete ? 'Draft Assessment' : 'Completed Assessment');
        logData.interaction_type = 'Session';
        logData.session_status = onEmbeddedComplete ? 'Draft' : 'Completed';
      } else if (isQuickAssessment && !onEmbeddedComplete) {
        logData.session_status = 'Completed';
      }

      if (finalLogId) {
        const { error: updateError } = await supabase.from('PsychE_Counseling_Logs').update(logData).eq('id', finalLogId);
        if (updateError) console.error("Error updating log:", updateError);
      } else {
        const { data, error: insertError } = await supabase.from('PsychE_Counseling_Logs').insert([logData]).select().single();
        if (insertError) console.error("Error inserting log:", insertError);
        if (data) {
          finalLogId = data.id;
          setLogId(finalLogId);
          logIdRef.current = finalLogId;
        }
      }

      if (!finalLogId) throw new Error("Could not resolve finalLogId");

      // Strict Math Guard on Resumed Drafts:
      // We purely compute the payloadScore from the current rawUI value in `answers` state
      const responsesToInsert = Object.entries(answers).map(([questionId, rawScore]) => {
        const question = sampledQuestions.find(q => q.id === questionId);
        // Math / Reverse Scoring Logic for 1-4 Scale: final_score = 5 - raw_score
        let payloadScore = rawScore;
        if (question && question.is_reverse_scored) {
          payloadScore = 5 - rawScore; // 1->4, 2->3, 3->2, 4->1
        }
        
        return {
          log_id: finalLogId,
          question_id: questionId,
          score_value: payloadScore
        };
      });

      if (responsesToInsert.length > 0) {
        // Strict Delete only for the questions being overwritten, preserving other assessments on same log
        const questionIds = responsesToInsert.map(r => r.question_id);
        const { error: delError } = await supabase.from('PsychE_Responses').delete().eq('log_id', finalLogId).in('question_id', questionIds);
        if (delError) console.error("Error deleting old responses:", delError);
        
        const { error: insError } = await supabase.from('PsychE_Responses').insert(responsesToInsert);
        if (insError) console.error("Error inserting responses:", insError);
        
        const { error: telemetryError } = await supabase.rpc('calculate_student_telemetry', { 
          target_student_uuid: studentUuid 
        });
        if (telemetryError) console.warn('Telemetry engine failed:', telemetryError.message);
      }

      if (onEmbeddedComplete) {
        onEmbeddedComplete({
          moduleId,
          logId: finalLogId
        });
        onComplete();
        return;
      }

      onComplete();
    } catch (error) {
      console.error("Failed to submit assessment", error);
      setIsCompleted(false);
      setSaving(false);
    }
  };

  const handleAddNewQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalModuleId = moduleId || newQuestionModuleId;
    if (!newQuestionPrompt || !finalModuleId) return;
    
    try {
      await supabase.from('PsychE_Questions').insert([{
        module_id: finalModuleId,
        prompt_text: newQuestionPrompt,
        is_reverse_scored: newQuestionReverse,
        is_active: true
      }]);
      
      // Instantly re-trigger
      setShowAddQuestion(false);
      setNewQuestionPrompt('');
      await loadQuestions();
    } catch (error) {
      console.error("Error adding fresh question:", error);
    }
  };

  // Dry Well Block & Quick Question Modal
  if (dryWell) {
    return createPortal(
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(10, 10, 15, 0.95)', backdropFilter: 'blur(12px)' }}>
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
          className="bento-card p-8" style={{ width: '90%', maxWidth: '450px', backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', textAlign: 'center' }}
        >
          {!showAddQuestion ? (
            <>
              <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
                <X size={24} />
              </div>
              <h3 className="text-h3 mb-2">No Fresh Questions</h3>
              <p className="text-muted mb-6">No fresh questions available. Please add new questions to the library or wait for the cooldown period to expire.</p>
              
              <button 
                onClick={() => setShowAddQuestion(true)} 
                className="btn btn-primary w-full mb-3"
                style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)' }}
              >
                + Add New Questions to Library
              </button>
              
              <button onClick={() => { saveDraft().then(() => onClose()); }} className="btn btn-secondary w-full">Close</button>
            </>
          ) : (
            <form onSubmit={handleAddNewQuestion} style={{ textAlign: 'left' }}>
              <h3 className="text-h3 mb-4 flex items-center gap-2"><Plus size={20} className="text-primary"/> Add Fresh Question</h3>
              
              {!moduleId && (
                <div className="mb-4">
                  <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem' }}>Select Module</label>
                  <select 
                    required
                    className="input" 
                    value={newQuestionModuleId} 
                    onChange={e => setNewQuestionModuleId(e.target.value)}
                    style={{ width: '100%', padding: '0.75rem', backgroundColor: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text)' }}
                  >
                    <option value="">-- Choose Module --</option>
                    {availableModules.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="mb-4">
                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem' }}>Question Prompt</label>
                <textarea 
                  required
                  className="input" 
                  value={newQuestionPrompt} 
                  onChange={e => setNewQuestionPrompt(e.target.value)}
                  placeholder="E.g., Student exhibits..."
                  style={{ width: '100%', padding: '0.75rem', minHeight: '80px', backgroundColor: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text)' }}
                />
              </div>

              <div className="mb-6">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}>
                  <input 
                    type="checkbox" 
                    checked={newQuestionReverse} 
                    onChange={e => setNewQuestionReverse(e.target.checked)} 
                    style={{ width: '18px', height: '18px', accentColor: 'var(--color-primary)' }}
                  />
                  Reverse Scored (1=Good, 4=Bad)
                </label>
              </div>

              <div className="flex gap-3">
                <button type="button" onClick={() => setShowAddQuestion(false)} className="btn btn-secondary flex-1">Cancel</button>
                <button type="submit" className="btn btn-primary flex-1">Save & Start</button>
              </div>
            </form>
          )}
        </motion.div>
      </div>,
      document.body
    );
  }

  if (sampledQuestions.length === 0) return null; // Still fetching Q1

  const totalSteps = sampledQuestions.length;
  const currentQ = sampledQuestions[currentStep];
  
  // Ensure we have exactly 4 values to map, fallback just in case
  const defaultLabels = { "1": "1", "2": "2", "3": "3", "4": "4" };
  const labelsToRender = currentQ?.custom_labels || defaultLabels;
  const renderScale = [1, 2, 3, 4];

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(10, 10, 15, 0.95)', backdropFilter: 'blur(12px)' }}>
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bento-card"
        style={{
          width: '90%',
          maxWidth: '800px',
          minHeight: '450px',
          padding: '3rem',
          backgroundColor: 'var(--color-background)',
          border: '1px solid var(--color-primary)',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative'
        }}
      >
        <button 
          onClick={() => {
            saveDraft().then(() => onClose());
          }} 
          style={{ position: 'absolute', top: '1.5rem', right: '1.5rem', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}
        >
          <X size={24} />
        </button>

        <div className="flex justify-between items-center mb-8">
          <div>
            <h2 className="text-h1 flex items-center gap-3" style={{ fontSize: '1.5rem' }}>
              <FileText className="text-primary" /> {moduleTitle || 'Daily Mix Assessment'}
            </h2>
            {logId && !isCompleted && <span style={{ fontSize: '0.75rem', color: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.1)', padding: '0.2rem 0.6rem', borderRadius: '4px', marginTop: '0.5rem', display: 'inline-block' }}>Draft Saved</span>}
          </div>
          
          <span className="text-muted" style={{ fontWeight: 600, fontSize: '1.1rem' }}>
            Question {currentStep + 1} of {totalSteps}
          </span>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                <span style={{ 
                  display: 'inline-block', 
                  padding: '0.25rem 1rem', 
                  backgroundColor: 'rgba(94, 106, 210, 0.1)', 
                  color: 'var(--color-primary)', 
                  borderRadius: '20px',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase'
                }}>
                  Module: {currentQ?.module_name}
                </span>
              </div>

              <p style={{ fontSize: '1.5rem', fontWeight: 500, marginBottom: '3rem', lineHeight: 1.4, textAlign: 'center' }}>
                {currentQ?.prompt_text}
              </p>

              <div style={{ display: 'flex', gap: '1rem', maxWidth: '700px', margin: '0 auto' }}>
                {renderScale.map(val => {
                  const isSelected = answers[currentQ?.id] === val;
                  const labelText = labelsToRender[val.toString()] || val.toString();
                  return (
                      <button
                      key={val}
                      type="button"
                      onClick={() => {
                        setAnswers(prev => ({ ...prev, [currentQ.id]: val }));
                        if (currentStep < totalSteps - 1) {
                          setCurrentStep(c => c + 1);
                        }
                      }}
                      style={{
                        flex: 1, padding: '1.25rem 0.5rem', borderRadius: '12px',
                        backgroundColor: isSelected ? 'var(--color-primary)' : 'rgba(255,255,255,0.03)',
                        border: isSelected ? '1px solid var(--color-primary)' : '1px solid rgba(255,255,255,0.1)',
                        color: isSelected ? '#fff' : 'inherit',
                        cursor: 'pointer', transition: 'all 0.2s',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem',
                        boxShadow: isSelected ? '0 4px 15px rgba(94, 106, 210, 0.4)' : 'none',
                        backdropFilter: 'blur(10px)'
                      }}
                    >
                      <span style={{ fontSize: '1.5rem', fontWeight: 700 }}>{val}</span>
                      <span style={{ fontSize: '0.875rem', opacity: 0.8, textAlign: 'center' }}>{labelText}</span>
                    </button>
                  )
                })}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '3rem', paddingTop: '2rem', borderTop: '1px solid var(--color-border)' }}>
          <button
            type="button"
            onClick={() => setCurrentStep(prev => prev - 1)}
            disabled={currentStep === 0}
            className="btn btn-secondary"
            style={{ padding: '1rem 2.5rem', opacity: currentStep === 0 ? 0.3 : 1, fontSize: '1rem' }}
          >
            Previous
          </button>

          {currentStep < totalSteps - 1 ? (
            <button
              type="button"
              onClick={() => setCurrentStep(prev => prev + 1)}
              className="btn btn-secondary"
              style={{ padding: '1rem 2.5rem', backgroundColor: 'rgba(94, 106, 210, 0.1)', color: 'var(--color-primary)', borderColor: 'transparent', fontSize: '1rem' }}
            >
              Next Step
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinalSubmit}
              disabled={saving}
              className="btn btn-primary"
              style={{ padding: '1rem 2.5rem', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', fontSize: '1rem' }}
            >
              {saving ? 'Saving...' : 'Complete Assessment'}
            </button>
          )}
        </div>
      </motion.div>
    </div>,
    document.body
  );
};
