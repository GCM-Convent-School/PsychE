// Shared caller check for every Edge Function that touches student data.
//
// Release 1 (P11): these functions use the service role, which bypasses RLS,
// so they must decide for themselves who is allowed in. Accepted callers:
//   - a logged-in staff member: valid user JWT + an active PsychE_Staff row
//     with one of the allowed roles;
//   - the service role itself (GitHub Actions cron sends the service key).
// Anyone else — including a request carrying only the public anon key — gets
// null, and the function answers 401.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type Caller =
  | { kind: 'staff'; userId: string; staffId: string; role: string }
  | { kind: 'service' };

export async function authorizeCaller(
  req: Request,
  admin: SupabaseClient,
  opts: { roles?: string[]; allowService?: boolean } = {}
): Promise<Caller | null> {
  const { roles = ['counsellor', 'admin'], allowService = true } = opts;
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (allowService && serviceKey && token === serviceKey) return { kind: 'service' };

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData?.user) return null;

  const { data: staff } = await admin
    .from('PsychE_Staff')
    .select('id, role, active')
    .eq('user_id', userData.user.id)
    .maybeSingle();
  if (!staff || !staff.active || !roles.includes(staff.role)) return null;

  return { kind: 'staff', userId: userData.user.id, staffId: staff.id, role: staff.role };
}

export function unauthorized(corsHeaders: Record<string, string>, body: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ ...body, error: 'Not signed in, or your access is not active.' }), {
    status: 401,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Mobile numbers are stored as the last 10 digits ("+91 98765 43210" → "9876543210").
export function normalizeMobile(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const digits = input.replace(/\D/g, '');
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  return /^[0-9]{10}$/.test(ten) ? ten : null;
}
