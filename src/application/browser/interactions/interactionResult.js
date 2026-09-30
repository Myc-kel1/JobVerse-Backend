/*
 * ============================================================
 * FORM INTERACTION RESULT
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * Defines the shared result contract used by every browser form
 * interaction handler in JobVerse.
 *
 * Phase 4 will contain multiple interaction implementations:
 *
 * - text inputs
 * - textareas
 * - selects
 * - radio buttons
 * - checkboxes
 * - custom ARIA controls
 * - file uploads
 *
 * Every implementation must return the same predictable result
 * structure.
 *
 * ============================================================
 * IMPORTANT ARCHITECTURE RULE
 * ============================================================
 *
 * This module DOES NOT:
 *
 * - interact with Playwright
 * - locate browser elements
 * - resolve candidate answers
 * - inspect application forms
 * - change application lifecycle state
 * - submit applications
 *
 * It ONLY defines and constructs interaction results.
 * ============================================================
 */


/*
 * ============================================================
 * FIELD INTERACTION STATUSES
 * ============================================================
 */

const FIELD_INTERACTION_STATUSES =
  Object.freeze({
    FILLED:
      "filled",

    SKIPPED:
      "skipped",

    FAILED:
      "failed",

    UNSUPPORTED:
      "unsupported",

    NEEDS_REVIEW:
      "needs_review",

    BLOCKED:
      "blocked",
  });


const VALID_FIELD_INTERACTION_STATUSES =
  new Set(
    Object.values(
      FIELD_INTERACTION_STATUSES
    )
  );


/*
 * ============================================================
 * FORM INTERACTION STATUSES
 * ============================================================
 *
 * These describe the outcome of one complete interaction pass.
 */

const FORM_INTERACTION_STATUSES =
  Object.freeze({
    COMPLETED:
      "completed",

    PARTIAL:
      "partial",

    NEEDS_REVIEW:
      "needs_review",

    BLOCKED:
      "blocked",

    FAILED:
      "failed",
  });

  /*
 * ============================================================
 * FORM INTERACTION OUTCOMES
 * ============================================================
 *
 * Stage 9 provides one execution-facing result that later stages
 * can consume without reinterpreting field-level details.
 */

const FORM_INTERACTION_OUTCOMES =
  Object.freeze({
    READY_FOR_REVIEW:
      "ready_for_review",

    NEEDS_CANDIDATE_INPUT:
      "needs_candidate_input",

    NEEDS_HUMAN_REVIEW:
      "needs_human_review",

    BLOCKED:
      "blocked",

    FAILED:
      "failed",

    PARTIAL:
      "partial",
  });


/*
 * ============================================================
 * BASIC HELPERS
 * ============================================================
 */

function normalizeString(
  value
) {
  return String(
    value ?? ""
  ).trim();
}


function normalizeNullableString(
  value
) {
  const normalized =
    normalizeString(
      value
    );

  return normalized ||
    null;
}


/*
 * ============================================================
 * BUILD FIELD RESULT
 * ============================================================
 *
 * Creates one normalized result for one form field.
 *
 * We deliberately do NOT include the candidate answer itself in
 * logs/results unless a higher layer explicitly needs it.
 *
 * This reduces unnecessary exposure of potentially sensitive
 * candidate information.
 */

function buildFieldInteractionResult({
  field,
  status,
  reason = null,
  errorCode = null,
  metadata = {},
}) {
  if (
    !VALID_FIELD_INTERACTION_STATUSES
      .has(
        status
      )
  ) {
    throw new Error(
      `Unsupported field interaction status: ${status}`
    );
  }


  return {
    fieldId:
      normalizeNullableString(
        field?.fieldId
      ),

    platformFieldId:
      normalizeNullableString(
        field?.platformFieldId
      ),

    platformFieldName:
      normalizeNullableString(
        field?.platformFieldName
      ),

    label:
      normalizeString(
        field?.label
      ),

    fieldType:
      normalizeString(
        field?.fieldType
      ),

    required:
      Boolean(
        field?.required
      ),

    status,

    reason:
      normalizeNullableString(
        reason
      ),

    errorCode:
      normalizeNullableString(
        errorCode
      ),

    metadata:
      metadata &&
      typeof metadata ===
        "object"
        ? {
            ...metadata,
          }
        : {},
  };
}


/*
 * ============================================================
 * CONVENIENCE BUILDERS
 * ============================================================
 */

function buildFilledResult(
  field,
  metadata = {}
) {
  return buildFieldInteractionResult({
    field,

    status:
      FIELD_INTERACTION_STATUSES
        .FILLED,

    metadata,
  });
}


function buildSkippedResult(
  field,
  reason,
  metadata = {}
) {
  return buildFieldInteractionResult({
    field,

    status:
      FIELD_INTERACTION_STATUSES
        .SKIPPED,

    reason,

    metadata,
  });
}


