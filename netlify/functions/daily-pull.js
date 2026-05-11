const { fetchInsightsForDate } = require("./meta-fetcher");
const { upsertInsightRows } = require("./sheets-writer");
const { getYesterdaySGT } = require("./config");

// ============================================================
// DAILY PULL — runs at 7am SGT (23:00 UTC previous day)
// Pulls yesterday's campaign-level insights → writes to sheet
// ============================================================

exports.handler = async (event) => {
  try {
    const date = event.queryStringParameters?.date || getYesterdaySGT();

    console.log(`[daily-pull] Pulling Meta campaign data for ${date}`);

    const insights = await fetchInsightsForDate(date);
    console.log(`[daily-pull] Got ${insights.length} campaign rows for ${date}`);

    const result = await upsertInsightRows(insights);

    return {
      statusCode: 200,
      body: JSON.stringify(
        {
          ok: true,
          date,
          campaignCount: insights.length,
          totalSpend: insights.reduce((s, r) => s + r.spend, 0).toFixed(2),
          totalLeads: insights.reduce((s, r) => s + r.leads, 0),
          sheetWrite: result,
          rows: insights.map((r) => ({
            campaign: r.campaignName,
            type: r.type,
            spend: r.spend.toFixed(2),
            leads: r.leads,
            cpl: r.costPerLead.toFixed(2),
          })),
        },
        null,
        2
      ),
    };
  } catch (err) {
    console.error("[daily-pull] ERROR:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};

// Scheduled: 12:01am SGT daily (16:01 UTC previous day)
exports.config = {
  schedule: "1 16 * * *",
};
