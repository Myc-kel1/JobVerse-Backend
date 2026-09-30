/*
 * ============================================================
 * APPLICATION ELIGIBILITY SERVICE
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * This module owns JobVerse's application lifecycle rules.
 *
 * It determines:
 *
 * - whether generated documents are complete
 * - whether an application may enter review
 * - whether it should appear in the Applications workspace
 * - whether it may be approved
 * - whether application execution may begin
 * - whether a requested status transition is valid
 *
 * ============================================================
 * WHY THIS FILE EXISTS
 * ============================================================
 *
 * Business-critical lifecycle rules should NOT be duplicated
 * across:
 *
 * - api.js
 * - applicationService.js
 * - applicationExecutionService.js
 * - frontend components
 *
 * They should all rely on one policy layer.
 *
 * ============================================================
 * IMPORTANT PRODUCT RULE
 * ============================================================
 *
 * A shortlisted/queued job is NOT automatically an
 * application.
 *
 * A Generated Application becomes available in the
 * Applications workflow only after:
 *
 * 1. generation succeeded
 * 2. tailored CV exists
 * 3. tailored cover letter exists
 * 4. it is explicitly moved to Under Review
 *
 * Application execution requires:
 *
 * 1. status = Approved
 * 2. generated documents exist
 * 3. executionStatus = ready
 *
 * ============================================================
 */


/*
 * ============================================================
 * APPLICATION STATUSES
 * ============================================================
 */

const APPLICATION_STATUSES =
  Object.freeze({
    GENERATED:
      "Generated",

    UNDER_REVIEW:
      "Under Review",

    APPROVED:
      "Approved",

    REJECTED:
      "Rejected",

    APPLIED:
      "Applied",
  });


/*
 * ============================================================
 * EXECUTION STATUSES
 * ============================================================
 */

const EXECUTION_STATUSES =
  Object.freeze({
    NOT_READY:
      "not_ready",

    READY:
      "ready",

    APPLYING:
      "applying",

    NEEDS_REVIEW:
      "needs_review",

    SUBMITTED:
      "submitted",

    FAILED:
      "failed",
  });


/*
 * ============================================================
 * APPLICATIONS WORKSPACE STATUSES
 * ============================================================
 *
 * Under Review:
 *     Candidate is currently reviewing the generated package.
 *
 * Approved:
 *     Review is complete and execution can begin.
 *
 * Applied:
 *     Kept visible as application history.
 *
 * Generated is intentionally excluded.
 *
 * A Generated record only means document generation finished;
 * the candidate has not yet explicitly moved it into review.
 */

const APPLICATION_WORKSPACE_STATUSES =
  new Set([
    APPLICATION_STATUSES
      .UNDER_REVIEW,

    APPLICATION_STATUSES
      .APPROVED,

    APPLICATION_STATUSES
      .APPLIED,
  ]);


/*
 * ============================================================
 * NORMALIZATION HELPERS
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
 * CANONICAL APPLICATION STATUS
 * ============================================================
 */

function normalizeApplicationStatus(
  value
) {
  const normalized =
    normalizeLower(
      value
    );

  for (
    const status of
    Object.values(
      APPLICATION_STATUSES
    )
  ) {
    if (
      normalizeLower(
        status
      ) ===
      normalized
    ) {
      return status;
    }
  }

  return "";
}


/*
 * ============================================================
 * CANONICAL EXECUTION STATUS
 * ============================================================
 */

function normalizeExecutionStatus(
  value
) {
  const normalized =
    normalizeLower(
      value
    );

  for (
    const status of
    Object.values(
      EXECUTION_STATUSES
    )
  ) {
    if (
      normalizeLower(
        status
      ) ===
      normalized
    ) {
      return status;
    }
  }

  return "";
}


/*
 * ============================================================
 * DOCUMENT PRESENCE
 * ============================================================
 *
 * We intentionally check for both generated documents.
 *
 * Current JobVerse policy:
 *
 *     tailored CV
 *     +
 *     tailored cover letter
 *
 * must exist before the application enters the review
 * workflow.
 */

function hasGeneratedCv(
  application
) {
  if (
    !application
  ) {
    return false;
  }

  return Boolean(
    normalizeString(
      application.cvFile
    )
  );
}


