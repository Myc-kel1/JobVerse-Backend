const {
  getGeneratedApplication,
  getJobForCandidate
} = require(
  "./applicationService"
);

const {
  createApplicationAttempt,
  startApplicationAttempt,
  markAttemptNeedsReview,
  failApplicationAttempt
} = require(
  "./applicationAttemptService"
);

const {
  prepareManualApplication
} = require(
  "./channels/manualApplication"
);

const {
  routeApplication
} = require(
  "./applicationRouter"
);

const {
  prepareGoogleFormApplication
} = require(
  "./channels/googleFormApplication"
);

const {
  prepareEmailApplication
} = require(
  "./channels/emailApplication"
);

const {
  assertCanStartExecution
} = require(
  "./execution/executionGuard"
);

/*
 * ============================================================
 * CONSTANTS
 * ============================================================
 */

const SUPPORTED_EXECUTION_MODES =
  new Set([
    "manual",
    "assisted",
    "automatic"
  ]);

/*
 * ============================================================
 * HELPERS
 * ============================================================
 */

function normalizeString(
  value
) {
  return String(
    value || ""
  ).trim();
}

function normalizeLower(
  value
) {
  return normalizeString(
    value
  ).toLowerCase();
}

function normalizeExecutionMode(
  value
) {
  const mode =
    normalizeLower(
      value ||
      "assisted"
    );

  if (
    !SUPPORTED_EXECUTION_MODES.has(
      mode
    )
  ) {
    throw new Error(
      `Unsupported application mode: ${value}`
    );
  }

  return mode;
}

/*
 * ============================================================
 * VALIDATE EXECUTABLE APPLICATION
 * ============================================================
 */

function validateExecutableApplication(
  application
) {
  if (!application) {
    throw new Error(
      "Generated application not found"
    );
  }

  const status =
    normalizeLower(
      application.status
    );

  if (
    status !==
    "approved"
  ) {
    throw new Error(
      "Application must be Approved before execution can begin"
    );
  }

  const executionStatus =
    normalizeLower(
      application.executionStatus
    );

  if (
    executionStatus ===
    "submitted"
  ) {
    throw new Error(
      "Application has already been submitted"
    );
  }

  return true;
}

/*
 * ============================================================
 * RESOLVE APPLICATION ROUTE
 * ============================================================
 */

async function resolveApplicationRoute(
  applicationId
) {
  const application =
    await getGeneratedApplication(
      applicationId
    );

  validateExecutableApplication(
    application
  );

  const job =
    await getJobForCandidate(
      application.jobId,
      application.candidateEmail
    );

  if (!job) {
    throw new Error(
      "Full job details not found for this application"
    );
  }

  const route =
    routeApplication({
      job,
      application
    });

  return {
    application,
    job,
    route
  };
}

/*
 * ============================================================
 * PREVIEW APPLICATION EXECUTION
 * ============================================================
 *
 * Does not create an attempt.
 *
 * Used by the frontend to preview how an approved application
 * would be handled.
 */

async function previewApplicationExecution(
  applicationId
) {
  const {
    application,
    job,
    route
  } =
    await resolveApplicationRoute(
      applicationId
    );

  const preview = {
    applicationId:
      application.applicationId,

    candidateEmail:
      application.candidateEmail,

    jobId:
      application.jobId,

    jobTitle:
      application.jobTitle,

    company:
      application.company,

    applicationMode:
      application.applicationMode ||
      "assisted",

    applicationMethod:
      route.applicationMethod,

    applicationUrl:
      route.applicationUrl,

    applicationRecipient:
      route.applicationRecipient,

    confidence:
      route.confidence,

    reason:
      route.reason,

    requiresHumanReview:
      route.requiresHumanReview
  };

  /*
   * If this is an email application, enrich the preview with
   * the actual draft package.
   */
  if (
    route.applicationMethod ===
    "email"
  ) {
    try {
      const email =
        await prepareEmailApplication({
          applicationId:
            application.applicationId
        });

      preview.email =
        email;
    } catch (err) {
      preview.email = {
        ready:
          false,

        reason:
          err?.message ||
          String(err)
      };
    }
  }

  return preview;
}

/*
 * ============================================================
 * PREPARE APPLICATION EXECUTION
 * ============================================================
 *
 * 1. Authorize execution through executionGuard.js
 * 2. Load job and detect submission method
 * 3. Normalize execution mode
 * 4. Create Application Attempt
 *
 * No actual submission occurs here.
 *
 * IMPORTANT:
 *
 * This service does NOT implement execution eligibility rules.
 *
 * Those rules belong to:
 *
 *     execution/executionGuard.js
 *
 * The guard verifies, among other things:
 *
 * - application is eligible for execution
 * - required generated documents exist
 * - executionStatus is ready
 * - application has not already been submitted
 * - no conflicting active attempt exists
 */

