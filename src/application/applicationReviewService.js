const {
  APPLICATION_STATUSES,
  EXECUTION_STATUSES,

  assertApplicationStatusTransition,
  getApplicationEligibilitySummary
} = require(
  "./applicationEligibilityService"
);

const {
  requireApplicationById,
  saveUpdatedApplication,

  applicationBelongsToCandidate
} = require(
  "./applicationPersistence"
);


/*
 * ============================================================
 * APPLICATION REVIEW SERVICE
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * Own candidate-controlled application review transitions.
 *
 * Lifecycle handled here:
 *
 *     Generated
 *         ↓
 *     Under Review
 *        ↙   ↘
 * Rejected   Approved
 *
 * ============================================================
 * THIS MODULE DOES NOT
 * ============================================================
 *
 * - generate CVs
 * - generate cover letters
 * - submit job applications
 * - mark an application Applied
 * - inspect browser forms
 * - query all workspace records
 *
 * Those responsibilities belong to other modules.
 *
 * ============================================================
 */


/*
 * ============================================================
 * REVIEW TARGETS
 * ============================================================
 *
 * Only these statuses may be assigned through the review
 * service.
 *
 * Generated:
 *     owned by document generation
 *
 * Applied:
 *     owned by confirmed application submission
 */

const REVIEW_TARGET_STATUSES =
  Object.freeze([
    APPLICATION_STATUSES
      .UNDER_REVIEW,

    APPLICATION_STATUSES
      .APPROVED,

    APPLICATION_STATUSES
      .REJECTED
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


/*
 * ============================================================
 * CANONICAL REVIEW STATUS
 * ============================================================
 *
 * Allows callers to send:
 *
 *     "approved"
 *     "Approved"
 *     " APPROVED "
 *
 * while persistence always receives the canonical value:
 *
 *     "Approved"
 */

function resolveReviewStatus(
  requestedStatus
) {
  const normalized =
    normalizeLower(
      requestedStatus
    );

  return (
    REVIEW_TARGET_STATUSES.find(
      (status) =>
        normalizeLower(
          status
        ) ===
        normalized
    ) ||
    null
  );
}


/*
 * ============================================================
 * REVIEW SERVICE ERROR
 * ============================================================
 *
 * Gives future API routes predictable error metadata without
 * coupling this service directly to Express.
 */

class ApplicationReviewError extends Error {
  constructor(
    message,
    {
      code =
        "APPLICATION_REVIEW_ERROR",

      statusCode =
        409,

      details = {}
    } = {}
  ) {
    super(
      message
    );

    this.name =
      "ApplicationReviewError";

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
 * ASSERT VALID REVIEW TARGET
 * ============================================================
 */

function assertValidReviewTarget(
  requestedStatus
) {
  const status =
    resolveReviewStatus(
      requestedStatus
    );

  if (
    !status
  ) {
    throw new ApplicationReviewError(
      "Review status must be Under Review, Approved, or Rejected.",
      {
        code:
          "INVALID_REVIEW_STATUS",

        statusCode:
          400,

        details: {
          requestedStatus:
            normalizeString(
              requestedStatus
            )
        }
      }
    );
  }

  return status;
}


/*
 * ============================================================
 * ACTIVE EXECUTION PROTECTION
 * ============================================================
 *
 * Review decisions must not silently overwrite an application
 * while a browser/email execution is already active.
 *
 * Example:
 *
 *     Approved
 *       ↓
 *     applying
 *
 * should not suddenly become:
 *
 *     Rejected
 *
 * while a worker is still submitting it.
 *
 * These execution states therefore block manual review-state
 * changes.
 */

const REVIEW_MUTATION_BLOCKED_EXECUTION_STATUSES =
  new Set([
    EXECUTION_STATUSES
      .APPLYING,

    EXECUTION_STATUSES
      .NEEDS_REVIEW,

    EXECUTION_STATUSES
      .SUBMITTED
  ]);


function assertReviewMutationSafe(
  application
) {
  const executionStatus =
    normalizeLower(
      application
        ?.executionStatus
    );

  if (
    REVIEW_MUTATION_BLOCKED_EXECUTION_STATUSES
      .has(
        executionStatus
      )
  ) {
    throw new ApplicationReviewError(
      "Application review status cannot be changed while application execution is active or already submitted.",
      {
        code:
          "APPLICATION_EXECUTION_ACTIVE",

        statusCode:
          409,

        details: {
          applicationId:
            application
              ?.applicationId ||
            "",

          executionStatus:
            application
              ?.executionStatus ||
            ""
        }
      }
    );
  }

  return true;
}


/*
 * ============================================================
 * OPTIONAL CANDIDATE OWNERSHIP CHECK
 * ============================================================
 *
 * Internal services may call review operations using only an
 * applicationId.
 *
 * Candidate-facing API routes should also pass candidateEmail.
 *
 * When candidateEmail is supplied, ownership is verified.
 */

function assertCandidateOwnershipIfProvided(
  application,
  candidateEmail
) {
  const normalizedCandidateEmail =
    normalizeString(
      candidateEmail
    );

  /*
   * No email supplied:
   *
   * allow internal trusted service usage.
   */
  if (
    !normalizedCandidateEmail
  ) {
    return true;
  }

  if (
    !applicationBelongsToCandidate(
      application,
      normalizedCandidateEmail
    )
  ) {
    /*
     * Return 404 semantics rather than revealing another
     * candidate's application exists.
     */
    throw new ApplicationReviewError(
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
 * SYNCHRONIZE EXECUTION STATUS
 * ============================================================
 *
 * Application lifecycle status and execution status are related
 * but intentionally separate.
 *
 * Under Review
 *     → not_ready
 *
 * Approved
 *     → ready
 *
 * Rejected
 *     → not_ready
 */

function getExecutionStatusForReviewStatus(
  reviewStatus
) {
  switch (
    reviewStatus
  ) {
    case APPLICATION_STATUSES
      .UNDER_REVIEW:
      return EXECUTION_STATUSES
        .NOT_READY;


    case APPLICATION_STATUSES
      .APPROVED:
      return EXECUTION_STATUSES
        .READY;


    case APPLICATION_STATUSES
      .REJECTED:
      return EXECUTION_STATUSES
        .NOT_READY;


    default:
      throw new ApplicationReviewError(
        "Unsupported application review status.",
        {
          code:
            "UNSUPPORTED_REVIEW_STATUS",

          statusCode:
            400,

          details: {
            reviewStatus
          }
        }
      );
  }
}


/*
 * ============================================================
 * BUILD REVIEW RESULT
 * ============================================================
 *
 * Standard result shape for:
 *
 * - API responses
 * - tests
 * - frontend integrations
 */

function buildReviewResult(
  application,
  {
    previousStatus = ""
  } = {}
) {
  return {
    application,

    transition: {
      previousStatus,

      currentStatus:
        application.status
    },

    eligibility:
      getApplicationEligibilitySummary(
        application
      )
  };
}


/*
 * ============================================================
 * TRANSITION APPLICATION REVIEW STATUS
 * ============================================================
 *
 * Main mutation function.
 *
 * Higher-level convenience functions below call this function.
 */

async function transitionApplicationReviewStatus(
  applicationId,
  requestedStatus,
  {
    candidateEmail
  } = {}
) {
  const normalizedApplicationId =
    normalizeString(
      applicationId
    );

  if (
    !normalizedApplicationId
  ) {
    throw new ApplicationReviewError(
      "applicationId is required.",
      {
        code:
          "APPLICATION_ID_REQUIRED",

        statusCode:
          400
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * LOAD APPLICATION
   * ----------------------------------------------------------
   *
   * Persistence concerns stay inside applicationPersistence.js.
   */

  const application =
    await requireApplicationById(
      normalizedApplicationId
    );


  /*
   * ----------------------------------------------------------
   * OWNERSHIP CHECK
   * ----------------------------------------------------------
   */

  assertCandidateOwnershipIfProvided(
    application,
    candidateEmail
  );


  /*
   * ----------------------------------------------------------
   * NORMALIZE TARGET STATUS
   * ----------------------------------------------------------
   */

  const targetStatus =
    assertValidReviewTarget(
      requestedStatus
    );


  const previousStatus =
    application.status;


  /*
   * ----------------------------------------------------------
   * IDEMPOTENT REQUEST
   * ----------------------------------------------------------
   *
   * Repeating:
   *
   *     Approved → Approved
   *
   * should not create unnecessary writes.
   */

  if (
    normalizeLower(
      previousStatus
    ) ===
    normalizeLower(
      targetStatus
    )
  ) {
    return buildReviewResult(
      application,
      {
        previousStatus
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * PROTECT ACTIVE EXECUTION
   * ----------------------------------------------------------
   */

  assertReviewMutationSafe(
    application
  );


  /*
   * ----------------------------------------------------------
   * AUTHORITATIVE LIFECYCLE VALIDATION
   * ----------------------------------------------------------
   *
   * This handles rules including:
   *
   * Generated -> Under Review
   *
   * Under Review -> Approved
   *
   * Under Review -> Rejected
   *
   * Approved -> Rejected
   *
   * and rejects illegal jumps.
   *
   * It also verifies generated documents where required.
   */

  assertApplicationStatusTransition(
    application,
    targetStatus
  );


  /*
   * ----------------------------------------------------------
   * BUILD UPDATED RECORD
   * ----------------------------------------------------------
   */

  const updated = {
    ...application,

    status:
      targetStatus,

    executionStatus:
      getExecutionStatusForReviewStatus(
        targetStatus
      )
  };


  /*
   * Approval represents a clean transition into an executable
   * state.
   *
   * Old generation/execution failure messages should not remain
   * visible after a legitimate approval.
   */
  if (
    targetStatus ===
    APPLICATION_STATUSES
      .APPROVED
  ) {
    updated.failureReason =
      "";
  }


  /*
   * ----------------------------------------------------------
   * PERSIST
   * ----------------------------------------------------------
   *
   * saveUpdatedApplication() automatically sets updatedAt.
   */

  const persisted =
    await saveUpdatedApplication(
      updated
    );


  return buildReviewResult(
    persisted,
    {
      previousStatus
    }
  );
}


/*
 * ============================================================
 * MOVE TO UNDER REVIEW
 * ============================================================
 *
 * This is the explicit gate that converts:
 *
 *     generated documents
 *
 * into:
 *
 *     an application being reviewed by the candidate
 *
 * Required state:
 *
 *     Generated
 *     +
 *     CV exists
 *     +
 *     Cover letter exists
 */

async function moveApplicationToReview(
  applicationId,
  options = {}
) {
  return transitionApplicationReviewStatus(
    applicationId,

    APPLICATION_STATUSES
      .UNDER_REVIEW,

    options
  );
}


/*
 * ============================================================
 * APPROVE APPLICATION
 * ============================================================
 *
 * Required state:
 *
 *     Under Review
 *
 * Result:
 *
 *     status = Approved
 *     executionStatus = ready
 *
 * This does NOT start execution.
 */

async function approveApplication(
  applicationId,
  options = {}
) {
  return transitionApplicationReviewStatus(
    applicationId,

    APPLICATION_STATUSES
      .APPROVED,

    options
  );
}


/*
 * ============================================================
 * REJECT APPLICATION
 * ============================================================
 *
 * Candidate chooses not to continue with the prepared
 * application.
 *
 * Result:
 *
 *     status = Rejected
 *     executionStatus = not_ready
 */

async function rejectApplication(
  applicationId,
  options = {}
) {
  return transitionApplicationReviewStatus(
    applicationId,

    APPLICATION_STATUSES
      .REJECTED,

    options
  );
}


/*
 * ============================================================
 * REVIEW ACTION AVAILABILITY
 * ============================================================
 *
 * Useful for the frontend/API.
 *
 * Instead of React manually deciding which buttons should
 * appear, the backend can expose allowed review actions.
 */

function getAvailableReviewActions(
  application
) {
  if (
    !application
  ) {
    return {
      enterReview:
        false,

      approve:
        false,

      reject:
        false
    };
  }

  /*
   * If application execution is active, no review mutation
   * should be presented.
   */
  try {
    assertReviewMutationSafe(
      application
    );
  } catch (_) {
    return {
      enterReview:
        false,

      approve:
        false,

      reject:
        false
    };
  }


  const status =
    normalizeLower(
      application.status
    );


  return {
    /*
     * Generated -> Under Review
     */
    enterReview:
      status ===
      normalizeLower(
        APPLICATION_STATUSES
          .GENERATED
      ),


    /*
     * Under Review -> Approved
     */
    approve:
      status ===
      normalizeLower(
        APPLICATION_STATUSES
          .UNDER_REVIEW
      ),


    /*
     * Candidate can reject during review or before execution.
     */
    reject:
      status ===
        normalizeLower(
          APPLICATION_STATUSES
            .UNDER_REVIEW
        ) ||
      (
        status ===
          normalizeLower(
            APPLICATION_STATUSES
              .APPROVED
          ) &&
        normalizeLower(
          application
            .executionStatus
        ) ===
          normalizeLower(
            EXECUTION_STATUSES
              .READY
          )
      )
  };
}


/*
 * ============================================================
 * GET REVIEW STATE
 * ============================================================
 *
 * Non-mutating helper that can be used by APIs when presenting
 * a generated application.
 */

async function getApplicationReviewState(
  applicationId,
  {
    candidateEmail
  } = {}
) {
  const application =
    await requireApplicationById(
      applicationId
    );


  assertCandidateOwnershipIfProvided(
    application,
    candidateEmail
  );


  return {
    application,

    availableActions:
      getAvailableReviewActions(
        application
      ),

    eligibility:
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
   * Main lifecycle mutation.
   */
  transitionApplicationReviewStatus,

  /*
   * Explicit review operations.
   */
  moveApplicationToReview,
  approveApplication,
  rejectApplication,

  /*
   * Review information.
   */
  getApplicationReviewState,
  getAvailableReviewActions,

  /*
   * Validation helpers.
   */
  resolveReviewStatus,
  assertValidReviewTarget,
  assertReviewMutationSafe,

  /*
   * Constants.
   */
  REVIEW_TARGET_STATUSES,
  REVIEW_MUTATION_BLOCKED_EXECUTION_STATUSES,

  /*
   * Error.
   */
  ApplicationReviewError
};