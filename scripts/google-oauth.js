require("dotenv").config();

const { google } = require("googleapis");
const readline = require("readline");

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;

if (!clientId || !clientSecret || !redirectUri) {
  throw new Error(
    "Missing GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, or GOOGLE_OAUTH_REDIRECT_URI"
  );
}

const oauth2Client = new google.auth.OAuth2(
  clientId,
  clientSecret,
  redirectUri
);

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: SCOPES,
});

console.log("\nOpen this URL in your browser:\n");
console.log(authUrl);
console.log("\nAfter authorization, Google will redirect you.");
console.log("Copy the FULL authorization code from the redirect URL.\n");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question("Paste authorization code here: ", async (code) => {
  try {
    const { tokens } = await oauth2Client.getToken(code);

    console.log("\nOAuth tokens received.\n");

    console.log("REFRESH TOKEN:");
    console.log(tokens.refresh_token || "NO REFRESH TOKEN RETURNED");

    console.log("\nACCESS TOKEN:");
    console.log(tokens.access_token || "NO ACCESS TOKEN RETURNED");

    console.log("\nIMPORTANT:");
    console.log(
      "Copy the REFRESH TOKEN into your GOOGLE_OAUTH_REFRESH_TOKEN environment variable."
    );
  } catch (error) {
    console.error("\nOAuth exchange failed:");
    console.error(error.response?.data || error.message);
  } finally {
    rl.close();
  }
});