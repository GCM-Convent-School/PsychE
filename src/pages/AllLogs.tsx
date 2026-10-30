import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Clock, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.1 } }
};

const PAGE_SIZE = 25;

export const AllLogs: React.FC = () => {
  const navigate = useNavigate();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const fetchLogsPage = useCallback(async (pageNum: number) => {
    const from = pageNum * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('PsychE_Counseling_Logs')
      .select(`
        id,
        reason,
        session_date,
        student_uuid,
        PsychE_Students (full_name, student_id)
      `)
      .order('session_date', { ascending: false })
      .range(from, to);

    if (error) throw error;
    return data ?? [];
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await fetchLogsPage(0);
        setLogs(data);
        setPage(0);
        setHasMore(data.length === PAGE_SIZE);
      } catch (error) {
        console.error('Error fetching all logs:', error);
      } finally {
        setLoading(false);
      }
    })();
  }, [fetchLogsPage]);

  const handleLoadMore = async () => {
    const nextPage = page + 1;
    setLoadingMore(true);
    try {
      const data = await fetchLogsPage(nextPage);
      setLogs(prev => [...prev, ...data]);
      setPage(nextPage);
      setHasMore(data.length === PAGE_SIZE);
    } catch (error) {
      console.error('Error fetching more logs:', error);
    } finally {
      setLoadingMore(false);
    }
  };

  const getColorForReason = (reason: string) => {
    if (reason.toLowerCase().includes('stress')) return 'var(--accent-red)';
    if (reason.toLowerCase().includes('career')) return 'var(--accent-blue)';
    if (reason.toLowerCase().includes('conflict')) return 'var(--accent-amber)';
    return 'var(--accent-green)';
  };

  return (
    <motion.div variants={container} initial="hidden" animate="show" style={{ padding: '1rem 0' }}>
      <div className="flex justify-between items-center mb-6 mobile-stack mobile-stack-start" style={{ gap: '1rem' }}>
        <div>
          <button onClick={() => navigate(-1)} aria-label="Back" className="btn btn-secondary mb-4 page-back" style={{ padding: '0.25rem 0.5rem', fontSize: '0.875rem', backgroundColor: 'transparent', border: 'none' }}>
            <ArrowLeft size={16} /> Back
          </button>
          <h1 className="text-h1 flex items-center gap-3">
            <Clock size={28} /> All Counseling Records
          </h1>
          <p className="text-muted">Viewing all documented counseling sessions.</p>
        </div>
      </div>

      <motion.div className="bento-card">
        {loading ? (
          <p className="text-muted text-center py-4">Loading logs...</p>
        ) : logs.length === 0 ? (
          <p className="text-muted text-center py-4">No records found.</p>
        ) : (
          <div className="flex" style={{ flexDirection: 'column', gap: '1rem' }}>
            {logs.map((log) => (
              <motion.div 
                key={log.id}
                onClick={() => navigate(`/student/${log.PsychE_Students?.student_id || log.student_uuid}`)}
                whileHover={{ x: 5, backgroundColor: 'rgb(var(--ink) / 0.024)' }}
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'space-between',
                  padding: '1rem',
                  borderRadius: 'var(--radius-md)',
                  transition: 'background-color 0.2s',
                  cursor: 'pointer',
                  border: '1px solid var(--color-border)'
                }}
              >
                <div className="flex items-center gap-4">
                  <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: getColorForReason(log.reason) }}></div>
                  <div>
                    <p style={{ fontWeight: 600, fontSize: '1.1rem' }}>{log.PsychE_Students?.full_name}</p>
                    <p className="text-muted" style={{ fontSize: '0.875rem' }}>{log.reason}</p>
                  </div>
                </div>
                <div className="text-right text-muted" style={{ fontSize: '0.875rem' }}>
                  {new Date(log.session_date).toLocaleString()}
                </div>
              </motion.div>
            ))}
          </div>
        )}
        {!loading && hasMore && (
          <div className="flex justify-center" style={{ marginTop: '1.25rem' }}>
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="btn btn-secondary"
              style={{ padding: '0.5rem 1.25rem', fontSize: '0.875rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
            >
              {loadingMore ? (
                <>
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                    style={{ display: 'inline-flex' }}
                  >
                    <Loader2 size={14} />
                  </motion.div>
                  Loading…
                </>
              ) : (
                'Load More'
              )}
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
};
