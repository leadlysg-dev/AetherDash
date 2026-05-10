const { fetchInsightsForDate } = require("./meta-fetcher");
const { upsertInsightRows } = require("./sheets-writer");

// ============================================================
// BACKFILL — pull a date range
// Usage: /api/backfill?start=2026-01-01&end=2026-05-05
// ============================================================

function* dateRange(start, end) {
  const cursor = new Date(start);
  const endDate = new Date(end);
  while (cursor <= endDate) {
    yield cursor.toISOString().split("T")[0];
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

exports.handler = async (event) => {
  try {
    const { start, end } = event.queryStringParameters || {};
    if (!start || !end) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          ok: false,
          error: "Missing 'start' and 'end' query params. Format: YYYY-MM-DD",
        }),
      };
    }

    console.log(`[backfill] Range: ${start} → ${end}`);

    let totalAdRows = 0;
    let success = 0;
    let failed = 0;
    const results = [];

    for (const date of dateRange(start, end)) {
      try {
        const insights = await fetchInsightsForDate(date);
        await upsertInsightRows(insights);
        totalAdRows += insights.length;
        success++;
        results.push({
          date,
          ok: true,
          adRows: insights.length,
          spend: insights.reduce((s, r) => s + r.spend, 0).toFixed(2),
          leads: insights.reduce((s, r) => s + r.leads, 0),
        });
        await sleep(250);
      } catch (err) {
        failed++;
        results.push({ date, ok: false, error: err.message });
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify(
        {
          ok: true,
          range: `${start} → ${end}`,
          totalDays: results.length,
          success,
          failed,
          totalAdRows,
          results,
        },
        null,
        2
      ),
    };
  } catch (err) {
    console.error("[backfill] ERROR:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
