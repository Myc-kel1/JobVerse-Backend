const { prepareSearchQueries } = require("../pipeline/prepareQueries");

function stripHtml(html) {
  return (html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** Remotive's salary field is a loose free-text string, not structured min/max. Best-effort parse. */
function parseSalary(salaryText) {
  if (!salaryText) return { min: null, max: null };
  const numbers = salaryText.replace(/,/g, "").match(/\d+(\.\d+)?/g);
  if (!numbers || numbers.length === 0) return { min: null, max: null };
  const nums = numbers.map(Number);
  if (nums.length === 1) return { min: nums[0], max: nums[0] };
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

function normalizeJobType(jobType) {
  const map = {
    full_time: "Full-time", part_time: "Part-time", contract: "Contract",
    freelance: "Freelance", internship: "Internship"
  };
  return map[jobType] || jobType || null;
}

function normalize(j) {
  const description = stripHtml(j.description);
  const { min, max } = parseSalary(j.salary);

  return {
    jobId: null,
    title: j.title || "",
    company: j.company_name || "",
    location: j.candidate_required_location || "Remote",
    country: null, // Remotive jobs are remote-first; specific country restrictions live in candidate_required_location text
    workModel: "Remote", // every Remotive listing is remote by definition
    salaryMin: min,
    salaryMax: max,
    salaryCurrency: min != null ? "USD" : null, // Remotive salaries are typically quoted in USD when present
    salaryPeriod: min != null ? "year" : null,
    salaryKnown: min != null,
    jobType: normalizeJobType(j.job_type),
    description,
    shortDescription: description.slice(0, 300),
    url: j.url || "",
    postedDate: j.publication_date || null,
    sourceName: "Remotive",
    sourceJobId: j.id ? String(j.id) : null
  };
}

async function fetchForQuery(query, { maxRetries = 3 } = {}) {
  const params = new URLSearchParams({ search: query, limit: "20" });
  const url = `https://remotive.com/api/remote-jobs?${params.toString()}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url);
      if ([429, 500, 502, 503, 504].includes(res.status) && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * attempt * 2));
        continue;
      }
      if (!res.ok) throw new Error(`Remotive failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
      return await res.json();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt * 2));
    }
  }
}

/**
 * Remotive has no page parameter -- it returns up to `limit` results for a
 * search in one call, so this fetches once per unique keyword rather than
 * once per keyword x page like the other two sources.
 */
async function fetchJobsForCandidate(candidate, { requestDelayMs = 500 } = {}) {
  const queries = prepareSearchQueries(candidate);
  const uniqueKeywords = [...new Set(queries.map((q) => q.query))];

  const jobs = [];
  const errors = [];

  for (const keyword of uniqueKeywords) {
    try {
      const body = await fetchForQuery(keyword);
      const results = (body && body.jobs) || [];
      jobs.push(...results.map(normalize));
    } catch (err) {
      errors.push({ source: "remotive", query: keyword, error: err.message });
    }
    await new Promise((r) => setTimeout(r, requestDelayMs));
  }

  return { jobs, errors, requestCount: uniqueKeywords.length };
}

module.exports = { fetchJobsForCandidate, normalize, parseSalary };
