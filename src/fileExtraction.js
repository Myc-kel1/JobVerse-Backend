const mammoth = require("mammoth");
const { createDriveClient } = require("./auth/google");

let driveClient = null;

async function getDriveClient() {
  if (driveClient) return driveClient;
  driveClient = createDriveClient();
  return driveClient;
}

/**
 * Google Forms file-upload links come in a couple of common shapes:
 *   https://drive.google.com/open?id=FILE_ID
 *   https://drive.google.com/file/d/FILE_ID/view?usp=drivesdk
 * This extracts the FILE_ID from either.
 */
/*
 * ============================================================
 * EXTRACT GOOGLE DRIVE FILE ID
 * ============================================================
 *
 * Supported examples:
 *
 * https://drive.google.com/open?id=FILE_ID
 * https://drive.google.com/file/d/FILE_ID/view
 * https://docs.google.com/document/d/FILE_ID/edit
 * https://docs.google.com/spreadsheets/d/FILE_ID/edit
 *
 * Generated JobVerse DOCX files can receive a docs.google.com
 * webViewLink even though the stored Drive object is still the
 * original uploaded binary file.
 */

function extractDriveFileId(
  url
) {
  const normalized =
    String(
      url || ""
    ).trim();


  if (
    !normalized
  ) {
    return null;
  }


  /*
   * Query-string style:
   *
   * ?id=FILE_ID
   */
  const openMatch =
    normalized.match(
      /[?&]id=([a-zA-Z0-9_-]+)/
    );


  if (
    openMatch
  ) {
    return openMatch[1];
  }


  /*
   * Standard Drive file URL:
   *
   * /file/d/FILE_ID/
   */
  const filePathMatch =
    normalized.match(
      /\/file\/d\/([a-zA-Z0-9_-]+)/
    );


  if (
    filePathMatch
  ) {
    return filePathMatch[1];
  }


  /*
   * Google Docs/Sheets/Slides-style webViewLink:
   *
   * /document/d/FILE_ID/
   * /spreadsheets/d/FILE_ID/
   * /presentation/d/FILE_ID/
   *
   * Restrict the recognized resource type rather than matching an
   * arbitrary "/d/" path.
   */
  const googleEditorMatch =
    normalized.match(
      /\/(?:document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]+)/
    );


  if (
    googleEditorMatch
  ) {
    return googleEditorMatch[1];
  }


  return null;
}

/** Downloads a Drive file's raw bytes and mime type. */
async function downloadDriveFile(fileUrl) {
  const fileId = extractDriveFileId(fileUrl);
  if (!fileId) throw new Error(`Could not extract a Drive file ID from: ${fileUrl}`);

  const drive = await getDriveClient();
  const meta = await drive.files.get({ fileId, fields: "mimeType, name" });
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" }
  );

  return {
    buffer: Buffer.from(res.data),
    mimeType: meta.data.mimeType,
    fileName: meta.data.name
  };
}

/** Extracts plain text from a PDF, DOCX, or plain-text buffer. */
async function extractText(buffer, mimeType) {
  if (mimeType === "application/pdf") {
    const { PDFParse } = require("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text.trim();
    } finally {
      await parser.destroy(); // pdf-parse v2 holds worker resources open until explicitly destroyed
    }
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword"
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim();
  }

  if (mimeType && mimeType.startsWith("text/")) {
    return buffer.toString("utf-8").trim();
  }

  throw new Error(`Unsupported file type for text extraction: ${mimeType}`);
}

/** Convenience wrapper: download a Drive file URL and return its extracted text. */
async function extractTextFromDriveUrl(fileUrl) {
  if (!fileUrl) return null;
  const { buffer, mimeType, fileName } = await downloadDriveFile(fileUrl);
  const text = await extractText(buffer, mimeType);
  return { text, fileName, mimeType };
}

module.exports = { extractDriveFileId, downloadDriveFile, extractText, extractTextFromDriveUrl };
