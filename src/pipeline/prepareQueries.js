/**
 * Turns a candidate's comma-separated searchKeywords into individual query
 * strings, prioritizing preferredJobTitle first, then expands each across
 * maxSearchPages so callers can fetch multiple pages without a loop.
 */
function prepareSearchQueries(candidate) {
  const maxPages = Math.max(1, Math.min(Number(candidate.maxSearchPages) || 3, 5));

  let keywords = (candidate.searchKeywords || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  const seen = new Set();
  keywords = keywords.filter((k) => {
    const key = k.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (candidate.preferredJobTitle && !seen.has(candidate.preferredJobTitle.toLowerCase())) {
    keywords.unshift(candidate.preferredJobTitle.trim());
  }

  if (keywords.length === 0) {
    keywords = [candidate.preferredJobTitle || "Remote Job"];
  }

  const queries = [];
  for (const query of keywords) {
    for (let page = 1; page <= maxPages; page++) {
      queries.push({ query, page });
    }
  }
  return queries;
}

module.exports = { prepareSearchQueries };