function hasGeneratedCoverLetter(
  application
) {
  if (
    !application
  ) {
    return false;
  }

  return Boolean(
    normalizeString(
      application.coverLetterFile
    )
  );
}


function hasRequiredGeneratedDocuments(
  application
) {
  return (
    hasGeneratedCv(
      application
    ) &&
    hasGeneratedCoverLetter(
      application
    )
  );
}


/*
 * ============================================================
 * DOCUMENT STATUS DETAILS
 * ============================================================
 *
 * Useful for:
 *
 * - API responses
 * - frontend messaging
 * - debugging
 * - validation errors
 */

function getGeneratedDocumentStatus(
  application
) {
  const hasCv =
    hasGeneratedCv(
      application
    );

  const hasCoverLetter =
    hasGeneratedCoverLetter(
      application
    );

  const missingDocuments =
    [];

  if (
    !hasCv
  ) {
    missingDocuments.push(
      "cv"
    );
  }

  if (
    !hasCoverLetter
  ) {
    missingDocuments.push(
      "cover_letter"
    );
  }

  return {
    complete:
      hasCv &&
      hasCoverLetter,

    hasCv,

    hasCoverLetter,

    missingDocuments,
  };
}


/*
 * ============================================================
 * ELIGIBILITY RESULT BUILDER
 * ============================================================
 *
 * All policy checks return the same predictable structure:
 *
 * {
 *   eligible: true/false,
 *   code: "...",
 *   reason: "..."
 * }
 */

function buildEligibilityResult({
  eligible,
  code,
  reason,
  details = {},
}) {
  return {
    eligible:
      Boolean(
        eligible
      ),

    code:
      normalizeString(
        code
      ),

    reason:
      normalizeString(
        reason
      ),

    details:
      details &&
      typeof details ===
        "object"
        ? {
            ...details,
          }
        : {},
  };
}


/*
 * ============================================================
 * CAN ENTER REVIEW
 * ============================================================
 *
 * Generated -> Under Review
 *
 * Requirements:
 *
 * - application exists
 * - current status is Generated
 * - CV exists
 * - cover letter exists
 */

function canEnterReview(
  application
) {
  if (
    !application
  ) {
    return buildEligibilityResult({
      eligible:
        false,

      code:
        "APPLICATION_NOT_FOUND",

      reason:
        "Generated application was not found.",
    });
  }

  const status =
    normalizeApplicationStatus(
      application.status
    );

  if (
    status !==
    APPLICATION_STATUSES
      .GENERATED
  ) {
    return buildEligibilityResult({
      eligible:
        false,

      code:
        "INVALID_REVIEW_SOURCE_STATUS",

      reason:
        `Only Generated applications can enter review. Current status: ${
          status ||
          "unknown"
        }.`,
    });
  }

  const documents =
    getGeneratedDocumentStatus(
      application
    );

  if (
    !documents.complete
  ) {
    return buildEligibilityResult({
      eligible:
        false,

      code:
        "GENERATED_DOCUMENTS_INCOMPLETE",

      reason:
        "Application cannot enter review because required generated documents are missing.",

      details: {
        documents,
      },
    });
  }

  return buildEligibilityResult({
    eligible:
      true,

    code:
      "REVIEW_ELIGIBLE",

    reason:
      "Application has all required generated documents and may enter review.",

    details: {
      documents,
    },
  });
}


/*
 * ============================================================
 * SHOULD APPEAR IN APPLICATIONS WORKSPACE
 * ============================================================
 *
 * IMPORTANT:
 *
 * Generated alone is NOT enough.
 *
 * The application must have passed through the explicit review
 * gate.
 *
 * Current visible states:
 *
 * - Under Review
 * - Approved
 * - Applied
 *
 * Rejected is excluded from the active Applications workspace.
 * It can later be shown through history/filtering if desired.
 */

