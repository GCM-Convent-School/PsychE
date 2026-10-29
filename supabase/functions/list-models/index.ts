// =============================================================================
//  PsychE V13 — list-models (Supabase Edge Function)
//
//  Feeds the "AI Models" picker on the Settings page: returns the models each
//  provider says this project's API keys can use RIGHT NOW, plus the router's
//  built-in defaults. Exists as an Edge Function for the same reason as
//  generate-ai-report — the provider keys must never reach the browser.
//
//  Read-only: never writes. The Settings page saves the admin's ordered pick
//  to PsychE_Settings.ai_models itself, and modelRouter.ts reads it from there.
//
//  Body: none (POST or GET).
//
//  Deploy:
//    supabase functions deploy list-models --project-ref <your-ref>
//  Shares GROQ_API_KEY / GEMINI_API_KEY with the other AI functions.
// =============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildCorsHeaders } from '../_shared/cors.ts';
import { authorizeCaller, unauthorized } from '../_shared/auth.ts';
import { fetchLiveCatalog } from '../_shared/modelCatalog.ts';
import { DEFAULT_MODEL_PROFILES, readProviderKeys } from '../_shared/modelRouter.ts';

Deno.serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // Release 1: only admins choose AI models (Settings page).
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const caller = await authorizeCaller(req, admin, { roles: ['admin'] });
    if (!caller) return unauthorized(corsHeaders, { providers: null, defaults: [] });

    const keys = readProviderKeys();
    const catalog = await fetchLiveCatalog(keys.groq, keys.gemini);
    const defaults = DEFAULT_MODEL_PROFILES.map((m) => ({ provider: m.provider, name: m.name }));

    return new Response(
      JSON.stringify({ providers: catalog, defaults, fetchedAt: new Date().toISOString(), error: null }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[list-models] Unhandled error:', err);
    return new Response(JSON.stringify({ providers: null, defaults: [], error: 'Unable to fetch the model list.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
