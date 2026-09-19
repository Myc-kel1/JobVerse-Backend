const config = require("./config");
const { createSheetsClient } = require("./auth/google");

let sheetsClient = null;

async function getSheetsClient() {
  if (sheetsClient) return sheetsClient;
  sheetsClient = createSheetsClient();
  return sheetsClient;
}

function sheetRange(tabName, suffix = "") {
  const safeTabName = String(tabName).replace(/'/g, "''");
  return `'${safeTabName}'${suffix}`;
}

async function readSheet(tabName) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.SPREADSHEET_ID(),
    range: sheetRange(tabName)
  });
  const rows = res.data.values || [];
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => String(h).trim());
  return rows.slice(1).map((row) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ""; });
    return obj;
  });
}

async function appendRows(tabName, records) {
  if (records.length === 0) return;
  const sheets = await getSheetsClient();
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: config.SPREADSHEET_ID(),
    range: sheetRange(tabName, "!1:1")
  });
  const headers = (existing.data.values && existing.data.values[0]) || [];
  if (!headers.length) throw new Error(`Sheet '${tabName}' has no header row`);
  const values = records.map((record) => headers.map((h) => record[h] ?? ""));
  await sheets.spreadsheets.values.append({
    spreadsheetId: config.SPREADSHEET_ID(),
    range: sheetRange(tabName),
    valueInputOption: "USER_ENTERED",
    requestBody: { values }
  });
}

async function upsertRows(tabName, records, matchColumns) {
  if (records.length === 0) return;
  const sheets = await getSheetsClient();
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: config.SPREADSHEET_ID(),
    range: sheetRange(tabName)
  });
  const rows = existing.data.values || [];
  const headers = (rows[0] || []).map((h) => String(h).trim());
  if (!headers.length) throw new Error(`Sheet '${tabName}' has no header row`);

  const keyFor = (obj) => matchColumns.map((c) => obj[c] ?? "").join("||");
  const existingIndexByKey = new Map();
  rows.slice(1).forEach((row, i) => {
    const obj = {};
    headers.forEach((h, colIdx) => { obj[h] = row[colIdx] ?? ""; });
    existingIndexByKey.set(keyFor(obj), i + 2);
  });

  const toAppend = [];
  const updates = [];
  for (const record of records) {
    const key = keyFor(record);
    const rowNumber = existingIndexByKey.get(key);
    const rowValues = headers.map((h) => record[h] ?? "");
    if (rowNumber) {
      updates.push({
        range: sheetRange(tabName, `!A${rowNumber}:${columnLetter(headers.length)}${rowNumber}`),
        values: [rowValues]
      });
    } else {
      toAppend.push(rowValues);
    }
  }

  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: config.SPREADSHEET_ID(),
      requestBody: { valueInputOption: "USER_ENTERED", data: updates }
    });
  }
  if (toAppend.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: config.SPREADSHEET_ID(),
      range: sheetRange(tabName),
      valueInputOption: "USER_ENTERED",
      requestBody: { values: toAppend }
    });
  }
}

/** Creates an application-related tab only if it does not exist, then installs its header row. */
async function ensureSheetWithHeaders(title, headers) {
  const sheets = await getSheetsClient();
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: config.SPREADSHEET_ID(),
    fields: "sheets.properties"
  });
  const existing = spreadsheet.data.sheets?.find((s) => s.properties?.title === title);

  if (!existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: config.SPREADSHEET_ID(),
      requestBody: { requests: [{ addSheet: { properties: { title } } }] }
    });
  }

  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: config.SPREADSHEET_ID(),
    range: sheetRange(title, "!1:1")
  });
  const currentHeaders = (headerResponse.data.values?.[0] || []).map((h) => String(h).trim());

  if (currentHeaders.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: config.SPREADSHEET_ID(),
      range: sheetRange(title, "!1:1"),
      valueInputOption: "RAW",
      requestBody: { values: [headers] }
    });
    return { createdOrInitialized: true, title };
  }

  const missing = headers.filter((h) => !currentHeaders.includes(h));
  if (missing.length) {
    throw new Error(`Sheet '${title}' already exists but is missing required columns: ${missing.join(", ")}`);
  }
  return { createdOrInitialized: false, title };
}

function columnLetter(n) {
  let letter = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

module.exports = { readSheet, appendRows, upsertRows, ensureSheetWithHeaders };
