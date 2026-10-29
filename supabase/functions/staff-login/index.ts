// =============================================================================
//  PsychE Release 1 — staff-login (Supabase Edge Function)
//
//  Mobile number + 4-digit work code → a real Supabase Auth session.
//
//  Flow:
//    1. psyche_check_work_code() verifies the code against its bcrypt hash and
//       applies the throttle (5 wrong codes → 15-minute cooldown, no lockout).
//    2. On success, make sure the staff member has an auth.users row (created
//       on first login, with an internal e-mail address that never receives
//       mail), then mint a one-time magic-link token for it.
//    3. Return the token hash; the browser exchanges it with
//       supabase.auth.verifyOtp({ token_hash, type: 'magiclink' }) for a
//       session. No e-mail is ever sent.
//
//  Admin break-glass (works when SMS is down): if BOTH secrets are set and the
//  mobile matches BREAKGLASS_MOBILE and the code's SHA-256 matches
//  BREAKGLASS_CODE_SHA256, the attempt passes — but only for an ACTIVE ADMIN
//  row, and it still counts against the throttle. The code itself is never in
//  the repository (it is public).
//    supabase secrets set BREAKGLASS_MOBILE=<10 digits>
//    supabase secrets set BREAKGLASS_CODE_SHA256=$(printf '%s' '<code>' | shasum -a 256 | cut -d' ' -f1)
//
//  Deploy (public: called before anyone is signed in):
//    supabase functions deploy staff-login --no-verify-jwt --project-ref <ref>
//  Optional: STAFF_EMAIL_DOMAIN (default staff.upsych.invalid).
// =============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildCorsHeaders } from '../_shared/cors.ts';
import { normalizeMobile } from '../_shared/auth.ts';

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function isBreakglass(mobile: string, code: string): Promise<boolean> {
  const bgMobile = Deno.env.get('BREAKGLASS_MOBILE');
  const bgHash = Deno.env.get('BREAKGLASS_CODE_SHA256')?.trim().toLowerCase();
  if (!bgMobile || !bgHash || bgMobile !== mobile) return false;
  return timingSafeEqual(await sha256Hex(code), bgHash);
}

Deno.serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req.headers.get('Origin'));
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const mobile = normalizeMobile(body.mobile);
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!mobile || !/^[0-9]{4,12}$/.test(code)) {
      return json({ error: 'Enter your 10-digit mobile number and your work code.' }, 400);
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const breakglass = await isBreakglass(mobile, code);
    const { data: rows, error: checkError } = await admin.rpc('psyche_check_work_code', {
      p_mobile: mobile, p_code: code, p_breakglass: breakglass,
    });
    if (checkError) throw checkError;
    const result = rows?.[0];

    if (!result || result.status !== 'ok') {
      if (result?.staff_id) {
        await admin.from('PsychE_Audit').insert({
          action: 'login_failed', table_name: 'PsychE_Staff', record_id: result.staff_id,
          detail: { status: result.status },
        });
      }
      if (result?.status === 'cooldown') {
        return json({ error: 'Too many wrong codes. Please wait 15 minutes and try again.', cooldownUntil: result.cooldown_until }, 429);
      }
      return json({ error: 'That mobile number and work code do not match.' }, 401);
    }

    // First login: create the auth user. Later logins reuse it.
    const email = `${mobile}@${Deno.env.get('STAFF_EMAIL_DOMAIN') ?? 'staff.upsych.invalid'}`;
    if (!result.user_id) {
      const { error: createError } = await admin.auth.admin.createUser({
        email, email_confirm: true, user_metadata: { staff_id: result.staff_id },
      });
      // "already registered" is fine: the link below finds the existing user.
      if (createError && !/already|exists|registered/i.test(createError.message)) throw createError;
    }

    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (linkError || !link?.properties?.hashed_token) throw linkError ?? new Error('No token returned.');

    if (link.user && link.user.id !== result.user_id) {
      // Without this link the app can't find the staff row and shows "not active",
      // so fail the sign-in loudly instead of handing out a useless session.
      const { error: linkStaffError } = await admin.from('PsychE_Staff').update({ user_id: link.user.id }).eq('id', result.staff_id);
      if (linkStaffError) throw linkStaffError;
    }

    await admin.from('PsychE_Audit').insert({
      actor_user: link.user?.id ?? result.user_id, action: 'login', table_name: 'PsychE_Staff',
      record_id: result.staff_id, detail: breakglass ? { breakglass: true } : null,
    });

    return json({ tokenHash: link.properties.hashed_token, error: null });
  } catch (err) {
    console.error('[staff-login] Unhandled error:', err);
    return json({ error: 'Sign-in is unavailable right now. Please try again.' }, 500);
  }
});
