# nhs-triggers — Setup Guide

## Step 1 — Create a Server-to-Server OAuth app in Zoom Marketplace

1. Go to **https://marketplace.zoom.us** and sign in as an admin.
2. Click **Develop → Build App** in the top menu.
3. Choose **Server-to-Server OAuth** and click **Create**.
4. Give it a name (e.g. `nhs-triggers`) and click **Create**.
5. On the **App Credentials** tab, copy:
   - **Account ID**
   - **Client ID**
   - **Client Secret**
   Keep these safe — you'll need them for the worker secrets below.
6. Go to the **Scopes** tab and add the following scopes:
   - `contact_center_variable:read:admin`
   - `contact_center_variable:write:admin`
7. Click **Continue** → **Activate** to publish the app to your account.

---

## Step 2 — Find your Variable IDs in Zoom Contact Centre

You need the internal `variable_id` for both `nhs.mso` and `nhs.provider`.

### Option A — Zoom CC Admin UI
1. Log in to the Zoom web portal → **Contact Center** → **Management** → **Variables**.
2. Find the **nhs** variable group and click into it.
3. Click on `mso` — the URL will contain the variable ID (e.g. `W_VATTk_Q5aW6z5rZtBxAQ`).
4. Repeat for `provider`.

### Option B — API call (using curl)
```bash
# Replace YOUR_ACCESS_TOKEN with a token from your S2S app
curl -s -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  "https://api.zoom.us/v2/contact_center/variables" | jq '.variables[] | {name: .variable_name, id: .variable_id, group: .variable_group_id}'
```
Look for `variable_name: "mso"` and `variable_name: "provider"` in the output.

> **Important:** Make sure both variables are set up as **Global Variables** with  
> `value_category = linked_value` in Zoom CC — this ensures the value persists  
> across engagements and your toggle changes will take effect immediately.

---

## Step 3 — Deploy the Cloudflare Worker

### Prerequisites
```bash
npm install -g wrangler
wrangler login
```

### Set secrets
```bash
cd nhs-triggers
wrangler secret put ZOOM_ACCOUNT_ID
wrangler secret put ZOOM_CLIENT_ID
wrangler secret put ZOOM_CLIENT_SECRET
wrangler secret put ZOOM_MSO_VARIABLE_ID
wrangler secret put ZOOM_PROVIDER_VARIABLE_ID
```
Enter each value when prompted.

### Deploy
```bash
wrangler deploy
```

Wrangler will print a URL like `https://nhs-triggers.<your-subdomain>.workers.dev` — that's your toggle page.

---

## Step 4 — Test it

1. Open the worker URL in a browser.
2. The page reads the current `nhs.mso` value live from Zoom CC on load.
3. Click the toggle — it should flip and update Zoom CC immediately.
4. If MSO is on, the provider dropdown appears; changing it updates `nhs.provider`.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| 502 error on toggle | S2S app scopes missing or not activated — re-check Step 1 |
| Page loads with wrong state | `value_category` on the variable isn't `linked_value` |
| "Token request failed 401" | Wrong Client ID / Secret / Account ID |
| Variable ID errors (404) | Double-check the IDs from Step 2 |

---

## Files in this folder

| File | Purpose |
|---|---|
| `index.js` | The complete Cloudflare Worker (single file) |
| `wrangler.toml` | Wrangler config — name, entry point, compatibility date |
| `SETUP.md` | This guide |
