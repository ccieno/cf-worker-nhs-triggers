# nhs-triggers — NHS MSO API Worker

A Cloudflare Worker providing a JSON API to read and control NHS Major Service Outage (MSO) status in a Zoom Contact Centre demo environment. The browser UI is served from `app.eno.solutions/nhs`.

**Deployed at:** `app.eno.solutions/nhs/*`

## Routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/nhs/status` | Returns current MSO and provider values as JSON |
| `POST` | `/nhs/update` | Updates `mso` or `provider` variable in ZCC |
| `OPTIONS` | `*` | CORS preflight |

CORS is locked to `https://app.eno.solutions`.

## Variables

| Variable | ZCC Variable | Description |
|---|---|---|
| `mso` | `nhs.mso` | Major Service Outage flag — `"true"` routes callers to emergency handling |
| `provider` | `nhs.provider` | Affected provider name (Microsoft365, Global Protect, 8x8, Oracle, Rio, SystemOne) |

## POST /nhs/update payload

```json
{ "variable": "mso", "value": "true" }
{ "variable": "provider", "value": "Oracle" }
```

## Architecture

- No browser UI in this worker — UI lives at `app.eno.solutions/nhs`
- Server-to-Server OAuth with in-memory token caching
- All responses are JSON with CORS headers

## Secrets required

| Secret | Description |
|---|---|
| `ZOOM_ACCOUNT_ID` | Zoom account ID |
| `ZOOM_CLIENT_ID` | Server-to-Server OAuth app client ID |
| `ZOOM_CLIENT_SECRET` | Server-to-Server OAuth app client secret |
| `ZOOM_MSO_VARIABLE_ID` | Variable ID for `nhs.mso` (ZCC Admin → Variables) |
| `ZOOM_PROVIDER_VARIABLE_ID` | Variable ID for `nhs.provider` |

## Development

```bash
wrangler dev       # local dev server
wrangler deploy    # deploy to Cloudflare
```

No npm dependencies — single `index.js` file.
