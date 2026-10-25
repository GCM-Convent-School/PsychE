// =============================================================================
//  Model Choice Router
//
//  Picks which LLM handles a given generation and falls through to the next
//  candidate on failure. Candidate order, highest priority first:
//
//    1. The admin's choice — PsychE_Settings.ai_models (V13), an ordered list
//       saved from the Settings page, picked from the providers' LIVE model
//       lists (list-models Edge Function).
//    2. DEFAULT_MODEL_PROFILES below — used alone when nothing is configured,
//       and appended as fallbacks when something is.
//    3. Self-heal: if every candidate failed with "model not found", ask the
//       provider for its live model list and try up to two of those.
//
//  Why (1) and (3) exist: the original Llama models were hardcoded here and
//  Groq retired them on 2026-08-16. Every AI feature 404'd until a code
//  redeploy, and the error was hidden behind a generic message. A retired
//  model should now cost one failed attempt, not an outage.
//
//  ⚠ maxRpm/maxRpd are CONSERVATIVE PLACEHOLDERS, not read from the actual
//    Groq/Google account tier — there is no API for "what's my quota".
//    Under-cap models are tried first; over-cap ones are pushed to the end,
//    never dropped, because the real HTTP call is still the true backstop.
//
//  Rate tracking is a database table (PsychE_Model_Usage_Log), not an
//  in-memory counter — Edge Functions are stateless per invocation, so a
//  module-level counter would reset unpredictably and undercount.
// =============================================================================

import { callGroq, callGemini, type CallFn } from './llmProviders.ts';
import { fetchLiveCatalog, type Provider } from './modelCatalog.ts';

export interface ModelProfile {
  name: string;
  provider: Provider;
  maxRpm: number;
  maxRpd: number;
  reasoningClass: 'high' | 'medium' | 'low';
}

// Groq's documented replacements for the retired Llama models. The Gemini
// entry is Google's rolling "-latest" alias rather than a pinned version:
// gemini-2.5-flash-lite was still listed by /v1beta/models on 2026-10-25 but
// returned 404 on generateContent, so a listing alone isn't proof of life.
export const DEFAULT_MODEL_PROFILES: ModelProfile[] = [
  { name: 'openai/gpt-oss-120b', provider: 'groq', maxRpm: 30, maxRpd: 1000, reasoningClass: 'high' },
  { name: 'openai/gpt-oss-20b', provider: 'groq', maxRpm: 30, maxRpd: 1000, reasoningClass: 'medium' },
  { name: 'gemini-flash-lite-latest', provider: 'gemini', maxRpm: 15, maxRpd: 1000, reasoningClass: 'medium' },
];

// Limits assumed for an admin-picked model we have no profile for.
const UNKNOWN_MODEL_LIMITS = { maxRpm: 30, maxRpd: 1000 };

export interface UsageCounts {
  callsLastMinute: number;
  callsToday: number;
}

export type LoadStats = Record<string, UsageCounts>;

async function getUsageCounts(supabase: any, modelName: string): Promise<UsageCounts> {
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const [{ count: minuteCount }, { count: dayCount }] = await Promise.all([
    supabase.from('PsychE_Model_Usage_Log').select('*', { count: 'exact', head: true })
      .eq('model_name', modelName).gte('called_at', oneMinuteAgo),
    supabase.from('PsychE_Model_Usage_Log').select('*', { count: 'exact', head: true })
      .eq('model_name', modelName).gte('called_at', startOfDay.toISOString()),
  ]);

  return { callsLastMinute: minuteCount ?? 0, callsToday: dayCount ?? 0 };
}

/** One read of PsychE_Model_Usage_Log per candidate model. Call once per request. */
export async function getLoadStats(supabase: any, profiles: ModelProfile[]): Promise<LoadStats> {
  const stats: LoadStats = {};
  await Promise.all(
    profiles.map(async (profile) => {
      stats[profile.name] = await getUsageCounts(supabase, profile.name);
    })
  );
  return stats;
}

/** PsychE_Settings.ai_models → profiles, in the admin's order. Never throws. */
export async function loadConfiguredModels(supabase: any): Promise<ModelProfile[]> {
  const { data, error } = await supabase.from('PsychE_Settings').select('ai_models').eq('id', 1).maybeSingle();
  // Column missing (V13 migration not run yet) or unreadable → defaults only.
  if (error || !Array.isArray(data?.ai_models)) return [];

  return data.ai_models
    .filter((m: any) => (m?.provider === 'groq' || m?.provider === 'gemini') && typeof m?.name === 'string' && m.name.trim())
    .map((m: any): ModelProfile => {
      const known = DEFAULT_MODEL_PROFILES.find((d) => d.provider === m.provider && d.name === m.name);
      return known ?? { name: m.name.trim(), provider: m.provider, ...UNKNOWN_MODEL_LIMITS, reasoningClass: 'high' };
    });
}

function reasoningRank(m: ModelProfile): number {
  return m.reasoningClass === 'high' ? 2 : m.reasoningClass === 'medium' ? 1 : 0;
}

function isUnderCap(profile: ModelProfile, usage: UsageCounts | undefined): boolean {
  if (!usage) return true;
  return usage.callsLastMinute < profile.maxRpm && usage.callsToday < profile.maxRpd;
}

function key(m: { provider: string; name: string }): string {
  return `${m.provider}:${m.name}`;
}

/**
 * Full ranked candidate list. Configured models keep the admin's order;
 * defaults follow (highest reasoning first for 'full', lowest for 'summary').
 * Within that order, under-cap models go first and over-cap ones last.
 */
