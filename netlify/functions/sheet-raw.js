const { readMetaData } = require("./sheets-writer");
const { CONFIG } = require("./config");

// ============================================================
// /api/sheet-raw — returns all rows from META RAW
// Mirrors AARO's direct-sheet-read pattern, but goes through service account
// ============================================================

exports.handler = async () => {
  try {
    const rows = await readMetaData();
    if (!rows || rows.length < 2) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
        body: JSON.stringify({ ok: true, headers: [], rows: [] }),
      };
    }

    const headers = rows[0];
    const data = rows.slice(1).map((r) => {
      const obj = {};
      headers.forEach((h, i) => {
        const v = r[i];
        if (
          ["Spend", "Impressions", "Reach", "Frequency", "Clicks", "CPM", "CTR", "CPC", "Leads", "Cost Per Lead"].includes(h)
        ) {
          obj[h] = parseFloat(v) || 0;
        } else {
          obj[h] = v || "";
        }
      });
      return obj;
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
      body: JSON.stringify({
        ok: true,
        config: {
          targetCPL: CONFIG.business.targetCPL,
          leadsCampaignBudget: CONFIG.business.leadsCampaignBudget,
          leadsCampaignDays: CONFIG.business.leadsCampaignDays,
          activeWindowDays: CONFIG.business.activeWindowDays,
        },
        headers,
        rows: data,
        rowCount: data.length,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
