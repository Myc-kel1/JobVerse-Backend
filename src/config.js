require("dotenv").config();

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

module.exports = {
  // Google OAuth 2.0. The refresh token is the only long-lived Google
  // credential stored by the application. No service-account private key is
  // required for the production Render deployment.
  GOOGLE_OAUTH_CLIENT_ID: () => required("GOOGLE_OAUTH_CLIENT_ID"),
  GOOGLE_OAUTH_CLIENT_SECRET: () => required("GOOGLE_OAUTH_CLIENT_SECRET"),
  GOOGLE_OAUTH_REFRESH_TOKEN: () => required("GOOGLE_OAUTH_REFRESH_TOKEN"),
  GOOGLE_OAUTH_REDIRECT_URI: () => process.env.GOOGLE_OAUTH_REDIRECT_URI || "http://localhost:3000/oauth2callback",
  SPREADSHEET_ID: () => required("SPREADSHEET_ID"),

  // RapidAPI / JSearch
  RAPIDAPI_KEY: () => required("RAPIDAPI_KEY"),

  // Adzuna
  ADZUNA_APP_ID: () => required("ADZUNA_APP_ID"),
  ADZUNA_APP_KEY: () => required("ADZUNA_APP_KEY"),
  ADZUNA_COUNTRY: process.env.ADZUNA_COUNTRY || "gb",

  // Groq
  GROQ_API_KEY: () => required("GROQ_API_KEY"),
  GROQ_PRIMARY_MODEL: process.env.GROQ_PRIMARY_MODEL || "openai/gpt-oss-120b",
  GROQ_RETRY_MODEL: process.env.GROQ_RETRY_MODEL || "openai/gpt-oss-20b",
  GROQ_APPLICATION_MODEL: process.env.GROQ_APPLICATION_MODEL || process.env.GROQ_RETRY_MODEL || "openai/gpt-oss-20b",

  // Behavior
  AI_CALL_DELAY_MS: Number(process.env.AI_CALL_DELAY_MS) || 12000,
  APPLICATION_AI_CALL_DELAY_MS: Number(process.env.APPLICATION_AI_CALL_DELAY_MS) || 12000,
  DAILY_RUN_HOUR: Number(process.env.DAILY_RUN_HOUR) || 8,
  PORT: Number(process.env.PORT) || 3000,
  MANUAL_TRIGGER_TOKEN: process.env.MANUAL_TRIGGER_TOKEN || null,
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN || "*",
   GENERATED_DOCUMENTS_FOLDER_ID: process.env.GENERATED_DOCUMENTS_FOLDER_ID || null
};
