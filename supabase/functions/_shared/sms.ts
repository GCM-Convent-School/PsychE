// SMS via the school's notify gateway.
//
// Per clone, never in code:
//   supabase secrets set NOTIFY_API_URL=https://notify.<school-domain>/api/v1/messages
//   supabase secrets set NOTIFY_API_KEY=<key>

export async function sendSms(mobile: string, message: string): Promise<{ ok: boolean; error?: string }> {
  const url = Deno.env.get('NOTIFY_API_URL');
  const key = Deno.env.get('NOTIFY_API_KEY');
  if (!url || !key) return { ok: false, error: 'SMS gateway is not configured (NOTIFY_API_URL / NOTIFY_API_KEY).' };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile, message }),
    });
    if (!res.ok) {
      // Log the gateway's answer for debugging, never the message (it holds the code).
      console.error(`[sms] gateway ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return { ok: false, error: `SMS gateway returned ${res.status}.` };
    }
    return { ok: true };
  } catch (err) {
    console.error('[sms] gateway unreachable:', err);
    return { ok: false, error: 'SMS gateway unreachable.' };
  }
}
