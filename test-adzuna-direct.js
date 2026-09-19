require("dotenv").config();

async function main() {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;

  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    results_per_page: "1",
    what: "Software Engineer",
    "content-type": "application/json"
  });

  const url =
    `https://api.adzuna.com/v1/api/jobs/gb/search/1?${params.toString()}`;

  console.log("Testing Adzuna credentials directly...");
  console.log("APP_ID loaded:", !!appId);
  console.log("APP_KEY loaded:", !!appKey);

  const response = await fetch(url);

  console.log("HTTP status:", response.status);

  const text = await response.text();

  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text);
  }
}

main().catch((error) => {
  console.error("ERROR:", error.message);
  process.exit(1);
});