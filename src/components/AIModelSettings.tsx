// =============================================================================
//  PsychE V13 — AI Models tab (Settings)
//  Lets the admin pick which LLMs write AI reports and formalize sessions,
//  from the providers' LIVE model lists (list-models Edge Function), in
//  priority order. Saved to PsychE_Settings.ai_models; the Edge Functions'
//  model router tries these first, then its built-in defaults, then any
//  model the provider still lists — so a retired model degrades to a
//  fallback instead of taking the AI features down.
// =============================================================================

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Save, Sparkles, AlertTriangle } from 'lucide-react';
import { fetchModelCatalog, fetchSavedModels, saveModels, recommendModels, type ProviderCatalog } from '../lib/aiModels';
import type { AIModelChoice, AIProvider } from '../types';

const SLOT_LABELS = ['Primary', 'Fallback 1', 'Fallback 2'];
const PROVIDER_NAMES: Record<AIProvider, string> = { groq: 'Groq', gemini: 'Google Gemini' };

const encode = (c: AIModelChoice) => `${c.provider}:${c.name}`;
function decode(value: string): AIModelChoice | null {
  const i = value.indexOf(':');
  if (i < 0) return null;
  const provider = value.slice(0, i);
  if (provider !== 'groq' && provider !== 'gemini') return null;
  return { provider, name: value.slice(i + 1) };
}

export const AIModelSettings: React.FC = () => {
  const [providers, setProviders] = useState<Record<AIProvider, ProviderCatalog> | null>(null);
  const [defaults, setDefaults] = useState<AIModelChoice[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [slots, setSlots] = useState<(AIModelChoice | null)[]>([null, null, null]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadCatalog = async () => {
    setRefreshing(true);
    const result = await fetchModelCatalog();
    setRefreshing(false);
    if (result.error || !result.providers) {
      setError(result.error ?? 'Unable to fetch the model list.');
      return;
    }
    setError(null);
    setProviders(result.providers);
    setDefaults(result.defaults);
    setFetchedAt(result.fetchedAt);
  };

  useEffect(() => {
    (async () => {
      const [saved] = await Promise.all([fetchSavedModels(), loadCatalog()]);
      if (saved.error) setError(`Could not load saved models: ${saved.error}`);
      setSlots(SLOT_LABELS.map((_, i) => saved.data[i] ?? null));
      setLoading(false);
    })();
  }, []);

  const isLive = (c: AIModelChoice) =>
    !!providers?.[c.provider]?.models.some(m => m.id === c.name);

  const setSlot = (index: number, value: string) => {
    setNotice(null);
    setSlots(prev => prev.map((s, i) => (i === index ? decode(value) : s)));
  };

  const handleRecommended = () => {
    if (!providers) return;
    const picks = recommendModels(providers, defaults, SLOT_LABELS.length);
    setSlots(SLOT_LABELS.map((_, i) => picks[i] ?? null));
    setNotice('Recommended models filled in — press Save to apply.');
  };

  const handleSave = async () => {
    const chosen = slots.filter((s): s is AIModelChoice => s !== null);
    const unique = chosen.filter((c, i) => chosen.findIndex(o => encode(o) === encode(c)) === i);
    setSaving(true);
    const { error: saveError } = await saveModels(unique);
    setSaving(false);
    if (saveError) { setError(`Could not save: ${saveError}`); return; }
    setError(null);
    setSlots(SLOT_LABELS.map((_, i) => unique[i] ?? null));
    setNotice(unique.length ? 'Saved. New AI reports will use this order.' : 'Cleared. The built-in defaults will be used.');
  };

  const providerList: AIProvider[] = ['groq', 'gemini'];

  return (
    <motion.div className="bento-card" style={{ padding: '2rem' }}>
      <div className="flex justify-between items-center mb-4 mobile-stack mobile-stack-start" style={{ gap: '1rem' }}>
        <div>
          <h2 className="text-h3" style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>AI Models</h2>
          <p className="text-muted" style={{ fontSize: '0.875rem', maxWidth: '620px' }}>
            Choose which models write AI reports and formalize session notes, in order of preference.
            The list comes live from each provider. If every chosen model fails, the system falls back to
            its built-in defaults and then to any model the provider still offers.
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={loadCatalog} disabled={refreshing} style={{ whiteSpace: 'nowrap' }}>
          <RefreshCw size={16} /> {refreshing ? 'Fetching…' : 'Refresh list'}
        </button>
      </div>

      {error && <p className="mini-note-error mb-4">{error}</p>}

      {loading ? (
        <p className="text-muted">Loading models…</p>
      ) : (
        <>
          {providers && (
            <div className="flex gap-2 flex-wrap mb-4">
              {providerList.map(p => {
                const cat = providers[p];
                const cls = !cat.configured ? 'pill' : cat.error ? 'pill pill--red' : 'pill pill--green';
                const text = !cat.configured
                  ? `${PROVIDER_NAMES[p]}: no API key`
                  : cat.error ? `${PROVIDER_NAMES[p]}: error` : `${PROVIDER_NAMES[p]}: ${cat.models.length} models`;
                return <span key={p} className={cls} title={cat.error ?? undefined}>{text}</span>;
              })}
              {fetchedAt && <span className="text-muted" style={{ fontSize: '0.75rem', alignSelf: 'center' }}>
                Updated {new Date(fetchedAt).toLocaleTimeString()}
              </span>}
            </div>
          )}

          <div className="flex" style={{ flexDirection: 'column', gap: '0.875rem', maxWidth: '560px' }}>
            {SLOT_LABELS.map((label, i) => {
              const current = slots[i];
              const stale = current && providers && !isLive(current);
              return (
                <div key={label}>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 600, display: 'block', marginBottom: '0.375rem' }}>{label}</label>
                  <select
                    className="input"
                    value={current ? encode(current) : ''}
                    onChange={e => setSlot(i, e.target.value)}
                  >
                    <option value="">{i === 0 ? '— Use built-in defaults —' : '— None —'}</option>
                    {stale && current && <option value={encode(current)}>{current.name} (no longer available)</option>}
                    {providers && providerList.filter(p => providers[p].models.length > 0).map(p => (
                      <optgroup key={p} label={PROVIDER_NAMES[p]}>
                        {providers[p].models.map(m => (
                          <option key={m.id} value={encode({ provider: p, name: m.id })}>{m.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  {stale && (
                    <p style={{ fontSize: '0.75rem', color: 'var(--accent-amber)', marginTop: '0.375rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                      <AlertTriangle size={13} /> The provider no longer lists this model — pick another.
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {notice && <p className="text-muted mt-4" style={{ fontSize: '0.8125rem' }}>{notice}</p>}

          <div className="flex gap-2 mt-4 flex-wrap">
            <button type="button" className="btn btn-secondary" onClick={handleRecommended} disabled={!providers}>
              <Sparkles size={16} /> Use recommended
            </button>
            <motion.button
              type="button"
              onClick={handleSave}
              disabled={saving}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="btn btn-primary"
              style={{ background: 'var(--color-primary)', border: 'none', padding: '0.75rem 2rem' }}
            >
              {saving ? 'Saving...' : <><Save size={18} /> Save Models</>}
            </motion.button>
          </div>
        </>
      )}
    </motion.div>
  );
};
