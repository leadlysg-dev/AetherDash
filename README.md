# Aether Athletics — Ad Pipeline (Campaign Level)

Daily Meta Ads pull → Google Sheets → Telegram briefing → live dashboard.

Same architecture as AARO. Distinguishes BA vs Lead-gen automatically by campaign name.

## What this does

- **12:01am SGT daily** — pulls yesterday's Meta campaign-level data, writes to sheet
- **Monday 8:00am SGT** — AI briefing posted to Telegram
- **Dashboard** at `/dashboard.html` — live performance view

## Sheet schema — META RAW (16 columns)

`Date | Campaign ID | Campaign Name | Objective | Type | Status | Spend | Impressions | Reach | Frequency | Clicks | CPM | CTR | CPC | Leads | Cost Per Lead`

Upsert key: `Date + Campaign ID` (cols A+B).

## Lead counting (3 non-overlapping action types)

1. `lead` — Meta lead form
2. `offsite_conversion.fb_pixel_lead` — pixel-tracked website leads
3. `onsite_conversion.messaging_conversation_started_7d` — WA / Messenger

## Type classifier

| Match (regex on campaign name) | Type |
|---|---|
| `^KEEPOFF_` | Other |
| `_LEADS[A-Z]*_` | Leads |
| `_BA_`, `_ENGAGEMENT_`, `_PPE_` | BA |
| else → Meta objective fallback | BA/Leads/Other |

## Schedules

- `daily-pull`: `1 16 * * *` UTC (12:01am SGT daily)
- `daily-insight`: `0 0 * * 1` UTC (Monday 8:00am SGT)
