const {
  assertCanResumeExecution,
  ApplicationExecutionGuardError,
} = require(
  "./executionGuard"
);


const {
  getActiveAttemptState,
} = require(
  "../attempts/applicationAttemptQueryService"
);

const {
  getJobForCandidate,
} = require(
  "../applicationService"
);

/*
 * ============================================================
 * PHASE 4 BROWSER EXECUTION
 * ============================================================
 *
 * Executes inspection -> resolution -> safe browser filling
 * without final submission.
 */

const {
  executeCurrentBrowserForm,
  BROWSER_FORM_EXECUTION_STATUSES,
} = require(
  "./browserFormExecutionService"
);


const {
  updateApplicationAttempt,
} = require(
  "../applicationAttemptService"
);

const {
  materializeApplicationDocuments,
  cleanupMaterializedApplicationDocuments,
} = require(
  "./applicationDocumentMaterializationService"
);


/*
 * ============================================================
 * EXECUTION RESUME SERVICE
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * Resume an EXISTING paused application execution.
 *
 * This service must never create a second Application Attempt.
 *
 *
/*
 * ============================================================
 * CURRENT PHASE
 * ============================================================
 *
 * Phase 4 now supports:
 *
 *     Google Form browser-interaction resume.
 *
 * Example:
 *
 * attempt
 *   ↓
 * needs_review
 *   ↓
 * candidate supplies / confirms missing answers
 *   ↓
 * resume SAME attempt
 *   ↓
 * applying
 *   ↓
 * open isolated Playwright session
 *   ↓
 * inspect rendered form
 *   ↓
 * resolve candidate answers
 *   ↓
 * safely fill supported controls
 *   ↓
 * safety scan + post-fill validation
 *   ↓
 * needs_review
 *   ↓
 * review_filled_form
 *
 *
 * IMPORTANT:
 *
 * Phase 4 does NOT perform final submission.
 *
 * Application status therefore remains Approved.
 */


/*
 * ============================================================
 * FUTURE PHASES
 * ============================================================
 *
 * Later resume orchestration will add:
 *
 * - Phase 5 multi-step form flow
 * - company-form browser execution
 * - ATS adapters
 * - controlled submission
 * - submission confirmation
 *
 * without changing the public same-attempt resume concept.
 */


/*
 * ============================================================
 * CONSTANTS
 * ============================================================
 */

/*
 * Candidate-triggered Phase 4 resume is intentionally restricted
 * to an attempt that is paused for review.
 *
 * Although the attempt-query layer considers:
 *
 * pending
 * applying
 * needs_review
 *
 * potentially resumable, "potentially resumable" does NOT mean
 * automatically safe to resume.
 *
 * Interrupted pending/applying attempts belong to later recovery
 * logic.
 */
const CANDIDATE_RESUMABLE_STATUS =
  "needs_review";


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
 * MAP BROWSER RESUME NEXT ACTION
 * ============================================================
 *
 * browserFormExecutionService uses generic browser terminology.
 *
 * executionResumeService translates that into the application
 * workflow terminology exposed by the existing resume API.
 */

