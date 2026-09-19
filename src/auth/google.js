const { google } = require("googleapis");
const config = require("../config");

let authClient = null;

/**
 * Production authentication for Jobverse.
 *
 * We intentionally use Google OAuth 2.0 with a refresh token instead of a
 * service-account JSON key. This works on Render because the refresh token is
 * stored as a secret environment variable and Google access tokens are short
 * lived. The Google account used for the OAuth consent must have access to the
 * Jobverse spreadsheet and Drive upload folder.
 */
function getGoogleAuth() {
  if (authClient) return authClient;

  const clientId = config.GOOGLE_OAUTH_CLIENT_ID();
  const clientSecret = config.GOOGLE_OAUTH_CLIENT_SECRET();
  const refreshToken = config.GOOGLE_OAUTH_REFRESH_TOKEN();

  authClient = new google.auth.OAuth2(clientId, clientSecret);
  authClient.setCredentials({ refresh_token: refreshToken });
  return authClient;
}

function getGoogleAuthForConsent() {
  return new google.auth.OAuth2(
    config.GOOGLE_OAUTH_CLIENT_ID(),
    config.GOOGLE_OAUTH_CLIENT_SECRET(),
    config.GOOGLE_OAUTH_REDIRECT_URI()
  );
}

function createSheetsClient() {
  return google.sheets({ version: "v4", auth: getGoogleAuth() });
}

function createDriveClient() {
  return google.drive({ version: "v3", auth: getGoogleAuth() });
}

module.exports = {
  getGoogleAuth,
  getGoogleAuthForConsent,
  createSheetsClient,
  createDriveClient
};