function buildFailedResult(
  field,
  reason,
  {
    errorCode = null,
    metadata = {},
  } = {}
) {
  return buildFieldInteractionResult({
    field,

    status:
      FIELD_INTERACTION_STATUSES
        .FAILED,

    reason,

    errorCode,

    metadata,
  });
}


function buildUnsupportedResult(
  field,
  reason,
  metadata = {}
) {
  return buildFieldInteractionResult({
    field,

    status:
      FIELD_INTERACTION_STATUSES
        .UNSUPPORTED,

    reason,

    metadata,
  });
}


function buildNeedsReviewResult(
  field,
  reason,
  metadata = {}
) {
  return buildFieldInteractionResult({
    field,

    status:
      FIELD_INTERACTION_STATUSES
        .NEEDS_REVIEW,

    reason,

    metadata,
  });
}


function buildBlockedResult(
  field,
  reason,
  {
    errorCode = null,
    metadata = {},
  } = {}
) {
  return buildFieldInteractionResult({
    field,

    status:
      FIELD_INTERACTION_STATUSES
        .BLOCKED,

    reason,

    errorCode,

    metadata,
  });
}


/*
 * ============================================================
 * SUMMARIZE FIELD RESULTS
 * ============================================================
 */

function summarizeFieldInteractions(
  results
) {
  const safeResults =
    Array.isArray(
      results
    )
      ? results
      : [];


  const countStatus =
    (
      targetStatus
    ) =>
      safeResults.filter(
        (item) =>
          item?.status ===
          targetStatus
      ).length;


  const summary = {
    total:
      safeResults.length,

    filled:
      countStatus(
        FIELD_INTERACTION_STATUSES
          .FILLED
      ),

    skipped:
      countStatus(
        FIELD_INTERACTION_STATUSES
          .SKIPPED
      ),

    failed:
      countStatus(
        FIELD_INTERACTION_STATUSES
          .FAILED
      ),

    unsupported:
      countStatus(
        FIELD_INTERACTION_STATUSES
          .UNSUPPORTED
      ),

    needsReview:
      countStatus(
        FIELD_INTERACTION_STATUSES
          .NEEDS_REVIEW
      ),

    blocked:
      countStatus(
        FIELD_INTERACTION_STATUSES
          .BLOCKED
      ),
  };


  return summary;
}


/*
 * ============================================================
 * DERIVE FORM INTERACTION STATUS
 * ============================================================
 */

function deriveFormInteractionStatus(
  summary
) {
  if (
    Number(
      summary?.blocked ||
      0
    ) >
    0
  ) {
    return FORM_INTERACTION_STATUSES
      .BLOCKED;
  }


  if (
    Number(
      summary?.needsReview ||
      0
    ) >
    0
  ) {
    return FORM_INTERACTION_STATUSES
      .NEEDS_REVIEW;
  }


  if (
    Number(
      summary?.failed ||
      0
    ) >
    0 ||
    Number(
      summary?.unsupported ||
      0
    ) >
    0
  ) {
    return FORM_INTERACTION_STATUSES
      .PARTIAL;
  }


  return FORM_INTERACTION_STATUSES
    .COMPLETED;
}


/*
 * ============================================================
 * DERIVE FORM INTERACTION OUTCOME
 * ============================================================
 */

function deriveFormInteractionOutcome({
  interactionSummary,
  validation,
  handoff = null,
}) {
  const summary =
    interactionSummary ||
    {};


  const validationSummary =
    validation?.summary ||
    {};


  /*
   * Explicit safety handoff has highest priority.
   */
  if (
    handoff?.blocked ===
    true
  ) {
    return FORM_INTERACTION_OUTCOMES
      .BLOCKED;
  }


  /*
   * Hard browser/page blocking takes precedence.
   */
  if (
    Number(
      summary.blocked ||
      0
    ) >
      0 ||
    Number(
      validationSummary.notFound ||
      0
    ) >
      0
  ) {
    return FORM_INTERACTION_OUTCOMES
      .BLOCKED;
  }


  /*
   * Validation failures mean the page is not ready for review.
   */
  if (
    Number(
      summary.failed ||
      0
    ) >
      0 ||
    Number(
      validationSummary.invalid ||
      0
    ) >
      0
  ) {
    return FORM_INTERACTION_OUTCOMES
      .FAILED;
  }


  /*
   * Explicit review-required controls.
   */
  if (
    Number(
      summary.needsReview ||
      0
    ) >
      0 ||
    Number(
      validationSummary.needsReview ||
      0
    ) >
      0
  ) {
    return FORM_INTERACTION_OUTCOMES
      .NEEDS_HUMAN_REVIEW;
  }


  /*
   * Unsupported/skipped fields mean we cannot claim complete
   * browser preparation.
   */
  if (
    Number(
      summary.unsupported ||
      0
    ) >
      0 ||
    Number(
      validationSummary.skipped ||
      0
    ) >
      0
  ) {
    return FORM_INTERACTION_OUTCOMES
      .PARTIAL;
  }


  /*
   * Phase 4 never submits.
   *
   * The strongest successful state is therefore:
   *
   * ready_for_review
   */
  return FORM_INTERACTION_OUTCOMES
    .READY_FOR_REVIEW;
}


