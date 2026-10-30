// =============================================================================
//  PsychE Release 1 — Staff session
//  Owns: who is signed in, their staff role, sign-in and sign-out.
//
//  Sign-in is mobile number + personal 4-digit work code. The staff-login
//  Edge Function checks the code and returns a one-time token, which
//  verifyOtp exchanges for a normal Supabase session (stored by supabase-js,
//  refreshed automatically). From then on every query runs as that person and
//  RLS decides what they see.
//
//  The app renders NOTHING until status leaves 'loading': a query that ran
//  before the session was restored would go out as anon and get zero rows,
//  which looks like an empty school rather than an error.
// =============================================================================

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type StaffRole = 'counsellor' | 'principal' | 'admin' | 'teacher';

export interface StaffMember {
  id: string;
  full_name: string;
  mobile: string;
  role: StaffRole;
}

type AuthStatus = 'loading' | 'signedOut' | 'noAccess' | 'signedIn';

interface AuthState {
  status: AuthStatus;
  session: Session | null;
  staff: StaffMember | null;
  signIn: (mobile: string, code: string) => Promise<{ error: string | null }>;
  requestNewCode: (mobile: string) => Promise<{ message: string }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

// Supabase-js puts an Edge Function's JSON error body on error.context.
async function functionError(error: unknown, fallback: string): Promise<string> {
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json();
      if (body?.error) return body.error;
    } catch { /* not JSON */ }
  }
  return fallback;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [staff, setStaff] = useState<StaffMember | null>(null);

  const resolveStaff = useCallback(async (next: Session | null) => {
    setSession(next);
    if (!next) {
      setStaff(null);
      setStatus('signedOut');
      return;
    }
    const { data } = await supabase
      .from('PsychE_Staff')
      .select('id, full_name, mobile, role, active')
      .eq('user_id', next.user.id)
      .maybeSingle();
    // Principals and teachers sign in from Release 3, when their screens exist (D12).
    if (data && data.active && (data.role === 'counsellor' || data.role === 'admin')) {
      setStaff({ id: data.id, full_name: data.full_name, mobile: data.mobile, role: data.role });
      setStatus('signedIn');
    } else {
      setStaff(null);
      setStatus('noAccess');
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => resolveStaff(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      // Token refreshes keep the same person; only re-check on real changes.
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // Deferred: calling Supabase inside this callback can deadlock supabase-js.
        setTimeout(() => resolveStaff(next), 0);
      } else if (next) {
        setSession(next);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [resolveStaff]);

  const signIn = useCallback(async (mobile: string, code: string) => {
    const { data, error } = await supabase.functions.invoke('staff-login', { body: { mobile, code } });
    if (error || !data?.tokenHash) {
      return { error: error ? await functionError(error, 'Sign-in failed. Please try again.') : (data?.error ?? 'Sign-in failed.') };
    }
    const { error: otpError } = await supabase.auth.verifyOtp({ token_hash: data.tokenHash, type: 'magiclink' });
    return { error: otpError ? 'Sign-in failed. Please try again.' : null };
  }, []);

  const requestNewCode = useCallback(async (mobile: string) => {
    const { data, error } = await supabase.functions.invoke('send-work-code', { body: { mobile } });
    if (error) return { message: await functionError(error, 'Could not send a code right now. Please try again later.') };
    return { message: data?.message ?? 'If this number belongs to a staff account, a new work code has been sent.' };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return (
    <AuthContext.Provider value={{ status, session, staff, signIn, requestNewCode, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
