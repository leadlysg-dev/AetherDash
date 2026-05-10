const Anthropic = require("@anthropic-ai/sdk");
const fetch = require("node-fetch");
const { readMetaData } = require("./sheets-writer");
const { CONFIG, getDateSGT, getYesterdaySGT } = require("./config");

// ============================================================
// DAILY TELEGRAM BRIEFING — gym-owner voice
// Status-aware: ACTIVE vs PAUSED lead campaigns
// Runs at 7:30am SGT
// ============================================================

function rowsToObjects(rows) {
  if (!rows || rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map((r) => {
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
}

function fmtMoney(n) {
  if (n === null || isNaN(n)) return "—";
  return `$${Math.round(parseFloat(n)).toLocaleString()}`;
}
function fmtMoneyDec(n) {
  if (n === null || isNaN(n)) return "—";
  return `$${parseFloat(n).toFixed(2)}`;
}
function fmtPct(n, decimals = 1) {
  if (n === null || isNaN(n)) return "—";
  return `${parseFloat(n).toFixed(decimals)}%`;
}
function fmtNum(n) {
  if (n === null || isNaN(n)) return "—";
  return Math.round(parseFloat(n)).toLocaleString();
}

function escMD(text) {
  // Escape characters that conflict with Telegram Markdown V1
  if (!text) return "";
  return String(text).replace(/([_*`[\]])/g, "\\$1");
}

// Detect lead campaign runs from rows
function detectLeadCampaignRuns(rows) {
  const leadRows = rows.filter((r) => r.Type === "Leads" && r.Spend > 0);
  const byCamp = new Map();
  for (const r of leadRows) {
    const k = r["Campaign ID"];
    if (!byCamp.has(k)) byCamp.set(k, []);
    byCamp.get(k).push(r);
  }
  const runs = [];
  for (const [, days] of byCamp) {
    days.sort((a, b) => (a.Date < b.Date ? -1 : 1));
    let cur = null;
    for (const d of days) {
      if (!cur) {
        cur = newRun(d);
      } else {
        const gap = (new Date(d.Date) - new Date(cur.endDate)) / (1000 * 60 * 60 * 24);
        if (gap > 3) {
          runs.push(finalize(cur));
          cur = newRun(d);
        } else {
          cur.endDate = d.Date;
        }
      }
      cur.spend += d.Spend;
      cur.leads += d.Leads;
      cur.impressions += d.Impressions;
      cur.clicks += d.Clicks;
      cur.reach = Math.max(cur.reach, d.Reach);
    }
    if (cur) runs.push(finalize(cur));
  }
  runs.sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  return runs;

  function newRun(d) {
    return {
      campaignId: d["Campaign ID"],
      campaignName: d["Campaign Name"],
      startDate: d.Date,
      endDate: d.Date,
      spend: 0,
      leads: 0,
      impressions: 0,
      clicks: 0,
      reach: 0,
    };
  }
  function finalize(r) {
    const start = new Date(r.startDate);
    const end = new Date(r.endDate);
    r.days = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
    r.cpl = r.leads > 0 ? r.spend / r.leads : 0;
    return r;
  }
}

async function generateInsight(state) {
  const client = new Anthropic({ apiKey: CONFIG.anthropic.apiKey });

  const ctx = {
    targetCPL: CONFIG.business.targetCPL,
    targetBudget: CONFIG.business.leadsCampaignBudget,
    targetDays: CONFIG.business.leadsCampaignDays,
    yesterday: state.yesterday,
    last7BA: state.last7BA,
    activeLead: state.activeLead,
    recentRuns: state.recentRuns,
    daysSinceLastLeadCamp: state.daysSinceLastLeadCamp,
  };

  const prompt = `You are an ad performance analyst for Aether Athletics, a gym in Singapore. The owner is in his 2nd year running Meta ads. He runs two campaign types:
1. BRAND AWARENESS (BA) — always-on, no specific target, focused on reach/impressions
2. LEAD CAMPAIGNS — runs for ~${ctx.targetDays} days at ~$${ctx.targetBudget} budget, then pauses for a while. Target cost per lead: $${ctx.targetCPL}

Write a SHORT briefing — 3 punchy bullet points max (max 200 words total). Talk like a fellow ad pro to the gym owner: direct, specific with numbers, focused on what matters NOW. No fluff, no greetings, no markdown asterisks. Plain text only.

Yesterday's data:
- BA spend: $${ctx.yesterday.baSpend?.toFixed(2) || 0}, reach ${ctx.yesterday.baReach || 0}, impressions ${ctx.yesterday.baImpressions || 0}
- Leads spend: $${ctx.yesterday.leadsSpend?.toFixed(2) || 0}, leads ${ctx.yesterday.leads || 0}, CPL $${ctx.yesterday.cpl?.toFixed(2) || 0}

Last 7 days BA: spend $${ctx.last7BA.spend?.toFixed(2) || 0}, reach ${ctx.last7BA.reach || 0}

${
  ctx.activeLead
    ? `ACTIVE LEAD CAMPAIGN: "${ctx.activeLead.campaignName}" — Day ${ctx.activeLead.days}, spent $${ctx.activeLead.spend.toFixed(2)} of $${ctx.targetBudget}, ${ctx.activeLead.leads} leads at $${ctx.activeLead.cpl.toFixed(2)} CPL (target $${ctx.targetCPL}). ${ctx.activeLead.cpl > ctx.targetCPL ? "OVER target." : "UNDER target."}`
    : `NO active lead campaign. Last one ended ${ctx.daysSinceLastLeadCamp} days ago.`
}

Recent lead campaigns: ${ctx.recentRuns
    .slice(0, 3)
    .map(
      (r) =>
        `${r.startDate.slice(5)}→${r.endDate.slice(5)} ($${r.spend.toFixed(0)}, ${r.leads} leads, $${r.cpl.toFixed(0)} CPL)`
    )
    .join("; ") || "none"}

Write the 3 bullets now. Lead with the most actionable thing.`;

  const msg = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 400,
    messages: [{ role: "user", content: prompt }],
  });

  return msg.content[0].text.trim();
}

function buildMessage(state, insight) {
  const { yesterday, activeLead, daysSinceLastLeadCamp, last7BA } = state;
  const dateStr = state.targetDate;

  let header = `🏋️ *Aether Athletics — Daily Briefing*\n_${dateStr}_\n\n`;

  // Status banner
  let status;
  if (activeLead) {
    const overUnder =
      activeLead.cpl > 0
        ? activeLead.cpl > CONFIG.business.targetCPL
          ? `🔺 ${fmtMoneyDec(activeLead.cpl)} CPL (over $${CONFIG.business.targetCPL})`
          : `✅ ${fmtMoneyDec(activeLead.cpl)} CPL (under $${CONFIG.business.targetCPL})`
        : `${fmtMoneyDec(0)} CPL`;
    status = `*Status: 🟢 LEAD CAMPAIGN ACTIVE*
_${escMD(activeLead.campaignName)}_
Day ${activeLead.days} · ${fmtMoney(activeLead.spend)}/${fmtMoney(CONFIG.business.leadsCampaignBudget)} spent (${Math.round((activeLead.spend / CONFIG.business.leadsCampaignBudget) * 100)}%)
${activeLead.leads} leads · ${overUnder}`;
  } else {
    status = `*Status: ⚪️ NO ACTIVE LEAD CAMPAIGN*
Last ended ${daysSinceLastLeadCamp} days ago`;
  }

  // Yesterday section
  let yest = `\n\n*Yesterday*
🎯 BA: ${fmtMoney(yesterday.baSpend)} spent · ${fmtNum(yesterday.baReach)} reach · ${fmtNum(yesterday.baImpressions)} imp`;

  if (activeLead || yesterday.leadsSpend > 0) {
    yest += `\n🎣 Leads: ${fmtMoney(yesterday.leadsSpend)} spent · ${yesterday.leads || 0} leads · ${
      yesterday.leads > 0 ? fmtMoneyDec(yesterday.cpl) : "—"
    } CPL`;
  }

  // 7-day BA context
  yest += `\n\n*Last 7 days (BA)*
${fmtMoney(last7BA.spend)} · ${fmtNum(last7BA.reach)} reach · ${fmtNum(last7BA.impressions)} imp`;

  // AI insight
  const ai = `\n\n*Take*\n${insight}`;

  // Dashboard link if available
  const dashLink = CONFIG.business.dashboardUrl
    ? `\n\n[View dashboard →](${CONFIG.business.dashboardUrl})`
    : "";

  return header + status + yest + ai + dashLink;
}

async function sendTelegram(text) {
  const { botToken, chatId } = CONFIG.telegram;
  if (!botToken || !chatId) {
    throw new Error("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID env var is missing");
  }
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram: ${JSON.stringify(data)}`);
  return data;
}

exports.handler = async (event) => {
  try {
    const preview = event.queryStringParameters?.preview === "true";
    const targetDate = event.queryStringParameters?.date || getYesterdaySGT();

    const rows = await readMetaData();
    const all = rowsToObjects(rows);

    if (!all.length) {
      throw new Error("No data in sheet. Run /api/daily-pull first.");
    }

    // Yesterday's split
    const yRows = all.filter((r) => r.Date === targetDate);
    const yBA = yRows.filter((r) => r.Type === "BA");
    const yLeads = yRows.filter((r) => r.Type === "Leads");

    const yesterday = {
      baSpend: yBA.reduce((s, r) => s + r.Spend, 0),
      baImpressions: yBA.reduce((s, r) => s + r.Impressions, 0),
      baReach: yBA.reduce((s, r) => s + r.Reach, 0),
      leadsSpend: yLeads.reduce((s, r) => s + r.Spend, 0),
      leads: yLeads.reduce((s, r) => s + r.Leads, 0),
      cpl: 0,
    };
    yesterday.cpl =
      yesterday.leads > 0 ? yesterday.leadsSpend / yesterday.leads : 0;

    // Last 7 days BA
    const targetD = new Date(targetDate);
    const start7 = new Date(targetD);
    start7.setUTCDate(start7.getUTCDate() - 6);
    const start7Str = start7.toISOString().split("T")[0];
    const last7Rows = all.filter(
      (r) => r.Date >= start7Str && r.Date <= targetDate && r.Type === "BA"
    );
    const last7BA = {
      spend: last7Rows.reduce((s, r) => s + r.Spend, 0),
      impressions: last7Rows.reduce((s, r) => s + r.Impressions, 0),
      reach: last7Rows.reduce((s, r) => s + r.Reach, 0),
    };

    // Lead campaign analysis
    const runs = detectLeadCampaignRuns(all);
    let activeLead = null;
    let daysSinceLastLeadCamp = null;
    if (runs.length) {
      const newest = runs[0];
      const tDate = new Date(targetDate);
      const lastEndDate = new Date(newest.endDate);
      const daysSince = Math.floor((tDate - lastEndDate) / (1000 * 60 * 60 * 24));
      if (daysSince <= CONFIG.business.activeWindowDays) {
        activeLead = newest;
      } else {
        daysSinceLastLeadCamp = daysSince;
      }
    }

    const state = {
      targetDate,
      yesterday,
      last7BA,
      activeLead,
      daysSinceLastLeadCamp,
      recentRuns: runs,
    };

    const insight = await generateInsight(state);
    const message = buildMessage(state, insight);

    if (preview) {
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, preview: true, message, state }, null, 2),
      };
    }

    const tgResult = await sendTelegram(message);

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        sent: true,
        telegramMessageId: tgResult.result?.message_id,
      }),
    };
  } catch (err) {
    console.error("[daily-insight] ERROR:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};

// Scheduled: Monday 8:00am SGT only (00:00 UTC Monday)
exports.config = {
  schedule: "0 0 * * 1",
};
