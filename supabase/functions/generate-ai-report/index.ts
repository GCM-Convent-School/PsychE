// =============================================================================
//  PsychE V10/V11 — generate-ai-report (Supabase Edge Function)
//
//  Why this exists as an Edge Function and not client code: this is the first
//  place in the app that needs to hold a secret server-side. Everything else
//  in PsychE is a Vite SPA calling Supabase directly with the anon key, which
//  is fine for Supabase (RLS is the boundary, however thin pre-production) but
//  would leak an LLM API key into every deployed bundle if called from the
//  browser. See agent.md's note on the committed-anon-key incident — this
//  function exists so that mistake is structurally impossible to repeat here.
//
//  Called two ways:
//    - On-demand: the frontend via supabase.functions.invoke(), body
//      { studentUuid, source: 'on_demand' }.
//    - Cron: .github/workflows/ai_reports_batch.yml, one curl per eligible
//      student, body { studentUuid, source: 'cron' }, authenticated with the
//      service role key.
//
//  V11 added the Model Choice Router (supabase/functions/_shared/modelRouter)
//  in place of a hardcoded Groq-then-Gemini fallback: the ranked candidate
//  list already accounts for today's call volume per model, so a busy day
//  degrades to a smaller model instead of just failing once Groq's free tier
//  caps out. V13 made the candidate list admin-configurable (Settings page →
//  PsychE_Settings.ai_models) after Groq retired the hardcoded Llama models.
//
//  Deploy:
//    supabase functions deploy generate-ai-report --project-ref <your-ref>
//    supabase secrets set GROQ_API_KEY=<key> --project-ref <your-ref>
//    supabase secrets set GEMINI_API_KEY=<key> --project-ref <your-ref>   (optional fallback)
//
//  SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY do NOT need to be set — every
//  Supabase Edge Function receives them automatically.
// =============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildCorsHeaders } from '../_shared/cors.ts';
import { buildTelemetrySummary, renderTelemetrySummary } from '../_shared/telemetryLabels.ts';
import { generateJsonWithRepair } from '../_shared/llmProviders.ts';
import { generateWithFallback, readProviderKeys, availableProvidersFor, logModelUsage } from '../_shared/modelRouter.ts';

const ON_DEMAND_COOLDOWN_HOURS = 24;

// Brevity caps (Task 3.3): a "clinical briefing" that runs to a page isn't
// crisp, it's just a smaller PRD. These are enforced two ways — the prompt
// asks for them, and max_tokens makes rambling past them physically impossible.
const MAX_OUTPUT_TOKENS = 900;

// ─── Prompt ───────────────────────────────────────────────────────────────
// Deliberately narrower than the eventual report shape: trajectory_delta and
// previous_suggestions_review are NOT requested here. Both are fixed,
// deterministic values spliced in after generation (see below) — asking the
// model for them and then overwriting the answer anyway would just waste
// output tokens and risk format drift for fields we discard regardless.
const SYSTEM_PROMPT = `You are a child psychology assistant writing an internal clinical
briefing for a school counsellor. The counsellor already knows this student personally;
you are giving them a synthesis of anonymised, structured data only — you have not read
any session notes or transcripts, and none exist in your input.

Tone: warm, clinically grounded, never cold or "lab report" in feel. Pair any formal
psychological term with a plain-language gloss in the same sentence. Never output raw
numbers, percentages, or scores — you were given qualitative bands precisely so you are
not tempted to invent false numeric precision.

Ground every claim in the provided data. Do not invent events, quotes, or specifics that
were not given to you. If the data is thin, say so plainly rather than padding.

Brevity is mandatory, not a suggestion:
- clinical_summary: 2-3 sentences, never more.
- tension_narrative: at most 2 sentences.
- engagement_narrative: at most 2 sentences.
- next_session_questions: exactly 3, each one concise sentence/question.
- ground_level_suggestions: action_item and rationale are each one sentence.

Respond with ONLY a single valid JSON object — no markdown fences, no commentary before
or after — matching exactly this shape:
{
  "clinical_summary": string (2-3 sentences),
  "dominant_theme": string (a short title, e.g. "Navigating Family Transition"),
  "tension_narrative": string (max 2 sentences on the dominant tension, if any),
  "engagement_narrative": string (max 2 sentences on session engagement/attendance),
  "next_session_questions": string[] (exactly 3 open-ended questions for the counsellor to ask),
  "ground_level_suggestions": [
    { "category": "Classroom & Academic", "action_item": string, "rationale": string, "clinical_term": string },
    { "category": "Counselor Intervention", "action_item": string, "rationale": string, "clinical_term": string }
  ]
}`;

function buildUserPrompt(anonProfileId: string, telemetryText: string): string {
  return `Student profile: ${anonProfileId}
${telemetryText}

Write the JSON report now.`;
}

function isValidReportShape(obj: any): boolean {
  return (
    obj &&
    typeof obj.clinical_summary === 'string' &&
    typeof obj.dominant_theme === 'string' &&
    typeof obj.tension_narrative === 'string' &&
    typeof obj.engagement_narrative === 'string' &&
    Array.isArray(obj.next_session_questions) &&
    Array.isArray(obj.ground_level_suggestions)
  );
}

