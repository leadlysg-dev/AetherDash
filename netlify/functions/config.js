// ============================================================
// AETHER ATHLETICS — CONFIG
// ============================================================

// Auto-normalize the ad account ID:
// - strips whitespace
// - removes accidentally-pasted "act_" duplicates
// - adds "act_" prefix if missing
function normalizeAdAccountId(raw) {
  if (!raw) return "";
  let id = String(raw).trim();
  // Remove all "act_" prefixes (in case user pasted "act_act_123")
  id = id.replace(/^(act_)+/i, "");
  // Strip non-numeric chars in case there's a stray space
  id = id.replace(/[^0-9]/g, "");
  if (!id) return "";
  return "act_" + id;
}

const CONFIG = {
  client: {
    name: "Aether Athletics",
    slug: "aa",
    timezone: "Asia/Singapore",
  },
  meta: {
    accessToken: (process.env.META_ACCESS_TOKEN || "").trim(),
    adAccountId: normalizeAdAccountId(process.env.META_AD_ACCOUNT_ID),
    apiVersion: "v21.0",
  },
  google: {
    sheetId: process.env.GOOGLE_SHEET_ID,
    serviceAccountEmail: process.env.GOOGLE_SA_CLIENT_EMAIL,
    serviceAccountKey: process.env.GOOGLE_SA_PRIVATE_KEY,
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
  },

  // Gym client business rules
  business: {
    // Target cost per lead. Edit via TARGET_CPL env var.
    targetCPL: parseFloat(process.env.TARGET_CPL || "50"),
    // Typical leads campaign: budget cap and duration
    leadsCampaignBudget: parseFloat(process.env.LEADS_CAMPAIGN_BUDGET || "2000"),
    leadsCampaignDays: parseInt(process.env.LEADS_CAMPAIGN_DAYS || "21", 10),
    // A campaign is "currently active" if it had spend in the last N days
    activeWindowDays: 3,
    // Site URL (used in Telegram briefing as a link)
    dashboardUrl: process.env.DASHBOARD_URL || "",
  },

  sheet: {
    metaTab: "META RAW",
    headers: [
      "Date",
      "Campaign ID",
      "Campaign Name",
      "Objective",
      "Type",
      "Status",
      "Spend",
      "Impressions",
      "Reach",
      "Frequency",
      "Clicks",
      "CPM",
      "CTR",
      "CPC",
      "Leads",
      "Cost Per Lead",
    ],
  },
};

// ============================================================
// CAMPAIGN TYPE CLASSIFIER
// ============================================================

// Maps Meta objectives to internal type. BA = Brand Awareness.
const OBJECTIVE_MAP = {
  // Brand Awareness / top-of-funnel
  BRAND_AWARENESS: "BA",
  REACH: "BA",
  OUTCOME_AWARENESS: "BA",
  POST_ENGAGEMENT: "BA",
  PAGE_LIKES: "BA",
  VIDEO_VIEWS: "BA",
  OUTCOME_ENGAGEMENT: "BA",
  OUTCOME_TRAFFIC: "BA",
  LINK_CLICKS: "BA",

  // Lead-gen / bottom-of-funnel
  LEAD_GENERATION: "Leads",
  OUTCOME_LEADS: "Leads",
  CONVERSIONS: "Leads",
  OUTCOME_SALES: "Leads",
  MESSAGES: "Leads",
};

function classifyCampaign(objective, campaignName = "") {
  // 1. Try objective map
  if (OBJECTIVE_MAP[objective]) return OBJECTIVE_MAP[objective];

  // 2. Fall back to name-based heuristics (case-insensitive)
  const n = (campaignName || "").toLowerCase();
  if (n.includes("lead") || n.includes("conversion") || n.includes("signup")) return "Leads";
  if (n.includes("ba ") || n.includes("brand") || n.includes("awareness") || n.includes("reach"))
    return "BA";

  return "Other";
}

// ============================================================
// HELPERS
// ============================================================

function getYesterdaySGT() {
  const now = new Date();
  const sgtNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  sgtNow.setUTCDate(sgtNow.getUTCDate() - 1);
  return sgtNow.toISOString().split("T")[0];
}

function getDateSGT(daysAgo = 0) {
  const now = new Date();
  const sgtNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  sgtNow.setUTCDate(sgtNow.getUTCDate() - daysAgo);
  return sgtNow.toISOString().split("T")[0];
}

function getServiceAccountCredentials() {
  if (!CONFIG.google.serviceAccountKey) {
    throw new Error("GOOGLE_SA_PRIVATE_KEY env var is missing");
  }
  if (!CONFIG.google.serviceAccountEmail) {
    throw new Error("GOOGLE_SA_CLIENT_EMAIL env var is missing");
  }

  let privateKey = CONFIG.google.serviceAccountKey;
  privateKey = privateKey.replace(/\\n/g, "\n");

  if (!privateKey.includes("BEGIN PRIVATE KEY")) {
    try {
      const raw = Buffer.from(privateKey, "base64").toString("utf-8");
      if (raw.includes("BEGIN PRIVATE KEY")) {
        privateKey = raw;
      } else {
        privateKey = `-----BEGIN PRIVATE KEY-----\n${privateKey
          .match(/.{1,64}/g)
          .join("\n")}\n-----END PRIVATE KEY-----\n`;
      }
    } catch (e) {
      throw new Error("GOOGLE_SA_PRIVATE_KEY format not recognized.");
    }
  }

  return {
    client_email: CONFIG.google.serviceAccountEmail,
    private_key: privateKey,
  };
}

module.exports = {
  CONFIG,
  classifyCampaign,
  getYesterdaySGT,
  getDateSGT,
  getServiceAccountCredentials,
};
