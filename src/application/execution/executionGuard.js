const {
  canExecuteApplication,
  getApplicationEligibilitySummary
} = require(
  "../applicationEligibilityService"
);

const {
  requireApplicationById,
  applicationBelongsToCandidate
} = require(
  "../applicationPersistence"
);

const {
  getApplicationAttempt,
  getActiveAttemptState,
  getSubmittedAttempt
} = require(
  "../attempts/applicationAttemptQueryService"
);

/*
 * ============================================================
 * APPLICATION EXECUTION GUARD
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * Central authorization gate for starting or resuming a real
 * job application execution.
 *
 * Before an application can reach:
 *
 *     email sending
 *     Playwright
 *     Google Forms
 *     ATS forms
 *     company forms
 *
 * it must pass this module.
 *
 * ============================================================
 * CORE EXECUTION RULE
 * ============================================================
 *
 * An application is executable only when:
 *
 *     status = Approved
 *
 * AND:
 *
 *     CV exists
 *
 * AND:
 *
 *     Cover Letter exists
 *
 * AND:
 *
 *     executionStatus = ready
 *
 * AND:
 *
 *     no conflicting active attempt exists
 *
 * ============================================================
 * RESPONSIBILITY BOUNDARY
 * ============================================================
 *
 * This module DOES:
 *
 * - enforce execution eligibility
 * - enforce optional candidate ownership
 * - protect against conflicting active attempts
 * - expose structured execution-readiness information
 *
 * This module DOES NOT:
 *
 * - create attempts
 * - mutate attempts
 * - submit applications
 * - launch Playwright
 * - send emails
 * - fill forms
 * - mark applications Applied
 *
 * ============================================================
 */


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


/*
 * ============================================================
 * EXECUTION GUARD ERROR
 * ============================================================
 *
 * Structured errors make later route/controller handling much
 * cleaner.
 */

class ApplicationExecutionGuardError
  extends Error {
  constructor(
    message,
    {
      code =
        "APPLICATION_EXECUTION_NOT_ALLOWED",

      statusCode =
        409,

      details = {}
    } = {}
  ) {
    super(
      message
    );

    this.name =
      "ApplicationExecutionGuardError";

    this.code =
      code;

    this.statusCode =
      statusCode;

    this.details =
      details;
  }
}


/*
 * ============================================================
 * ASSERT APPLICATION ID
 * ============================================================
 */

function assertApplicationId(
  applicationId
) {
  const normalized =
    normalizeString(
      applicationId
    );

  if (
    !normalized
  ) {
    throw new ApplicationExecutionGuardError(
      "applicationId is required.",
      {
        code:
          "APPLICATION_ID_REQUIRED",

        statusCode:
          400
      }
    );
  }

  return normalized;
}


/*
 * ============================================================
 * CANDIDATE OWNERSHIP
 * ============================================================
 *
 * candidateEmail is optional because trusted internal services
 * may operate using applicationId alone.
 *
 * Candidate-facing APIs should pass it.
 *
 * NOTE:
 *
 * candidateEmail is an ownership consistency check, not proper
 * authentication.
 */

function assertCandidateOwnershipIfProvided(
  application,
  candidateEmail
) {
  const normalizedEmail =
    normalizeString(
      candidateEmail
    );

  if (
    !normalizedEmail
  ) {
    return true;
  }


  if (
    !applicationBelongsToCandidate(
      application,
      normalizedEmail
    )
  ) {
    /*
     * We intentionally respond using not-found semantics.
     *
     * This avoids revealing whether another candidate's
     * application exists.
     */
    throw new ApplicationExecutionGuardError(
      "Application not found.",
      {
        code:
          "APPLICATION_NOT_FOUND",

        statusCode:
          404
      }
    );
  }


  return true;
}


/*
 * ============================================================
 * ASSERT APPLICATION HAS NOT ALREADY BEEN SUBMITTED
 * ============================================================
 *
 * Even if application state somehow becomes inconsistent,
 * an existing submitted attempt must prevent another blind
 * execution.
 *
 * This is defense-in-depth against duplicate applications.
 */

