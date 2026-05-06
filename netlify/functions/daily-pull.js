const { fetchMetaInsights } = require("./meta-fetcher");
const { writeMetaRow } = require("./sheets-writer");
const { getYesterdaySGT } = require("./config");

// ============================================================
// DAILY PULL — runs at 7am SGT (23:00 UTC previous day)
// Pulls yesterday's Meta Ads data → writes to Google Sheet
// ============================================================

exports.handler = async (event) => {
  try {
    // Allow manual override via query string: ?date=2026-05-01
    const date = event.queryStringParameters?.date || getYesterdaySGT();

    console.log(`[daily-pull] Pulling Meta data for ${date}`);

    const insights = await fetchMetaInsights(date);
    console.log(`[daily-pull] Got insights:`, insights);

    const result = await writeMetaRow(insights);
    console.log(`[daily-pull] Sheet write:`, result);

    return {
      statusCode: 200,
      body: JSON.stringify(
        {
          ok: true,
          date,
          insights,
          sheetWrite: result,
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

// Scheduled: every day at 23:00 UTC = 7am SGT
exports.config = {
  schedule: "0 23 * * *",
};
