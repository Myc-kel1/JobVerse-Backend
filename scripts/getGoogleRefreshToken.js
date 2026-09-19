require("dotenv").config();
const http = require("http");
const { google } = require("googleapis");
const { URL } = require("url");
const readline = require("readline");

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI || "http://localhost:3000/oauth2callback";

if (!clientId || !clientSecret) {
  console.error("Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET first.");
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
const scopes = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive"
];

const authUrl = oauth2.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: scopes
});

console.log("Open this URL in your browser:\n\n" + authUrl + "\n");
console.log("After consent, paste the authorization code here if your redirect URI does not automatically return it.");

if (redirectUri.startsWith("http://localhost:")) {
  const url = new URL(redirectUri);
  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    const code = requestUrl.searchParams.get("code");
    const error = requestUrl.searchParams.get("error");
    if (error) {
      res.end("Authorization failed. You can close this tab.");
      console.error("OAuth error:", error);
      server.close();
      process.exit(1);
    }
    if (!code) return res.end("Waiting for OAuth callback...");

    try {
      const { tokens } = await oauth2.getToken(code);
      console.log("\nOAuth complete. Add this to your local .env and Render environment:");
      console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token || "<NO_REFRESH_TOKEN_RETURNED>"}`);
      res.end("Jobverse Google authentication complete. You can close this tab.");
    } catch (err) {
      console.error("Failed to exchange OAuth code:", err.message);
      res.end("OAuth exchange failed. Check the terminal.");
    } finally {
      setTimeout(() => server.close(), 250);
    }
  });
  server.listen(Number(url.port), url.hostname, () => {
    console.log(`Waiting for Google OAuth callback on ${redirectUri}`);
  });
} else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question("Paste the authorization code: ", async (code) => {
    try {
      const { tokens } = await oauth2.getToken(code.trim());
      console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token || "<NO_REFRESH_TOKEN_RETURNED>"}`);
    } catch (err) {
      console.error(err.message);
      process.exitCode = 1;
    } finally {
      rl.close();
    }
  });
}
