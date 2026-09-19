const { readSheet, appendRows } = require("./googleSheets");
const { runDiscoveryForCandidate } = require("./runDiscovery");

/**
 * Reads all candidates, skips paused/deleted ones, and runs the full
 * discovery pipeline for each in turn (never in parallel -- parallel
 * candidates would multiply RapidAPI/Groq request rates and risk hitting
 * rate limits even faster than the single-candidate pacing already does).
 */
async function runDailyDiscoveryForAllCandidates() {
  const candidates = await readSheet("Candidates");
  const active = candidates.filter((c) => c.status !== "paused" && c.status !== "deleted");

  console.log(`[daily run] ${active.length} active candidate(s) to process`);

  const summaries = [];
  for (const candidate of active) {
    try {
      const summary = await runDiscoveryForCandidate(candidate);
      summaries.push(summary);
      console.log(`[daily run] done: ${candidate.candidateEmail}`, summary);
    } catch (err) {
      console.error(`[daily run] FAILED for ${candidate.candidateEmail}:`, err);
      summaries.push({ candidateEmail: candidate.candidateEmail, error: err.message });
    }
  }

  try {
    await appendRows(
      "Job Search Execution Summary",
      summaries.map((s) => ({ ...s, loggedAt: new Date().toISOString() }))
    );
  } catch (err) {
    // Logging failure should never take down an otherwise-successful run.
    console.error("[daily run] Failed to write execution summary log:", err);
  }

  return summaries;
}

module.exports = { runDailyDiscoveryForAllCandidates };
