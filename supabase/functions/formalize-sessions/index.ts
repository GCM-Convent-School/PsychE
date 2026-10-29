// =============================================================================
//  PsychE V12 — formalize-sessions (Supabase Edge Function)
//
//  Replaces generate-session-report (V11), which blended a whole date range
//  into one AI-written narrative paragraph — testing showed that's unusable.
//  This function does the opposite: it tops up whatever hasn't been
//  formalized yet for a student, one session at a time, in a SINGLE batched
//  LLM call, and never touches a session that's already formalized.
//
//  Body: { studentUuid: string }
//  No date range, no telemetry/summary flags — those are print-time-only
//  concerns now (see FormalReportExport.tsx / ReportExport.tsx), completely
//  decoupled from generation. Telemetry never reaches this function at all.
//
//  "Only a single AI run per student, saves AI overhead": PsychE_Formalized_
//  Sessions.log_id is UNIQUE, so step 3 below is a single indexed lookup, and
//  if nothing is pending we return before ever calling the model router/the
//  provider — a student with nothing new costs zero LLM calls, not just zero
//  writes.
//
//  Deploy:
//    supabase functions deploy formalize-sessions --project-ref <your-ref>
//  Shares GROQ_API_KEY / GEMINI_API_KEY secrets with generate-ai-report — no
//  separate secret to set.
// =============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildCorsHeaders } from '../_shared/cors.ts';
import { authorizeCaller, unauthorized } from '../_shared/auth.ts';
import { redactSessionForFormalization, type RawSession } from '../_shared/redaction.ts';
import { generateJsonWithRepair } from '../_shared/llmProviders.ts';
import { generateWithFallback, readProviderKeys, availableProvidersFor, logModelUsage } from '../_shared/modelRouter.ts';

// Sized for a first-time backlog covering many sessions at once, not one
// paragraph — this function never condenses, so output scales with how many
// sessions are pending. A backlog large enough to exceed this in one call is
// an accepted, documented limitation (no chunking in this version).
const MAX_OUTPUT_TOKENS = 4096;

const SYSTEM_PROMPT = `You are a child psychology assistant converting a school counsellor's raw
session notes into formal clinical language, one session at a time.

You will be given a JSON array of sessions, each with an "id" and up to three text
fields: "reason", "student_response", "recommended_action". Some fields may be null —
leave them null in your output too.

Ground rules, all mandatory:
- Rewrite each field into formal, precise clinical language. Pair any clinical term with
  a plain-language gloss in the same sentence, matching the tone of a formal case record.
- Preserve every specific detail already present. Do not condense, summarize, or omit
  anything. Do not shorten a session's content just because it seems minor.
- Treat every session independently. Never reference, compare, or blend content from one
  session into another's fields.
- Never invent, reference, or imply any number, score, percentage, or telemetry value —
  none were given to you, and none belong in this output.
- Do not invent facts, names, or specifics not present in the input.

Respond with ONLY a single valid JSON object — no markdown fences, no commentary before
or after — matching exactly this shape, with "sessions" in the SAME ORDER and the SAME
"id" values as the input, one output object per input session:
{
  "sessions": [
    { "id": string, "reason": string | null, "student_response": string | null, "recommended_action": string | null }
  ]
}`;

function buildUserPrompt(sessions: { id: string; reason: string | null; student_response: string | null; recommended_action: string | null }[]): string {
  return `Sessions to formalize (${sessions.length} total):\n${JSON.stringify(sessions, null, 2)}\n\nReturn the JSON object now.`;
}

function isValidShape(pendingIds: Set<string>, expectedCount: number) {
  return (obj: any): boolean => {
    if (!obj || !Array.isArray(obj.sessions)) return false;
    if (obj.sessions.length !== expectedCount) return false;
    return obj.sessions.every((s: any) => s && typeof s.id === 'string' && pendingIds.has(s.id));
  };
}

