// ============================================================
// CONFIG — all env vars in one place
// ============================================================

const CONFIG = {
  client: {
    name: "Aether Athletics",
    slug: "aa",
    timezone: "Asia/Singapore",
  },
  meta: {
    accessToken: process.env.META_ACCESS_TOKEN,
    adAccountId: process.env.META_AD_ACCOUNT_ID, // format: act_123456789
    apiVersion: "v21.0",
  },
  google: {
    sheetId: process.env.GOOGLE_SHEET_ID,
    serviceAccountEmail: process.env.GOOGLE_SA_CLIENT_EMAIL,
    serviceAccountKey: process.env.GOOGLE_SA_PRIVATE_KEY, // base64 encoded raw body
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
  sheet: {
    metaTab: "META RAW",
    headers: [
      "Date",
      "Spend",
      "Impressions",
      "Clicks",
      "CPM",
      "CTR",
      "CPC",
      "Conversions",
      "Cost Per Conversion",
    ],
  },
};

// ============================================================
// HELPERS
// ============================================================

function getYesterdaySGT() {
  // Get yesterday in SGT (UTC+8)
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
  // The private key body is stored as raw base64 in env var (no PEM headers)
  // Reconstruct PEM format
  const rawKey = Buffer.from(CONFIG.google.serviceAccountKey, "base64").toString("utf-8");
  // Wrap into proper PEM format
  const pemKey = `-----BEGIN PRIVATE KEY-----\n${rawKey
    .match(/.{1,64}/g)
    .join("\n")}\n-----END PRIVATE KEY-----\n`;

  return {
    client_email: CONFIG.google.serviceAccountEmail,
    private_key: pemKey,
  };
}

module.exports = {
  CONFIG,
  getYesterdaySGT,
  getDateSGT,
  getServiceAccountCredentials,
};