async function prepareApplicationExecution({
  applicationId,
  applicationMode
}) {
  /*
   * ==========================================================
   * EXECUTION GATE
   * ==========================================================
   *
   * This MUST happen before:
   *
   * - application routing for a real execution
   * - Application Attempt creation
   *
   * If this throws, nothing below runs.
   *
   * In particular:
   *
   *     createApplicationAttempt()
   *
   * will never run for an ineligible or duplicate execution.
   */

  await assertCanStartExecution(
    applicationId
  );

  /*
   * ==========================================================
   * EXISTING ROUTE RESOLUTION
   * ==========================================================
   *
   * Existing behavior is intentionally preserved.
   *
   * resolveApplicationRoute() continues to:
   *
   * - load application
   * - load full job
   * - detect application method
   *
   * We are not moving that responsibility into this function.
   */

  const {
    application,
    job,
    route
  } =
    await resolveApplicationRoute(
      applicationId
    );

  /*
   * ==========================================================
   * EXECUTION MODE
   * ==========================================================
   *
   * Existing behavior preserved.
   */

  const mode =
    normalizeExecutionMode(
      applicationMode ||
      application.applicationMode ||
      "assisted"
    );

  /*
   * ==========================================================
   * CREATE ATTEMPT
   * ==========================================================
   *
   * At this point the centralized execution guard has already
   * authorized creation of a NEW attempt.
   */

  const attempt =
    await createApplicationAttempt({
      applicationId:
        application.applicationId,

      applicationMethod:
        route.applicationMethod,

      applicationMode:
        mode
    });

  return {
    application,
    job,
    route,
    attempt
  };
}

/*
 * ============================================================
 * HANDLE EMAIL EXECUTION
 * ============================================================
 */

async function handleEmailExecution({
  application,
  job,
  route,
  attempt,
  mode
}) {
  /*
   * Prepare the actual email payload.
   */
  const email =
    await prepareEmailApplication({
      applicationId:
        application.applicationId
    });

  /*
   * If the email cannot be prepared safely, pause rather than
   * fail the whole application.
   */
  if (
    !email.ready
  ) {
    const review =
      await markAttemptNeedsReview(
        attempt.attemptId,
        email.reason ||
        "Email application requires additional review."
      );

    return {
      status:
        "needs_review",

      nextAction:
        "review_email",

      application,

      job,

      route,

      applicationMode:
        mode,

      attempt:
        review.attempt,

      parentApplication:
        review.application,

      email
    };
  }

  /*
   * Assisted mode intentionally pauses for review.
   *
   * The candidate should confirm:
   * - recipient
   * - subject
   * - body
   * - attachments
   *
   * before we add Gmail sending.
   */
  if (
    mode ===
    "assisted"
  ) {
    const review =
      await markAttemptNeedsReview(
        attempt.attemptId,
        "Email draft is ready for candidate review before sending."
      );

    return {
      status:
        "needs_review",

      nextAction:
        "review_email",

      application,

      job,

      route,

      applicationMode:
        mode,

      attempt:
        review.attempt,

      parentApplication:
        review.application,

      email
    };
  }

  /*
   * Manual mode means JobVerse prepares the email but the
   * candidate sends it personally.
   */
  if (
    mode ===
    "manual"
  ) {
    const review =
      await markAttemptNeedsReview(
        attempt.attemptId,
        "Email draft is ready. Candidate must send the application manually."
      );

    return {
      status:
        "needs_review",

      nextAction:
        "manual_email_send",

      application,

      job,

      route,

      applicationMode:
        mode,

      attempt:
        review.attempt,

      parentApplication:
        review.application,

      email
    };
  }

  /*
   * Automatic sending has deliberately not been enabled yet.
   *
   * We do NOT pretend the email was sent.
   */
  if (
    mode ===
    "automatic"
  ) {
    const review =
      await markAttemptNeedsReview(
        attempt.attemptId,
        "Automatic email sending is not enabled yet. Review the prepared email before submission."
      );

    return {
      status:
        "needs_review",

      nextAction:
        "review_email",

      application,

      job,

      route,

      applicationMode:
        mode,

      attempt:
        review.attempt,

      parentApplication:
        review.application,

      email
    };
  }

  /*
   * Defensive fallback.
   */
  const failure =
    await failApplicationAttempt(
      attempt.attemptId,
      `Unsupported email execution mode: ${mode}`
    );

  return {
    status:
      "failed",

    nextAction:
      null,

    application,

    job,

    route,

    applicationMode:
      mode,

    attempt:
      failure.attempt,

    parentApplication:
      failure.application,

    email
  };
}

/*
 * ============================================================
 * START APPLICATION EXECUTION
 * ============================================================
 */

