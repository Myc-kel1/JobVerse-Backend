const {
  validateJobs,
  generateStableJobIds,
  filterByRecency,
  dedupeThisRun,
  applyHardRequirementFilter
} = require("./pipeline/filters");

const jsearchSource = require("./sources/jsearch");
const adzunaSource = require("./sources/adzuna");
const remotiveSource = require("./sources/remotive");

// ------------------------------------------------------------
// AI SCORING
// ------------------------------------------------------------
//
// Use the provider-independent scorer instead of calling Groq
// directly.
//
// The fallback layer handles:
//
// Groq success
//      ↓
// return Groq result
//
// Groq failure
//      ↓
// try Gemini
//
// Both providers return the same scoring structure.
//
const {
  scoreAllJobsWithFallback
} = require("./aiScorer");

const { readSheet, upsertRows } = require("./googleSheets");

async function runDiscoveryForCandidate(candidate) {
  const summary = {
    candidateEmail: candidate.candidateEmail,
    executionDate: new Date().toISOString(),
    searchQueries: 0,
    fetchErrors: 0,
    jobsBySource: {},
    totalJobsFound: 0,
    invalidJobs: 0,
    jobsAfterRecencyFilter: 0,
    duplicatesRemoved: 0,
    previouslySeenJobs: 0,
    hardRejectedJobs: 0,
    aiEvaluatedJobs: 0,
    aiFailures: 0,

    // AI provider diagnostics
    groqScoredJobs: 0,
    geminiScoredJobs: 0,
    aiFallbacks: 0,

    qualifiedJobs: 0,
    topResultsSaved: 0,
    jobDetailsSaved: 0
  };

  // ------------------------------------------------------------
  // 1. FETCH JOBS FROM ALL SOURCES
  // ------------------------------------------------------------

  const sourceResults = await Promise.allSettled([
    jsearchSource.fetchJobsForCandidate(candidate),
    adzunaSource.fetchJobsForCandidate(candidate),
    remotiveSource.fetchJobsForCandidate(candidate)
  ]);

  const [
    jsearchResult,
    adzunaResult,
    remotiveResult
  ] = sourceResults;

  const allFetchErrors = [];
  let jobs = [];

  for (const [
    name,
    result
  ] of [
    ["jsearch", jsearchResult],
    ["adzuna", adzunaResult],
    ["remotive", remotiveResult]
  ]) {
    if (result.status === "fulfilled") {
      jobs.push(...result.value.jobs);
      allFetchErrors.push(...result.value.errors);

      summary.jobsBySource[name] =
        result.value.jobs.length;

      summary.searchQueries +=
        result.value.requestCount || 0;
    } else {
      allFetchErrors.push({
        source: name,
        error:
          result.reason?.message ||
          String(result.reason)
      });

      summary.jobsBySource[name] = 0;
    }
  }

  summary.fetchErrors = allFetchErrors.length;

  if (allFetchErrors.length > 0) {
    console.warn(
      `[${candidate.candidateEmail}] ${allFetchErrors.length} fetch errors across sources:`,
      allFetchErrors
    );
  }

  summary.totalJobsFound = jobs.length;

  // ------------------------------------------------------------
  // 2. VALIDATE / NORMALIZE / FILTER JOBS
  // ------------------------------------------------------------

  const beforeValidate = jobs.length;

  jobs = validateJobs(jobs);

  summary.invalidJobs =
    beforeValidate - jobs.length;

  jobs = generateStableJobIds(jobs);

  jobs = filterByRecency(
    jobs,
    Number(candidate.jobRecencyDays) || 7
  );

  summary.jobsAfterRecencyFilter =
    jobs.length;

  // ------------------------------------------------------------
  // 3. REMOVE DUPLICATES FROM CURRENT RUN
  // ------------------------------------------------------------

  const beforeDedupe = jobs.length;

  jobs = dedupeThisRun(jobs);

  summary.duplicatesRemoved =
    beforeDedupe - jobs.length;

  // ------------------------------------------------------------
  // 4. REMOVE JOBS ALREADY SEEN BY THIS CANDIDATE
  // ------------------------------------------------------------

  const existingRows =
    await readSheet("Shortlisted Jobs");

  const existingIds = new Set(
    existingRows
      .filter(
        (r) =>
          r.candidateEmail ===
          candidate.candidateEmail
      )
      .map((r) => r.jobId)
  );

  const beforeSeenCheck = jobs.length;

  jobs = jobs.filter(
    (j) => !existingIds.has(j.jobId)
  );

  summary.previouslySeenJobs =
    beforeSeenCheck - jobs.length;

  // ------------------------------------------------------------
  // 5. APPLY DETERMINISTIC HARD REQUIREMENT FILTER
  // ------------------------------------------------------------

  jobs = applyHardRequirementFilter(
    jobs,
    candidate
  );

  const hardPassed = jobs.filter(
    (j) => j.hardFilterPassed
  );

  summary.hardRejectedJobs =
    jobs.length - hardPassed.length;

  // ------------------------------------------------------------
  // 6. AI SCORING
  // ------------------------------------------------------------
  //
  // IMPORTANT:
  // Keep the existing argument order:
  //
  // scoreAllJobs(candidate, hardPassed)
  //
  // The fallback scorer has been designed to preserve this.
  //
  // Groq is attempted first.
  //
  // If Groq fails:
  //
  //     Groq
  //       ↓
  //     Gemini
  //
  // If Gemini also fails, aiParseSuccess will be false.
  //
  const scored =
    await scoreAllJobsWithFallback(
      candidate,
      hardPassed
    );

  summary.aiEvaluatedJobs =
    scored.length;

  summary.aiFailures =
    scored.filter(
      (j) => !j.aiParseSuccess
    ).length;

  // ------------------------------------------------------------
  // 6B. AI PROVIDER SUMMARY
  // ------------------------------------------------------------

  summary.groqScoredJobs =
    scored.filter(
      (j) =>
        j.aiParseSuccess &&
        j.aiProvider === "groq"
    ).length;

  summary.geminiScoredJobs =
    scored.filter(
      (j) =>
        j.aiParseSuccess &&
        j.aiProvider === "gemini"
    ).length;

  summary.aiFallbacks =
    scored.filter(
      (j) =>
        j.aiParseSuccess &&
        j.fallbackUsed === true
    ).length;

  console.log(
    `[${candidate.candidateEmail}] AI PROVIDER SUMMARY`,
    {
      aiEvaluatedJobs:
        summary.aiEvaluatedJobs,

      aiFailures:
        summary.aiFailures,

      groqScoredJobs:
        summary.groqScoredJobs,

      geminiScoredJobs:
        summary.geminiScoredJobs,

      aiFallbacks:
        summary.aiFallbacks
    }
  );

  // ------------------------------------------------------------
  // 7. AI SCORE DEBUG SUMMARY
  // ------------------------------------------------------------

  const minimumMatchScore =
    Number(candidate.minimumMatchScore) || 6;

  const successfulScores =
    scored.filter(
      (j) => j.aiParseSuccess
    );

  console.log(
    `[${candidate.candidateEmail}] AI SCORE SUMMARY`,
    successfulScores.map((j) => ({
      jobId: j.jobId,
      title: j.title,
      company: j.company,

      // Provider information
      aiProvider: j.aiProvider,
      aiModel: j.aiModel,
      fallbackUsed: j.fallbackUsed || false,

      overallScore: j.overallScore,
      excluded: j.excluded,
      minimumMatchScore,

      titleMatch: j.titleMatch,
      skillMatch: j.skillMatch,
      experienceMatch: j.experienceMatch,
      workModelMatch: j.workModelMatch,
      locationMatch: j.locationMatch,
      jobTypeMatch: j.jobTypeMatch,
      salaryMatch: j.salaryMatch,
      recencyScore: j.recencyScore
    }))
  );

  // ------------------------------------------------------------
  // 8. QUALIFY JOBS
  // ------------------------------------------------------------

  // IMPORTANT:
  //
  // Qualification rules remain exactly the same.
  //
  // It does not matter whether the score came from
  // Groq or Gemini.
  //
  const qualified = scored.filter(
    (j) =>
      j.aiParseSuccess &&
      j.excluded === false &&
      j.overallScore >=
        minimumMatchScore
  );

  // ------------------------------------------------------------
  // 9. QUALIFICATION DEBUG SUMMARY
  // ------------------------------------------------------------

  const excludedCount =
    scored.filter(
      (j) =>
        j.aiParseSuccess &&
        j.excluded === true
    ).length;

  const belowThresholdCount =
    scored.filter(
      (j) =>
        j.aiParseSuccess &&
        j.excluded === false &&
        j.overallScore <
          minimumMatchScore
    ).length;

  console.log(
    `[${candidate.candidateEmail}] QUALIFICATION SUMMARY`,
    {
      minimumMatchScore,

      aiEvaluated:
        scored.length,

      aiFailures:
        summary.aiFailures,

      successfullyScored:
        successfulScores.length,

      excludedCount,

      belowThresholdCount,

      qualifiedCount:
        qualified.length
    }
  );

  // ------------------------------------------------------------
  // 10. SORT QUALIFIED JOBS
  // ------------------------------------------------------------

  qualified.sort((a, b) => {
    if (
      b.overallScore !==
      a.overallScore
    ) {
      return (
        b.overallScore -
        a.overallScore
      );
    }

    return (
      new Date(b.postedDate || 0) -
      new Date(a.postedDate || 0)
    );
  });

  // For now, keep all qualified jobs.
  // maxResults can be applied later once
  // scoring behavior is verified.
  const topResults = qualified;

  summary.qualifiedJobs =
    qualified.length;

  summary.topResultsSaved =
    topResults.length;

  // ------------------------------------------------------------
  // 11. SAVE QUALIFIED JOBS
  // ------------------------------------------------------------

  if (topResults.length > 0) {
    const shortlistRows =
      topResults.map((j) => ({
        jobId: j.jobId,
        candidateEmail:
          candidate.candidateEmail,
        candidateName:
          candidate.candidateName,

        title: j.title,
        company: j.company,
        location: j.location,
        workModel: j.workModel,

        salaryMin: j.salaryMin,
        salaryMax: j.salaryMax,
        salaryCurrency:
          j.salaryCurrency,
        salaryPeriod:
          j.salaryPeriod,

        jobType: j.jobType,
        url: j.url,
        postedDate: j.postedDate,
        sourceName: j.sourceName,

        overallScore:
          j.overallScore,

        titleMatch:
          j.titleMatch,

        skillMatch:
          j.skillMatch,

        experienceMatch:
          j.experienceMatch,

        workModelMatch:
          j.workModelMatch,

        locationMatch:
          j.locationMatch,

        jobTypeMatch:
          j.jobTypeMatch,

        salaryMatch:
          j.salaryMatch,

        recencyScore:
          j.recencyScore,

        matchedSkills: (
          j.matchedSkills || []
        ).join(", "),

        missingSkills: (
          j.missingSkills || []
        ).join(", "),

        rationale:
          j.rationale,

        status: "New",

        dateSaved:
          new Date().toISOString()
      }));

    await upsertRows(
      "Shortlisted Jobs",
      shortlistRows,
      ["jobId", "candidateEmail"]
    );

    // ----------------------------------------------------------
    // 12. SAVE FULL JOB DETAILS SEPARATELY
    // ----------------------------------------------------------
    //
    // Keep large source descriptions out of
    // Shortlisted Jobs while making them available
    // later for document generation and human review.
    //

    const now =
      new Date().toISOString();

    const detailRows =
      topResults.map((j) => ({
        jobId: j.jobId,
        candidateEmail:
          candidate.candidateEmail,

        title: j.title,
        company: j.company,
        location: j.location,
        workModel: j.workModel,
        jobType: j.jobType,

        salaryMin: j.salaryMin,
        salaryMax: j.salaryMax,
        salaryCurrency:
          j.salaryCurrency,
        salaryPeriod:
          j.salaryPeriod,

        url: j.url,
        postedDate: j.postedDate,
        sourceName: j.sourceName,

        description:
          j.description || "",

        overallScore:
          j.overallScore,

        capturedAt: now,
        updatedAt: now
      }));

    await upsertRows(
      "Job Details",
      detailRows,
      ["jobId", "candidateEmail"]
    );

    summary.jobDetailsSaved =
      detailRows.length;
  }

  return summary;
}

module.exports = {
  runDiscoveryForCandidate
};

