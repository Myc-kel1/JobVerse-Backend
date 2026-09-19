const config = require("../config");
const { prepareSearchQueries } = require("../pipeline/prepareQueries");

function stripHtml(html) {
  return (html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function pickDatePosted(jobRecencyDays) {
  if (jobRecencyDays <= 1) return "today";
  if (jobRecencyDays <= 3) return "3days";
  if (jobRecencyDays <= 7) return "week";
  return "month";
}

function extractRawJobs(resp) {
  if (!resp) return [];
  if (Array.isArray(resp)) return resp;
  if (Array.isArray(resp.data)) return resp.data;
  if (resp.data && Array.isArray(resp.data.jobs)) return resp.data.jobs;
  return [];
}

function normalize(j) {
  const description = stripHtml(j.job_description);
  const location = j.job_is_remote
    ? "Remote"
    : [j.job_city, j.job_state, j.job_country].filter(Boolean).join(", ");

  return {
    jobId: null,
    title: j.job_title || "",
    company: j.employer_name || "",
    location: location || "Not specified",
    country: j.job_country || null,
    workModel: j.job_is_remote ? "Remote" : null,
    salaryMin: j.job_min_salary != null ? Number(j.job_min_salary) : null,
    salaryMax: j.job_max_salary != null ? Number(j.job_max_salary) : null,
    salaryCurrency: j.job_salary_currency || null,
    salaryPeriod: j.job_salary_period || null,
    salaryKnown: !!(j.job_min_salary || j.job_max_salary),
    jobType: j.job_employment_type || null,
    description,
    shortDescription: description.slice(0, 300),
    url: j.job_apply_link || j.job_google_link || "",
    postedDate: j.job_posted_at_datetime_utc || null,
    sourceName: "RapidAPI - JSearch",
    sourceJobId: j.job_id || null
  };
}

async function fetchPage({ query, page, jobRecencyDays, workModel }, { maxRetries = 3 } = {}) {
  const params = new URLSearchParams({
    query, page: String(page), num_pages: "1", country: "ng", language: "en",
    date_posted: pickDatePosted(jobRecencyDays || 7),
    remote_jobs_only: (workModel || "").toLowerCase() === "remote" ? "true" : "false"
  });
  const url = `https://jsearch.p.rapidapi.com/search-v2?${params.toString()}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "X-RapidAPI-Key": config.RAPIDAPI_KEY(), "X-RapidAPI-Host": "jsearch.p.rapidapi.com" }
      });
      if ([429, 500, 502, 503, 504].includes(res.status) && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * attempt * 2));
        continue;
      }
      if (!res.ok) throw new Error(`JSearch failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
      return await res.json();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt * 2));
    }
  }
}

/** Fetches every query/page combination for a candidate and returns normalized jobs + any errors. */
async function fetchJobsForCandidate(candidate, { requestDelayMs = 500 } = {}) {
  const queries = prepareSearchQueries(candidate);
  const jobs = [];
  const errors = [];

  for (const q of queries) {
    try {
      const body = await fetchPage({ query: q.query, page: q.page, jobRecencyDays: candidate.jobRecencyDays, workModel: candidate.workModel });
      jobs.push(...extractRawJobs(body).map(normalize));
    } catch (err) {
      errors.push({ source: "jsearch", query: q.query, page: q.page, error: err.message });
    }
    await new Promise((r) => setTimeout(r, requestDelayMs));
  }

  return { jobs, errors, requestCount: queries.length };
}

module.exports = { fetchJobsForCandidate, normalize, extractRawJobs };
