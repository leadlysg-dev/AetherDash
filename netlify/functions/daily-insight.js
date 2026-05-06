const Anthropic = require("@anthropic-ai/sdk");
const fetch = require("node-fetch");
const { readMetaData } = require("./sheets-writer");
const { CONFIG, getYesterdaySGT } = require("./config");

// ============================================================
// DAILY INSIGHT — runs at 7:30am SGT (23:30 UTC previous day)
// Reads recent Meta data → Claude analyses → sends Telegram briefing
// ============================================================

function fmt(n, type = "number") {
  if (n === null || n === undefined || isNaN(n)) return "—";
  if (type === "currency") return `$${parseFloat(n).toFixed(2)}`;
  if (type === "percent") return `${parseFloat(n).toFixed(2)}%`;
  if (type === "int") return Math.round(parseFloat(n)).toLocaleString();
  return parseFloat(n).toFixed(2);
}

function pctChange(curr, prev) {
  if (!prev || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

function fmtChange(pct) {
  if (pct === null || isNaN(pct)) return "";
  const arrow = pct >= 0 ? "🔺" : "🔻";
  return ` ${arrow} ${Math.abs(pct).toFixed(1)}%`;
}

function rowsToObjects(rows) {
  // rows[0] is headers, rest are data
  if (!rows || rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = r[i];
    });
    return obj;
  });
}

async function generateInsight(yesterdayData, prev7DaysData) {
  const client = new Anthropic({ apiKey: CONFIG.anthropic.apiKey });

  const summary = `
Yesterday (${yesterdayData.Date}):
- Spend: $${yesterdayData.Spend}
- Impressions: ${yesterdayData.Impressions}
- Clicks: ${yesterdayData.Clicks}
- CTR: ${yesterdayData.CTR}%
- CPC: $${yesterdayData.CPC}
- CPM: $${yesterdayData.CPM}
- Conversions: ${yesterdayData.Conversions}
- Cost per conversion: $${yesterdayData["Cost Per Conversion"]}

Previous 7 days context:
${prev7DaysData
  .map(
    (d) =>
      `- ${d.Date}: spend $${d.Spend}, clicks ${d.Clicks}, CTR ${d.CTR}%, conv ${d.Conversions}`
  )
  .join("\n")}
`;

  const msg = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 400,
    messages: [
      {
        role: "user",
        content: `You are an ad performance analyst for Aether Athletics. Look at yesterday's Meta Ads numbers vs the past week and write a SHORT briefing — 3-4 bullet points max. Highlight what changed, what's working, what needs attention. Be specific with numbers. No fluff. Use plain text (no markdown, no asterisks).

${summary}`,
      },
    ],
  });

  return msg.content[0].text.trim();
}

function buildTelegramMessage(yesterday, prevDay, insight) {
  const date = yesterday.Date;

  const spendChange = pctChange(parseFloat(yesterday.Spend), parseFloat(prevDay?.Spend));
  const clicksChange = pctChange(parseFloat(yesterday.Clicks), parseFloat(prevDay?.Clicks));
  const ctrChange = pctChange(parseFloat(yesterday.CTR), parseFloat(prevDay?.CTR));
  const cpcChange = pctChange(parseFloat(yesterday.CPC), parseFloat(prevDay?.CPC));
  const convChange = pctChange(
    parseFloat(yesterday.Conversions),
    parseFloat(prevDay?.Conversions)
  );

  return `📊 *Aether Athletics — Daily Briefing*
_${date}_

*Yesterday's KPIs (Meta)*
💰 Spend: ${fmt(yesterday.Spend, "currency")}${fmtChange(spendChange)}
👀 Impressions: ${fmt(yesterday.Impressions, "int")}
🖱 Clicks: ${fmt(yesterday.Clicks, "int")}${fmtChange(clicksChange)}
📈 CTR: ${fmt(yesterday.CTR, "percent")}${fmtChange(ctrChange)}
💵 CPC: ${fmt(yesterday.CPC, "currency")}${fmtChange(cpcChange)}
🎯 Conversions: ${fmt(yesterday.Conversions, "int")}${fmtChange(convChange)}
💸 CPA: ${fmt(yesterday["Cost Per Conversion"], "currency")}

*AI Insight*
${insight}`;
}

async function sendTelegram(text) {
  const { botToken, chatId } = CONFIG.telegram;
  if (!botToken || !chatId) {
    throw new Error("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID env var is missing");
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Telegram error: ${JSON.stringify(data)}`);
  }
  return data;
}

exports.handler = async (event) => {
  try {
    const preview = event.queryStringParameters?.preview === "true";
    const targetDate = event.queryStringParameters?.date || getYesterdaySGT();

    console.log(`[daily-insight] Generating briefing for ${targetDate}`);

    const rows = await readMetaData();
    const data = rowsToObjects(rows);

    const yesterday = data.find((d) => d.Date === targetDate);
    if (!yesterday) {
      throw new Error(`No data found in sheet for ${targetDate}. Run daily-pull first.`);
    }

    // Sort by date descending, get previous day + last 7 days
    const sorted = [...data].sort((a, b) => (a.Date < b.Date ? 1 : -1));
    const yesterdayIdx = sorted.findIndex((d) => d.Date === targetDate);
    const prevDay = sorted[yesterdayIdx + 1] || null;
    const prev7 = sorted.slice(yesterdayIdx + 1, yesterdayIdx + 8);

    const insight = await generateInsight(yesterday, prev7);
    const message = buildTelegramMessage(yesterday, prevDay, insight);

    if (preview) {
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, preview: true, message, insight }, null, 2),
      };
    }

    const tgResult = await sendTelegram(message);

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, sent: true, telegramMessageId: tgResult.result?.message_id }),
    };
  } catch (err) {
    console.error("[daily-insight] ERROR:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};

// Scheduled: every day at 23:30 UTC = 7:30am SGT (30 min after daily-pull)
exports.config = {
  schedule: "30 23 * * *",
};
