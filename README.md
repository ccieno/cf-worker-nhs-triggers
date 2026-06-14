# nhs-triggers — NHS MSO Control Worker

A Cloudflare Worker that provides a simple toggle UI for controlling NHS Major Service Outage (MSO) status in a Zoom Contact Centre demo environment.

**Deployed at:** `api.eno.solutions/nhs`

## What it does

Serves a browser-based toggle page that lets you flip two ZCC global variables without needing ZCC admin access:

| Variable | Description |
|---|---|
| `nhs.mso` | Major Service Outage flag — routes callers to emergency handling when `true` |
| `nhs.provider` | Provider type — controls which flow branch handles the call |

This is used during NHS demos to simulate a real-world outage scenario mid-call, showing how ZCC can dynamically change routing behaviour in real time.

## How it works

1. The worker serves an HTML page with toggle controls at `GET /nhs`
2. When a toggle is flipped, the page posts to `POST /nhs/update`
3. The worker authenticates to Zoom using Server-to-Server OAuth (credentials cached in memory)
4. It calls the ZCC Variables API (`/v2/contact_center/variables/:id`) to patch the variable value
5. The UI reflects the updated state

Authentication tokens are cached in the worker's memory for their full lifetime to avoid unnecessary re-authentication on each request.


## Development & deployment

```bash
wrangler dev       # local dev server
wrangler deploy    # deploy to Cloudflare
```

No npm dependencies — single `index.js` file.
