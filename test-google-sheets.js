require("dotenv").config();

const config = require("./src/config");
const { createSheetsClient } = require("./src/auth/google");

async function main() {
  try {
    console.log("Creating Google Sheets client...");

    const sheets = createSheetsClient();

    console.log("Testing spreadsheet connection...");
    console.log("Spreadsheet ID exists:", Boolean(config.SPREADSHEET_ID()));

    const response = await sheets.spreadsheets.get({
      spreadsheetId: config.SPREADSHEET_ID(),
      fields: "properties.title,sheets.properties.title"
    });

    console.log("\nSUCCESS");
    console.log("Spreadsheet:", response.data.properties?.title);

    console.log(
      "Sheets:",
      response.data.sheets?.map((s) => s.properties?.title)
    );
  } catch (err) {
    console.error("\nGOOGLE SHEETS TEST FAILED");
    console.error("Name:", err.name);
    console.error("Message:", err.message);
    console.error("Code:", err.code);
    console.error("Status:", err.response?.status);
    console.error("Response:", err.response?.data);
  }
}

main();
