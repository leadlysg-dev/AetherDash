const { google } = require("googleapis");
const { CONFIG, getServiceAccountCredentials } = require("./config");

// ============================================================
// GOOGLE SHEETS WRITER
// Handles auth, ensures tab exists, upserts rows by date
// ============================================================

async function getSheetsClient() {
  const creds = getServiceAccountCredentials();
  const auth = new google.auth.JWT(
    creds.client_email,
    null,
    creds.private_key,
    ["https://www.googleapis.com/auth/spreadsheets"]
  );
  await auth.authorize();
  return google.sheets({ version: "v4", auth });
}

async function ensureTabExists(sheets, sheetId, tabName, headers) {
  // Check if tab already exists
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const exists = meta.data.sheets.some((s) => s.properties.title === tabName);

  if (!exists) {
    // Create the tab
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: { title: tabName },
            },
          },
        ],
      },
    });

    // Add header row
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${tabName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
  }
}

async function upsertRowByDate(sheets, sheetId, tabName, dateStr, rowValues) {
  // Read existing dates (column A) to find if this date already has a row
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${tabName}!A:A`,
  });

  const existing = res.data.values || [];
  let foundRowIndex = -1;
  for (let i = 1; i < existing.length; i++) {
    // skip header row at i=0
    if (existing[i][0] === dateStr) {
      foundRowIndex = i + 1; // 1-indexed for Sheets
      break;
    }
  }

  if (foundRowIndex > 0) {
    // Update existing row
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${tabName}!A${foundRowIndex}`,
      valueInputOption: "RAW",
      requestBody: { values: [rowValues] },
    });
    return { action: "updated", row: foundRowIndex };
  } else {
    // Append new row
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${tabName}!A:A`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [rowValues] },
    });
    return { action: "appended" };
  }
}

async function readAllRows(sheets, sheetId, tabName) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${tabName}!A:Z`,
  });
  return res.data.values || [];
}

async function writeMetaRow(insights) {
  const sheets = await getSheetsClient();
  const tabName = CONFIG.sheet.metaTab;

  await ensureTabExists(sheets, CONFIG.google.sheetId, tabName, CONFIG.sheet.headers);

  const row = [
    insights.date,
    insights.spend,
    insights.impressions,
    insights.clicks,
    insights.cpm,
    insights.ctr,
    insights.cpc,
    insights.conversions,
    insights.costPerConversion,
  ];

  return upsertRowByDate(sheets, CONFIG.google.sheetId, tabName, insights.date, row);
}

async function readMetaData() {
  const sheets = await getSheetsClient();
  const tabName = CONFIG.sheet.metaTab;
  return readAllRows(sheets, CONFIG.google.sheetId, tabName);
}

module.exports = { writeMetaRow, readMetaData, getSheetsClient };
