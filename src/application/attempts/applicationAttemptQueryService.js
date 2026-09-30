const {
  getAttemptById,
  getAttemptsByApplicationId,
  getAttemptsByCandidate,
  sortAttemptsNewestFirst,
  attemptBelongsToApplication,
  attemptBelongsToCandidate
} = require(
  "./applicationAttemptPersistence"
);


/*
 * ============================================================
 * APPLICATION ATTEMPT QUERY SERVICE
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * Read-only business-query layer for Application Attempts.
 *
 * Persistence answers:
 *
 *     "What rows exist?"
 *
 * This service answers:
 *
 *     "Which attempt is active?"
 *     "What is the latest attempt?"
 *     "Is there already an execution in progress?"
 *     "Which attempt may potentially be resumed?"
 *
 * ============================================================
 * THIS MODULE DOES NOT
 * ============================================================
 *
 * - create attempts
 * - update attempts
 * - start browser execution
 * - mark attempts submitted
 * - mutate applications
 *
 * ============================================================
 */


/*
 * ============================================================
 * ATTEMPT STATUS DEFINITIONS
 * ============================================================
 *
 * These represent the current JobVerse attempt lifecycle.
 *
 * ACTIVE statuses block creation of another execution attempt.
 *
 * TERMINAL statuses no longer represent an in-progress execution.
 */

const ACTIVE_ATTEMPT_STATUSES =
  Object.freeze([
    "pending",
    "applying",
    "needs_review"
  ]);


const TERMINAL_ATTEMPT_STATUSES =
  Object.freeze([
    "submitted",
    "failed",
    "cancelled"
  ]);


/*
 * ============================================================
 * RESUMABLE ATTEMPT STATUSES
 * ============================================================
 *
 * needs_review:
 *     candidate/human intervention is required
 *
 * applying:
 *     may become resumable after interrupted execution,
 *     although later recovery logic must determine whether
 *     resuming is actually safe.
 *
 * pending:
 *     execution was created but may not have started yet.
 *
 * IMPORTANT:
 *
 * This means "candidate for resume", not:
 *
 *     "resume immediately without checks"
 *
 * executionResumeService.js will eventually perform the stronger
 * safety checks.
 */

const POTENTIALLY_RESUMABLE_STATUSES =
  Object.freeze([
    "pending",
    "applying",
    "needs_review"
  ]);


/*
 * ============================================================
 * NORMALIZATION
 * ============================================================
 */

function normalizeString(
  value
) {
  return String(
    value ?? ""
  ).trim();
}


function normalizeLower(
  value
) {
  return normalizeString(
    value
  ).toLowerCase();
}


function normalizeEmail(
  value
) {
  return normalizeLower(
    value
  );
}


/*
 * ============================================================
 * STATUS HELPERS
 * ============================================================
 */

function getAttemptStatus(
  attempt
) {
  return normalizeLower(
    attempt?.status
  );
}


function isAttemptStatus(
  attempt,
  expectedStatus
) {
  return (
    getAttemptStatus(
      attempt
    ) ===
    normalizeLower(
      expectedStatus
    )
  );
}


function isActiveAttempt(
  attempt
) {
  return ACTIVE_ATTEMPT_STATUSES
    .includes(
      getAttemptStatus(
        attempt
      )
    );
}


function isTerminalAttempt(
  attempt
) {
  return TERMINAL_ATTEMPT_STATUSES
    .includes(
      getAttemptStatus(
        attempt
      )
    );
}


function isPotentiallyResumableAttempt(
  attempt
) {
  return POTENTIALLY_RESUMABLE_STATUSES
    .includes(
      getAttemptStatus(
        attempt
      )
    );
}


/*
 * ============================================================
 * GET ATTEMPT
 * ============================================================
 *
 * Optional ownership checks may be supplied.
 *
 * If an ownership check fails, null is returned instead of
 * exposing another candidate/application attempt.
 */

