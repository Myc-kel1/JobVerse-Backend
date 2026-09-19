function stripHtml(html) {
  return (html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Accepts the raw JSearch API response body (already parsed JSON) and
 * returns the job array, handling every response shape actually observed
 * from JSearch in production: {data: [...]}, {data: {jobs: [...]}}, or a
 * bare array as a fallback.
 */
function extractJobs(resp) {
  if (!resp) return [];
  if (Array.isArray(resp)) return resp;
  if (Array.isArray(resp.data)) return resp.data;
  if (resp.data && Array.isArray(resp.data.jobs)) return resp.data.jobs;
  return [];
}

/**
 * Takes an array of raw JSearch response bodies (one per search request)
 * and returns one flat array of normalized job objects.
 */
function flattenAndNormalize(rawResponses) {
  const allJobs = [];

  for (const resp of rawResponses) {
    allJobs.push(...extractJobs(resp));
  }

  return allJobs.map((j) => {
    const description = stripHtml(j.job_description);
    const salaryKnown = !!(j.job_min_salary || j.job_max_salary);
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
      salaryKnown,
      jobType: j.job_employment_type || null,
      description,
      shortDescription: description.slice(0, 300),
      url: j.job_apply_link || j.job_google_link || "",
      postedDate: j.job_posted_at_datetime_utc || null,
      sourceName: "RapidAPI - JSearch",
      sourceJobId: j.job_id || null
    };
  });
}

module.exports = { flattenAndNormalize, extractJobs };
