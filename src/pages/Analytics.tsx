import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { BarChart2, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { MIN_COMPOSITE_CONFIDENCE } from '../types';
import {
  allocationSummary, recencyBuckets, needAlignment, underServed,
  throughputSummary, feasibility, depthFrontier,
  WORKING_DAYS_PER_TERM, TARGET_CONTACTS_PER_TERM, PLANNED_ENROLMENT, FALLBACK_DEPTH
} from '../analytics/programmeHealth';
import type { ProgrammeHealthPayload } from '../analytics/programmeHealth';
import {
  AllocationPanel, CoveragePanel, FeasibilityPanel,
  ThroughputPanel, TriagePanel, IntegrityPanel
} from '../components/ProgrammeHealthPanel';
import { useDocumentTitle } from '../lib/branding';

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06 } } };
const item = { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } };

/**
 * Programme Health — the school-admin view.
 *
 * Deliberately split into MEASURED panels (allocation, recency, throughput,
 * integrity) and MODELLED panels (feasibility). The school runs a single
 * counsellor with no plans to add another, so capacity is fixed and the
 * governing question is not "do we need more staff" but "is the fixed capacity
 * being used, and aimed at the right students". See ARCH_technical-specs.md §9.
 */
export const Analytics: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ProgrammeHealthPayload | null>(null);

  useDocumentTitle('Programme Health');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: payload, error: rpcError } = await supabase
        .rpc('psyche_programme_health', { p_window_days: 180 });
      if (rpcError) setError(rpcError.message);
      else setData(payload as ProgrammeHealthPayload);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="page-loading" style={{ padding: '2rem' }}>Loading programme health…</div>;
  if (error) return (
    <div className="bento-card" style={{ margin: '1rem 0', borderColor: 'rgba(245,91,91,0.4)' }}>
      <h3 className="text-h3" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#f55b5b' }}>
        <AlertTriangle size={18} /> Could not load programme health
      </h3>
      <p className="text-muted" style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>{error}</p>
      <p className="text-muted" style={{ fontSize: '0.78rem', marginTop: '0.5rem' }}>
        If this reads “function psyche_programme_health does not exist”, run
        <code style={{ margin: '0 0.3rem' }}>v8_programme_health.sql</code> against this database.
      </p>
    </div>
  );
  if (!data) return null;

  const students = data.students ?? [];
  const capacity = data.daily_session_capacity ?? 0;

  // ---- MEASURED ----------------------------------------------------------
  const alloc = allocationSummary(students);
  const buckets = recencyBuckets(students);
  const alignment = needAlignment(students, MIN_COMPOSITE_CONFIDENCE);
  const triage = underServed(students, MIN_COMPOSITE_CONFIDENCE, 30);
  const through = throughputSummary(data.daily_throughput ?? [], capacity);

  // ---- MODELLED ----------------------------------------------------------
  // Depth is taken from observed behaviour where there is enough of it, so the
  // model self-calibrates rather than resting on a hard-coded guess.
  const depthIsObserved = alloc.everSeen >= 5 && alloc.meanSessionsPerSeen != null;
  const observedDepth = depthIsObserved ? (alloc.meanSessionsPerSeen as number) : FALLBACK_DEPTH;

  const modelFor = (n: number) => feasibility({
    capacityPerDay: capacity,
    workingDaysPerTerm: WORKING_DAYS_PER_TERM,
    studentCount: n,
    targetContactsPerTerm: TARGET_CONTACTS_PER_TERM,
    observedDepth
  });
  const now = modelFor(Math.max(1, alloc.studentCount));
  const projected = modelFor(PLANNED_ENROLMENT);
  const frontier = depthFrontier(
    projected.capacityPerTerm, PLANNED_ENROLMENT, TARGET_CONTACTS_PER_TERM,
    [2, 4, Number(observedDepth.toFixed(1)), 9]
  );

  return (
    <motion.div variants={container} initial="hidden" animate="show" style={{ padding: '1rem 0' }}>
      <motion.div variants={item} style={{ marginBottom: '1.5rem' }}>
        <h1 className="text-h1" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <BarChart2 size={30} style={{ color: 'var(--color-primary)' }} /> Programme Health
        </h1>
        <p className="text-muted" style={{ marginTop: '0.25rem' }}>
          School-wide view of how counselling capacity is used and allocated · last {data.window_days} days
        </p>
      </motion.div>

      <div className="bento-grid">
        <AllocationPanel a={alloc} />
        <CoveragePanel buckets={buckets} total={alloc.studentCount} />

        <FeasibilityPanel
          now={now} projected={projected}
          capacity={capacity} workingDays={WORKING_DAYS_PER_TERM}
          currentN={alloc.studentCount} plannedN={PLANNED_ENROLMENT}
          observedDepth={observedDepth} depthIsObserved={depthIsObserved}
          frontier={frontier}
        />
        <ThroughputPanel daily={data.daily_throughput ?? []} summary={through} capacity={capacity} />

        <TriagePanel
          students={triage} alignment={alignment}
          onOpen={(sid) => sid && navigate(`/student/${sid}`)}
        />
        <IntegrityPanel i={data.integrity} />
      </div>
    </motion.div>
  );
};