async function assertNoSubmittedAttempt(
  applicationId
) {
  const submittedAttempt =
    await getSubmittedAttempt(
      applicationId
    );

  if (
    !submittedAttempt
  ) {
    return null;
  }

  throw new ApplicationExecutionGuardError(
    "This application already has a submitted attempt.",
    {
      code:
        "APPLICATION_ALREADY_SUBMITTED",

      statusCode:
        409,

      details: {
        attemptId:
          submittedAttempt
            .attemptId ||
          "",

        submittedAt:
          submittedAttempt
            .completedAt ||
          submittedAttempt
            .updatedAt ||
          ""
      }
    }
  );
}


/*
 * ============================================================
 * ASSERT NO ACTIVE EXECUTION ATTEMPT
 * ============================================================
 *
 * Reads the authoritative attempt state through the dedicated
 * query service.
 *
 * JobVerse must never intentionally start a second execution
 * while another pending/applying/needs_review attempt exists.
 */

async function assertNoActiveExecutionAttempt(
  applicationId
) {
  const state =
    await getActiveAttemptState(
      applicationId
    );

  /*
   * ----------------------------------------------------------
   * DATA-INTEGRITY CONFLICT
   * ----------------------------------------------------------
   *
   * Multiple active attempts should never normally exist.
   *
   * Do not guess which one is authoritative.
   */
  if (
    state.hasConflict
  ) {
    throw new ApplicationExecutionGuardError(
      "Multiple active application attempts were found. Execution requires reconciliation before continuing.",
      {
        code:
          "MULTIPLE_ACTIVE_APPLICATION_ATTEMPTS",

        statusCode:
          409,

        details: {
          activeAttemptCount:
            state.count,

          attemptIds:
            state.attempts
              .map(
                (attempt) =>
                  attempt
                    .attemptId
              )
              .filter(
                Boolean
              )
        }
      }
    );
  }

  /*
   * ----------------------------------------------------------
   * NORMAL ACTIVE ATTEMPT
   * ----------------------------------------------------------
   */

  if (
    state.hasActiveAttempt
  ) {
    throw new ApplicationExecutionGuardError(
      "An application execution attempt is already active.",
      {
        code:
          "APPLICATION_ATTEMPT_ALREADY_ACTIVE",

        statusCode:
          409,

        details: {
          attemptId:
            state.activeAttempt
              ?.attemptId ||
            "",

          attemptStatus:
            state.activeAttempt
              ?.status ||
            ""
        }
      }
    );
  }

  return state;
}


/*
 * ============================================================
 * EXECUTION ELIGIBILITY
 * ============================================================
 *
 * Delegates lifecycle/document rules to the authoritative
 * eligibility service.
 *
 * executionGuard does NOT recreate those rules.
 */

function assertExecutionEligibility(
  application
) {
  if (
    !application
  ) {
    throw new ApplicationExecutionGuardError(
      "Application is required.",
      {
        code:
          "APPLICATION_REQUIRED",

        statusCode:
          400
      }
    );
  }


  const result =
    canExecuteApplication(
      application
    );


  if (
    result?.eligible
  ) {
    return result;
  }


  throw new ApplicationExecutionGuardError(
    "Application is not eligible for execution.",
    {
      code:
        "APPLICATION_NOT_EXECUTABLE",

      statusCode:
        409,

      details: {
        /*
         * Preserve structured eligibility reasons when provided
         * by applicationEligibilityService.
         */
        reasons:
          result?.reasons ||
          result?.reason ||
          [],

        applicationStatus:
          application.status ||
          "",

        executionStatus:
          application.executionStatus ||
          ""
      }
    }
  );
}


/*
 * ============================================================
 * ASSERT EXECUTION CAN START
 * ============================================================
 *
 * Main authorization gate for a NEW application execution.
 *
 * Required conditions:
 *
 *     application exists
 *          +
 *     candidate owns it, when candidateEmail supplied
 *          +
 *     Approved
 *          +
 *     generated CV
 *          +
 *     generated cover letter
 *          +
 *     executionStatus = ready
 *          +
 *     no submitted attempt already exists
 *          +
 *     no active attempt exists
 *
 * Only after this succeeds should JobVerse create a new
 * Application Attempt.
 */

