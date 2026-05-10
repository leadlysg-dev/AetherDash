# Aether Athletics — Ad Pipeline (Ad Level)

Daily Meta Ads pull (at **ad creative level**) → Google Sheets → Telegram briefing → live dashboard.

Distinguishes **Brand Awareness (BA)** vs **Lead-gen** campaigns automatically by name pattern.

## What this does

- **7:00am SGT** — pulls yesterday's **ad-level** Meta data (one row per ad per day), writes to sheet
- **7:30am SGT** — generates AI briefing (gym-owner voice, rolled up to campaign level), posts to Telegram
- **Dashboard** at `/dashboard.html` — live performance view: KPIs, sparklines, campaign / ad set / ad tables

## Architecture

```
Meta Ads API (level=ad) → /api/daily-pull → Google Sheet (META RAW tab, 20 cols)
Manual CSV export       → /api/import-csv → same sheet
Google Sheet            → /api/sheet-raw  → public/dashboard.html
Google Sheet            → /api/daily-insight → Anthropic → Telegram
```

## Sheet schema — META RAW (20 columns)

| # | Column |
|---|---|
| 1 | Date |
| 2 | Campaign ID |
| 3 | Campaign Name |
| 4 | Ad Set ID |
| 5 | Ad Set Name |
| 6 | Ad ID |
| 7 | Ad Name |
| 8 | Objective |
| 9 | Type (BA / Leads / Other) |
| 10 | Status |
| 11 | Spend |
| 12 | Impressions |
| 13 | Reach |
| 14 | Frequency |
| 15 | Clicks |
| 16 | CPM |
| 17 | CTR |
| 18 | CPC |
| 19 | Leads |
| 20 | Cost Per Lead |

**Upsert key:** `Date` + `Ad ID` (cols A + F).

## Lead counting (3 non-overlapping action types)

Each lead = sum of:
1. `lead` — Meta lead form submissions
2. `offsite_conversion.fb_pixel_lead` — pixel-tracked website leads (LEADSWEB)
3. `onsite_conversion.messaging_conversation_started_7d` — WA / Messenger conversations

No double-counting from `lead_grouped` or `leadgen.other`.

## Type classifier (name-based, regex)

| Match | Type |
|---|---|
| `^KEEPOFF_` | Other (excluded from charts) |
| `_LEADS[A-Z]*_` (LEADS, LEADSWA, LEADSMESSENGER, LEADSWEB) | Leads |
| `_BA_`, `_ENGAGEMENT_`, `_PPE_` | BA |
| else | falls back to Meta objective; else `Other` |

## Env vars (Netlify → Site config → Environment variables)

| Variable | Description |
|---|---|
| `META_ACCESS_TOKEN` | System user token from Meta Business |
| `META_AD_ACCOUNT_ID` | Format `act_123456789` (auto-normalized) |
| `GOOGLE_SHEET_ID` | The sheet's ID from its URL |
| `GOOGLE_SA_CLIENT_EMAIL` | Service account email |
| `GOOGLE_SA_PRIVATE_KEY` | Service account private key |
| `ANTHROPIC_API_KEY` | For daily Telegram briefings |
| `TELEGRAM_BOT_TOKEN` | Bot to post briefings |
| `TELEGRAM_CHAT_ID` | Chat to post into |
| `TARGET_CPL` | $ threshold for green/red CPL coloring (default 50) |
| `LEADS_CAMPAIGN_BUDGET` | Default campaign budget (e.g. 2000) |
| `LEADS_CAMPAIGN_DAYS` | Default campaign run length (e.g. 21) |
| `DASHBOARD_URL` | Public URL for "View dashboard →" link in Telegram |

## Backfill

**Option A — CSV import (recommended for historical data)**
1. Meta Ads Manager → top tabs **Ads** → Date range = Maximum
2. Top-right → **Breakdown** → By Time → **Day**
3. **Columns** → Customize: Ad name, Ad ID, Ad set name, Ad set ID, Campaign name, Campaign ID, Objective, Delivery, Amount spent, Impressions, Reach, Frequency, Link clicks, CPM, CTR, CPC, Leads, Messaging conversations started
4. **Reports** → Export → CSV
5. Admin page → **Import from Meta CSV** → select file → Import

**Option B — API backfill (slower, has attribution lag)**
- Admin page → **Backfill date range** → set From/To → Start

## Daily ops

- 7:00am SGT: scheduled `daily-pull` runs automatically (Netlify cron `0 23 * * *` UTC)
- 7:30am SGT: scheduled `daily-insight` runs (Netlify cron `30 23 * * *` UTC)
- Dashboard auto-fetches from sheet on each page load
