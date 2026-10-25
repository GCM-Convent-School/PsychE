// =============================================================================
//  Live model catalogue — asks each provider which models this API key can
//  actually use right now.
//
//  Two callers:
//    - list-models (Settings page dropdowns): the counsellor/admin picks from
//      what really exists today instead of a hardcoded list that silently
//      rots (Groq retired both of the original Llama models on 2026-08-16,
//      which took every AI feature down until a redeploy).
//    - modelRouter.generateWithFallback: last-resort self-heal — if every
//      configured + default model fails with "model not found", pick a live
//      model from this list rather than returning an error.
//
//  The provider keys never leave the Edge Function; the browser only ever
//  sees model IDs.
// =============================================================================

export type Provider = 'groq' | 'gemini';

export interface CatalogModel {
  provider: Provider;
  id: string;
  label: string;
  contextWindow: number | null;
}

export interface ProviderCatalog {
  configured: boolean;
  models: CatalogModel[];
  error: string | null;
}

// Not text-generation models (speech, TTS, safety classifiers, embeddings,
// image/video, agentic "compound" systems) — useless for a JSON report.
const EXCLUDE = /whisper|tts|orpheus|playai|guard|safeguard|compound|embedding|imagen|veo|image|live|audio|robotics|computer-use|aqa|learnlm|transcribe|nano-banana/i;

async function fetchGroqModels(apiKey: string): Promise<CatalogModel[]> {
  const res = await fetch('https://api.groq.com/openai/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return (json.data ?? [])
    .filter((m: any) => m?.id && m.active !== false && !EXCLUDE.test(m.id))
    .map((m: any) => ({
      provider: 'groq' as const,
      id: m.id,
      label: m.id,
      contextWindow: typeof m.context_window === 'number' ? m.context_window : null,
    }));
}

async function fetchGeminiModels(apiKey: string): Promise<CatalogModel[]> {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
    headers: { 'x-goog-api-key': apiKey },
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return (json.models ?? [])
    .filter((m: any) =>
      typeof m?.name === 'string' &&
      m.name.includes('gemini') &&
      (m.supportedGenerationMethods ?? []).includes('generateContent') &&
      !EXCLUDE.test(m.name))
    .map((m: any) => {
      const id = m.name.replace(/^models\//, '');
      return {
        provider: 'gemini' as const,
        id,
        label: m.displayName ? `${m.displayName} (${id})` : id,
        contextWindow: typeof m.inputTokenLimit === 'number' ? m.inputTokenLimit : null,
      };
    });
}

async function catalogFor(provider: Provider, apiKey: string | undefined): Promise<ProviderCatalog> {
  if (!apiKey) return { configured: false, models: [], error: null };
  try {
    const models = provider === 'groq' ? await fetchGroqModels(apiKey) : await fetchGeminiModels(apiKey);
    models.sort((a, b) => a.id.localeCompare(b.id));
    return { configured: true, models, error: null };
  } catch (err) {
    return { configured: true, models: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchLiveCatalog(groqKey: string | undefined, geminiKey: string | undefined) {
  const [groq, gemini] = await Promise.all([catalogFor('groq', groqKey), catalogFor('gemini', geminiKey)]);
  return { groq, gemini };
}
