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
    serviceAccountKey: process.env.GOOGLE_SA_PRIVATE_KEY,
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

  // Handle: literal "\n" sequences (common when pasting JSON-encoded private_key into env vars)
  // Convert them into real newline characters
  privateKey = privateKey.replace(/\\n/g, "\n");

  // Handle: if it's base64-encoded (no PEM headers), decode and wrap
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
      throw new Error(
        "GOOGLE_SA_PRIVATE_KEY format not recognized. Paste the 'private_key' value from your service account JSON."
      );
    }
  }

  return {
    client_email: CONFIG.google.serviceAccountEmail,
    private_key: privateKey,
  };
}

module.exports = {
  CONFIG,
  getYesterdaySGT,
  getDateSGT,
  getServiceAccountCredentials,
};
