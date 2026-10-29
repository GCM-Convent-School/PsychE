// =============================================================================
//  PsychE Release 1 — School branding
//  Owns: the school's name, logo and accent for this deployment.
//
//  Each school runs its own clone (own Supabase project), so branding is the
//  single PsychE_Settings row, read through PsychE_Public_Branding — the only
//  thing the login screen may read before anyone signs in. Nothing
//  school-specific lives in code.
// =============================================================================

import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export const PRODUCT_NAME = 'UPsych';

export interface Branding {
  schoolName: string | null;
  logoUrl: string | null;
  accentColor: string | null;
}

const EMPTY: Branding = { schoolName: null, logoUrl: null, accentColor: null };

let cached: Branding | null = null;
let inflight: Promise<Branding> | null = null;
const listeners = new Set<(b: Branding) => void>();

async function fetchBranding(): Promise<Branding> {
  const { data, error } = await supabase.from('PsychE_Public_Branding').select('*').maybeSingle();
  if (error || !data) {
    if (error) console.warn('[branding] falling back to product name:', error.message);
    return EMPTY;
  }
  return { schoolName: data.school_name, logoUrl: data.school_logo_url, accentColor: data.accent_color };
}

export function loadBranding(): Promise<Branding> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = fetchBranding().then((b) => {
      cached = b;
      inflight = null;
      return b;
    });
  }
  return inflight;
}

// Settings calls this after an admin saves, so every screen updates at once.
export function refreshBranding(): Promise<Branding> {
  cached = null;
  return loadBranding().then((b) => {
    listeners.forEach((fn) => fn(b));
    return b;
  });
}

export function useBranding(): Branding {
  const [branding, setBranding] = useState<Branding>(cached ?? EMPTY);
  useEffect(() => {
    let alive = true;
    loadBranding().then((b) => { if (alive) setBranding(b); });
    listeners.add(setBranding);
    return () => { alive = false; listeners.delete(setBranding); };
  }, []);
  return branding;
}

// "UPsych · GCM Convent School", or just "UPsych" before a name is set.
export function appTitle(schoolName: string | null): string {
  return schoolName ? `${PRODUCT_NAME} · ${schoolName}` : PRODUCT_NAME;
}

// Sets the browser tab title once branding has loaded: "UPsych · School | Page".
export function useDocumentTitle(page: string): void {
  const { schoolName } = useBranding();
  useEffect(() => {
    document.title = `${appTitle(schoolName)} | ${page}`;
  }, [schoolName, page]);
}
