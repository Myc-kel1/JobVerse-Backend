const { google } = require("googleapis");
const readline = require("readline");
require("dotenv").config();

const oauth2Client =
  new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    process.env.GOOGLE_OAUTH_REDIRECT_URI
  );

const scopes = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive"
];

const authUrl =
  oauth2Client.generateAuthUrl({
    access_type: "offline",

    /*
     * Forces Google to show the consent screen again,
     * which helps ensure a fresh refresh_token is returned.
     */
    prompt: "consent",

    scope: scopes
  });

console.log("\nOpen this URL in your browser:\n");
console.log(authUrl);
console.log(
  "\nAfter approving access, copy the authorization code here.\n"
);

const rl =
  readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

rl.question(
  "Authorization code: ",
  async (code) => {
    try {
      const {
        tokens
      } =
        await oauth2Client.getToken(
          code.trim()
        );

      console.log(
        "\nOAuth tokens received.\n"
      );

      if (
        tokens.refresh_token
      ) {
        console.log(
          "NEW REFRESH TOKEN:\n"
        );

        console.log(
          tokens.refresh_token
        );

        console.log(
          "\nPut this value into GOOGLE_OAUTH_REFRESH_TOKEN in your .env file."
        );
      } else {
        console.log(
          "Google did not return a refresh token."
        );

        console.log(
          "Make sure access_type=offline and prompt=consent are present."
        );
      }
    } catch (err) {
      console.error(
        "Failed to exchange authorization code:",
        err.message
      );
    } finally {
      rl.close();
    }
  }
);