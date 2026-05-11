const fetch = require("node-fetch");
const { CONFIG, classifyCampaign } = require("./config");

// ============================================================
// META FETCHER — CAMPAIGN LEVEL (one row per campaign per day)
// ============================================================

// 3 non-overlapping lead action types
const LEAD_ACTION_TYPES = [
  "lead",
  "offsite_conversion.fb_pixel_lead",
  "onsite_conversion.messaging_conversation_started_7d",
];

function sumLeadActions(actions) {
  if (!Array.isArray(actions)) return 0;
  let total = 0;
  for (const a of actions) {
    if (LEAD_ACTION_TYPES.includes(a.action_type)) {
      total += parseFloat(a.value) || 0;
    }
  }
  return total;
}

async function fetchAllPaged(url) {
  const all = [];
  let next = url;
  while (next) {
    const res = await fetch(next);
    const data = await res.json();
    if (data.error) throw new Error(`Meta API: ${data.error.message}`);
    if (Array.isArray(data.data)) all.push(...data.data);
    next = data.paging?.next || null;
  }
  return all;
}

// campaign metadata: id → { effective_status }
async function fetchCampaignsMeta() {
  const { accessToken, adAccountId, apiVersion } = CONFIG.meta;
  const params = new URLSearchParams({
    access_token: accessToken,
    fields: "id,name,objective,effective_status,status",
    limit: "500",
  });
  const url = `https://graph.facebook.com/${apiVersion}/${adAccountId}/campaigns?${params}`;
  return fetchAllPaged(url);
}

async function fetchCampaignInsightsForDate(date) {
  const { accessToken, adAccountId, apiVersion } = CONFIG.meta;

  if (!accessToken) throw new Error("META_ACCESS_TOKEN env var is missing");
  if (!adAccountId) throw new Error("META_AD_ACCOUNT_ID env var is missing");

  const fields = [
    "campaign_id",
    "campaign_name",
    "objective",
    "spend",
    "impressions",
    "reach",
    "frequency",
    "clicks",
    "cpm",
    "ctr",
    "cpc",
    "actions",
  ].join(",");

  const params = new URLSearchParams({
    access_token: accessToken,
    fields,
    level: "campaign",
    time_range: JSON.stringify({ since: date, until: date }),
    limit: "500",
  });

  const url = `https://graph.facebook.com/${apiVersion}/${adAccountId}/insights?${params}`;
  return fetchAllPaged(url);
}

async function fetchInsightsForDate(date) {
  const [campaigns, rows] = await Promise.all([
    fetchCampaignsMeta(),
    fetchCampaignInsightsForDate(date),
  ]);

  const campMap = new Map(campaigns.map((c) => [c.id, c]));

  const result = [];
  for (const r of rows) {
    const camp = campMap.get(r.campaign_id) || {};
    const objective = r.objective || camp.objective || "UNKNOWN";
    const status = camp.effective_status || camp.status || "UNKNOWN";
    const type = classifyCampaign(objective, r.campaign_name);

    const spend = parseFloat(r.spend) || 0;
    const leads = sumLeadActions(r.actions);
    const cpl = leads > 0 ? spend / leads : 0;

    result.push({
      date,
      campaignId: r.campaign_id,
      campaignName: r.campaign_name,
      objective,
      type,
      status,
      spend,
      impressions: parseInt(r.impressions, 10) || 0,
      reach: parseInt(r.reach, 10) || 0,
      frequency: parseFloat(r.frequency) || 0,
      clicks: parseInt(r.clicks, 10) || 0,
      cpm: parseFloat(r.cpm) || 0,
      ctr: parseFloat(r.ctr) || 0,
      cpc: parseFloat(r.cpc) || 0,
      leads,
      costPerLead: cpl,
    });
  }

  return result;
}

module.exports = { fetchInsightsForDate };
