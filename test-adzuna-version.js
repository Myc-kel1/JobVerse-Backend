require("dotenv").config();

async function main() {
  const appId = process.env.ADZUNA_APP_ID?.trim();
  const appKey = process.env.ADZUNA_APP_KEY?.trim();

  console.log("APP ID exists:", Boolean(appId));
  console.log("APP KEY exists:", Boolean(appKey));

  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    results_per_page: "1",
    what: "Software Engineer",
  });

  const url = `https://api.adzuna.com/v1/api/jobs/gb/search/1?${params}`;

  console.log(
    "Request URL:",
    url.replace(appKey, "***REDACTED***")
  );

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  console.log("HTTP status:", response.status);
  console.log(await response.text());
}

main().catch(console.error);