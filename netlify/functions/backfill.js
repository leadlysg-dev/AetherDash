const { fetchMetaInsights } = require("./meta-fetcher");
const { writeMetaRow } = require("./sheets-writer");

// ============================================================
// BACKFILL — manual endpoint to pull a date range
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

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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

    const results = [];
    let success = 0;
    let failed = 0;

    for (const date of dateRange(start, end)) {
      try {
        const insights = await fetchMetaInsights(date);
        const writeResult = await writeMetaRow(insights);
        results.push({
          date,
          ok: true,
          spend: insights.spend,
          clicks: insights.clicks,
          action: writeResult.action,
        });
        success++;
        // Be polite to Meta API — small delay
        await sleep(300);
      } catch (err) {
        console.error(`[backfill] ${date} failed:`, err.message);
        results.push({ date, ok: false, error: err.message });
        failed++;
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
