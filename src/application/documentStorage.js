const { createDriveClient } = require("../auth/google");
const config = require("../config");

async function uploadGeneratedDocument({ buffer, fileName, mimeType }) {
  const drive = createDriveClient();
  const folderId = config.GENERATED_DOCUMENTS_FOLDER_ID;
  const requestBody = { name: fileName };
  if (folderId) requestBody.parents = [folderId];

  const result = await drive.files.create({
    requestBody,
    media: { mimeType, body: require("stream").Readable.from(buffer) },
    fields: "id,name,webViewLink,webContentLink"
  });

  return {
    id: result.data.id,
    name: result.data.name,
    url: result.data.webViewLink || result.data.webContentLink || ""
  };
}

module.exports = { uploadGeneratedDocument };