async function assertCanStartExecution(
  applicationId,
  {
    candidateEmail
  } = {}
) {
  const normalizedApplicationId =
    assertApplicationId(
      applicationId
    );

  /*
   * ----------------------------------------------------------
   * LOAD APPLICATION
   * ----------------------------------------------------------
   */

  const application =
    await requireApplicationById(
      normalizedApplicationId
    );

  /*
   * ----------------------------------------------------------
   * OWNERSHIP
   * ----------------------------------------------------------
   */

  assertCandidateOwnershipIfProvided(
    application,
    candidateEmail
  );

  /*
   * ----------------------------------------------------------
   * APPLICATION ELIGIBILITY
   * ----------------------------------------------------------
   */

  const eligibility =
    assertExecutionEligibility(
      application
    );

  /*
   * ----------------------------------------------------------
   * DUPLICATE SUBMISSION PROTECTION
   * ----------------------------------------------------------
   *
   * Check before active attempt state.
   */
  await assertNoSubmittedAttempt(
    normalizedApplicationId
  );

  /*
   * ----------------------------------------------------------
   * ACTIVE ATTEMPT PROTECTION
   * ----------------------------------------------------------
   */

  await assertNoActiveExecutionAttempt(
    normalizedApplicationId
  );

  return {
    allowed:
      true,

    application,

    eligibility
  };
}


/*
 * ============================================================
 * EXECUTION READINESS
 * ============================================================
 *
 * Non-mutating inspection endpoint/helper.
 *
 * Useful for:
 *
 * - execution preview
 * - frontend Start Application button
 * - diagnostics
 *
 * This function does not create or modify attempts.
 */

async function getExecutionReadiness(
  applicationId,
  {
    candidateEmail
  } = {}
) {
  const normalizedApplicationId =
    assertApplicationId(
      applicationId
    );

  const application =
    await requireApplicationById(
      normalizedApplicationId
    );

  assertCandidateOwnershipIfProvided(
    application,
    candidateEmail
  );

  /*
   * ----------------------------------------------------------
   * APPLICATION ELIGIBILITY
   * ----------------------------------------------------------
   */

  const eligibility =
    canExecuteApplication(
      application
    );

  /*
   * ----------------------------------------------------------
   * ATTEMPT STATE
   * ----------------------------------------------------------
   */

  const [
    activeState,
    submittedAttempt
  ] =
    await Promise.all([
      getActiveAttemptState(
        normalizedApplicationId
      ),

      getSubmittedAttempt(
        normalizedApplicationId
      )
    ]);

  const lifecycleEligible =
    Boolean(
      eligibility?.eligible
    );

  const noActiveAttempt =
    !activeState
      .hasActiveAttempt;

  const noActiveConflict =
    !activeState
      .hasConflict;

  const notPreviouslySubmitted =
    !submittedAttempt;

  const blockers =
    [];

  if (
    !lifecycleEligible
  ) {
    blockers.push(
      "application_not_executable"
    );
  }

  if (
    submittedAttempt
  ) {
    blockers.push(
      "application_already_submitted"
    );
  }

  if (
    activeState
      .hasConflict
  ) {
    blockers.push(
      "multiple_active_attempts"
    );
  } else if (
    activeState
      .hasActiveAttempt
  ) {
    blockers.push(
      "active_attempt_exists"
    );
  }

  return {
    allowed:
      lifecycleEligible &&
      noActiveAttempt &&
      noActiveConflict &&
      notPreviouslySubmitted,

    application,

    eligibility,

    eligibilitySummary:
      getApplicationEligibilitySummary(
        application
      ),

    activeAttempt:
      activeState
        .activeAttempt
      ? {
          attemptId:
            activeState
              .activeAttempt
              .attemptId ||
            "",

          status:
            activeState
              .activeAttempt
              .status ||
            ""
        }
      : null,

    submittedAttempt:
      submittedAttempt
      ? {
          attemptId:
            submittedAttempt
              .attemptId ||
            "",

          status:
            submittedAttempt
              .status ||
            "",

          completedAt:
            submittedAttempt
              .completedAt ||
            ""
        }
      : null,

    activeAttemptCount:
      activeState.count,

    blockers
  };
}


