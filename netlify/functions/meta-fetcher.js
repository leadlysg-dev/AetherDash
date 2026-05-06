const fetch = require("node-fetch");
const { CONFIG } = require("./config");

// ============================================================
// META ADS FETCHER
// Pulls account-level insights for a single date
// ============================================================

async function fetchMetaInsights(date) {
  const { accessToken, adAccountId, apiVersion } = CONFIG.meta;

  if (!accessToken) throw new Error("META_ACCESS_TOKEN env var is missing");
  if (!adAccountId) throw new Error("META_AD_ACCOUNT_ID env var is missing");

  const fields = [
    "spend",
    "impressions",
    "clicks",
    "cpm",
    "ctr",
    "cpc",
    "actions",
    "cost_per_action_type",
  ].join(",");

  const params = new URLSearchParams({
    access_token: accessToken,
    fields,
    level: "account",
    time_range: JSON.stringify({ since: date, until: date }),
  });

  const url = `https://graph.facebook.com/${apiVersion}/${adAccountId}/insights?${params}`;

  const res = await fetch(url);
  const data = await res.json();

  if (data.error) {
    throw new Error(`Meta API error: ${data.error.message} (code ${data.error.code})`);
  }

  // No data for this date (e.g. account had zero spend)
  if (!data.data || data.data.length === 0) {
    return {
      date,
      spend: 0,
      impressions: 0,
      clicks: 0,
      cpm: 0,
      ctr: 0,
      cpc: 0,
      conversions: 0,
      costPerConversion: 0,
    };
  }

  const row = data.data[0];

  // Extract conversions — Meta returns "actions" as an array of {action_type, value}
  // We sum standard conversion-relevant action types. Adjust as needed for AA's setup.
  const conversionActionTypes = [
    "purchase",
    "complete_registration",
    "lead",
    "onsite_conversion.lead_grouped",
    "offsite_conversion.fb_pixel_lead",
    "offsite_conversion.fb_pixel_purchase",
    "onsite_conversion.messaging_conversation_started_7d",
  ];

  let conversions = 0;
  if (Array.isArray(row.actions)) {
    for (const a of row.actions) {
      if (conversionActionTypes.includes(a.action_type)) {
        conversions += parseFloat(a.value) || 0;
      }
    }
  }

  const spend = parseFloat(row.spend) || 0;
  const costPerConversion = conversions > 0 ? spend / conversions : 0;

  return {
    date,
    spend,
    impressions: parseInt(row.impressions, 10) || 0,
    clicks: parseInt(row.clicks, 10) || 0,
    cpm: parseFloat(row.cpm) || 0,
    ctr: parseFloat(row.ctr) || 0,
    cpc: parseFloat(row.cpc) || 0,
    conversions,
    costPerConversion,
  };
}

module.exports = { fetchMetaInsights };