function isApplicationWorkspaceEligible(
  application
) {
  if (
    !application
  ) {
    return buildEligibilityResult({
      eligible:
        false,

      code:
        "APPLICATION_NOT_FOUND",

      reason:
        "Application was not found.",
    });
  }

  const status =
    normalizeApplicationStatus(
      application.status
    );

  if (
    !APPLICATION_WORKSPACE_STATUSES
      .has(
        status
      )
  ) {
    return buildEligibilityResult({
      eligible:
        false,

      code:
        "NOT_IN_APPLICATION_WORKFLOW",

      reason:
        `Application status ${
          status ||
          "unknown"
        } is not eligible for the Applications workspace.`,
    });
  }

  const documents =
    getGeneratedDocumentStatus(
      application
    );

  if (
    !documents.complete
  ) {
    return buildEligibilityResult({
      eligible:
        false,

      code:
        "GENERATED_DOCUMENTS_INCOMPLETE",

      reason:
        "Application is not available because required generated documents are missing.",

      details: {
        documents,
      },
    });
  }

  return buildEligibilityResult({
    eligible:
      true,

    code:
      "APPLICATION_WORKSPACE_ELIGIBLE",

    reason:
      "Application passed the review gate and has all required generated documents.",

    details: {
      documents,
    },
  });
}


/*
 * ============================================================
 * CAN BE APPROVED
 * ============================================================
 *
 * Only an application currently Under Review can be approved.
 */

function canApproveApplication(
  application
) {
  if (
    !application
  ) {
    return buildEligibilityResult({
      eligible:
        false,

      code:
        "APPLICATION_NOT_FOUND",

      reason:
        "Application was not found.",
    });
  }

  const status =
    normalizeApplicationStatus(
      application.status
    );

  if (
    status !==
    APPLICATION_STATUSES
      .UNDER_REVIEW
  ) {
    return buildEligibilityResult({
      eligible:
        false,

      code:
        "APPLICATION_NOT_UNDER_REVIEW",

      reason:
        "Only applications currently Under Review can be approved.",
    });
  }

  const documents =
    getGeneratedDocumentStatus(
      application
    );

  if (
    !documents.complete
  ) {
    return buildEligibilityResult({
      eligible:
        false,

      code:
        "GENERATED_DOCUMENTS_INCOMPLETE",

      reason:
        "Application cannot be approved because required generated documents are missing.",

      details: {
        documents,
      },
    });
  }

  return buildEligibilityResult({
    eligible:
      true,

    code:
      "APPLICATION_APPROVAL_ELIGIBLE",

    reason:
      "Application is eligible for approval.",

    details: {
      documents,
    },
  });
}


/*
 * ============================================================
 * CAN EXECUTE APPLICATION
 * ============================================================
 *
 * This is the strongest gate.
 *
 * Requirements:
 *
 * - status = Approved
 * - executionStatus = ready
 * - CV exists
 * - cover letter exists
 */

function canExecuteApplication(
  application
) {
  if (
    !application
  ) {
    return buildEligibilityResult({
      eligible:
        false,

      code:
        "APPLICATION_NOT_FOUND",

      reason:
        "Application was not found.",
    });
  }

  const status =
    normalizeApplicationStatus(
      application.status
    );

  if (
    status !==
    APPLICATION_STATUSES
      .APPROVED
  ) {
    return buildEligibilityResult({
      eligible:
        false,

      code:
        "APPLICATION_NOT_APPROVED",

      reason:
        "Application execution requires an Approved application.",
    });
  }

  const documents =
    getGeneratedDocumentStatus(
      application
    );

  if (
    !documents.complete
  ) {
    return buildEligibilityResult({
      eligible:
        false,

      code:
        "GENERATED_DOCUMENTS_INCOMPLETE",

      reason:
        "Application execution cannot begin because required generated documents are missing.",

      details: {
        documents,
      },
    });
  }

  const executionStatus =
    normalizeExecutionStatus(
      application.executionStatus
    );

  if (
    executionStatus !==
    EXECUTION_STATUSES
      .READY
  ) {
    return buildEligibilityResult({
      eligible:
        false,

      code:
        "APPLICATION_NOT_EXECUTION_READY",

      reason:
        `Application execution requires executionStatus = ready. Current execution status: ${
          executionStatus ||
          "unknown"
        }.`,
    });
  }

  return buildEligibilityResult({
    eligible:
      true,

    code:
      "APPLICATION_EXECUTION_ELIGIBLE",

    reason:
      "Application is approved, has required documents, and is ready for execution.",

    details: {
      documents,

      executionStatus,
    },
  });
}


