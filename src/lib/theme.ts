import { useEffect, useState } from 'react';

// Light, dark, or follow the device. The choice lives in localStorage; the
// resolved theme sits on <html data-theme>, set before first paint by the
// script in index.html. Every component reads colours from CSS tokens, so
// switching is one attribute change.

export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'upsych-theme';
const EVENT = 'upsych-theme';

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply(pref: ThemePref) {
  const resolved = pref === 'dark' || (pref === 'system' && systemDark()) ? 'dark' : 'light';
  const root = document.documentElement;
  if (root.getAttribute('data-theme') === resolved) return;
  const swap = () => root.setAttribute('data-theme', resolved);
  // Cross-fade where the browser supports it; instant otherwise.
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (doc.startViewTransition && !reduce) doc.startViewTransition(swap);
  else swap();
}

export function setThemePref(pref: ThemePref) {
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch { /* private mode: still switch for this visit */ }
  apply(pref);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: pref }));
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(readPref);
  const [resolved, setResolved] = useState<'light' | 'dark'>(
    () => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'),
  );

  useEffect(() => {
    const sync = () => {
      setPref(readPref());
      setResolved(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
    };
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystem = () => { if (readPref() === 'system') apply('system'); };
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    window.addEventListener(EVENT, sync);
    mq.addEventListener('change', onSystem);
    return () => { obs.disconnect(); window.removeEventListener(EVENT, sync); mq.removeEventListener('change', onSystem); };
  }, []);

  return {
    pref,
    resolved,
    setTheme: setThemePref,
    toggle: () => setThemePref(resolved === 'dark' ? 'light' : 'dark'),
  };
}
