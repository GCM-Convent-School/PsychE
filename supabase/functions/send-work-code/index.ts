// =============================================================================
//  PsychE Release 1 — send-work-code (Supabase Edge Function)
//
//  Issues a new personal 4-digit work code and sends it by SMS. The code is
//  permanent until the next one is issued (founder decision 2026-10-29: "a
//  personal code sent once"); only its bcrypt hash is stored.
//
//  Called two ways:
//    - Admin, from Settings → Staff: body { staffId }, with the admin's session.
//      Used when adding a person and for "send a new code".
//    - Anyone, from the login screen's "Send me a new code": body { mobile }.
//      Always answers the same generic message, whether or not the number
//      belongs to staff, so it can't be used to discover who works here. At
//      most one self-service code per number every 10 minutes.
//
//  Deploy (public: the login screen calls it before anyone is signed in):
//    supabase functions deploy send-work-code --no-verify-jwt --project-ref <ref>
//  Secrets: NOTIFY_API_URL, NOTIFY_API_KEY (see _shared/sms.ts), ALLOWED_DOMAINS.
// =============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildCorsHeaders } from '../_shared/cors.ts';
import { authorizeCaller, normalizeMobile } from '../_shared/auth.ts';
import { sendSms } from '../_shared/sms.ts';

const SELF_SERVICE_INTERVAL_MINUTES = 10;
const GENERIC_SELF_SERVICE_REPLY = 'If this number belongs to a staff account, a new work code has been sent to it by SMS.';

function newWorkCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 10000;
  return n.toString().padStart(4, '0');
}

Deno.serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req.headers.get('Origin'));
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const caller = await authorizeCaller(req, admin, { roles: ['admin'], allowService: false });
    const isAdminRequest = caller?.kind === 'staff' && typeof body.staffId === 'string';

    let staffQuery = admin.from('PsychE_Staff').select('id, full_name, mobile, active');
    if (isAdminRequest) {
      staffQuery = staffQuery.eq('id', body.staffId);
    } else {
      const mobile = normalizeMobile(body.mobile);
      if (!mobile) return json({ ok: false, error: 'Enter a 10-digit mobile number.' }, 400);
      staffQuery = staffQuery.eq('mobile', mobile);
    }
    const { data: staff } = await staffQuery.maybeSingle();

    if (!staff || !staff.active) {
      return isAdminRequest
        ? json({ ok: false, error: 'That staff member is not active.' }, 404)
        : json({ ok: true, message: GENERIC_SELF_SERVICE_REPLY });
    }

    if (!isAdminRequest) {
      const { data: secret } = await admin
        .from('PsychE_Staff_Secrets').select('code_sent_at').eq('staff_id', staff.id).maybeSingle();
      const lastSent = secret?.code_sent_at ? new Date(secret.code_sent_at).getTime() : 0;
      if (Date.now() - lastSent < SELF_SERVICE_INTERVAL_MINUTES * 60_000) {
        return json({ ok: true, message: GENERIC_SELF_SERVICE_REPLY });
      }
    }

    const code = newWorkCode();
    const { error: setError } = await admin.rpc('psyche_set_work_code', { p_staff_id: staff.id, p_code: code });
    if (setError) throw setError;

    const { data: branding } = await admin.from('PsychE_Public_Branding').select('school_name').maybeSingle();
    const signoff = branding?.school_name ? `\n_— ${branding.school_name}_` : '';
    const sms = await sendSms(
      staff.mobile,
      `Dear ${staff.full_name},\nYour UPsych work code is ${code}. Sign in with this mobile number and code. Do not share it.${signoff}`
    );

    await admin.from('PsychE_Audit').insert({
      actor_user: caller?.kind === 'staff' ? caller.userId : null,
      action: 'work_code_sent',
      table_name: 'PsychE_Staff',
      record_id: staff.id,
      detail: { by: isAdminRequest ? 'admin' : 'self_service', delivered: sms.ok },
    });

    if (isAdminRequest) {
      return sms.ok
        ? json({ ok: true, message: `New work code sent to ${staff.full_name}.` })
        : json({ ok: false, error: `The code was reset but the SMS failed: ${sms.error}` }, 502);
    }
    return json({ ok: true, message: GENERIC_SELF_SERVICE_REPLY });
  } catch (err) {
    console.error('[send-work-code] Unhandled error:', err);
    return json({ ok: false, error: 'Could not send a work code right now.' }, 500);
  }
});
