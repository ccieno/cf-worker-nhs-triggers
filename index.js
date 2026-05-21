/**
 * nhs-triggers — Cloudflare Worker
 *
 * Provides an HTML toggle page to control NHS Major Service Outage (MSO)
 * status via Zoom Contact Centre global variables.
 *
 * Required environment variables (set via Cloudflare dashboard or wrangler secrets):
 *   ZOOM_ACCOUNT_ID          — Your Zoom account ID
 *   ZOOM_CLIENT_ID           — Server-to-Server OAuth app Client ID
 *   ZOOM_CLIENT_SECRET       — Server-to-Server OAuth app Client Secret
 *   ZOOM_MSO_VARIABLE_ID     — Variable ID for nhs.mso  (find in ZCC Admin → Variables)
 *   ZOOM_PROVIDER_VARIABLE_ID — Variable ID for nhs.provider
 */

// ─── In-memory token cache (resets on worker cold start) ────────────────────
let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken(env) {
  const now = Date.now();
  // Reuse token if it has more than 30 s left
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

  // 204 No Content on success — nothing to parse
  return true;
}

// ─── HTML renderer ───────────────────────────────────────────────────────────

const PROVIDERS = ['Microsoft365', 'Global Protect', '8x8', 'Oracle', 'Rio', 'SystemOne'];

