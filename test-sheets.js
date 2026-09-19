const { readSheet } = require("./src/googleSheets");

(async () => {
  try {
    console.log("Testing Shortlisted Jobs...");
    const rows = await readSheet("Shortlisted Jobs");

    console.log("SUCCESS");
    console.log("Rows:", rows.length);
    console.log(rows.slice(0, 2));
  } catch (error) {
    console.error("FAILED");
    console.error(error.message);
    console.error(error.stack);
  }
})();