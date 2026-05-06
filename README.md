# Aether Athletics — Ad Pipeline

Daily Meta Ads pull → Google Sheets → Telegram AI briefing. Same architecture as AARO, simplified for a single Meta account.

## What this does

- **7:00am SGT** — pulls yesterday's Meta ad account performance, writes to Google Sheet
- **7:30am SGT** — reads sheet, asks Claude for insight, posts to Telegram

## Deploy steps

### 1. Push to GitHub

```bash
cd aa-pipeline
git init
git add .
git commit -m "Initial commit"
git branch -M main
# Create new repo on GitHub (e.g. aa-pipeline), then:
git remote add origin https://github.com/YOUR_USERNAME/aa-pipeline.git
git push -u origin main
```

### 2. Connect to Netlify

1. Go to **app.netlify.com** → **Add new site** → **Import an existing project**
2. Pick GitHub → select your `aa-pipeline` repo
3. Build settings: leave defaults (`netlify.toml` handles everything)
4. Deploy site
5. Rename the site (Site settings → Change site name) to something like `aetherathletics-pipeline`

### 3. Set up Google Sheet

1. Create a new blank Google Sheet — name it `Aether Athletics — Reporting Data`
2. Copy the Sheet ID from the URL: `https://docs.google.com/spreadsheets/d/THIS_PART_HERE/edit`
3. Share the sheet with your service account email (the one from `GOOGLE_SA_CLIENT_EMAIL`) → Editor access

The pipeline will auto-create the `META RAW` tab on first run.

### 4. Add env vars in Netlify

Site settings → Environment variables → Add the following:

| Variable | What it is | Source |
|----------|------------|--------|
| `META_ACCESS_TOKEN` | Long-lived system user token | From Meta Business Settings (you've already saved this) |
| `META_AD_ACCOUNT_ID` | Aether Athletics ad account, format `act_123456789` | From Meta Business Settings |
| `GOOGLE_SHEET_ID` | The sheet ID from URL | Step 3 above |
| `GOOGLE_SA_CLIENT_EMAIL` | Service account email | From Google Cloud Console (reuse AARO's if same project) |
| `GOOGLE_SA_PRIVATE_KEY` | Raw base64 of the PRIVATE KEY body (no PEM headers) | See "Private key encoding" below |
| `ANTHROPIC_API_KEY` | Your Anthropic API key | Reuse AARO's |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | Reuse `@Leadly_sg_bot` token from AARO |
| `TELEGRAM_CHAT_ID` | Chat/group ID for AA's briefings | Create a new Telegram group, add the bot, get chat ID |

#### Private key encoding

Take the JSON service account key, extract the `private_key` field. The value looks like:

```
-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSj...
-----END PRIVATE KEY-----
```

Strip the `-----BEGIN/END-----` lines and all newlines. Take only the base64 body. Paste that into `GOOGLE_SA_PRIVATE_KEY`. The code will reconstruct the PEM format at runtime.

### 5. Trigger a redeploy

After adding env vars, redeploy: **Deploys → Trigger deploy → Deploy site**.

### 6. Verify everything works

Visit: `https://YOUR-SITE.netlify.app/api/diagnostic`

Expected: all four checks `ok: true` (Meta, Sheets, Anthropic, Telegram).

If any fail, the error message will tell you which env var is wrong.

### 7. Pull yesterday's data

`https://YOUR-SITE.netlify.app/api/daily-pull`

Then check the Google Sheet — `META RAW` tab should now exist with one row.

### 8. Backfill historical data (optional)

`https://YOUR-SITE.netlify.app/api/backfill?start=2026-01-01&end=2026-05-05`

This loops through every date and pulls Meta data for each. Takes ~1 second per day.

### 9. Test the Telegram briefing

Preview without sending: `/api/daily-insight?preview=true`

Send for real: `/api/daily-insight`

### 10. Confirm scheduled functions are active

Site settings → Functions → you should see `daily-pull` and `daily-insight` listed as scheduled.

That's it. After this, you don't touch anything — the daily briefing just shows up at 7:30am SGT.

## File layout

```
aa-pipeline/
├── netlify.toml           Netlify config
├── package.json           Dependencies
├── public/
│   └── index.html         Landing page (lists endpoints)
└── netlify/functions/
    ├── config.js          Env vars + helpers
    ├── meta-fetcher.js    Pulls from Meta Ads API
    ├── sheets-writer.js   Writes to Google Sheets
    ├── daily-pull.js      Scheduled 7am SGT
    ├── daily-insight.js   Scheduled 7:30am SGT
    ├── backfill.js        Manual: pull a date range
    └── diagnostic.js      Manual: verify env vars
```

## Differences from AARO

- Single Meta tab (no per-campaign segmentation)
- No Google Ads (you said Meta only)
- Same Telegram briefing format
