const fetch = require("node-fetch");
const { CONFIG, classifyCampaign } = require("./config");

// ============================================================
// META FETCHER — campaign-level
// One row per campaign per date
// ============================================================

// ============================================================
// LEAD COUNTING — three distinct, non-overlapping action types
// Sum = total leads. No double-counting.
// ============================================================
// Why these 3:
//   1. 'lead' — Meta lead form submissions (LEADS_ABO, LEADS_CBO style)
//   2. 'offsite_conversion.fb_pixel_lead' — website form leads via pixel (LEADSWEB)
//   3. 'onsite_conversion.messaging_conversation_started_7d' — WhatsApp/Messenger
//      conversations (LEADSWA, LEADSMESSENGER, IF&M ad sets)
//
// Notably EXCLUDED to avoid double-counting:
//   - 'onsite_conversion.lead_grouped'  (overlaps with 'lead')
//   - 'leadgen.other'                    (overlaps with 'lead')
//   - 'complete_registration'            (overlaps with pixel_lead in some setups)
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

// 1. Fetch all campaigns in account (id, name, objective, status)
async function fetchCampaigns() {
  const { accessToken, adAccountId, apiVersion } = CONFIG.meta;

  const url = `https://graph.facebook.com/${apiVersion}/${adAccountId}/campaigns?` +
    new URLSearchParams({
      access_token: accessToken,
      fields: "id,name,objective,status,effective_status",
      limit: "500",
    });

  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(`Meta campaigns: ${data.error.message}`);
  return data.data || [];
}

// 2. Fetch insights for a date — at campaign level
async function fetchCampaignInsightsForDate(date) {
  const { accessToken, adAccountId, apiVersion } = CONFIG.meta;

  if (!accessToken) throw new Error("META_ACCESS_TOKEN env var is missing");
  if (!adAccountId) throw new Error("META_AD_ACCOUNT_ID env var is missing");

  const fields = [
    "campaign_id",
    "campaign_name",
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
  const res = await fetch(url);
  const data = await res.json();

  if (data.error) {
    // Code 100 with "nonexisting field" usually = wrong ad account ID format,
    // missing permissions, or revoked token.
    if (data.error.code === 100) {
      throw new Error(
        `Meta insights: ${data.error.message} — Check META_AD_ACCOUNT_ID is "act_NUMBERS" and that the system user has access to that ad account.`
      );
    }
    throw new Error(`Meta insights: ${data.error.message} (code ${data.error.code})`);
  }
  return data.data || [];
}

// 3. Combine: for given date, return one structured row per campaign that had spend
async function fetchInsightsForDate(date) {
  const [campaigns, rows] = await Promise.all([
    fetchCampaigns(),
    fetchCampaignInsightsForDate(date),
  ]);

  const campMap = new Map();
  for (const c of campaigns) {
    campMap.set(c.id, c);
  }

  const result = [];
  for (const r of rows) {
    const camp = campMap.get(r.campaign_id) || {};
    const objective = camp.objective || "UNKNOWN";
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

module.exports = { fetchInsightsForDate, fetchCampaigns };