async function getApplicationAttempt(
  attemptId,
  {
    applicationId,
    candidateEmail
  } = {}
) {
  const normalizedAttemptId =
    normalizeString(
      attemptId
    );


  if (
    !normalizedAttemptId
  ) {
    return null;
  }


  const attempt =
    await getAttemptById(
      normalizedAttemptId
    );


  if (
    !attempt
  ) {
    return null;
  }


  /*
   * ----------------------------------------------------------
   * APPLICATION OWNERSHIP
   * ----------------------------------------------------------
   */

  if (
    normalizeString(
      applicationId
    ) &&
    !attemptBelongsToApplication(
      attempt,
      applicationId
    )
  ) {
    return null;
  }


  /*
   * ----------------------------------------------------------
   * CANDIDATE OWNERSHIP
   * ----------------------------------------------------------
   */

  if (
    normalizeEmail(
      candidateEmail
    ) &&
    !attemptBelongsToCandidate(
      attempt,
      candidateEmail
    )
  ) {
    return null;
  }


  return attempt;
}


/*
 * ============================================================
 * LIST ATTEMPTS FOR APPLICATION
 * ============================================================
 *
 * Newest attempts are returned first.
 */

async function listAttemptsForApplication(
  applicationId
) {
  const normalizedApplicationId =
    normalizeString(
      applicationId
    );


  if (
    !normalizedApplicationId
  ) {
    return [];
  }


  const attempts =
    await getAttemptsByApplicationId(
      normalizedApplicationId
    );


  return sortAttemptsNewestFirst(
    attempts
  );
}


/*
 * ============================================================
 * LIST ATTEMPTS FOR CANDIDATE
 * ============================================================
 */

async function listAttemptsForCandidate(
  candidateEmail
) {
  const normalizedCandidateEmail =
    normalizeEmail(
      candidateEmail
    );


  if (
    !normalizedCandidateEmail
  ) {
    return [];
  }


  const attempts =
    await getAttemptsByCandidate(
      normalizedCandidateEmail
    );


  return sortAttemptsNewestFirst(
    attempts
  );
}


/*
 * ============================================================
 * GET LATEST ATTEMPT
 * ============================================================
 */

async function getLatestAttemptForApplication(
  applicationId
) {
  const attempts =
    await listAttemptsForApplication(
      applicationId
    );


  return (
    attempts[0] ||
    null
  );
}


/*
 * ============================================================
 * GET ACTIVE ATTEMPTS
 * ============================================================
 *
 * Normally there should be no more than ONE.
 *
 * Returning the entire list is still useful for:
 *
 * - diagnostics
 * - corruption detection
 * - recovery
 * - testing
 */

async function getActiveAttemptsForApplication(
  applicationId
) {
  const attempts =
    await listAttemptsForApplication(
      applicationId
    );


  return attempts.filter(
    isActiveAttempt
  );
}


/*
 * ============================================================
 * GET ACTIVE ATTEMPT
 * ============================================================
 *
 * Main function used by executionGuard.
 *
 * Newest active attempt wins for the lookup.
 *
 * IMPORTANT:
 *
 * If multiple active attempts somehow exist, we do NOT silently
 * consider that healthy.
 *
 * The additional helper below exposes that conflict.
 */

async function getActiveAttemptForApplication(
  applicationId
) {
  const attempts =
    await getActiveAttemptsForApplication(
      applicationId
    );


  return (
    attempts[0] ||
    null
  );
}


/*
 * ============================================================
 * ACTIVE ATTEMPT EXISTS
 * ============================================================
 */

async function hasActiveAttemptForApplication(
  applicationId
) {
  return Boolean(
    await getActiveAttemptForApplication(
      applicationId
    )
  );
}


/*
 * ============================================================
 * ACTIVE ATTEMPT CONFLICT
 * ============================================================
 *
 * JobVerse should never intentionally create multiple active
 * attempts for a single application.
 *
 * If this returns true, stored state needs reconciliation.
 */

async function hasMultipleActiveAttempts(
  applicationId
) {
  const attempts =
    await getActiveAttemptsForApplication(
      applicationId
    );


  return (
    attempts.length >
    1
  );
}


/*
 * ============================================================
 * GET ACTIVE ATTEMPT STATE
 * ============================================================
 *
 * Gives execution services richer diagnostics than simply:
 *
 *     true / false
 */

async function getActiveAttemptState(
  applicationId
) {
  const attempts =
    await getActiveAttemptsForApplication(
      applicationId
    );


  return {
    hasActiveAttempt:
      attempts.length >
      0,

    hasConflict:
      attempts.length >
      1,

    count:
      attempts.length,

    activeAttempt:
      attempts[0] ||
      null,

    attempts
  };
}


/*
 * ============================================================
 * LIST TERMINAL ATTEMPTS
 * ============================================================
 */

