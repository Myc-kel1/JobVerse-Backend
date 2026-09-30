const {
  ensureSheetWithHeaders
} = require("../googleSheets");


/*
 * ============================================================
 * GENERATED APPLICATIONS
 * ============================================================
 */

const GENERATED_APPLICATION_HEADERS = [
  // Existing application identity / job information
  "applicationId",
  "jobId",
  "candidateEmail",
  "candidateName",
  "jobTitle",
  "company",
  "overallScore",

  // Existing generation information
  "applicationType",
  "cvStatus",
  "coverLetterStatus",
  "cvFile",
  "coverLetterFile",
  "cvText",
  "coverLetterText",

  // Existing validation information
  "cvValidationStatus",
  "coverLetterValidationStatus",
  "factualWarnings",
  "missingRequirements",
  "keyAlignmentPoints",

  // Existing application lifecycle
  "status",
  "createdAt",
  "updatedAt",

  // Application execution information
  "applicationMethod",
  "applicationMode",
  "executionStatus",
  "applicationUrl",
  "applicationRecipient",
  "submittedAt",
  "lastAttemptAt",
  "attemptCount",
  "confirmationReference",
  "failureReason",
];


/*
 * ============================================================
 * JOB DETAILS
 * ============================================================
 */

const JOB_DETAILS_HEADERS = [
  "jobId",
  "candidateEmail",
  "title",
  "company",
  "location",
  "workModel",
  "jobType",
  "salaryMin",
  "salaryMax",
  "salaryCurrency",
  "salaryPeriod",
  "url",
  "postedDate",
  "sourceName",
  "overallScore",
  "description",
  "capturedAt",
  "updatedAt",
];


/*
 * ============================================================
 * APPLICATION ATTEMPTS
 * ============================================================
 *
 * One row represents one attempt to submit an application.
 *
 * An application can have multiple attempts.
 *
 * Example:
 *
 * Attempt 1
 * → Google Form
 * → needs_review
 *
 * Attempt 2
 * → Google Form
 * → submitted
 */

const APPLICATION_ATTEMPT_HEADERS = [
  "attemptId",
  "applicationId",
  "candidateEmail",
  "jobId",
  "applicationMethod",
  "applicationMode",
  "status",
  "startedAt",
  "completedAt",
  "failureReason",
  "confirmationReference",
  "confirmationUrl",
  "createdAt",
  "updatedAt",
];


/*
 * ============================================================
 * CANDIDATE APPLICATION ANSWERS
 * ============================================================
 *
 * Stores reusable candidate answers.
 *
 * One row:
 *
 * candidate
 * +
 * canonical question
 * +
 * answer
 */

const CANDIDATE_APPLICATION_ANSWER_HEADERS = [
  "candidateEmail",
  "questionKey",
  "questionText",
  "answer",
  "answerType",
  "verified",
  "source",
  "createdAt",
  "updatedAt",
];


/*
 * ============================================================
 * FOLLOW UPS
 * ============================================================
 *
 * Follow-up records created after applications are submitted
 * or whenever a follow-up is explicitly scheduled.
 */

const FOLLOW_UP_HEADERS = [
  "followUpId",
  "applicationId",
  "candidateEmail",
  "jobId",
  "company",
  "jobTitle",
  "dueAt",
  "status",
  "note",
  "completedAt",
  "createdAt",
  "updatedAt",
];


/*
 * ============================================================
 * ACTIVITY LOG
 * ============================================================
 *
 * Permanent activity/audit trail.
 *
 * This will eventually replace the frontend's reconstructed
 * Activity feed.
 */

const ACTIVITY_LOG_HEADERS = [
  "activityId",
  "candidateEmail",
  "entityType",
  "entityId",
  "eventType",
  "status",
  "message",
  "metadata",
  "createdAt",
];


/*
 * ============================================================
 * SEARCH RUNS
 * ============================================================
 *
 * Persistent search-run storage.
 *
 * This prevents JobVerse from depending entirely on the
 * in-memory search run Map.
 */

const SEARCH_RUN_HEADERS = [
  "runId",
  "candidateEmail",
  "status",
  "startedAt",
  "completedAt",
  "totalJobsFound",
  "qualifiedJobs",
  "sourceSummary",
  "error",
  "createdAt",
  "updatedAt",
];


