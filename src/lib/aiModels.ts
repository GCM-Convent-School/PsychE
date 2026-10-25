// =============================================================================
//  PsychE V13 — AI model selection data access
//  Owns: reading/writing PsychE_Settings.ai_models and invoking the
//  list-models Edge Function. The live model lists come from the providers
//  server-side (the API keys never reach the browser); this module only sees
//  model IDs. modelRouter.ts in the Edge Functions reads the saved order.
// =============================================================================

import { supabase } from './supabase';
import type { AIModelChoice, AIProvider } from '../types';

export interface CatalogModel {
  provider: AIProvider;
  id: string;
  label: string;
  contextWindow: number | null;
}

export interface ProviderCatalog {
  configured: boolean;
  models: CatalogModel[];
  error: string | null;
}

export interface ModelCatalogResult {
  providers: Record<AIProvider, ProviderCatalog> | null;
  defaults: AIModelChoice[];
  fetchedAt: string | null;
  error: string | null;
}

export async function fetchModelCatalog(): Promise<ModelCatalogResult> {
  const { data, error } = await supabase.functions.invoke('list-models', { body: {} });
  if (error) return { providers: null, defaults: [], fetchedAt: null, error: error.message || 'Unable to reach the model service.' };
  return {
    providers: data?.providers ?? null,
    defaults: data?.defaults ?? [],
    fetchedAt: data?.fetchedAt ?? null,
    error: data?.error ?? null,
  };
}

export async function fetchSavedModels(): Promise<{ data: AIModelChoice[]; error: string | null }> {
  const { data, error } = await supabase.from('PsychE_Settings').select('ai_models').eq('id', 1).maybeSingle();
  if (error) return { data: [], error: error.message };
  return { data: Array.isArray(data?.ai_models) ? data.ai_models : [], error: null };
}

export async function saveModels(models: AIModelChoice[]): Promise<{ error: string | null }> {
  const { error } = await supabase.from('PsychE_Settings').update({ ai_models: models }).eq('id', 1);
  return { error: error?.message ?? null };
}

/**
 * Recommended order: the router's built-in defaults that the providers still
 * list today, topped up with the live models offering the largest context
 * window. Never returns a model the provider doesn't currently list.
 */
export function recommendModels(
  providers: Record<AIProvider, ProviderCatalog>,
  defaults: AIModelChoice[],
  slots: number
): AIModelChoice[] {
  const live = [...providers.groq.models, ...providers.gemini.models];
  const isLive = (c: AIModelChoice) => live.some(m => m.provider === c.provider && m.id === c.name);

  const picks = defaults.filter(isLive);
  const rest = [...live]
    .sort((a, b) => (b.contextWindow ?? 0) - (a.contextWindow ?? 0))
    .map(m => ({ provider: m.provider, name: m.id }))
    .filter(c => !picks.some(p => p.provider === c.provider && p.name === c.name));

  return [...picks, ...rest].slice(0, slots);
}