/*
 * ============================================================
 * NEXT ACTION
 * ============================================================
 *
 * Phase 4 does not submit the application.
 *
 * This tells the execution layer what should happen next.
 */

function deriveInteractionNextAction(
  outcome
) {
  switch (
    outcome
  ) {
    case FORM_INTERACTION_OUTCOMES
      .READY_FOR_REVIEW:
      return "review_filled_form";


    case FORM_INTERACTION_OUTCOMES
      .NEEDS_CANDIDATE_INPUT:
      return "complete_missing_answers";


    case FORM_INTERACTION_OUTCOMES
      .NEEDS_HUMAN_REVIEW:
      return "human_review";


    case FORM_INTERACTION_OUTCOMES
      .BLOCKED:
      return "browser_handoff";


    case FORM_INTERACTION_OUTCOMES
      .FAILED:
      return "retry_or_review";


    case FORM_INTERACTION_OUTCOMES
      .PARTIAL:
      return "review_partial_form";


    default:
      return "human_review";
  }
}


/*
 * ============================================================
 * BUILD COMPLETE FORM INTERACTION RESULT
 * ============================================================
 *
 * This is the stable Phase 4 result contract.
 */

function buildFormInteractionResult({
  results,
  validation = null,
  startedAt = null,
  completedAt = null,
  handoffReason = null,
  handoff = null,
}) {
  const safeResults =
    Array.isArray(
      results
    )
      ? results
      : [];


  const interactionSummary =
    summarizeFieldInteractions(
      safeResults
    );


  const status =
    deriveFormInteractionStatus(
      interactionSummary
    );


  const outcome =
    deriveFormInteractionOutcome({
      interactionSummary,
      validation,
      handoff,
    });


  const nextAction =
    deriveInteractionNextAction(
      outcome
    );


  const requiresHumanReview =
    [
      FORM_INTERACTION_OUTCOMES
        .NEEDS_HUMAN_REVIEW,

      FORM_INTERACTION_OUTCOMES
        .BLOCKED,

      FORM_INTERACTION_OUTCOMES
        .FAILED,

      FORM_INTERACTION_OUTCOMES
        .PARTIAL,
    ].includes(
      outcome
    );


  return {
    /*
     * Low-level interaction status.
     */
    status,

    /*
     * Execution-facing interpretation.
     */
    outcome,

    nextAction,

    /*
     * Phase 4 success means:
     *
     * all supported fields were handled and post-fill validation
     * did not detect blocking/review conditions.
     *
     * It still does NOT mean submitted/applied.
     */
    success:
      outcome ===
      FORM_INTERACTION_OUTCOMES
        .READY_FOR_REVIEW,

    submitted:
      false,

    interactionSummary,

    validation:
      validation ||
      null,

    fields:
      safeResults,

    requiresHumanReview,

    handoff:
  handoff &&
  typeof handoff ===
    "object"
    ? {
        blocked:
          Boolean(
            handoff.blocked
          ),

        type:
          normalizeNullableString(
            handoff.type
          ),

        reason:
          normalizeNullableString(
            handoff.reason
          ),

        nextAction:
          normalizeNullableString(
            handoff.nextAction
          ),

        metadata:
          handoff.metadata &&
          typeof handoff.metadata ===
            "object"
            ? {
                ...handoff.metadata,
              }
            : {},
      }
    : null,

handoffReason:
  normalizeNullableString(
    handoffReason ||
    handoff?.type
  ),

    startedAt:
      normalizeNullableString(
        startedAt
      ),

    completedAt:
      normalizeNullableString(
        completedAt
      ),
  };
}


/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  FIELD_INTERACTION_STATUSES,

  VALID_FIELD_INTERACTION_STATUSES,

  FORM_INTERACTION_STATUSES,

  FORM_INTERACTION_OUTCOMES,

  buildFieldInteractionResult,

  buildFilledResult,

  buildSkippedResult,

  buildFailedResult,

  buildUnsupportedResult,

  buildNeedsReviewResult,

  buildBlockedResult,

  summarizeFieldInteractions,

  deriveFormInteractionStatus,

  deriveFormInteractionOutcome,

  deriveInteractionNextAction,

  buildFormInteractionResult,
};