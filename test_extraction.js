const fs = require("fs");
const { extractText } = require("./src/fileExtraction");

async function run() {
  console.log("=== PDF extraction (real file: Jobverse_Roadmap.pdf) ===");
  const path = require("path");

const pdfPath = path.join(__dirname, "fixtures", "Jobverse_Roadmap.pdf");
const pdfBuffer = fs.readFileSync(pdfPath);
  const pdfText = await extractText(pdfBuffer, "application/pdf");
  console.log("Extracted", pdfText.length, "characters");
  console.log("First 200 chars:", pdfText.slice(0, 200));
  if (!pdfText.includes("Jobverse")) throw new Error("FAILED: expected 'Jobverse' in extracted PDF text");
  if (!pdfText.includes("Roadmap")) throw new Error("FAILED: expected 'Roadmap' in extracted PDF text");

  console.log("\n=== DOCX extraction (real file: Jobverse_Roadmap.docx) ===");
  const docxPath = path.join(__dirname, "fixtures", "Jobverse_Roadmap.docx");
  const docxBuffer = fs.readFileSync(docxPath);
  const docxText = await extractText(docxBuffer, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  console.log("Extracted", docxText.length, "characters");
  console.log("First 200 chars:", docxText.slice(0, 200));
  if (!docxText.includes("System Overview")) throw new Error("FAILED: expected section heading in extracted DOCX text");

  console.log("\nAll file extraction assertions passed against REAL PDF and DOCX files.");
}

run().catch(err => { console.error("TEST FAILED:", err); process.exit(1); });
