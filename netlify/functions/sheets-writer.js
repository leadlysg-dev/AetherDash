const { google } = require("googleapis");
const { CONFIG, getServiceAccountCredentials } = require("./config");

// ============================================================
// SHEETS WRITER — campaign-level (one row per campaign per day)
// ============================================================

async function getSheetsClient() {
  const creds = getServiceAccountCredentials();
  const auth = new google.auth.JWT(creds.client_email, null, creds.private_key, [
    "https://www.googleapis.com/auth/spreadsheets",
  ]);
  await auth.authorize();
  return google.sheets({ version: "v4", auth });
}

async function ensureTabExists(sheets, sheetId, tabName, headers) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const exists = meta.data.sheets.some((s) => s.properties.title === tabName);

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: tabName } } }],
      },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${tabName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
  }
}

// Returns all rows including header
async function readAll(sheets, sheetId, tabName) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${tabName}!A:Z`,
  });
  return res.data.values || [];
}

function rowFromInsight(i) {
  return [
    i.date,
    i.campaignId,
    i.campaignName,
    i.adSetId,
    i.adSetName,
    i.adId,
    i.adName,
    i.objective,
    i.type,
    i.status,
    i.spend,
    i.impressions,
    i.reach,
    i.frequency,
    i.clicks,
    i.cpm,
    i.ctr,
    i.cpc,
    i.leads,
    i.costPerLead,
  ];
}

// Upsert by composite key Date + Ad ID (column A + column F)
async function upsertInsightRows(insights) {
  if (!insights.length) return { written: 0, deleted: 0, written_rows: 0 };

  const sheets = await getSheetsClient();
  const tabName = CONFIG.sheet.metaTab;
  await ensureTabExists(sheets, CONFIG.google.sheetId, tabName, CONFIG.sheet.headers);

  const all = await readAll(sheets, CONFIG.google.sheetId, tabName);

  // Build set of incoming keys (Date|Ad ID)
  const incomingKeys = new Set(insights.map((i) => `${i.date}|${i.adId}`));

  // Find existing rows with matching keys → delete
  // Date is column A (index 0), Ad ID is column F (index 5)
  const rowsToDelete = [];
  for (let r = 1; r < all.length; r++) {
    const row = all[r];
    const key = `${row[0]}|${row[5]}`;
    if (incomingKeys.has(key)) rowsToDelete.push(r + 1);
  }

  if (rowsToDelete.length) {
    const sheetMeta = await sheets.spreadsheets.get({ spreadsheetId: CONFIG.google.sheetId });
    const sheetTab = sheetMeta.data.sheets.find((s) => s.properties.title === tabName);
    const sheetGid = sheetTab.properties.sheetId;

    const requests = rowsToDelete
      .sort((a, b) => b - a)
      .map((rowNum) => ({
        deleteDimension: {
          range: { sheetId: sheetGid, dimension: "ROWS", startIndex: rowNum - 1, endIndex: rowNum },
        },
      }));

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: CONFIG.google.sheetId,
      requestBody: { requests },
    });
  }

  const values = insights.map(rowFromInsight);
  await sheets.spreadsheets.values.append({
    spreadsheetId: CONFIG.google.sheetId,
    range: `${tabName}!A:A`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });

  return { written: values.length, deleted: rowsToDelete.length };
}

async function readMetaData() {
  const sheets = await getSheetsClient();
  return readAll(sheets, CONFIG.google.sheetId, CONFIG.sheet.metaTab);
}

module.exports = { upsertInsightRows, readMetaData, getSheetsClient };