/*
 * ============================================================
 * APPLICATION SHEET INITIALIZATION CACHE
 * ============================================================
 *
 * PROBLEM BEING SOLVED
 * ------------------------------------------------------------
 *
 * ensureApplicationSheets() is called by multiple services:
 *
 * - application generation
 * - candidate answers
 * - application attempts
 * - follow-ups
 * - activity logging
 * - search-run persistence
 *
 * Each complete schema check requires multiple Google Sheets
 * API read requests.
 *
 * Re-running that schema check during every normal CRUD
 * operation can exhaust the Google Sheets per-user read quota.
 *
 *
 * SOLUTION
 * ------------------------------------------------------------
 *
 * Cache the initialization Promise for the lifetime of this
 * Node.js process.
 *
 * First caller:
 *
 *   performs the real schema check
 *
 * Concurrent callers:
 *
 *   await the same Promise
 *
 * Later callers:
 *
 *   immediately reuse the completed Promise
 *
 *
 * FAILURE BEHAVIOR
 * ------------------------------------------------------------
 *
 * If initialization fails, the cached Promise is reset.
 *
 * This is important because a temporary Google/API/network
 * problem must not permanently poison the running process.
 */

let applicationSheetsReadyPromise =
  null;


/*
 * ============================================================
 * PERFORM REAL APPLICATION SHEET INITIALIZATION
 * ============================================================
 *
 * Internal function.
 *
 * This contains the actual Google Sheets API work.
 *
 * It should only run once successfully during a normal server
 * lifecycle.
 */

async function initializeApplicationSheets() {
  /*
   * Existing sheets.
   */
  await ensureSheetWithHeaders(
    "Generated Applications",
    GENERATED_APPLICATION_HEADERS
  );


  await ensureSheetWithHeaders(
    "Job Details",
    JOB_DETAILS_HEADERS
  );


  /*
   * Application execution sheets.
   */
  await ensureSheetWithHeaders(
    "Application Attempts",
    APPLICATION_ATTEMPT_HEADERS
  );


  /*
   * Reusable candidate answers.
   */
  await ensureSheetWithHeaders(
    "Candidate Application Answers",
    CANDIDATE_APPLICATION_ANSWER_HEADERS
  );


  /*
   * Application follow-up lifecycle.
   */
  await ensureSheetWithHeaders(
    "Follow Ups",
    FOLLOW_UP_HEADERS
  );


  /*
   * Permanent application/activity history.
   */
  await ensureSheetWithHeaders(
    "Activity Log",
    ACTIVITY_LOG_HEADERS
  );


  /*
   * Persistent search execution state.
   */
  await ensureSheetWithHeaders(
    "Search Runs",
    SEARCH_RUN_HEADERS
  );


  return true;
}


/*
 * ============================================================
 * ENSURE APPLICATION SHEETS
 * ============================================================
 *
 * Public initialization boundary used throughout JobVerse.
 *
 * IMPORTANT:
 *
 * Calling this repeatedly is safe.
 *
 * After the first successful call, it does NOT repeat the
 * Google Sheets schema checks during the lifetime of this
 * server process.
 */

async function ensureApplicationSheets() {
  /*
   * A successful or currently-running initialization already
   * exists.
   *
   * Return the same Promise instead of making new Google Sheets
   * API calls.
   */
  if (
    applicationSheetsReadyPromise
  ) {
    return applicationSheetsReadyPromise;
  }


  /*
   * Store the Promise immediately.
   *
   * Doing this BEFORE awaiting is important.
   *
   * If several requests call this function at the same time,
   * they all receive the exact same initialization Promise
   * rather than starting duplicate initialization work.
   */
  applicationSheetsReadyPromise =
    initializeApplicationSheets()
      .catch(
        (error) => {
          /*
           * Initialization failed.
           *
           * Clear the cache so another request can retry later.
           */
          applicationSheetsReadyPromise =
            null;

          throw error;
        }
      );


  return applicationSheetsReadyPromise;
}


/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  ensureApplicationSheets,

  GENERATED_APPLICATION_HEADERS,
  JOB_DETAILS_HEADERS,
  APPLICATION_ATTEMPT_HEADERS,
  CANDIDATE_APPLICATION_ANSWER_HEADERS,
  FOLLOW_UP_HEADERS,
  ACTIVITY_LOG_HEADERS,
  SEARCH_RUN_HEADERS,
};