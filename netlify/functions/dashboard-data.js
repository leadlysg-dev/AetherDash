const { readMetaData } = require("./sheets-writer");
const { CONFIG, getDateSGT } = require("./config");

// ============================================================
// DASHBOARD DATA API — feeds the frontend dashboard
// /api/dashboard-data?days=30
// ============================================================

function rowsToObjects(rows) {
  if (!rows || rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, i) => {
      const v = r[i];
      // Numeric columns
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
}

// Group rows by date, summing across campaigns of a given type
function aggregateByDate(rows, typeFilter = null) {
  const filtered = typeFilter ? rows.filter((r) => r.Type === typeFilter) : rows;
  const map = new Map();
  for (const r of filtered) {
    const d = r.Date;
    if (!map.has(d)) {
      map.set(d, {
        date: d,
        spend: 0,
        impressions: 0,
        reach: 0,
        clicks: 0,
        leads: 0,
        campaigns: new Set(),
      });
    }
    const agg = map.get(d);
    agg.spend += r.Spend;
    agg.impressions += r.Impressions;
    agg.reach += r.Reach;
    agg.clicks += r.Clicks;
    agg.leads += r.Leads;
    agg.campaigns.add(r["Campaign ID"]);
  }
  // Compute derived metrics
  return Array.from(map.values())
    .map((a) => ({
      date: a.date,
      spend: a.spend,
      impressions: a.impressions,
      reach: a.reach,
      clicks: a.clicks,
      leads: a.leads,
      ctr: a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0,
      cpc: a.clicks > 0 ? a.spend / a.clicks : 0,
      cpm: a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0,
      cpl: a.leads > 0 ? a.spend / a.leads : 0,
      campaignCount: a.campaigns.size,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Detect lead campaign "runs" — contiguous date blocks of spend per campaign
function detectLeadCampaignRuns(rows) {
  const leadRows = rows.filter((r) => r.Type === "Leads" && r.Spend > 0);

  // Group by campaign id
  const byCamp = new Map();
  for (const r of leadRows) {
    if (!byCamp.has(r["Campaign ID"])) {
      byCamp.set(r["Campaign ID"], {
        campaignId: r["Campaign ID"],
        campaignName: r["Campaign Name"],
        days: [],
      });
    }
    byCamp.get(r["Campaign ID"]).days.push(r);
  }

  // For each campaign, detect contiguous runs (gap > 2 days = new run)
  const runs = [];
  for (const [, camp] of byCamp) {
    camp.days.sort((a, b) => (a.Date < b.Date ? -1 : 1));
    let currentRun = null;
    for (const d of camp.days) {
      const dDate = new Date(d.Date);
      if (!currentRun) {
        currentRun = {
          campaignId: camp.campaignId,
          campaignName: camp.campaignName,
          startDate: d.Date,
          endDate: d.Date,
          spend: 0,
          leads: 0,
          impressions: 0,
          clicks: 0,
          reach: 0,
          days: 0,
        };
      } else {
        const gap = (dDate - new Date(currentRun.endDate)) / (1000 * 60 * 60 * 24);
        if (gap > 3) {
          runs.push(finishRun(currentRun));
          currentRun = {
            campaignId: camp.campaignId,
            campaignName: camp.campaignName,
            startDate: d.Date,
            endDate: d.Date,
            spend: 0,
            leads: 0,
            impressions: 0,
            clicks: 0,
            reach: 0,
            days: 0,
          };
        } else {
          currentRun.endDate = d.Date;
        }
      }
      currentRun.spend += d.Spend;
      currentRun.leads += d.Leads;
      currentRun.impressions += d.Impressions;
      currentRun.clicks += d.Clicks;
      currentRun.reach = Math.max(currentRun.reach, d.Reach);
    }
    if (currentRun) runs.push(finishRun(currentRun));
  }

  // Sort by start date desc
  runs.sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  return runs;

  function finishRun(r) {
    const start = new Date(r.startDate);
    const end = new Date(r.endDate);
    r.days = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
    r.cpl = r.leads > 0 ? r.spend / r.leads : 0;
    r.ctr = r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0;
    return r;
  }
}

// Detect if there's an ACTIVE lead campaign — spent in last N days
function detectActiveLeadCampaign(runs, activeWindowDays) {
  if (!runs.length) return null;
  const newest = runs[0];
  const today = new Date();
  const lastDay = new Date(newest.endDate);
  const daysSinceLastSpend = Math.floor((today - lastDay) / (1000 * 60 * 60 * 24));
  if (daysSinceLastSpend <= activeWindowDays) {
    return {
      ...newest,
      daysSinceLastSpend,
      // Pace info
      budget: CONFIG.business.leadsCampaignBudget,
      spendPct: (newest.spend / CONFIG.business.leadsCampaignBudget) * 100,
      targetCPL: CONFIG.business.targetCPL,
      cplVsTarget:
        newest.cpl > 0
          ? ((newest.cpl - CONFIG.business.targetCPL) / CONFIG.business.targetCPL) * 100
          : 0,
    };
  }
  return null;
}

function summarize(periodRows) {
  return periodRows.reduce(
    (s, r) => ({
      spend: s.spend + r.Spend,
      impressions: s.impressions + r.Impressions,
      reach: s.reach + r.Reach,
      clicks: s.clicks + r.Clicks,
      leads: s.leads + r.Leads,
    }),
    { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0 }
  );
}

function pct(curr, prev) {
  if (!prev || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

exports.handler = async (event) => {
  try {
    const days = parseInt(event.queryStringParameters?.days || "30", 10);
    const startDate = event.queryStringParameters?.start;
    const endDate = event.queryStringParameters?.end;

    const rows = await readMetaData();
    const all = rowsToObjects(rows);

    if (!all.length) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: true,
          empty: true,
          message: "No data in sheet yet. Run /api/daily-pull first.",
        }),
      };
    }

    // Determine period
    const today = getDateSGT(0);
    let from, to;
    if (startDate && endDate) {
      from = startDate;
      to = endDate;
    } else {
      to = getDateSGT(1); // yesterday
      from = getDateSGT(days);
    }

    const periodRows = all.filter((r) => r.Date >= from && r.Date <= to);

    // Previous period (for delta)
    const periodLength =
      (new Date(to) - new Date(from)) / (1000 * 60 * 60 * 24) + 1;
    const prevTo = new Date(from);
    prevTo.setUTCDate(prevTo.getUTCDate() - 1);
    const prevFrom = new Date(prevTo);
    prevFrom.setUTCDate(prevFrom.getUTCDate() - periodLength + 1);
    const prevToStr = prevTo.toISOString().split("T")[0];
    const prevFromStr = prevFrom.toISOString().split("T")[0];
    const prevPeriodRows = all.filter(
      (r) => r.Date >= prevFromStr && r.Date <= prevToStr
    );

    // Type-segmented data
    const baRows = periodRows.filter((r) => r.Type === "BA");
    const leadsRows = periodRows.filter((r) => r.Type === "Leads");

    const totals = summarize(periodRows);
    const baSummary = summarize(baRows);
    const leadsSummary = summarize(leadsRows);
    const prevTotals = summarize(prevPeriodRows);

    // Lead campaign runs (entire history, not just period)
    const allLeadRuns = detectLeadCampaignRuns(all);
    const activeLeads = detectActiveLeadCampaign(allLeadRuns, CONFIG.business.activeWindowDays);

    // Daily timeseries
    const dailyAll = aggregateByDate(periodRows);
    const dailyBA = aggregateByDate(periodRows, "BA");
    const dailyLeads = aggregateByDate(periodRows, "Leads");

    // Campaign breakdown for the period
    const campaignBreakdown = {};
    for (const r of periodRows) {
      const k = r["Campaign ID"];
      if (!campaignBreakdown[k]) {
        campaignBreakdown[k] = {
          campaignId: r["Campaign ID"],
          campaignName: r["Campaign Name"],
          type: r.Type,
          status: r.Status,
          objective: r.Objective,
          spend: 0,
          impressions: 0,
          reach: 0,
          clicks: 0,
          leads: 0,
          activeDays: new Set(),
        };
      }
      const c = campaignBreakdown[k];
      c.spend += r.Spend;
      c.impressions += r.Impressions;
      c.reach = Math.max(c.reach, r.Reach);
      c.clicks += r.Clicks;
      c.leads += r.Leads;
      if (r.Spend > 0) c.activeDays.add(r.Date);
    }
    const campaigns = Object.values(campaignBreakdown).map((c) => ({
      ...c,
      activeDays: c.activeDays.size,
      cpl: c.leads > 0 ? c.spend / c.leads : 0,
      ctr: c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0,
      cpm: c.impressions > 0 ? (c.spend / c.impressions) * 1000 : 0,
      cpc: c.clicks > 0 ? c.spend / c.clicks : 0,
    }));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
      body: JSON.stringify({
        ok: true,
        client: CONFIG.client.name,
        config: {
          targetCPL: CONFIG.business.targetCPL,
          leadsCampaignBudget: CONFIG.business.leadsCampaignBudget,
          leadsCampaignDays: CONFIG.business.leadsCampaignDays,
        },
        period: { from, to, days: periodLength },
        prevPeriod: { from: prevFromStr, to: prevToStr },
        summary: {
          totals,
          ba: baSummary,
          leads: {
            ...leadsSummary,
            cpl: leadsSummary.leads > 0 ? leadsSummary.spend / leadsSummary.leads : 0,
          },
          deltas: {
            spend: pct(totals.spend, prevTotals.spend),
            impressions: pct(totals.impressions, prevTotals.impressions),
            clicks: pct(totals.clicks, prevTotals.clicks),
            leads: pct(totals.leads, prevTotals.leads),
          },
        },
        activeLeadsCampaign: activeLeads,
        leadRuns: allLeadRuns,
        timeseries: { all: dailyAll, ba: dailyBA, leads: dailyLeads },
        campaigns,
        lastDataDate: all.reduce((m, r) => (r.Date > m ? r.Date : m), ""),
      }),
    };
  } catch (err) {
    console.error("[dashboard-data] ERROR:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
