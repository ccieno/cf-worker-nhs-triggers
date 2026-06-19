/**
 * nhs-triggers — Cloudflare Worker
 *
 * API-only backend for NHS Major Service Outage (MSO) status control.
 * Browser UI is served from app.eno.solutions/nhs.
 *
 * Routes:
 *   GET  /nhs/status  — Returns current MSO and provider values as JSON
 *   POST /nhs/update  — Updates a variable value in Zoom CC
 *
 * Required environment variables (set via Cloudflare dashboard or wrangler secrets):
 *   ZOOM_ACCOUNT_ID           — Your Zoom account ID
 *   ZOOM_CLIENT_ID            — Server-to-Server OAuth app Client ID
 *   ZOOM_CLIENT_SECRET        — Server-to-Server OAuth app Client Secret
 *   ZOOM_MSO_VARIABLE_ID      — Variable ID for nhs.mso  (find in ZCC Admin → Variables)
 *   ZOOM_PROVIDER_VARIABLE_ID — Variable ID for nhs.provider
 */

const CORS_ORIGIN = 'https://app.eno.solutions';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': CORS_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ─── In-memory token cache (resets on worker cold start) ────────────────────
let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken(env) {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry - 30_000) {
    return cachedToken;
  }

  const credentials = btoa(`${env.ZOOM_CLIENT_ID}:${env.ZOOM_CLIENT_SECRET}`);
  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${env.ZOOM_ACCOUNT_ID}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token request failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = now + data.expires_in * 1000;
  return cachedToken;
}

// ─── Zoom CC Variables API helpers ──────────────────────────────────────────

async function getVariable(env, variableId) {
  const token = await getAccessToken(env);
  const res = await fetch(
    `https://api.zoom.us/v2/contact_center/variables/${variableId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET variable ${variableId} failed (${res.status}): ${body}`);
  }

  return res.json();
}

async function updateVariable(env, variableId, value) {
  const token = await getAccessToken(env);
  const res = await fetch(
    `https://api.zoom.us/v2/contact_center/variables/${variableId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [value] }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PATCH variable ${variableId} failed (${res.status}): ${body}`);
  }

  return true;
}

// ─── Valid provider values ───────────────────────────────────────────────────

const PROVIDERS = ['Microsoft365', 'Global Protect', '8x8', 'Oracle', 'Rio', 'SystemOne'];

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

// ─── Request router ──────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // ── GET /nhs/status — return current variable values as JSON ─────────────
    if (request.method === 'GET' && pathname === '/nhs/status') {
      try {
        const [msoVar, providerVar] = await Promise.all([
          getVariable(env, env.ZOOM_MSO_VARIABLE_ID),
          getVariable(env, env.ZOOM_PROVIDER_VARIABLE_ID),
        ]);

        const mso      = msoVar.values?.[0]      ?? 'false';
        const provider = providerVar.values?.[0] ?? 'Microsoft365';

        return jsonResponse({ mso, provider });
      } catch (err) {
        console.error(err);
        return jsonResponse({ error: err.message }, 502);
      }
    }

    // ── POST /nhs/update — write a variable value to Zoom CC ─────────────────
    if (request.method === 'POST' && pathname === '/nhs/update') {
      let body;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
      }

      const { variable, value } = body;

      try {
        if (variable === 'mso') {
          if (value !== 'true' && value !== 'false') {
            return jsonResponse({ error: 'value must be "true" or "false"' }, 400);
          }
          await updateVariable(env, env.ZOOM_MSO_VARIABLE_ID, value);

        } else if (variable === 'provider') {
          if (!PROVIDERS.includes(value)) {
            return jsonResponse({ error: `Unknown provider. Valid: ${PROVIDERS.join(', ')}` }, 400);
          }
          await updateVariable(env, env.ZOOM_PROVIDER_VARIABLE_ID, value);

        } else {
          return jsonResponse({ error: 'Unknown variable name' }, 400);
        }

        return jsonResponse({ ok: true });
      } catch (err) {
        console.error(err);
        return jsonResponse({ error: err.message }, 502);
      }
    }

    return jsonResponse({ error: 'Not Found' }, 404);
  },
};