function renderPage(msoValue, providerValue) {
  const isMso = msoValue === 'true';

  const providerOptions = PROVIDERS.map(
    (p) => `<option value="${p}"${providerValue === p ? ' selected' : ''}>${p}</option>`
  ).join('\n          ');

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NHS Service Status</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #eef2f7;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .card {
      background: #fff;
      border-radius: 18px;
      padding: 36px 40px 32px;
      box-shadow: 0 6px 30px rgba(0,0,0,.10);
      max-width: 460px;
      width: calc(100% - 32px);
    }

    /* NHS header strip */
    .header {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 28px;
    }
    .nhs-badge {
      background: #005eb8;
      color: #fff;
      font-weight: 800;
      font-size: 17px;
      letter-spacing: 1.5px;
      padding: 5px 11px;
      border-radius: 6px;
      flex-shrink: 0;
    }
    .header h1 {
      font-size: 18px;
      font-weight: 700;
      color: #1a1a2e;
      line-height: 1.2;
    }

    /* Status card */
    .status-box {
      border-radius: 12px;
      padding: 20px 22px;
      margin-bottom: 20px;
      border: 2px solid;
      transition: background .35s, border-color .35s;
    }
    .status-box[data-mso="true"]  { background: #fff5f5; border-color: #fc8181; }
    .status-box[data-mso="false"] { background: #f0fdf4; border-color: #68d391; }

    .status-label {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      color: #888;
      margin-bottom: 10px;
    }

    .status-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .status-text {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 20px;
      font-weight: 700;
      transition: color .35s;
    }
    .status-box[data-mso="true"]  .status-text { color: #c53030; }
    .status-box[data-mso="false"] .status-text { color: #276749; }

    .status-emoji { font-size: 26px; line-height: 1; }

    /* Toggle switch — pure CSS, no JS styling needed */
    .toggle-label {
      position: relative;
      display: inline-block;
      width: 64px;
      height: 34px;
      flex-shrink: 0;
      cursor: pointer;
    }
    .toggle-label input {
      opacity: 0;
      width: 0;
      height: 0;
      position: absolute;
    }
    .toggle-track {
      position: absolute;
      inset: 0;
      border-radius: 34px;
      background: #68d391;
      transition: background .3s;
    }
    .toggle-track::before {
      content: '';
      position: absolute;
      width: 26px;
      height: 26px;
      left: 4px;
      top: 4px;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 2px 5px rgba(0,0,0,.2);
      transition: transform .3s;
    }
    .toggle-label input:checked + .toggle-track {
      background: #fc8181;
    }
    .toggle-label input:checked + .toggle-track::before {
      transform: translateX(30px);
    }

    /* Provider dropdown (shown only when MSO active) */
    .provider-section {
      overflow: hidden;
      transition: max-height .35s ease, opacity .35s ease;
    }
    .provider-section[data-visible="true"]  { max-height: 120px; opacity: 1; }
    .provider-section[data-visible="false"] { max-height: 0;     opacity: 0; pointer-events: none; }

    .provider-label {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      color: #888;
      margin-bottom: 8px;
    }

    .provider-select {
      width: 100%;
      padding: 11px 40px 11px 14px;
      border: 2px solid #e2e8f0;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 600;
      color: #1a1a2e;
      background: #fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='7' viewBox='0 0 12 7'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23888' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat right 14px center;
      appearance: none;
      cursor: pointer;
      transition: border-color .2s;
    }
    .provider-select:focus {
      outline: none;
      border-color: #fc8181;
    }

    /* Busy overlay */
    .card.busy { opacity: .55; pointer-events: none; }

    /* Toast */
    #toast {
      position: fixed;
      bottom: 22px;
      right: 22px;
      padding: 11px 18px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      color: #fff;
      background: #1a1a2e;
      opacity: 0;
      transform: translateY(8px);
      transition: opacity .3s, transform .3s;
      pointer-events: none;
      z-index: 999;
      max-width: 320px;
    }
    #toast.show { opacity: 1; transform: translateY(0); }
    #toast.error { background: #c53030; }

    .footer {
      margin-top: 24px;
      text-align: center;
      font-size: 11px;
      color: #bbb;
      letter-spacing: 0.3px;
    }
  </style>
</head>
<body>

<div class="card" id="card">
  <div class="header">
    <div class="nhs-badge">NHS</div>
    <h1>Service Status Control</h1>
  </div>

  <!-- MSO toggle -->
  <div class="status-box" id="statusBox" data-mso="${isMso}">
    <div class="status-label">Major Service Outage</div>
    <div class="status-row">
      <div class="status-text">
        <span class="status-emoji" id="emoji">${isMso ? '🚨' : '😊'}</span>
        <span id="statusText">${isMso ? 'Yes — Outage Active' : 'No — All Good'}</span>
      </div>
      <label class="toggle-label" aria-label="Toggle MSO">
        <input type="checkbox" id="msoToggle" ${isMso ? 'checked' : ''} />
        <span class="toggle-track"></span>
      </label>
    </div>
  </div>

  <!-- Provider dropdown — visible only when MSO is on -->
  <div class="provider-section" id="providerSection" data-visible="${isMso}">
    <div class="provider-label">Affected Provider</div>
    <select class="provider-select" id="providerSelect">
      ${providerOptions}
    </select>
  </div>

  <div class="footer">NHS Triggers · Zoom Contact Centre Integration</div>
</div>

<div id="toast"></div>

<script>
  const card           = document.getElementById('card');
  const statusBox      = document.getElementById('statusBox');
  const emoji          = document.getElementById('emoji');
  const statusText     = document.getElementById('statusText');
  const msoToggle      = document.getElementById('msoToggle');
  const providerSection = document.getElementById('providerSection');
  const providerSelect = document.getElementById('providerSelect');
  const toast          = document.getElementById('toast');

  let toastTimer;

  function showToast(msg, isError = false) {
    clearTimeout(toastTimer);
    toast.textContent = msg;
    toast.className = 'show' + (isError ? ' error' : '');
    toastTimer = setTimeout(() => { toast.className = ''; }, 3000);
  }

  function applyMsoUI(isMso) {
    statusBox.dataset.mso        = isMso;
    emoji.textContent            = isMso ? '🚨' : '😊';
    statusText.textContent       = isMso ? 'Yes — Outage Active' : 'No — All Good';
    providerSection.dataset.visible = isMso;
  }

  async function postUpdate(payload) {
    const res = await fetch('/nhs/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || res.statusText);
    }
  }

  // ── MSO toggle ──────────────────────────────────────────────────────────────
  msoToggle.addEventListener('change', async () => {
    const isMso = msoToggle.checked;
    card.classList.add('busy');
    try {
      await postUpdate({ variable: 'mso', value: isMso ? 'true' : 'false' });

      applyMsoUI(isMso);
      showToast(isMso ? '🚨 MSO activated' : '✅ MSO cleared');
    } catch (err) {
      msoToggle.checked = !isMso; // revert checkbox
      showToast('❌ Failed: ' + err.message, true);
    } finally {
      card.classList.remove('busy');
    }
  });

  // ── Provider dropdown ───────────────────────────────────────────────────────
  providerSelect.addEventListener('change', async () => {
    const provider = providerSelect.value;
    card.classList.add('busy');
    try {
      await postUpdate({ variable: 'provider', value: provider });
      showToast('✅ Provider set: ' + provider);
    } catch (err) {
      showToast('❌ Failed: ' + err.message, true);
    } finally {
      card.classList.remove('busy');
    }
  });
</script>
</body>
</html>`;
}

// ─── Request router ──────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    // ── POST /update — write a variable value to Zoom CC ─────────────────────
    if (request.method === 'POST' && pathname === '/nhs/update') {
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response('Invalid JSON body', { status: 400 });
      }

      const { variable, value } = body;

      try {
        if (variable === 'mso') {
          if (value !== 'true' && value !== 'false') {
            return new Response('value must be "true" or "false"', { status: 400 });
          }
          await updateVariable(env, env.ZOOM_MSO_VARIABLE_ID, value);

        } else if (variable === 'provider') {
          if (!PROVIDERS.includes(value)) {
            return new Response(`Unknown provider. Valid: ${PROVIDERS.join(', ')}`, { status: 400 });
          }
          await updateVariable(env, env.ZOOM_PROVIDER_VARIABLE_ID, value);

        } else {
          return new Response('Unknown variable name', { status: 400 });
        }

        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        console.error(err);
        return new Response(err.message, { status: 502 });
      }
    }

    // ── GET / — render the status page ───────────────────────────────────────
    if (request.method === 'GET' && pathname === '/nhs') {
      try {
        const [msoVar, providerVar] = await Promise.all([
          getVariable(env, env.ZOOM_MSO_VARIABLE_ID),
          getVariable(env, env.ZOOM_PROVIDER_VARIABLE_ID),
        ]);

        // values[0] is the current linked/default value for a global variable
        const msoValue      = msoVar.values?.[0]      ?? 'false';
        const providerValue = providerVar.values?.[0] ?? 'Microsoft365';

        return new Response(renderPage(msoValue, providerValue), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      } catch (err) {
        console.error(err);
        return new Response(
          `<h2>Error loading status</h2><pre>${err.message}</pre>`,
          { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    }

    return new Response('Not Found', { status: 404 });
  },
};
