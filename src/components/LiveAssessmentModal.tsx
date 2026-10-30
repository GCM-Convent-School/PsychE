import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronRight, CheckCircle, BrainCircuit } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface LiveAssessmentModalProps {
  studentUuid: string;
  studentName: string;
  onClose: () => void;
  onSuccess: () => void;
}

export const LiveAssessmentModal: React.FC<LiveAssessmentModalProps> = ({ studentUuid, studentName, onClose, onSuccess }) => {
  const [questions, setQuestions] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function initAssessment() {
      // Fetch active questions
      const { data, error } = await supabase
        .from('PsychE_Question_Library')
        .select('*')
        .eq('is_active', true);

      if (error || !data || data.length < 10) {
        console.error('Error fetching questions or not enough questions:', error);
        alert('Not enough active questions in the library to run an assessment (requires 10).');
        onClose();
        return;
      }

      setQuestions(generateAssessment(data));
      setLoading(false);
    }
    initAssessment();
  }, []);

  const generateAssessment = (allQuestions: any[]) => {
    const pillars = ['Cognitive', 'Emotional', 'Family', 'Career', 'Personality', 'Skills'];
    const selected: any[] = [];
    let remaining = [...allQuestions];

    const shuffle = (array: any[]) => {
      let currentIndex = array.length, randomIndex;
      while (currentIndex > 0) {
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
      }
      return array;
    };

    // 1. Get one from each available pillar
    for (const pillar of pillars) {
      const qsInPillar = remaining.filter(q => q.pillar === pillar);
      if (qsInPillar.length > 0) {
        shuffle(qsInPillar);
        const chosen = qsInPillar[0];
        selected.push(chosen);
        remaining = remaining.filter(q => q.id !== chosen.id);
      }
      if (selected.length === 10) break;
    }

    // 2. Fill remainder randomly
    if (selected.length < 10) {
      shuffle(remaining);
      const needed = 10 - selected.length;
      selected.push(...remaining.slice(0, needed));
    }

    // 3. Shuffle final array
    return shuffle(selected);
  };

  const handleScoreSelect = (score: number) => {
    const currentQ = questions[currentIndex];
    setScores(prev => ({ ...prev, [currentQ.id]: score }));
  };

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(prev => prev + 1);
    }
  };

  const handleSubmit = async () => {
    setSaving(true);
    
    // Calculate average
    const scoreValues = Object.values(scores);
    const sum = scoreValues.reduce((a, b) => a + b, 0);
    const average = sum / questions.length;

    // Package JSON
    const assessmentData = questions.map((q) => ({
      question_id: q.id,
      pillar: q.pillar,
      question_text: q.question_text,
      score: scores[q.id] || 0
    }));

    try {
      const { error } = await supabase
        .from('PsychE_Assessments')
        .insert({
          student_uuid: studentUuid,
          counsellor_name: 'Counselor', // Defaulting for now
          overall_score: parseFloat(average.toFixed(2)),
          assessment_data: assessmentData
        });

      if (error) throw error;
      
      onSuccess();
    } catch (error) {
      console.error('Error saving assessment:', error);
      alert('Failed to save assessment.');
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p className="text-muted">Initializing Assessment Engine...</p>
      </div>
    );
  }

  const currentQ = questions[currentIndex];
  const currentScore = scores[currentQ?.id];

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bento-card"
        style={{ width: '100%', maxWidth: '700px', backgroundColor: 'var(--color-background)', border: '1px solid rgb(var(--ink) / 0.080)', display: 'flex', flexDirection: 'column' }}
      >
        {/* Header */}
        <div className="flex justify-between items-center mb-6" style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: '1rem' }}>
          <div>
            <h2 className="text-h2 flex items-center gap-2"><BrainCircuit className="text-primary" /> Live Assessment</h2>
            <p className="text-muted" style={{ fontSize: '0.875rem' }}>Student: {studentName}</p>
          </div>
          <button onClick={onClose} className="btn btn-secondary" style={{ padding: '0.5rem', border: 'none', background: 'transparent' }}>
            <X size={20} className="text-muted" />
          </button>
        </div>

        {/* Content (AnimatePresence for smooth question transitions) */}
        <div style={{ minHeight: '300px', display: 'flex', flexDirection: 'column' }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={currentIndex}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
            >
              <div className="flex justify-between items-center mb-4">
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-primary)', backgroundColor: 'rgba(94, 106, 210, 0.1)', padding: '0.2rem 0.6rem', borderRadius: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {currentQ.pillar}
                </span>
                <span className="text-muted" style={{ fontSize: '0.875rem', fontWeight: 600 }}>
                  Question {currentIndex + 1} of 10
                </span>
              </div>
              
              <h3 className="text-h2 mb-8" style={{ fontSize: '1.25rem', lineHeight: '1.6', fontWeight: 500 }}>
                {currentQ.question_text}
              </h3>

              <div style={{ marginTop: 'auto' }}>
                <p className="text-muted mb-3" style={{ fontSize: '0.875rem', textAlign: 'center' }}>Rate Reasoning Framework (1-10)</p>
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'space-between' }}>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(num => (
                    <button
                      key={num}
                      onClick={() => handleScoreSelect(num)}
                      style={{
                        flex: 1,
                        padding: '1rem 0',
                        borderRadius: 'var(--radius-sm)',
                        border: currentScore === num ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                        backgroundColor: currentScore === num ? 'rgba(94, 106, 210, 0.15)' : 'rgb(var(--ink) / 0.016)',
                        color: currentScore === num ? 'var(--color-primary)' : 'inherit',
                        fontSize: '1.1rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        transform: currentScore === num ? 'scale(1.05)' : 'scale(1)'
                      }}
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end' }}>
          {currentIndex < questions.length - 1 ? (
            <button 
              onClick={handleNext}
              disabled={currentScore === undefined}
              className="btn btn-primary"
              style={{ padding: '0.75rem 1.5rem', opacity: currentScore === undefined ? 0.5 : 1, transition: 'all 0.2s', display: 'flex', gap: '0.5rem', alignItems: 'center' }}
            >
              Next Question <ChevronRight size={18} />
            </button>
          ) : (
            <button 
              onClick={handleSubmit}
              disabled={currentScore === undefined || saving}
              className="btn btn-primary"
              style={{ padding: '0.75rem 1.5rem', background: 'var(--accent-green)', border: 'none', opacity: (currentScore === undefined || saving) ? 0.5 : 1, transition: 'all 0.2s', display: 'flex', gap: '0.5rem', alignItems: 'center' }}
            >
              {saving ? 'Saving...' : <><CheckCircle size={18} /> Submit Assessment</>}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
};