/*
 * ============================================================
 * VALID STATUS TRANSITIONS
 * ============================================================
 *
 * Lifecycle:
 *
 * Generated
 *    ↓
 * Under Review
 *    ↓
 * Approved
 *    ↓
 * Applied
 *
 * Review rejection:
 *
 * Under Review
 *    ↓
 * Rejected
 *
 * Approved may still be rejected before submission if the
 * candidate changes their decision.
 *
 * APPLIED is terminal.
 */

const VALID_STATUS_TRANSITIONS =
  Object.freeze({
    [APPLICATION_STATUSES
      .GENERATED]:
      new Set([
        APPLICATION_STATUSES
          .UNDER_REVIEW,

        /*
         * Generation validation failures may already use
         * Rejected in the current JobVerse schema.
         */
        APPLICATION_STATUSES
          .REJECTED,
      ]),

    [APPLICATION_STATUSES
      .UNDER_REVIEW]:
      new Set([
        APPLICATION_STATUSES
          .APPROVED,

        APPLICATION_STATUSES
          .REJECTED,
      ]),

    [APPLICATION_STATUSES
      .APPROVED]:
      new Set([
        APPLICATION_STATUSES
          .REJECTED,

        /*
         * Applied should normally be set by successful
         * application submission rather than a manual API call.
         *
         * The transition is valid at domain level, while api.js
         * will continue protecting it from arbitrary manual use.
         */
        APPLICATION_STATUSES
          .APPLIED,
      ]),

    [APPLICATION_STATUSES
      .REJECTED]:
      new Set([]),

    [APPLICATION_STATUSES
      .APPLIED]:
      new Set([]),
  });


/*
 * ============================================================
 * CHECK STATUS TRANSITION
 * ============================================================
 */

function canTransitionApplicationStatus(
  application,
  requestedStatus
) {
  if (
    !application
  ) {
    return buildEligibilityResult({
      eligible:
        false,

      code:
        "APPLICATION_NOT_FOUND",

      reason:
        "Application was not found.",
    });
  }

  const currentStatus =
    normalizeApplicationStatus(
      application.status
    );

  const nextStatus =
    normalizeApplicationStatus(
      requestedStatus
    );

  if (
    !currentStatus
  ) {
    return buildEligibilityResult({
      eligible:
        false,

      code:
        "INVALID_CURRENT_STATUS",

      reason:
        `Current application status is invalid: ${
          application.status ||
          "empty"
        }.`,
    });
  }

  if (
    !nextStatus
  ) {
    return buildEligibilityResult({
      eligible:
        false,

      code:
        "INVALID_TARGET_STATUS",

      reason:
        `Requested application status is invalid: ${
          requestedStatus ||
          "empty"
        }.`,
    });
  }

  /*
   * Idempotent status request.
   */
  if (
    currentStatus ===
    nextStatus
  ) {
    return buildEligibilityResult({
      eligible:
        true,

      code:
        "STATUS_ALREADY_SET",

      reason:
        `Application is already ${currentStatus}.`,

      details: {
        currentStatus,
        nextStatus,
      },
    });
  }

  const allowed =
    VALID_STATUS_TRANSITIONS[
      currentStatus
    ];

  if (
    !allowed ||
    !allowed.has(
      nextStatus
    )
  ) {
    return buildEligibilityResult({
      eligible:
        false,

      code:
        "INVALID_STATUS_TRANSITION",

      reason:
        `Application cannot move from ${currentStatus} to ${nextStatus}.`,

      details: {
        currentStatus,
        nextStatus,
      },
    });
  }


  /*
   * ----------------------------------------------------------
   * TRANSITION-SPECIFIC RULES
   * ----------------------------------------------------------
   */

  if (
    nextStatus ===
    APPLICATION_STATUSES
      .UNDER_REVIEW
  ) {
    return canEnterReview(
      application
    );
  }


  if (
    nextStatus ===
    APPLICATION_STATUSES
      .APPROVED
  ) {
    return canApproveApplication(
      application
    );
  }


  return buildEligibilityResult({
    eligible:
      true,

    code:
      "STATUS_TRANSITION_ALLOWED",

    reason:
      `Application may move from ${currentStatus} to ${nextStatus}.`,

    details: {
      currentStatus,
      nextStatus,
    },
  });
}