async function getTerminalAttemptsForApplication(
  applicationId
) {
  const attempts =
    await listAttemptsForApplication(
      applicationId
    );


  return attempts.filter(
    isTerminalAttempt
  );
}


/*
 * ============================================================
 * GET LATEST TERMINAL ATTEMPT
 * ============================================================
 */

async function getLatestTerminalAttempt(
  applicationId
) {
  const attempts =
    await getTerminalAttemptsForApplication(
      applicationId
    );


  return (
    attempts[0] ||
    null
  );
}


/*
 * ============================================================
 * GET POTENTIALLY RESUMABLE ATTEMPT
 * ============================================================
 *
 * This only identifies a possible existing attempt.
 *
 * It does NOT decide that browser execution can safely resume.
 *
 * That decision will belong to:
 *
 *     executionResumeService.js
 */

async function getPotentiallyResumableAttempt(
  applicationId
) {
  const attempts =
    await listAttemptsForApplication(
      applicationId
    );


  return (
    attempts.find(
      isPotentiallyResumableAttempt
    ) ||
    null
  );
}


/*
 * ============================================================
 * GET SUBMITTED ATTEMPT
 * ============================================================
 *
 * Useful for idempotency.
 *
 * If an application already has a submitted attempt, execution
 * services should never create another submission blindly.
 */

async function getSubmittedAttempt(
  applicationId
) {
  const attempts =
    await listAttemptsForApplication(
      applicationId
    );


  return (
    attempts.find(
      (attempt) =>
        isAttemptStatus(
          attempt,
          "submitted"
        )
    ) ||
    null
  );
}


/*
 * ============================================================
 * HAS SUBMITTED ATTEMPT
 * ============================================================
 */

async function hasSubmittedAttempt(
  applicationId
) {
  return Boolean(
    await getSubmittedAttempt(
      applicationId
    )
  );
}


/*
 * ============================================================
 * ATTEMPT SUMMARY
 * ============================================================
 *
 * Useful later for:
 *
 * - execution preview
 * - application detail page
 * - diagnostics
 */

async function getApplicationAttemptSummary(
  applicationId
) {
  const attempts =
    await listAttemptsForApplication(
      applicationId
    );


  const activeAttempts =
    attempts.filter(
      isActiveAttempt
    );


  const submittedAttempts =
    attempts.filter(
      (attempt) =>
        isAttemptStatus(
          attempt,
          "submitted"
        )
    );


  const failedAttempts =
    attempts.filter(
      (attempt) =>
        isAttemptStatus(
          attempt,
          "failed"
        )
    );


  return {
    total:
      attempts.length,

    active:
      activeAttempts.length,

    submitted:
      submittedAttempts.length,

    failed:
      failedAttempts.length,

    hasActiveAttempt:
      activeAttempts.length >
      0,

    hasActiveConflict:
      activeAttempts.length >
      1,

    hasSubmittedAttempt:
      submittedAttempts.length >
      0,

    latestAttempt:
      attempts[0] ||
      null,

    activeAttempt:
      activeAttempts[0] ||
      null
  };
}


/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  /*
   * Status definitions.
   */
  ACTIVE_ATTEMPT_STATUSES,
  TERMINAL_ATTEMPT_STATUSES,
  POTENTIALLY_RESUMABLE_STATUSES,


  /*
   * Status helpers.
   */
  getAttemptStatus,
  isAttemptStatus,
  isActiveAttempt,
  isTerminalAttempt,
  isPotentiallyResumableAttempt,


  /*
   * Single attempt.
   */
  getApplicationAttempt,


  /*
   * Lists.
   */
  listAttemptsForApplication,
  listAttemptsForCandidate,


  /*
   * Latest.
   */
  getLatestAttemptForApplication,


  /*
   * Active execution.
   */
  getActiveAttemptsForApplication,
  getActiveAttemptForApplication,
  hasActiveAttemptForApplication,
  hasMultipleActiveAttempts,
  getActiveAttemptState,


  /*
   * Terminal history.
   */
  getTerminalAttemptsForApplication,
  getLatestTerminalAttempt,


  /*
   * Resume preparation.
   */
  getPotentiallyResumableAttempt,


  /*
   * Submission/idempotency.
   */
  getSubmittedAttempt,
  hasSubmittedAttempt,


  /*
   * Summary.
   */
  getApplicationAttemptSummary
};