function mapBrowserResumeNextAction(
  browserExecution
) {
  const status =
    normalizeLower(
      browserExecution?.status
    );


  const browserNextAction =
    normalizeString(
      browserExecution?.nextAction
    );


  /*
   * ----------------------------------------------------------
   * MISSING CANDIDATE ANSWERS
   * ----------------------------------------------------------
   *
   * Preserve the existing frontend/API action name.
   */

  if (
    status ===
    BROWSER_FORM_EXECUTION_STATUSES
      .NEEDS_INPUT
  ) {
    return "complete_google_form_answers";
  }


  /*
   * Answers exist but one or more still require explicit human
   * confirmation.
   */
  if (
    status ===
    BROWSER_FORM_EXECUTION_STATUSES
      .NEEDS_REVIEW &&
    browserNextAction ===
      "confirm_form_answers"
  ) {
    return "complete_google_form_answers";
  }


  /*
   * ----------------------------------------------------------
   * FORM FILLED SUCCESSFULLY
   * ----------------------------------------------------------
   *
   * IMPORTANT:
   *
   * review_filled_form does NOT mean submitted.
   */
  if (
    status ===
    BROWSER_FORM_EXECUTION_STATUSES
      .READY_FOR_REVIEW
  ) {
    return "review_filled_form";
  }


  /*
   * ----------------------------------------------------------
   * HUMAN HANDOFFS
   * ----------------------------------------------------------
   */

  if (
    browserNextAction ===
    "complete_login"
  ) {
    return "google_login_handoff";
  }


  if (
    browserNextAction ===
    "complete_captcha"
  ) {
    return "captcha_handoff";
  }


  if (
    browserNextAction ===
    "complete_verification_code"
  ) {
    return "verification_code_handoff";
  }


  if (
    browserNextAction ===
    "complete_identity_verification"
  ) {
    return "identity_verification_handoff";
  }


  if (
    browserNextAction ===
    "complete_authentication"
  ) {
    return "authentication_handoff";
  }


  if (
    browserNextAction ===
    "review_required_field"
  ) {
    return "review_required_field";
  }


  if (
    browserNextAction ===
    "review_field_mapping"
  ) {
    return "review_field_mapping";
  }


  /*
   * ----------------------------------------------------------
   * PARTIAL / FAILURE REVIEW
   * ----------------------------------------------------------
   */

  if (
    status ===
      BROWSER_FORM_EXECUTION_STATUSES
        .FAILED ||
    status ===
      BROWSER_FORM_EXECUTION_STATUSES
        .NEEDS_REVIEW
  ) {
    return "review_google_form";
  }


  /*
   * Conservative fallback.
   */
  return (
    browserNextAction ||
    "review_google_form"
  );
}


/*
 * ============================================================
 * BUILD RESUME REVIEW REASON
 * ============================================================
 */

function buildBrowserResumeReason(
  browserExecution
) {
  const explicitReason =
    normalizeString(
      browserExecution?.reason
    );


  if (
    explicitReason
  ) {
    return explicitReason;
  }


  const interactionReason =
    normalizeString(
      browserExecution
        ?.interaction
        ?.handoff
        ?.reason
    );


  if (
    interactionReason
  ) {
    return interactionReason;
  }


  const status =
    normalizeLower(
      browserExecution?.status
    );


  if (
    status ===
    BROWSER_FORM_EXECUTION_STATUSES
      .READY_FOR_REVIEW
  ) {
    return "Application form fields were filled successfully and are ready for candidate review.";
  }


  if (
    status ===
    BROWSER_FORM_EXECUTION_STATUSES
      .NEEDS_INPUT
  ) {
    return "Application form still requires candidate answers before browser filling can continue.";
  }


  if (
    status ===
    BROWSER_FORM_EXECUTION_STATUSES
      .BLOCKED
  ) {
    return "Browser execution requires candidate intervention before it can continue.";
  }


  if (
    status ===
    BROWSER_FORM_EXECUTION_STATUSES
      .FAILED
  ) {
    return "Browser form interaction encountered a problem and requires review.";
  }


  return "Application form requires candidate review before execution can continue.";
}


/*
 * ============================================================
 * RESUME ERROR
 * ============================================================
 *
 * Domain-specific error keeps HTTP/controller logic outside this
 * service.
 */