/*
 * ============================================================
 * CUSTOM ELIGIBILITY ERROR
 * ============================================================
 *
 * Service/API layers can throw this error while preserving a
 * machine-readable error code.
 */

class ApplicationEligibilityError extends Error {
  constructor(
    result,
    {
      statusCode =
        409,
    } = {}
  ) {
    super(
      result?.reason ||
      "Application is not eligible for this operation."
    );

    this.name =
      "ApplicationEligibilityError";

    this.code =
      result?.code ||
      "APPLICATION_NOT_ELIGIBLE";

    this.statusCode =
      statusCode;

    this.details =
      result?.details ||
      {};
  }
}


/*
 * ============================================================
 * ASSERTION HELPERS
 * ============================================================
 *
 * These are convenient for service layers.
 */

function assertCanEnterReview(
  application
) {
  const result =
    canEnterReview(
      application
    );

  if (
    !result.eligible
  ) {
    throw new ApplicationEligibilityError(
      result
    );
  }

  return result;
}


function assertApplicationWorkspaceEligible(
  application
) {
  const result =
    isApplicationWorkspaceEligible(
      application
    );

  if (
    !result.eligible
  ) {
    throw new ApplicationEligibilityError(
      result
    );
  }

  return result;
}


function assertCanApproveApplication(
  application
) {
  const result =
    canApproveApplication(
      application
    );

  if (
    !result.eligible
  ) {
    throw new ApplicationEligibilityError(
      result
    );
  }

  return result;
}


function assertCanExecuteApplication(
  application
) {
  const result =
    canExecuteApplication(
      application
    );

  if (
    !result.eligible
  ) {
    throw new ApplicationEligibilityError(
      result
    );
  }

  return result;
}


function assertApplicationStatusTransition(
  application,
  requestedStatus
) {
  const result =
    canTransitionApplicationStatus(
      application,
      requestedStatus
    );

  if (
    !result.eligible
  ) {
    throw new ApplicationEligibilityError(
      result
    );
  }

  return result;
}


/*
 * ============================================================
 * APPLICATION ELIGIBILITY SUMMARY
 * ============================================================
 *
 * Useful for API responses/frontend.
 *
 * Instead of the frontend recreating business rules, the
 * backend can return:
 *
 * eligibility.canEnterReview
 * eligibility.visibleInApplications
 * eligibility.canApprove
 * eligibility.canExecute
 */

function getApplicationEligibilitySummary(
  application
) {
  const documents =
    getGeneratedDocumentStatus(
      application
    );

  const review =
    canEnterReview(
      application
    );

  const workspace =
    isApplicationWorkspaceEligible(
      application
    );

  const approval =
    canApproveApplication(
      application
    );

  const execution =
    canExecuteApplication(
      application
    );

  return {
    documents,

    canEnterReview:
      review.eligible,

    reviewReason:
      review.reason,

    visibleInApplications:
      workspace.eligible,

    workspaceReason:
      workspace.reason,

    canApprove:
      approval.eligible,

    approvalReason:
      approval.reason,

    canExecute:
      execution.eligible,

    executionReason:
      execution.reason,
  };
}


/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  /*
   * Status constants.
   */
  APPLICATION_STATUSES,
  EXECUTION_STATUSES,
  APPLICATION_WORKSPACE_STATUSES,

  /*
   * Document checks.
   */
  hasGeneratedCv,
  hasGeneratedCoverLetter,
  hasRequiredGeneratedDocuments,
  getGeneratedDocumentStatus,

  /*
   * Eligibility checks.
   */
  canEnterReview,
  isApplicationWorkspaceEligible,
  canApproveApplication,
  canExecuteApplication,
  canTransitionApplicationStatus,

  /*
   * Assertions.
   */
  assertCanEnterReview,
  assertApplicationWorkspaceEligible,
  assertCanApproveApplication,
  assertCanExecuteApplication,
  assertApplicationStatusTransition,

  /*
   * Frontend/API summary.
   */
  getApplicationEligibilitySummary,

  /*
   * Normalization.
   */
  normalizeApplicationStatus,
  normalizeExecutionStatus,

  /*
   * Error class.
   */
  ApplicationEligibilityError,

  /*
   * Transition map.
   */
  VALID_STATUS_TRANSITIONS,
};