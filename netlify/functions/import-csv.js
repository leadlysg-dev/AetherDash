const { upsertInsightRows } = require("./sheets-writer");
const { classifyCampaign } = require("./config");

// ============================================================
// /api/import-csv — Meta CSV at AD level with Day breakdown
// Parses, classifies, writes to META RAW (ad-level)
// ============================================================

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        inQuote = false;
      } else {
        cell += c;
      }
    } else {
      if (c === '"') inQuote = true;
      else if (c === ",") {
        row.push(cell);
        cell = "";
      } else if (c === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else if (c !== "\r") {
        cell += c;
      }
    }
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function findCol(headers, candidates) {
  const lower = headers.map((h) => (h || "").toLowerCase().trim());
  for (const c of candidates) {
    const cLow = c.toLowerCase();
    let idx = lower.indexOf(cLow);
    if (idx >= 0) return idx;
    idx = lower.findIndex((h) => h.startsWith(cLow));
    if (idx >= 0) return idx;
  }
  return -1;
}

function num(v) {
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ""));
  return isNaN(n) ? 0 : n;
}

function normalizeDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const parts = s.split(/[\/\-]/);
  if (parts.length === 3) {
    let [a, b, c] = parts;
    if (a.length === 4) return `${a}-${b.padStart(2, "0")}-${c.padStart(2, "0")}`;
    if (c.length === 4) return `${c}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  return null;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ ok: false, error: "POST a CSV body" }) };
    }

    let csvText = event.body || "";
    if (event.isBase64Encoded) csvText = Buffer.from(csvText, "base64").toString("utf-8");
    if (!csvText.trim()) throw new Error("Empty CSV body");

    const rows = parseCSV(csvText);
    if (rows.length < 2) throw new Error("CSV has no data rows");

    const headers = rows[0];

    // Required ad-level columns
    const dayIdx = findCol(headers, ["Day"]);
    const startIdx = findCol(headers, ["Reporting starts"]);
    const endIdx = findCol(headers, ["Reporting ends"]);
    const adIdIdx = findCol(headers, ["Ad ID"]);
    const adNameIdx = findCol(headers, ["Ad name", "Ad Name"]);
    const adsetIdIdx = findCol(headers, ["Ad set ID", "Ad Set ID"]);
    const adsetNameIdx = findCol(headers, ["Ad set name", "Ad Set Name"]);
    const campIdIdx = findCol(headers, ["Campaign ID"]);
    const campNameIdx = findCol(headers, ["Campaign name", "Campaign Name"]);
    const objectiveIdx = findCol(headers, ["Objective"]);
    const statusIdx = findCol(headers, ["Ad delivery", "Delivery", "Campaign delivery"]);

    // Metrics
    const spendIdx = findCol(headers, ["Amount spent (SGD)", "Amount spent (USD)", "Amount spent", "Spend"]);
    const imprIdx = findCol(headers, ["Impressions"]);
    const reachIdx = findCol(headers, ["Reach"]);
    const freqIdx = findCol(headers, ["Frequency"]);
    const clicksIdx = findCol(headers, ["Link clicks", "Clicks"]);
    const cpmIdx = findCol(headers, ["CPM (cost per 1,000 impressions) (SGD)", "CPM (cost per 1,000 impressions) (USD)", "CPM"]);
    const ctrIdx = findCol(headers, ["CTR (link click-through rate)", "CTR (all)", "CTR"]);
    const cpcIdx = findCol(headers, ["CPC (cost per link click) (SGD)", "CPC (cost per link click) (USD)", "CPC"]);
    const leadsIdx = findCol(headers, ["Leads"]);
    const msgConvIdx = findCol(headers, ["Messaging conversations started"]);

    // Validate
    if (adNameIdx < 0 && adIdIdx < 0) {
      throw new Error('CSV is not at AD level. Re-export from Meta Ads Manager: top tabs → Ads → Breakdown by Time → Day. Must include "Ad name" and "Ad ID" columns.');
    }
    if (campNameIdx < 0) throw new Error('CSV missing "Campaign name" column');

    if (dayIdx < 0) {
      if (startIdx >= 0 && endIdx >= 0 && rows[1] && rows[1][startIdx] !== rows[1][endIdx]) {
        throw new Error('CSV is aggregated. Re-export with "Day" time breakdown enabled.');
      }
    }

    // Each row already at ad-day granularity (no aggregation needed)
    const insights = [];
    let skippedNoSpend = 0;
    let skippedNoData = 0;

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.every((x) => !x)) continue;

      const dateRaw = dayIdx >= 0 ? r[dayIdx] : r[startIdx];
      const date = normalizeDate(dateRaw);
      if (!date) {
        skippedNoData++;
        continue;
      }

      const adName = (r[adNameIdx] || "").trim();
      const adId = adIdIdx >= 0 ? (r[adIdIdx] || "").trim() : adName;
      if (!adName && !adId) {
        skippedNoData++;
        continue;
      }

      const spend = num(r[spendIdx]);
      const impressions = Math.round(num(r[imprIdx]));
      const reach = Math.round(num(r[reachIdx]));

      if (spend === 0 && impressions === 0 && reach === 0) {
        skippedNoSpend++;
        continue;
      }

      const campaignName = (r[campNameIdx] || "").trim();
      const campaignId = campIdIdx >= 0 ? (r[campIdIdx] || "").trim() : campaignName;
      const adSetName = adsetNameIdx >= 0 ? (r[adsetNameIdx] || "").trim() : "";
      const adSetId = adsetIdIdx >= 0 ? (r[adsetIdIdx] || "").trim() : "";
      const objective = objectiveIdx >= 0 ? (r[objectiveIdx] || "").trim() : "";
      const status = statusIdx >= 0 ? (r[statusIdx] || "").trim() : "";

      const formLeads = num(r[leadsIdx]);
      const msgConvs = num(r[msgConvIdx]);
      const leads = Math.round(formLeads + msgConvs);

      const frequency = num(r[freqIdx]);
      const clicks = Math.round(num(r[clicksIdx]));
      const cpm = num(r[cpmIdx]);
      const ctr = num(r[ctrIdx]);
      const cpc = num(r[cpcIdx]);
      const cpl = leads > 0 ? spend / leads : 0;

      const type = classifyCampaign(objective, campaignName);

      insights.push({
        date,
        campaignId,
        campaignName,
        adSetId,
        adSetName,
        adId,
        adName,
        objective,
        type,
        status,
        spend: Math.round(spend * 100) / 100,
        impressions,
        reach,
        frequency: Math.round(frequency * 100000) / 100000,
        clicks,
        cpm: Math.round(cpm * 100) / 100,
        ctr: Math.round(ctr * 100) / 100,
        cpc: Math.round(cpc * 100) / 100,
        leads,
        costPerLead: Math.round(cpl * 100) / 100,
      });
    }

    insights.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.adName < b.adName ? -1 : 1;
    });

    const CHUNK = 250;
    let written = 0;
    let deleted = 0;
    for (let i = 0; i < insights.length; i += CHUNK) {
      const batch = insights.slice(i, i + CHUNK);
      const result = await upsertInsightRows(batch);
      written += result.written || 0;
      deleted += result.deleted || 0;
    }

    const totalSpend = insights.reduce((s, r) => s + r.spend, 0);
    const totalLeads = insights.reduce((s, r) => s + r.leads, 0);
    const dates = [...new Set(insights.map((r) => r.date))].sort();
    const byType = insights.reduce((m, r) => {
      m[r.type] = (m[r.type] || 0) + 1;
      return m;
    }, {});

    return {
      statusCode: 200,
      body: JSON.stringify(
        {
          ok: true,
          summary: {
            adRowsWritten: written,
            adRowsReplaced: deleted,
            uniqueAds: new Set(insights.map((r) => r.adId)).size,
            uniqueAdSets: new Set(insights.map((r) => r.adSetId)).size,
            uniqueCampaigns: new Set(insights.map((r) => r.campaignId)).size,
            dateRange: dates.length ? `${dates[0]} → ${dates[dates.length - 1]}` : "n/a",
            totalSpend: totalSpend.toFixed(2),
            totalLeads,
            byType,
            skippedNoSpend,
            skippedNoData,
          },
        },
        null,
        2
      ),
    };
  } catch (err) {
    console.error("[import-csv] ERROR:", err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