class ApplicationExecutionResumeError
  extends Error {
  constructor(
    message,
    {
      code =
        "APPLICATION_EXECUTION_RESUME_ERROR",

      statusCode =
        409,

      details =
        {},
    } = {}
  ) {
    super(
      message
    );

    this.name =
      "ApplicationExecutionResumeError";

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
 * ASSERT RESUME ATTEMPT STATUS
 * ============================================================
 *
 * Phase 3 candidate resume only supports:
 *
 * needs_review
 *
 * We deliberately do NOT automatically resume:
 *
 * pending
 * applying
 *
 * because those states may indicate:
 *
 * - worker interruption
 * - crashed browser
 * - stale execution
 * - concurrent work
 *
 * Those require recovery/reconciliation logic later.
 */

function assertCandidateResumeStatus(
  attempt
) {
  const status =
    normalizeLower(
      attempt?.status
    );

  if (
    status !==
    CANDIDATE_RESUMABLE_STATUS
  ) {
    throw new ApplicationExecutionResumeError(
      "This application attempt is not paused for candidate review.",
      {
        code:
          "APPLICATION_ATTEMPT_NOT_WAITING_FOR_REVIEW",

        statusCode:
          409,

        details: {
          attemptId:
            normalizeString(
              attempt?.attemptId
            ),

          attemptStatus:
            status,
        },
      }
    );
  }

  return true;
}


/*
 * ============================================================
 * ASSERT SINGLE ACTIVE ATTEMPT
 * ============================================================
 *
 * Defensive integrity check.
 *
 * The execution guard verifies the requested attempt belongs to
 * the application, but resume should also refuse to continue if
 * stored data somehow contains multiple active attempts.
 */

async function assertSingleActiveAttempt({
  applicationId,
  attemptId,
}) {
  const state =
    await getActiveAttemptState(
      applicationId
    );


  if (
    state.hasConflict
  ) {
    throw new ApplicationExecutionResumeError(
      "Multiple active application attempts were found. Resume requires reconciliation before continuing.",
      {
        code:
          "MULTIPLE_ACTIVE_APPLICATION_ATTEMPTS",

        statusCode:
          409,

        details: {
          applicationId,

          activeAttemptCount:
            state.count,

          attemptIds:
            state.attempts
              .map(
                (attempt) =>
                  normalizeString(
                    attempt?.attemptId
                  )
              )
              .filter(
                Boolean
              ),
        },
      }
    );
  }


  if (
    !state.hasActiveAttempt
  ) {
    throw new ApplicationExecutionResumeError(
      "No active application attempt is available to resume.",
      {
        code:
          "APPLICATION_ATTEMPT_NOT_ACTIVE",

        statusCode:
          409,

        details: {
          applicationId,
          attemptId,
        },
      }
    );
  }


  const activeAttemptId =
    normalizeString(
      state.activeAttempt
        ?.attemptId
    );


  /*
   * The requested attempt must also be the currently active one.
   *
   * This prevents an older paused attempt from being resumed while
   * another attempt is authoritative.
   */
  if (
    activeAttemptId !==
    normalizeString(
      attemptId
    )
  ) {
    throw new ApplicationExecutionResumeError(
      "The requested application attempt is not the active attempt for this application.",
      {
        code:
          "APPLICATION_ATTEMPT_NOT_CURRENT",

        statusCode:
          409,

        details: {
          requestedAttemptId:
            normalizeString(
              attemptId
            ),

          activeAttemptId,
        },
      }
    );
  }


  return state;
}


/*
 * ============================================================
 * GOOGLE FORM RESUME — PHASE 4
 * ============================================================
 *
 * Resume the SAME paused attempt and run the browser interaction
 * layer.
 *
 * Lifecycle:
 *
 * needs_review
 *      ↓
 * applying
 *      ↓
 * browser inspect / resolve / fill
 *      ↓
 * needs_review
 *      ↓
 * candidate final review
 *
 *
 * IMPORTANT:
 *
 * This function NEVER:
 *
 * - creates another attempt
 * - calls /execute again
 * - clicks final Submit
 * - marks the application Applied
 */

async function resumeGoogleFormExecution({
  application,
  attempt,
  fallbackUrl = "",
  applicationMethod = "google_form",
}) {
  const attemptId =
    normalizeString(
      attempt?.attemptId
    );


  /*
 * Prefer the URL persisted on Generated Applications.
 *
 * Older generated rows may not have applicationUrl populated,
 * so the execution coordinator may provide the job URL as a
 * controlled fallback.
 */
const applicationUrl =
  normalizeString(
    application?.applicationUrl
  ) ||
  normalizeString(
    fallbackUrl
  );


  const candidateEmail =
    normalizeString(
      application?.candidateEmail
    );


  /*
   * ==========================================================
   * MOVE SAME ATTEMPT BACK TO APPLYING
   * ==========================================================
   *
   * This is NOT a new attempt.
   *
   * It simply records that the previously paused attempt has
   * resumed browser work.
   */

  const applyingState =
    await updateApplicationAttempt(
      attemptId,
      {
        status:
          "applying",

        /*
         * Clear the previous pause reason while browser execution
         * is actively progressing.
         */
        failureReason:
          "",
      }
    );


  let browserExecution;

  let materializedDocuments =
  null;

  try {
    /*
     * ========================================================
     * PHASE 4 BROWSER EXECUTION
     * ========================================================
     *
     * browserFormExecutionService handles:
     *
     * - isolated browser session
     * - safe navigation
     * - rendered-page inspection
     * - answer resolution
     * - missing-answer detection
     * - form interaction
     * - safety stops
     * - post-fill validation
     *
     * It does NOT submit.
     */

    /*
 * ============================================================
 * MATERIALIZE APPROVED APPLICATION DOCUMENTS
 * ============================================================
 *
 * Generated Applications stores Drive-backed document references.
 *
 * Playwright requires local filesystem paths for setInputFiles().
 *
 * Materialize the exact CV and cover letter belonging to THIS
 * approved application before browser interaction begins.
 */

materializedDocuments =
  await materializeApplicationDocuments(
    application
  );


browserExecution =
  await executeCurrentBrowserForm({
    url:
      applicationUrl,

    candidateEmail,

    applicationMethod:
     applicationMethod,

    source:
  applicationMethod ===
    "company_form"
      ? "company_form_resume"
      : "google_form_resume",

    /*
     * Exact structure expected by fileInputInteractor.js.
     */
    files:
      materializedDocuments
        .files,
  });
  } catch (
    error
  ) {
    /*
     * ========================================================
     * UNEXPECTED BROWSER/INFRASTRUCTURE ERROR
     * ========================================================
     *
     * Do NOT permanently fail the attempt here.
     *
     * A navigation timeout, transient browser problem, external
     * site failure, etc. may be recoverable.
     *
     * Return the SAME attempt to needs_review so a controlled
     * retry remains possible.
     */

    const reason =
      normalizeString(
        error?.message
      ) ||
      "Browser execution could not continue.";


    const paused =
      await updateApplicationAttempt(
        attemptId,
        {
          status:
            "needs_review",

          failureReason:
            reason,
        }
      );


    return {
      status:
        "needs_review",

      nextAction:
        "retry_browser_fill",

      reason,

      application:
        paused.application,

      attempt:
        paused.attempt,

      parentApplication:
        paused.application,

      applicationMode:
        paused.attempt
          ?.applicationMode ||
        applyingState.attempt
          ?.applicationMode ||
        application.applicationMode ||
        "assisted",

      browserExecution:
        null,

      resumed:
        true,

      submitted:
        false,
    };
  }
  finally {
    await cleanupMaterializedApplicationDocuments(
      materializedDocuments
    );
  }


  /*
   * ==========================================================
   * MAP PHASE 4 RESULT
   * ==========================================================
   */

  const nextAction =
    mapBrowserResumeNextAction(
      browserExecution
    );


  const reviewReason =
    buildBrowserResumeReason(
      browserExecution
    );


  /*
   * ==========================================================
   * RETURN SAME ATTEMPT TO NEEDS_REVIEW
   * ==========================================================
   *
   * Even when form filling succeeded, Phase 4 ends at human
   * review.
   *
   * We intentionally DO NOT mark:
   *
   * submitted
   * Applied
   */

  const paused =
    await updateApplicationAttempt(
      attemptId,
      {
        status:
          "needs_review",

        failureReason:
          reviewReason,
      }
    );


  return {
    status:
      "needs_review",

    nextAction,

    reason:
      reviewReason,

    application:
      paused.application,

    attempt:
      paused.attempt,

    parentApplication:
      paused.application,

    applicationMode:
      paused.attempt
        ?.applicationMode ||
      application.applicationMode ||
      "assisted",

    /*
     * Full structured Phase 4 result.
     */
    browserExecution,

    /*
     * Compatibility alias while frontend integration evolves.
     *
     * Existing consumers currently expect a googleForm-shaped
     * payload from this workflow.
     */
    googleForm: {
      inspection:
        browserExecution
          ?.inspection ||
        null,

      resolutions:
        browserExecution
          ?.resolutions ||
        [],

      summary:
        browserExecution
          ?.resolutionSummary ||
        null,

      interaction:
        browserExecution
          ?.interaction ||
        null,

      ready:
        browserExecution
          ?.status ===
        BROWSER_FORM_EXECUTION_STATUSES
          .READY_FOR_REVIEW,
    },

    resumed:
      true,

    submitted:
      false,
  };
}


/*
 * ============================================================
 * RESUME APPLICATION EXECUTION
 * ============================================================
 *
 * Main public service method.
 */

async function resumeApplicationExecution({
  applicationId,
  attemptId,
  candidateEmail,
}) {
  const normalizedApplicationId =
    normalizeString(
      applicationId
    );

  const normalizedAttemptId =
    normalizeString(
      attemptId
    );

  const normalizedCandidateEmail =
    normalizeString(
      candidateEmail
    );


  /*
   * ==========================================================
   * GUARD
   * ==========================================================
   *
   * Existing executionGuard handles:
   *
   * - application existence
   * - optional candidate ownership
   * - attempt existence
   * - attempt/application relationship
   * - submitted attempt protection
   * - failed attempt protection
   * - cancelled attempt protection
   */

  let guarded;

  try {
    guarded =
      await assertCanResumeExecution(
        normalizedApplicationId,
        normalizedAttemptId,
        normalizedCandidateEmail
          ? {
              candidateEmail:
                normalizedCandidateEmail,
            }
          : {}
      );
  } catch (
    error
  ) {
    /*
     * Preserve structured guard errors exactly.
     */
    if (
      error instanceof
      ApplicationExecutionGuardError
    ) {
      throw error;
    }

    throw error;
  }


  const {
    application,
    attempt,
  } =
    guarded;

    /*
 * ============================================================
 * LOAD AUTHORITATIVE JOB
 * ============================================================
 *
 * Older Generated Applications may not have applicationUrl
 * populated even though the underlying job still has its URL.
 *
 * Reuse the existing application-layer lookup rather than
 * duplicating Sheet access in the resume service.
 */

const job =
  await getJobForCandidate(
    application.jobId,
    application.candidateEmail
  );


if (
  !job
) {
  throw new ApplicationExecutionResumeError(
    "Full job details could not be found for this application.",
    {
      code:
        "APPLICATION_JOB_NOT_FOUND",

      statusCode:
        404,

      details: {
        applicationId:
          application.applicationId,

        jobId:
          application.jobId,
      },
    }
  );
}


/*
 * URL fallback order mirrors the existing Google Form
 * preparation logic.
 */
const fallbackApplicationUrl =
  normalizeString(
    job.applicationUrl
  ) ||
  normalizeString(
    job.applyUrl
  ) ||
  normalizeString(
    job.url
  );


  /*
   * Candidate-triggered resume currently means:
   *
   * needs_review -> inspect/re-evaluate same paused work.
   */
  assertCandidateResumeStatus(
    attempt
  );


  /*
   * Verify this is the ONE active attempt for the application.
   */
  await assertSingleActiveAttempt({
    applicationId:
      application.applicationId,

    attemptId:
      attempt.attemptId,
  });


  /*
   * ==========================================================
   * METHOD
   * ==========================================================
   */

  const applicationMethod =
    normalizeLower(
      attempt.applicationMethod ||
      application.applicationMethod ||
      "unknown"
    );


  /*
   * ==========================================================
   * GOOGLE FORM
   * ==========================================================
   */

  if (
    applicationMethod ===
    "google_form"
  ) {
    return resumeGoogleFormExecution({
      application,
      attempt,
      fallbackUrl:
        fallbackApplicationUrl,
      applicationMethod:
        "google_form",
    });
  }


  /*
   * ==========================================================
   * EMAIL
   * ==========================================================
   *
   * Email review/resume needs its own confirmed-send workflow.
   *
   * We do not pretend it resumed.
   */

  if (
    applicationMethod ===
    "email"
  ) {
    return {
      status:
        "needs_review",

      nextAction:
        "review_email",

      reason:
        "The email application is still waiting for candidate review.",

      application,

      attempt,

      applicationMode:
        attempt.applicationMode ||
        application.applicationMode ||
        "assisted",

      resumed:
        false,
    };
  }


  /*
   * ==========================================================
   * LINKEDIN
   * ==========================================================
   */

  if (
    applicationMethod ===
    "linkedin_easy_apply"
  ) {
    return {
      status:
        "needs_review",

      nextAction:
        "linkedin_handoff",

      reason:
        "LinkedIn Easy Apply requires a human-assisted application flow.",

      application,

      attempt,

      applicationMode:
        attempt.applicationMode ||
        application.applicationMode ||
        "assisted",

      resumed:
        false,
    };
  }


  /*
   * ==========================================================
   * ATS
   * ==========================================================
   */

  if (
    applicationMethod ===
    "ats_form"
  ) {
    return {
      status:
        "needs_review",

      nextAction:
        "inspect_ats_form",

      reason:
        "ATS browser execution is not implemented yet.",

      application,

      attempt,

      applicationMode:
        attempt.applicationMode ||
        application.applicationMode ||
        "assisted",

      resumed:
        false,
    };
  }


  /*
   * ============================================================
   * COMPANY FORM
   * ============================================================
   *
   * MVP assisted execution uses the same generic browser
   * interaction engine as Google Forms.
   *
   * This is safe because executeCurrentBrowserForm() does not:
   *
   * - create attempts
   * - submit forms
   * - click final Submit
   *
   * It only:
   *
   * inspect -> resolve -> fill -> validate -> human review
   */

  if (
    applicationMethod ===
    "company_form"
  ) {
    return resumeGoogleFormExecution({
      application,
      attempt,

      fallbackUrl:
        fallbackApplicationUrl,

      applicationMethod:
        "company_form",
    });
  }


  /*
   * ==========================================================
   * MANUAL
   * ==========================================================
   */

  if (
    applicationMethod ===
    "manual_only"
  ) {
    return {
      status:
        "needs_review",

      nextAction:
        "manual_handoff",

      reason:
        "This application must continue manually.",

      application,

      attempt,

      applicationMode:
        attempt.applicationMode ||
        application.applicationMode ||
        "assisted",

      resumed:
        false,
    };
  }


  /*
   * ==========================================================
   * UNSUPPORTED / UNKNOWN
   * ==========================================================
   */

  return {
    status:
      "needs_review",

    nextAction:
      "manual_review",

    reason:
      "The application method requires manual review before execution can continue.",

    application,

    attempt,

    applicationMode:
      attempt.applicationMode ||
      application.applicationMode ||
      "assisted",

    resumed:
      false,
  };
}


/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  resumeApplicationExecution,

  resumeGoogleFormExecution,

  mapBrowserResumeNextAction,

  buildBrowserResumeReason,

  assertCandidateResumeStatus,

  assertSingleActiveAttempt,

  ApplicationExecutionResumeError,
};