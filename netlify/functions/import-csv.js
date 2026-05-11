const { upsertInsightRows } = require("./sheets-writer");
const { classifyCampaign } = require("./config");

// ============================================================
// /api/import-csv — Meta CSV with Day breakdown (campaign level)
// Aggregates ad-set or ad-level rows up to campaign × day
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
    const dayIdx = findCol(headers, ["Day"]);
    const startIdx = findCol(headers, ["Reporting starts"]);
    const endIdx = findCol(headers, ["Reporting ends"]);
    const campIdIdx = findCol(headers, ["Campaign ID"]);
    const campNameIdx = findCol(headers, ["Campaign name", "Campaign Name"]);
    const objectiveIdx = findCol(headers, ["Objective"]);
    const statusIdx = findCol(headers, ["Campaign delivery", "Delivery", "Ad set delivery", "Ad delivery"]);
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

    if (campNameIdx < 0) throw new Error('CSV missing "Campaign name" column');

    if (dayIdx < 0) {
      const sample = rows[1];
      if (startIdx >= 0 && endIdx >= 0 && sample && sample[startIdx] !== sample[endIdx]) {
        throw new Error('CSV is aggregated. Re-export with "Day" time breakdown enabled.');
      }
    }

    // Group by (date, campaignId) — aggregates ad-set/ad rows up to campaign × day
    const grouped = new Map();

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.every((x) => !x)) continue;

      const dateRaw = dayIdx >= 0 ? r[dayIdx] : r[startIdx];
      const date = normalizeDate(dateRaw);
      if (!date) continue;

      const campaignName = (r[campNameIdx] || "").trim();
      if (!campaignName) continue;
      const campaignId = campIdIdx >= 0 ? (r[campIdIdx] || "").trim() : campaignName;
      const key = `${date}|${campaignId}`;

      if (!grouped.has(key)) {
        grouped.set(key, {
          date,
          campaignId,
          campaignName,
          objective: objectiveIdx >= 0 ? (r[objectiveIdx] || "").trim() : "",
          status: statusIdx >= 0 ? (r[statusIdx] || "").trim() : "",
          spend: 0,
          impressions: 0,
          reach: 0,
          freqSum: 0,
          freqCount: 0,
          clicks: 0,
          leads: 0,
        });
      }

      const g = grouped.get(key);
      g.spend += num(r[spendIdx]);
      g.impressions += num(r[imprIdx]);
      g.reach += num(r[reachIdx]);
      const f = num(r[freqIdx]);
      if (f > 0) {
        g.freqSum += f;
        g.freqCount++;
      }
      g.clicks += num(r[clicksIdx]);
      g.leads += num(r[leadsIdx]);
      g.leads += num(r[msgConvIdx]);
    }

    const insights = [];
    for (const g of grouped.values()) {
      if (g.spend === 0 && g.impressions === 0 && g.reach === 0) continue;

      const cpm = g.impressions > 0 ? (g.spend / g.impressions) * 1000 : 0;
      const ctr = g.impressions > 0 ? (g.clicks / g.impressions) * 100 : 0;
      const cpc = g.clicks > 0 ? g.spend / g.clicks : 0;
      const cpl = g.leads > 0 ? g.spend / g.leads : 0;
      const freq = g.freqCount > 0 ? g.freqSum / g.freqCount : 0;
      const type = classifyCampaign(g.objective, g.campaignName);

      insights.push({
        date: g.date,
        campaignId: g.campaignId,
        campaignName: g.campaignName,
        objective: g.objective,
        type,
        status: g.status || "ACTIVE",
        spend: Math.round(g.spend * 100) / 100,
        impressions: Math.round(g.impressions),
        reach: Math.round(g.reach),
        frequency: Math.round(freq * 100000) / 100000,
        clicks: Math.round(g.clicks),
        cpm: Math.round(cpm * 100) / 100,
        ctr: Math.round(ctr * 100) / 100,
        cpc: Math.round(cpc * 100) / 100,
        leads: Math.round(g.leads),
        costPerLead: Math.round(cpl * 100) / 100,
      });
    }

    insights.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.campaignName < b.campaignName ? -1 : 1;
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
            rowsWritten: written,
            rowsReplaced: deleted,
            uniqueCampaigns: new Set(insights.map((r) => r.campaignId)).size,
            dateRange: dates.length ? `${dates[0]} → ${dates[dates.length - 1]}` : "n/a",
            totalSpend: totalSpend.toFixed(2),
            totalLeads,
            byType,
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
