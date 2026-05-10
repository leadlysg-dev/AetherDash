# Aether Athletics — Ad Pipeline

Daily Meta Ads pull → Google Sheets → Telegram briefing → live dashboard.

Distinguishes **Brand Awareness (BA)** vs **Lead-gen** campaigns automatically.

## What this does

- **7:00am SGT** — pulls yesterday's campaign-level Meta Ads data, writes to sheet
- **7:30am SGT** — generates AI briefing (gym-owner voice), posts to Telegram
- **Dashboard** at `/` — live performance view with status banner, KPIs, charts, campaign breakdowns

## Architecture

```
Meta Ads API → /api/daily-pull → Google Sheet (META RAW tab)
                                    ↓
                              /api/dashboard-data
                                    ↓
                              public/index.html (live dashboard)

Google Sheet → /api/daily-insight → Anthropic → Telegram
```

## Env vars (Netlify → Site config → Environment variables)

| Variable | Description |
|---|---|
| `META_ACCESS_TOKEN` | System user token from Meta Business |
| `META_AD_ACCOUNT_ID` | Format `act_123456789` |
| `GOOGLE_SHEET_ID` | From the sheet URL |
| `GOOGLE_SA_CLIENT_EMAIL` | Service account email |
| `GOOGLE_SA_PRIVATE_KEY` | Paste `private_key` value from JSON (with `\n` literals) |
| `ANTHROPIC_API_KEY` | Reuse from AARO |
| `TELEGRAM_BOT_TOKEN` | New bot for AA |
| `TELEGRAM_CHAT_ID` | Negative for groups, positive for DM |
| `TARGET_CPL` | Target cost per lead (default `50`) |
| `LEADS_CAMPAIGN_BUDGET` | Typical budget per Lead campaign (default `2000`) |
| `LEADS_CAMPAIGN_DAYS` | Typical Lead campaign duration (default `21`) |
| `DASHBOARD_URL` | (optional) Full dashboard URL — adds link to TG briefing |

## Endpoints

| URL | Purpose |
|---|---|
| `/` | Live dashboard |
| `/api/diagnostic` | Verify all env vars + API connections |
| `/api/daily-pull` | Pull yesterday now |
| `/api/daily-pull?date=2026-05-01` | Pull a specific date |
| `/api/backfill?start=2026-01-01&end=2026-05-05` | Backfill a range |
| `/api/dashboard-data` | JSON endpoint feeding the dashboard |
| `/api/dashboard-data?days=7` | Last 7 days |
| `/api/dashboard-data?start=2026-04-01&end=2026-05-01` | Custom range |
| `/api/daily-insight?preview=true` | Preview Telegram message (no send) |
| `/api/daily-insight` | Generate + send briefing now |

## Sheet schema

Tab: `META RAW` — auto-created on first run. One row per campaign per day.

| Date | Campaign ID | Campaign Name | Objective | Type | Status | Spend | Impressions | Reach | Frequency | Clicks | CPM | CTR | CPC | Leads | Cost Per Lead |
|------|------|------|------|------|------|------|------|------|------|------|------|------|------|------|------|

**Type** is auto-classified:
- `BA` — REACH, BRAND_AWARENESS, ENGAGEMENT, TRAFFIC, VIDEO_VIEWS, PAGE_LIKES, LINK_CLICKS objectives
- `Leads` — LEAD_GENERATION, OUTCOME_LEADS, CONVERSIONS, MESSAGES, OUTCOME_SALES objectives
- `Other` — anything else

If classification looks off, edit `OBJECTIVE_MAP` in `netlify/functions/config.js`.

## Lead-gen "campaign run" detection

The dashboard auto-detects discrete Lead campaign runs from spend patterns:
- Same campaign ID + contiguous days of spend (gaps ≤ 3 days)
- A gap > 3 days = new run
- Active = had spend in the last 3 days

Past runs show in the **Lead Campaign History** tab. The current active run shows in the **status banner** at the top.

## Deploy

1. Push to GitHub
2. Netlify → Import existing project → pick repo → deploy (defaults are fine)
3. Add env vars
4. Trigger redeploy
5. Hit `/api/diagnostic` to verify
6. Hit `/api/daily-pull` for first data
7. Optional: hit `/api/backfill?start=YYYY-MM-DD&end=YYYY-MM-DD` for history
8. Visit `/` for the dashboard

## File layout

```
aa-pipeline/
├── netlify.toml
├── package.json
├── public/
│   └── index.html              ← Dashboard (frontend)
└── netlify/functions/
    ├── config.js               ← env vars, classifier, helpers
    ├── meta-fetcher.js         ← campaign-level Meta pull
    ├── sheets-writer.js        ← write to Google Sheets
    ├── daily-pull.js           ← scheduled 7am SGT
    ├── daily-insight.js        ← scheduled 7:30am SGT (Telegram)
    ├── backfill.js             ← manual: date range pull
    ├── dashboard-data.js       ← JSON API for frontend
    └── diagnostic.js           ← verify env vars
```

## Difference from AARO

- **Single platform** (Meta only — no Google Ads)
- **Campaign-level data** (vs account-level for AARO Meta)
- **BA/Leads classification** (gym client uses two distinct campaign types)
- **Status-aware dashboard** with active campaign banner + progress bar
- **Lead campaign run history** (auto-detected from spend gaps)
- **Gym-owner Telegram voice** (punchy, target-aware)
