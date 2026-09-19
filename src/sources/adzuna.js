const config = require("../config");
const { prepareSearchQueries } = require("../pipeline/prepareQueries");

// Adzuna does not cover every country -- Nigeria is not currently in their
// supported list. Defaults to "gb"; override via ADZUNA_COUNTRY if your
// candidates are targeting a different Adzuna-supported market. See
// https://developer.adzuna.com/overview for the current country list.
const CURRENCY_BY_COUNTRY = { gb: "GBP", us: "USD", ca: "CAD", au: "AUD", de: "EUR", fr: "EUR", nl: "EUR", ie: "EUR" };

function normalize(j, countryCode) {
  const description = (j.description || "").trim();
  const looksRemote = /\bremote\b/i.test(`${j.title} ${description}`);

  return {
    jobId: null,
    title: j.title || "",
    company: (j.company && j.company.display_name) || "",
    location: (j.location && j.location.display_name) || "Not specified",
    country: (countryCode || "").toUpperCase() || null,
    workModel: looksRemote ? "Remote" : null,
    salaryMin: j.salary_min != null ? Number(j.salary_min) : null,
    salaryMax: j.salary_max != null ? Number(j.salary_max) : null,
    salaryCurrency: CURRENCY_BY_COUNTRY[countryCode] || null,
    salaryPeriod: null,
    salaryKnown: j.salary_min != null || j.salary_max != null,
    jobType: j.contract_time === "part_time" ? "Part-time" : j.contract_time === "full_time" ? "Full-time" : null,
    description,
    shortDescription: description.slice(0, 300),
    url: j.redirect_url || "",
    postedDate: j.created || null,
    sourceName: "Adzuna",
    sourceJobId: j.id ? String(j.id) : null
  };
}

async function fetchPage(query, page, countryCode, { maxRetries = 3 } = {}) {
  const params = new URLSearchParams({
    app_id: config.ADZUNA_APP_ID(),
    app_key: config.ADZUNA_APP_KEY(),
    results_per_page: "20",
    what: query,
    "content-type": "application/json"
  });
  const url = `https://api.adzuna.com/v1/api/jobs/${countryCode}/search/${page}?${params.toString()}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url);
      if ([429, 500, 502, 503, 504].includes(res.status) && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * attempt * 2));
        continue;
      }
      if (!res.ok) throw new Error(`Adzuna failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
      return await res.json();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt * 2));
    }
  }
}

async function fetchJobsForCandidate(candidate, { requestDelayMs = 500, maxPages, countryCode } = {}) {
  const country = countryCode || config.ADZUNA_COUNTRY;
  const queries = prepareSearchQueries(candidate);
  const pages = maxPages || Math.max(1, Math.min(Number(candidate.maxSearchPages) || 3, 5));

  const jobs = [];
  const errors = [];

  // Adzuna's query param is "what" (keyword), one request per keyword per page.
  const uniqueKeywords = [...new Set(queries.map((q) => q.query))];

  for (const keyword of uniqueKeywords) {
    for (let page = 1; page <= pages; page++) {
      try {
        const body = await fetchPage(keyword, page, country);
        const results = (body && body.results) || [];
        jobs.push(...results.map((j) => normalize(j, country)));
      } catch (err) {
        errors.push({ source: "adzuna", query: keyword, page, error: err.message });
      }
      await new Promise((r) => setTimeout(r, requestDelayMs));
    }
  }

  return { jobs, errors, requestCount: uniqueKeywords.length * pages };
}

module.exports = { fetchJobsForCandidate, normalize };