async function startApplicationExecution({
  applicationId,
  applicationMode
}) {
  const prepared =
    await prepareApplicationExecution({
      applicationId,
      applicationMode
    });

  const {
    application,
    job,
    route,
    attempt
  } =
    prepared;

  const mode =
    normalizeExecutionMode(
      attempt.applicationMode ||
      applicationMode ||
      application.applicationMode ||
      "assisted"
    );

  /*
   * Move attempt:
   *
   * pending
   *   ↓
   * applying
   */
  await startApplicationAttempt(
    attempt.attemptId
  );

  /*
   * ==========================================================
   * ROUTE TO CHANNEL
   * ==========================================================
   */

  switch (
    route.applicationMethod
  ) {
    /*
     * --------------------------------------------------------
     * EMAIL
     * --------------------------------------------------------
     */
    case "email":
      return handleEmailExecution({
        application,
        job,
        route,
        attempt,
        mode
      });

    /*
     * --------------------------------------------------------
     * GOOGLE FORM
     * --------------------------------------------------------
     */
   case "google_form": {
  /*
   * ========================================================
   * INSPECT AND PREPARE GOOGLE FORM
   * ========================================================
   */

  const googleForm =
    await prepareGoogleFormApplication({
      applicationId:
        application.applicationId,

      formUrl:
        route.applicationUrl,
    });

  /*
   * We still pause before submission.
   *
   * Reasons may include:
   *
   * - missing candidate answers
   * - questions requiring confirmation
   * - Google authentication
   * - CAPTCHA
   * - incomplete inspection
   * - final candidate review
   */

  const reviewReason =
    googleForm.reason ||
    (
      googleForm.ready
        ? "Google Form application is prepared and ready for candidate review."
        : "Google Form application requires candidate input or review."
    );

  const review =
    await markAttemptNeedsReview(
      attempt.attemptId,
      reviewReason
    );

  return {
    status:
      "needs_review",

    nextAction:
      googleForm.ready
        ? "review_google_form"
        : "complete_google_form_answers",

    application,

    job,

    route,

    applicationMode:
      mode,

    attempt:
      review.attempt,

    parentApplication:
      review.application,

    googleForm,
  };
}

    /*
     * --------------------------------------------------------
     * LINKEDIN EASY APPLY
     * --------------------------------------------------------
     */
    case "linkedin_easy_apply": {
      const review =
        await markAttemptNeedsReview(
          attempt.attemptId,
          "LinkedIn Easy Apply detected. Human-assisted application flow is required."
        );

      return {
        status:
          "needs_review",

        nextAction:
          "linkedin_handoff",

        application,

        job,

        route,

        applicationMode:
          mode,

        attempt:
          review.attempt,

        parentApplication:
          review.application
      };
    }

    /*
     * --------------------------------------------------------
     * ATS FORM
     * --------------------------------------------------------
     */
    case "ats_form": {
      const review =
        await markAttemptNeedsReview(
          attempt.attemptId,
          "ATS application form detected. Form inspection is required before submission."
        );

      return {
        status:
          "needs_review",

        nextAction:
          "inspect_ats_form",

        application,

        job,

        route,

        applicationMode:
          mode,

        attempt:
          review.attempt,

        parentApplication:
          review.application
      };
    }

    /*
     * --------------------------------------------------------
     * COMPANY FORM
     * --------------------------------------------------------
     */
    case "company_form": {
      const review =
        await markAttemptNeedsReview(
          attempt.attemptId,
          "Company application form detected. Human-assisted inspection is required."
        );

      return {
        status:
          "needs_review",

        nextAction:
          "inspect_company_form",

        application,

        job,

        route,

        applicationMode:
          mode,

        attempt:
          review.attempt,

        parentApplication:
          review.application
      };
    }

    /*
     * --------------------------------------------------------
     * MANUAL ONLY
     * --------------------------------------------------------
     */
    case "manual_only": {
  const manual =
    await prepareManualApplication({
      applicationId:
        application.applicationId,

      route
    });

  const review =
    await markAttemptNeedsReview(
      attempt.attemptId,
      "Application requires manual candidate submission."
    );

  return {
    status:
      "needs_review",

    nextAction:
      "manual_handoff",

    application,

    job,

    route,

    applicationMode:
      mode,

    attempt:
      review.attempt,

    parentApplication:
      review.application,

    manual
  };
}

    /*
     * --------------------------------------------------------
     * UNKNOWN
     * --------------------------------------------------------
     */
    case "unknown": {
  const manual =
    await prepareManualApplication({
      applicationId:
        application.applicationId,

      route
    });

  const review =
    await markAttemptNeedsReview(
      attempt.attemptId,
      "Application method could not be identified reliably. Manual review is required."
    );

  return {
    status:
      "needs_review",

    nextAction:
      "manual_review",

    application,

    job,

    route,

    applicationMode:
      mode,

    attempt:
      review.attempt,

    parentApplication:
      review.application,

    manual
  };
}

    /*
     * --------------------------------------------------------
     * SAFETY FALLBACK
     * --------------------------------------------------------
     */
    default: {
      const failure =
        await failApplicationAttempt(
          attempt.attemptId,
          `Unsupported application method: ${route.applicationMethod}`
        );

      return {
        status:
          "failed",

        nextAction:
          null,

        application,

        job,

        route,

        applicationMode:
          mode,

        attempt:
          failure.attempt,

        parentApplication:
          failure.application
      };
    }
  }
}

/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  resolveApplicationRoute,
  previewApplicationExecution,
  prepareApplicationExecution,
  startApplicationExecution
};