export function rankModelsForReport(
  loadStats: LoadStats,
  reportType: 'summary' | 'full',
  availableProviders: Set<Provider>,
  configured: ModelProfile[] = []
): ModelProfile[] {
  const defaults = [...DEFAULT_MODEL_PROFILES].sort((a, b) =>
    reportType === 'full' ? reasoningRank(b) - reasoningRank(a) : reasoningRank(a) - reasoningRank(b));

  const seen = new Set<string>();
  const ordered = [...configured, ...defaults].filter((m) => {
    if (!availableProviders.has(m.provider) || seen.has(key(m))) return false;
    seen.add(key(m));
    return true;
  });

  const underCap = ordered.filter((m) => isUnderCap(m, loadStats[m.name]));
  const overCap = ordered.filter((m) => !isUnderCap(m, loadStats[m.name]));
  return [...underCap, ...overCap];
}

function callFnFor(profile: ModelProfile, keys: ProviderKeys, maxTokens: number): CallFn {
  if (profile.provider === 'groq') {
    return (system, user) => callGroq(keys.groq!, profile.name, system, user, { maxTokens, jsonMode: true });
  }
  return (system, user) => callGemini(keys.gemini!, profile.name, system, user, { maxTokens, jsonMode: true });
}

/** "Groq 404: {json}" → "404 model_not_found". Keeps UI error text short and key-free. */
function shortError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const status = msg.match(/^(?:Groq|Gemini) (\d{3})/)?.[1];
  const code = msg.match(/"code"\s*:\s*"([^"]+)"/)?.[1] ?? msg.match(/"status"\s*:\s*"([^"]+)"/)?.[1];
  if (status) return code ? `${status} ${code}` : status;
  return msg.length > 120 ? `${msg.slice(0, 117)}...` : msg;
}

function isModelNotFound(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /model_not_found|does not exist|is not found|NOT_FOUND|decommissioned/i.test(msg);
}

export interface ProviderKeys {
  groq: string | undefined;
  gemini: string | undefined;
}

export function readProviderKeys(): ProviderKeys {
  return { groq: Deno.env.get('GROQ_API_KEY'), gemini: Deno.env.get('GEMINI_API_KEY') };
}

export function availableProvidersFor(keys: ProviderKeys): Set<Provider> {
  return new Set<Provider>([
    ...(keys.groq ? (['groq'] as const) : []),
    ...(keys.gemini ? (['gemini'] as const) : []),
  ]);
}

export interface FallbackResult<T> {
  result: T | null;
  profile: ModelProfile | null;
  /** One "provider:model → reason" entry per failed attempt, in order tried. */
  failures: string[];
}

/**
 * Tries every candidate in order until `run` succeeds. `run` receives a
 * provider-bound call function and does its own prompting/validation —
 * throwing means "try the next model".
 */
export async function generateWithFallback<T>(opts: {
  supabase: any;
  keys: ProviderKeys;
  reportType: 'summary' | 'full';
  maxTokens: number;
  run: (call: CallFn) => Promise<T>;
}): Promise<FallbackResult<T>> {
  const { supabase, keys, reportType, maxTokens, run } = opts;
  const available = availableProvidersFor(keys);

  const configured = await loadConfiguredModels(supabase);
  const pool = [...configured, ...DEFAULT_MODEL_PROFILES];
  const loadStats = await getLoadStats(supabase, pool);
  const ranked = rankModelsForReport(loadStats, reportType, available, configured);

  const failures: string[] = [];
  const tried = new Set<string>();
  let sawModelNotFound = false;

  const attempt = async (profile: ModelProfile): Promise<T | null> => {
    tried.add(key(profile));
    try {
      return await run(callFnFor(profile, keys, maxTokens));
    } catch (err) {
      if (isModelNotFound(err)) sawModelNotFound = true;
      failures.push(`${key(profile)} → ${shortError(err)}`);
      return null;
    }
  };

  for (const profile of ranked) {
    const result = await attempt(profile);
    if (result !== null) return { result, profile, failures };
  }

  // Self-heal: every known model is gone — use whatever the provider lists today.
  if (sawModelNotFound) {
    const catalog = await fetchLiveCatalog(keys.groq, keys.gemini);
    const live = [...catalog.groq.models, ...catalog.gemini.models]
      .filter((m) => available.has(m.provider) && !tried.has(key({ provider: m.provider, name: m.id })))
      .sort((a, b) => (b.contextWindow ?? 0) - (a.contextWindow ?? 0))
      .slice(0, 2);
    for (const m of live) {
      const profile: ModelProfile = { name: m.id, provider: m.provider, ...UNKNOWN_MODEL_LIMITS, reasoningClass: 'high' };
      const result = await attempt(profile);
      if (result !== null) return { result, profile, failures };
    }
  }

  return { result: null, profile: null, failures };
}

/**
 * One row per generation. Doubles as the compliance audit trail — a Data
 * Protection Incharge can confirm what model ran, for which report type, and
 * roughly how much was sent, without reading raw prompts.
 */
export async function logModelUsage(
  supabase: any,
  entry: {
    modelName: string;
    provider: string;
    reportType: 'summary' | 'full' | 'session';
    tokensUsed: number | null;
    studentUuid: string | null;
  }
): Promise<void> {
  await supabase.from('PsychE_Model_Usage_Log').insert([{
    model_name: entry.modelName,
    provider: entry.provider,
    report_type: entry.reportType,
    tokens_used: entry.tokensUsed,
    student_uuid: entry.studentUuid,
  }]);
}