Deno.serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { studentUuid, source } = await req.json();
    const generationSource: 'on_demand' | 'cron' = source === 'cron' ? 'cron' : 'on_demand';

    if (!studentUuid || typeof studentUuid !== 'string') {
      return new Response(JSON.stringify({ report: null, error: 'studentUuid is required.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const [{ data: student, error: studentError }, { data: telemetry }, { data: engineStatusData }, { data: lastReport }] =
      await Promise.all([
        supabase.from('PsychE_Students').select('risk_level, course').eq('id', studentUuid).single(),
        supabase
          .from('PsychE_Student_Telemetry')
          .select('metrics_payload, eti_data, composite_data')
          .eq('student_uuid', studentUuid)
          .order('calculated_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.rpc('psyche_get_engine_status', { p_student_uuid: studentUuid }),
        supabase
          .from('PsychE_AI_Reports')
          .select('id, report_jsonb, generation_source, model_used, generated_at')
          .eq('student_uuid', studentUuid)
          .order('generated_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

    if (studentError || !student) {
      return new Response(JSON.stringify({ report: null, error: 'Student not found.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const metricsPayload = telemetry?.metrics_payload ?? null;
    const sessionCount = metricsPayload?.session_count ?? 0;
    const dataCompleteness = metricsPayload?.data_completeness ?? 0;

    // Same threshold as psyche_ai_report_eligible_students() — one bar, not two.
    if (sessionCount < 2 || dataCompleteness < 0.3) {
      return new Response(
        JSON.stringify({
          report: null,
          error: null,
          insufficientData: true,
          reason: 'Not enough recorded assessment data yet to write a meaningful report.',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (generationSource === 'on_demand' && lastReport?.generated_at) {
      const hoursSince = (Date.now() - new Date(lastReport.generated_at).getTime()) / 3_600_000;
      if (hoursSince < ON_DEMAND_COOLDOWN_HOURS) {
        return new Response(
          JSON.stringify({
            report: lastReport,
            error: null,
            cooldownActive: true,
            cooldownEndsAt: new Date(
              new Date(lastReport.generated_at).getTime() + ON_DEMAND_COOLDOWN_HOURS * 3_600_000
            ).toISOString(),
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const engineStatus = typeof engineStatusData === 'string' ? engineStatusData : 'warming';
    const summary = buildTelemetrySummary(student, metricsPayload, telemetry?.eti_data, telemetry?.composite_data, engineStatus);
    const anonProfileId = `ANON_${studentUuid}`;
    const userPrompt = buildUserPrompt(anonProfileId, renderTelemetrySummary(summary));

    const keys = readProviderKeys();
    if (availableProvidersFor(keys).size === 0) {
      return new Response(
        JSON.stringify({ report: null, error: 'No LLM provider configured (GROQ_API_KEY / GEMINI_API_KEY missing).' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { result, profile: chosenProfile, failures } = await generateWithFallback({
      supabase, keys, reportType: 'full', maxTokens: MAX_OUTPUT_TOKENS,
      run: (call) => generateJsonWithRepair(call, SYSTEM_PROMPT, userPrompt, isValidReportShape),
    });
    if (failures.length) console.warn('[generate-ai-report] Model attempts failed:', failures);

    if (!result || !chosenProfile) {
      return new Response(
        JSON.stringify({ report: null, error: `Unable to generate report right now. Tried: ${failures.join('; ')}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const content = result.data;
    const tokensUsed = result.tokensUsed;
    const modelUsed = `${chosenProfile.provider}:${chosenProfile.name}`;

    await logModelUsage(supabase, {
      modelName: chosenProfile.name,
      provider: chosenProfile.provider,
      reportType: 'full',
      tokensUsed,
      studentUuid,
    });

    const reportContent = {
      clinical_summary: content.clinical_summary,
      dominant_theme: content.dominant_theme,
      tension_narrative: content.tension_narrative,
      engagement_narrative: content.engagement_narrative,
      // Fixed, not model-generated — see the header comment on why.
      trajectory_delta: {
        change_direction: 'insufficient_data' as const,
        change_confidence: 'low' as const,
        change_narrative: "Trend comparison isn't part of this version yet — this report reflects only the current snapshot.",
      },
      previous_suggestions_review: null,
      next_session_questions: content.next_session_questions,
      ground_level_suggestions: content.ground_level_suggestions,
    };

    const { data: inserted, error: insertError } = await supabase
      .from('PsychE_AI_Reports')
      .insert([
        {
          student_uuid: studentUuid,
          report_jsonb: reportContent,
          generation_source: generationSource,
          model_used: modelUsed,
        },
      ])
      .select('id, student_uuid, report_jsonb, generation_source, model_used, generated_at')
      .single();

    if (insertError) {
      return new Response(JSON.stringify({ report: null, error: insertError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ report: inserted, error: null }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[generate-ai-report] Unhandled error:', err);
    return new Response(JSON.stringify({ report: null, error: 'Unexpected error generating the report.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
