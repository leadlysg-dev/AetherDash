const fetch = require("node-fetch");
const Anthropic = require("@anthropic-ai/sdk");
const { CONFIG } = require("./config");
const { getSheetsClient } = require("./sheets-writer");

// ============================================================
// DIAGNOSTIC — checks all env vars + API connections
// Hit /api/diagnostic to verify everything is wired up
// ============================================================

exports.handler = async () => {
  const checks = {};

  // Meta
  try {
    if (!CONFIG.meta.accessToken) throw new Error("META_ACCESS_TOKEN missing");
    if (!CONFIG.meta.adAccountId) throw new Error("META_AD_ACCOUNT_ID missing");
    const url = `https://graph.facebook.com/${CONFIG.meta.apiVersion}/${CONFIG.meta.adAccountId}?fields=name,account_status&access_token=${CONFIG.meta.accessToken}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    checks.meta = { ok: true, accountName: data.name, status: data.account_status };
  } catch (err) {
    checks.meta = { ok: false, error: err.message };
  }

  // Google Sheets
  try {
    const sheets = await getSheetsClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId: CONFIG.google.sheetId });
    checks.sheets = {
      ok: true,
      title: meta.data.properties.title,
      tabs: meta.data.sheets.map((s) => s.properties.title),
    };
  } catch (err) {
    checks.sheets = { ok: false, error: err.message };
  }

  // Anthropic
  try {
    if (!CONFIG.anthropic.apiKey) throw new Error("ANTHROPIC_API_KEY missing");
    const client = new Anthropic({ apiKey: CONFIG.anthropic.apiKey });
    const msg = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 20,
      messages: [{ role: "user", content: "Say 'ok' and nothing else." }],
    });
    checks.anthropic = { ok: true, response: msg.content[0].text };
  } catch (err) {
    checks.anthropic = { ok: false, error: err.message };
  }

  // Telegram
  try {
    if (!CONFIG.telegram.botToken) throw new Error("TELEGRAM_BOT_TOKEN missing");
    if (!CONFIG.telegram.chatId) throw new Error("TELEGRAM_CHAT_ID missing");
    const res = await fetch(
      `https://api.telegram.org/bot${CONFIG.telegram.botToken}/getMe`
    );
    const data = await res.json();
    if (!data.ok) throw new Error(JSON.stringify(data));
    checks.telegram = { ok: true, botName: data.result.username };
  } catch (err) {
    checks.telegram = { ok: false, error: err.message };
  }

  const allOk = Object.values(checks).every((c) => c.ok);

  return {
    statusCode: allOk ? 200 : 500,
    body: JSON.stringify({ allOk, checks }, null, 2),
  };
};
