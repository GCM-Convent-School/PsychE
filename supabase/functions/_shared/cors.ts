// Shared CORS headers — every function in this project is called from the
// browser (functions.invoke) and from GitHub Actions (curl), both need this.
//
// Origin is checked against a domain allowlist rather than left wildcard-open,
// so only these sites' own client-side JS can call the function directly.
// This has no effect on who can browse the sites themselves (that's DNS/
// hosting, not CORS) and none on server-to-server calls (cron, curl), which
// send no Origin header and are unaffected by CORS either way.
//
// Release 1 (clone per school): the allowlist is per deployment, not code.
//   supabase secrets set ALLOWED_DOMAINS=gcmconventschool.in,theupliftco.com
// Subdomains of each entry are allowed too. localhost is always allowed.
const ALLOWED_DOMAINS = (Deno.env.get('ALLOWED_DOMAINS') ?? '')
  .split(',')
  .map(d => d.trim().toLowerCase())
  .filter(Boolean);

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  try {
    const { hostname } = new URL(origin);
    if (hostname === 'localhost' || hostname === '127.0.0.1') return true; // local dev
    return ALLOWED_DOMAINS.some(d => hostname === d || hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

export function buildCorsHeaders(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': isAllowedOrigin(origin) ? origin! : '',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  };
}