Deno.serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Release 1: staff session or the service key; anon gets 401.
    const caller = await authorizeCaller(req, supabase);
    if (!caller) return unauthorized(corsHeaders, { formalizedSessions: [], skippedCount: 0 });

    const { studentUuid } = await req.json();

    if (!studentUuid || typeof studentUuid !== 'string') {
      return new Response(JSON.stringify({ formalizedSessions: [], skippedCount: 0, error: 'studentUuid is required.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const [{ data: logs, error: logsError }, { data: existing, error: existingError }] = await Promise.all([
      supabase.from('PsychE_Counseling_Logs')
        .select('id, counselor_name, reason, student_response, recommended_action')
        .eq('student_uuid', studentUuid)
        .eq('session_status', 'Completed'),
      supabase.from('PsychE_Formalized_Sessions')
        .select('log_id')
        .eq('student_uuid', studentUuid),
    ]);

    if (logsError) {
      return new Response(JSON.stringify({ formalizedSessions: [], skippedCount: 0, error: logsError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (existingError) {
      return new Response(JSON.stringify({ formalizedSessions: [], skippedCount: 0, error: existingError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const alreadyDone = new Set((existing ?? []).map((r: { log_id: string }) => r.log_id));
    const notYetDone = (logs ?? []).filter((l: RawSession) => !alreadyDone.has(l.id));

    const hasContent = (l: RawSession) =>
      Boolean(l.reason?.trim() || l.student_response?.trim() || l.recommended_action?.trim());

    const pending = notYetDone.filter(hasContent);
    const skippedCount = notYetDone.length - pending.length;

    // The core of "single run, saves AI overhead": nothing pending means no
    // provider lookup, no model ranking, no LLM call — a pure DB read.
    if (pending.length === 0) {
      return new Response(
        JSON.stringify({ formalizedSessions: [], skippedCount, error: null, alreadyCurrent: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const redacted = pending.map((l: RawSession) => redactSessionForFormalization(l));
    const pendingIds = new Set(pending.map((l: RawSession) => l.id));
    const userPrompt = buildUserPrompt(redacted);

    const keys = readProviderKeys();
    if (availableProvidersFor(keys).size === 0) {
      return new Response(
        JSON.stringify({ formalizedSessions: [], skippedCount, error: 'No LLM provider configured (GROQ_API_KEY / GEMINI_API_KEY missing).' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const validateShape = isValidShape(pendingIds, pending.length);
    const { result, profile: chosenProfile, failures } = await generateWithFallback({
      supabase, keys, reportType: 'full', maxTokens: MAX_OUTPUT_TOKENS,
      run: (call) => generateJsonWithRepair(call, SYSTEM_PROMPT, userPrompt, validateShape),
    });
    if (failures.length) console.warn('[formalize-sessions] Model attempts failed:', failures);

    if (!result || !chosenProfile) {
      return new Response(
        JSON.stringify({ formalizedSessions: [], skippedCount, error: `Unable to formalize sessions right now. Tried: ${failures.join('; ')}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const sessions: { id: string; reason: string | null; student_response: string | null; recommended_action: string | null }[] = result.data.sessions;
    const tokensUsed = result.tokensUsed;

    const modelUsed = `${chosenProfile.provider}:${chosenProfile.name}`;
    const batchId = crypto.randomUUID();

    await logModelUsage(supabase, {
      modelName: chosenProfile.name, provider: chosenProfile.provider,
      reportType: 'session', tokensUsed, studentUuid,
    });

    const rows = sessions.map((s) => ({
      log_id: s.id,
      student_uuid: studentUuid,
      reason_formal: s.reason,
      student_response_formal: s.student_response,
      recommended_action_formal: s.recommended_action,
      model_used: modelUsed,
      batch_id: batchId,
      created_by: caller.kind === 'staff' ? caller.userId : null,
    }));

    const { data: inserted, error: upsertError } = await supabase
      .from('PsychE_Formalized_Sessions')
      .upsert(rows, { onConflict: 'log_id' })
      .select('id, log_id, student_uuid, reason_formal, student_response_formal, recommended_action_formal, model_used, formalized_at');

    if (upsertError) {
      return new Response(JSON.stringify({ formalizedSessions: [], skippedCount, error: upsertError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ formalizedSessions: inserted ?? [], skippedCount, error: null }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[formalize-sessions] Unhandled error:', err);
    return new Response(JSON.stringify({ formalizedSessions: [], skippedCount: 0, error: 'Unexpected error formalizing sessions.' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
