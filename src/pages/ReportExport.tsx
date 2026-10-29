import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { parseISO } from 'date-fns';
import { supabase } from '../lib/supabase';
import { Printer, ArrowLeft } from 'lucide-react';
import { PrintSessionCard } from '../components/print/PrintSessionCard';
import { PrintTelemetryBlock } from '../components/print/PrintTelemetryBlock';
import { PrintAISummaryBlock } from '../components/print/PrintAISummaryBlock';
import { useBranding, appTitle } from '../lib/branding';

export const ReportExport: React.FC = () => {
  const { schoolName } = useBranding();
  const [searchParams] = useSearchParams();
  const studentId = searchParams.get('studentId');
  const startDate = searchParams.get('start');
  const endDate = searchParams.get('end');
  const allTime = searchParams.get('allTime') === 'true';
  const includeTelemetry = searchParams.get('includeTelemetry') === 'true';
  const includeSummary = searchParams.get('includeSummary') === 'true';
  const navigate = useNavigate();

  const [student, setStudent] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [telemetry, setTelemetry] = useState<any>(null);
  const [engineStatus, setEngineStatus] = useState<string | null>(null);
  const [aiSummary, setAiSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchReportData() {
      if (!studentId) return;
      if (!allTime && (!startDate || !endDate)) return;

      try {
        const { data: sData } = await supabase.from('PsychE_Students').select('*').eq('id', studentId).single();
        if (sData) setStudent(sData);

        let query = supabase
          .from('PsychE_Counseling_Logs')
          .select('*')
          .eq('student_uuid', studentId)
          .eq('session_status', 'Completed')
          .order('session_date', { ascending: true }); // Chronological for statement

        if (!allTime && startDate && endDate) {
          // parseISO, not `new Date(str)` — start/end are bare YYYY-MM-DD query
          // params, which the native constructor parses as UTC midnight and
          // shifts to the previous local day for negative-offset timezones,
          // silently dropping/including sessions at the range boundary (BUG-001).
          const startIso = parseISO(startDate).toISOString();
          const endD = parseISO(endDate);
          endD.setHours(23, 59, 59, 999);
          const endIso = endD.toISOString();

          query = query.gte('session_date', startIso).lte('session_date', endIso);
        }

        const { data: lData } = await query;

        if (lData) setLogs(lData);

        if (includeTelemetry) {
          const [{ data: tData }, { data: statusData }] = await Promise.all([
            supabase.from('PsychE_Student_Telemetry').select('*')
              .eq('student_uuid', studentId).order('calculated_at', { ascending: false }).limit(1).maybeSingle(),
            supabase.rpc('psyche_get_engine_status', { p_student_uuid: studentId }),
          ]);
          setTelemetry(tData ?? null);
          setEngineStatus(typeof statusData === 'string' ? statusData : null);
        }

        if (includeSummary) {
          const { data: rData } = await supabase.from('PsychE_AI_Reports').select('report_jsonb')
            .eq('student_uuid', studentId).order('generated_at', { ascending: false }).limit(1).maybeSingle();
          setAiSummary(rData?.report_jsonb ?? null);
        }
      } catch (error) {
        console.error("Failed to fetch report data", error);
      } finally {
        setLoading(false);
        // Auto print after a small delay to allow rendering
        setTimeout(() => window.print(), 500);
      }
    }
    fetchReportData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, startDate, endDate, allTime, includeTelemetry, includeSummary]);

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center' }}>Generating Report...</div>;
  if (!student) return <div style={{ padding: '2rem', textAlign: 'center' }}>Student not found or invalid parameters.</div>;

  return (
    <div style={{ backgroundColor: '#fff', color: '#000', minHeight: '100vh', padding: '2rem' }}>

      <div className="no-print" style={{ marginBottom: '2rem' }}>
        <button onClick={() => navigate(-1)} className="btn btn-secondary" style={{ marginRight: '1rem', padding: '0.5rem 1rem' }}>
          <ArrowLeft size={16} style={{ display: 'inline', marginRight: '0.5rem' }} /> Back
        </button>
        <button onClick={() => window.print()} className="btn btn-primary" style={{ padding: '0.5rem 1rem' }}>
          <Printer size={16} style={{ display: 'inline', marginRight: '0.5rem' }} /> Print Statement
        </button>
      </div>

      <div style={{ maxWidth: '800px', margin: '0 auto', fontFamily: 'serif' }}>
        {/* Header */}
        <div style={{ borderBottom: '2px solid #000', paddingBottom: '1rem', marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '2rem', fontWeight: 'bold' }}>{appTitle(schoolName)} Official Transcript</h1>
            <p style={{ margin: '0.5rem 0 0 0', fontSize: '1rem', color: '#555' }}>Counseling & Assessment Statement</p>
          </div>
          <div style={{ textAlign: 'right', fontSize: '0.875rem' }}>
            <p style={{ margin: 0 }}><strong>Generated:</strong> {new Date().toLocaleDateString()}</p>
            <p style={{ margin: '0.25rem 0 0 0' }}>
              <strong>Period:</strong> {allTime ? 'Full History (All Time)' : `${parseISO(startDate!).toLocaleDateString()} - ${parseISO(endDate!).toLocaleDateString()}`}
            </p>
          </div>
        </div>

        {/* Student Meta */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem', padding: '1.5rem', backgroundColor: '#f9f9f9', border: '1px solid #ddd' }}>
          <div>
            <p style={{ margin: '0 0 0.5rem 0' }}><strong>Student Name:</strong> {student.full_name}</p>
            <p style={{ margin: '0 0 0.5rem 0' }}><strong>Student ID:</strong> {student.student_id}</p>
            <p style={{ margin: 0 }}><strong>Course/Grade:</strong> {student.course}</p>
          </div>
          <div>
            <p style={{ margin: '0 0 0.5rem 0' }}><strong>Risk Level:</strong> {student.risk_level}</p>
            <p style={{ margin: '0 0 0.5rem 0' }}><strong>Contact:</strong> {student.mobile || 'N/A'}</p>
            <p style={{ margin: 0 }}><strong>Parent/Guardian:</strong> {student.fathers_name || student.mothers_name || 'N/A'}</p>
          </div>
        </div>

        {includeSummary && aiSummary && <PrintAISummaryBlock report={aiSummary} />}

        {includeTelemetry && (
          <PrintTelemetryBlock
            metricsPayload={telemetry?.metrics_payload ?? null}
            etiScore={telemetry?.eti_score ?? null}
            etiData={telemetry?.eti_data ?? null}
            compositeScore={telemetry?.composite_score ?? null}
            compositeConfidence={telemetry?.composite_confidence ?? null}
            rsiScore={telemetry?.rsi_score ?? null}
            engineStatus={engineStatus}
          />
        )}

        {/* Logs / Transactions */}
        <h2 style={{ fontSize: '1.25rem', borderBottom: '1px solid #ccc', paddingBottom: '0.5rem', marginBottom: '1.5rem' }}>Session History</h2>

        {logs.length === 0 ? (
          <p style={{ fontStyle: 'italic', color: '#666' }}>No completed sessions found in this date range.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {logs.map((log) => (
              <PrintSessionCard key={log.id} log={log} />
            ))}
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: '3rem', paddingTop: '1rem', borderTop: '2px solid #000', textAlign: 'center', fontSize: '0.875rem', color: '#777' }}>
          <p style={{ margin: 0 }}>End of Statement</p>
          <p style={{ margin: '0.25rem 0 0 0' }}>{appTitle(schoolName)} • Confidential Record</p>
        </div>
      </div>
    </div>
  );
};