/*
 * ============================================================
 * ASSERT EXECUTION CAN RESUME
 * ============================================================
 *
 * Resume differs from starting.
 *
 * Starting:
 *     must have NO active attempt
 *
 * Resuming:
 *     requires an EXISTING attempt
 *
 * This guard verifies the attempt belongs to the requested
 * application and candidate.
 */

async function assertCanResumeExecution(
  applicationId,
  attemptId,
  {
    candidateEmail
  } = {}
) {
  const normalizedApplicationId =
    assertApplicationId(
      applicationId
    );

  const normalizedAttemptId =
    normalizeString(
      attemptId
    );

  if (
    !normalizedAttemptId
  ) {
    throw new ApplicationExecutionGuardError(
      "attemptId is required for execution resume.",
      {
        code:
          "APPLICATION_ATTEMPT_REQUIRED",

        statusCode:
          400
      }
    );
  }

  /*
   * ----------------------------------------------------------
   * APPLICATION
   * ----------------------------------------------------------
   */

  const application =
    await requireApplicationById(
      normalizedApplicationId
    );

  assertCandidateOwnershipIfProvided(
    application,
    candidateEmail
  );

  /*
   * ----------------------------------------------------------
   * ATTEMPT
   * ----------------------------------------------------------
   *
   * Query service enforces both application and optional
   * candidate ownership.
   */

  const attempt =
    await getApplicationAttempt(
      normalizedAttemptId,
      {
        applicationId:
          normalizedApplicationId,

        candidateEmail
      }
    );

  if (
    !attempt
  ) {
    throw new ApplicationExecutionGuardError(
      "Application attempt not found.",
      {
        code:
          "APPLICATION_ATTEMPT_NOT_FOUND",

        statusCode:
          404
      }
    );
  }

  const attemptStatus =
    normalizeLower(
      attempt.status
    );

  /*
   * ----------------------------------------------------------
   * TERMINAL STATES
   * ----------------------------------------------------------
   */

  if (
    attemptStatus ===
    "submitted"
  ) {
    throw new ApplicationExecutionGuardError(
      "A submitted application attempt cannot be resumed.",
      {
        code:
          "APPLICATION_ALREADY_SUBMITTED",

        statusCode:
          409,

        details: {
          attemptId:
            attempt.attemptId
        }
      }
    );
  }

  if (
    attemptStatus ===
    "failed"
  ) {
    throw new ApplicationExecutionGuardError(
      "A failed application attempt cannot be resumed directly. A controlled retry is required.",
      {
        code:
          "APPLICATION_ATTEMPT_FAILED",

        statusCode:
          409,

        details: {
          attemptId:
            attempt.attemptId
        }
      }
    );
  }

  if (
    attemptStatus ===
    "cancelled"
  ) {
    throw new ApplicationExecutionGuardError(
      "A cancelled application attempt cannot be resumed.",
      {
        code:
          "APPLICATION_ATTEMPT_CANCELLED",

        statusCode:
          409,

        details: {
          attemptId:
            attempt.attemptId
        }
      }
    );
  }

  /*
   * More detailed resume eligibility such as:
   *
   * - why execution paused
   * - missing answers
   * - human handoff
   * - browser recovery
   *
   * will belong to executionResumeService.js.
   */

  return {
    allowed:
      true,

    application,

    attempt,

    eligibilitySummary:
      getApplicationEligibilitySummary(
        application
      )
  };
}


/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  /*
   * Main execution gates.
   */
  assertCanStartExecution,
  assertCanResumeExecution,

  /*
   * Readiness inspection.
   */
  getExecutionReadiness,

  /*
   * Application eligibility.
   */
  assertExecutionEligibility,

  /*
   * Attempt protection.
   */
  assertNoActiveExecutionAttempt,
  assertNoSubmittedAttempt,

  /*
   * Ownership.
   */
  assertCandidateOwnershipIfProvided,

  /*
   * Error.
   */
  ApplicationExecutionGuardError
};
