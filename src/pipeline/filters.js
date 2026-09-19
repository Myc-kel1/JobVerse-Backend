function normalizeUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref"].forEach((p) =>
      u.searchParams.delete(p)
    );
    return (u.origin + u.pathname).toLowerCase().replace(/\/+$/, "");
  } catch (e) {
    return url.toLowerCase().trim();
  }
}

function hashString(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/** Drops jobs missing a title or a usable URL. */
function validateJobs(jobs) {
  return jobs.filter((j) => j.title && j.title.trim() && j.url && j.url.trim());
}

/** Assigns a deterministic jobId based on URL, then sourceJobId, then a content fallback. */
function generateStableJobIds(jobs) {
  return jobs.map((j) => {
    const normUrl = normalizeUrl(j.url);
    let basis;
    if (normUrl) basis = "url:" + normUrl;
    else if (j.sourceJobId) basis = "src:" + String(j.sourceJobId).toLowerCase();
    else
      basis =
        "ctl:" +
        [j.company, j.title, j.location]
          .map((v) => (v || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
          .join("|");
    return { ...j, jobId: hashString(basis) };
  });
}

/** Keeps jobs posted within `recencyDays`; unknown dates are kept by default (non-lossy policy). */
function filterByRecency(jobs, recencyDays, { excludeUnknownDates = false } = {}) {
  const cutoff = new Date(Date.now() - recencyDays * 24 * 60 * 60 * 1000);
  return jobs
    .map((j) => {
      const known = !!j.postedDate && !isNaN(new Date(j.postedDate).getTime());
      return { ...j, postedDateKnown: known };
    })
    .filter((j) => (j.postedDateKnown ? new Date(j.postedDate) >= cutoff : !excludeUnknownDates));
}

/** Dedupes within one run, primary key jobId, fallback company+title+location. */
function dedupeThisRun(jobs) {
  const seen = new Set();
  const unique = [];
  for (const j of jobs) {
    const key = j.jobId
      ? "id:" + j.jobId
      : "fallback:" +
        [j.company, j.title, j.location]
          .map((v) => (v || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
          .join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(j);
  }
  return unique;
}

/** Deterministic pre-AI rejection rules. Adds hardFilterPassed + rejectionReason to every job. */
function applyHardRequirementFilter(jobs, candidate) {
  const excludedTitles = (candidate.excludedTitles || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const excludedKeywords = (candidate.excludedKeywords || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

  return jobs.map((j) => {
    const title = (j.title || "").toLowerCase();
    const text = `${j.title || ""} ${j.shortDescription || ""}`.toLowerCase();
    let rejectionReason = null;

    if (excludedTitles.some((t) => t && title.includes(t))) {
      rejectionReason = "Title matches an excluded title rule";
    } else if (excludedKeywords.some((k) => k && text.includes(k))) {
      rejectionReason = "Listing contains an excluded keyword";
    } else if (
      candidate.jobType && j.jobType &&
      candidate.jobType.toLowerCase() !== j.jobType.toLowerCase()
    ) {
      rejectionReason = "Job type does not match candidate preference";
    } else if (
      candidate.workModel && candidate.workModel.toLowerCase() === "remote" &&
      j.workModel && j.workModel.toLowerCase() !== "remote"
    ) {
      rejectionReason = "Not remote, candidate requires remote";
    }

    return { ...j, hardFilterPassed: rejectionReason === null, rejectionReason };
  });
}

module.exports = {
  validateJobs,
  generateStableJobIds,
  filterByRecency,
  dedupeThisRun,
  applyHardRequirementFilter,
  hashString,
  normalizeUrl
};
