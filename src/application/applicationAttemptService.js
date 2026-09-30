const { randomUUID } = require("crypto");

const {
  readSheet,
  upsertRows,
} = require("../googleSheets");

const {
  ensureApplicationSheets,
} = require("./applicationSheets");

const {
  createFollowUp,
} = require(
  "./followUpService"
);

const {
  logApplicationStarted,
  logApplicationNeedsReview,
  logApplicationFailed,
  logApplicationSubmitted,
  logJobApplied,
} = require("./activityLogService");

/*
 * ============================================================
 * CONSTANTS
 * ============================================================
 */

const APPLICATION_ATTEMPTS_SHEET =
  "Application Attempts";

const GENERATED_APPLICATIONS_SHEET =
  "Generated Applications";

const SHORTLISTED_JOBS_SHEET =
  "Shortlisted Jobs";

const VALID_ATTEMPT_STATUSES =
  new Set([
    "pending",
    "applying",
    "needs_review",
    "submitted",
    "failed",
  ]);

const VALID_APPLICATION_MODES =
  new Set([
    "manual",
    "assisted",
    "automatic",
  ]);

/*
 * ============================================================
 * HELPERS
 * ============================================================
 */

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeId(value) {
  return String(value || "")
    .trim();
}

function normalizeStatus(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function nowIso() {
  return new Date()
    .toISOString();
}

function toNumber(value) {
  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : 0;
}

function assertAttemptStatus(status) {
  const normalized =
    normalizeStatus(status);

  if (
    !VALID_ATTEMPT_STATUSES.has(
      normalized
    )
  ) {
    throw new Error(
      `Invalid application attempt status: ${status}`
    );
  }

  return normalized;
}

function assertApplicationMode(mode) {
  const normalized =
    normalizeStatus(mode);

  if (
    !VALID_APPLICATION_MODES.has(
      normalized
    )
  ) {
    throw new Error(
      `Invalid application mode: ${mode}`
    );
  }

  return normalized;
}

/*
 * ============================================================
 * GENERATED APPLICATION LOOKUP
 * ============================================================
 */

async function getGeneratedApplication(
  applicationId
) {
  await ensureApplicationSheets();

  const rows =
    await readSheet(
      GENERATED_APPLICATIONS_SHEET
    );

  const normalizedApplicationId =
    normalizeId(
      applicationId
    );

  return (
    rows.find(
      (row) =>
        normalizeId(
          row.applicationId
        ) ===
        normalizedApplicationId
    ) ||
    null
  );
}

/*
 * ============================================================
 * GENERATED APPLICATION PERSISTENCE
 * ============================================================
 */

async function persistGeneratedApplication(
  row
) {
  await upsertRows(
    GENERATED_APPLICATIONS_SHEET,
    [row],
    ["applicationId"]
  );

  return row;
}

/*
 * ============================================================
 * ATTEMPT LOOKUP
 * ============================================================
 */

async function getApplicationAttempt(
  attemptId
) {
  await ensureApplicationSheets();

  const rows =
    await readSheet(
      APPLICATION_ATTEMPTS_SHEET
    );

  const normalizedAttemptId =
    normalizeId(
      attemptId
    );

  return (
    rows.find(
      (row) =>
        normalizeId(
          row.attemptId
        ) ===
        normalizedAttemptId
    ) ||
    null
  );
}

/*
 * ============================================================
 * ATTEMPT PERSISTENCE
 * ============================================================
 */

async function persistApplicationAttempt(
  row
) {
  await upsertRows(
    APPLICATION_ATTEMPTS_SHEET,
    [row],
    ["attemptId"]
  );

  return row;
}

/*
 * ============================================================
 * LIST ATTEMPTS
 * ============================================================
 */

async function listApplicationAttempts(
  {
    applicationId,
    candidateEmail,
    jobId,
    status,
    limit = 50,
  } = {}
) {
  await ensureApplicationSheets();

  let rows =
    await readSheet(
      APPLICATION_ATTEMPTS_SHEET
    );

  if (applicationId) {
    const normalizedApplicationId =
      normalizeId(
        applicationId
      );

    rows =
      rows.filter(
        (row) =>
          normalizeId(
            row.applicationId
          ) ===
          normalizedApplicationId
      );
  }

  if (candidateEmail) {
    const normalizedCandidateEmail =
      normalizeEmail(
        candidateEmail
      );

    rows =
      rows.filter(
        (row) =>
          normalizeEmail(
            row.candidateEmail
          ) ===
          normalizedCandidateEmail
      );
  }

  if (jobId) {
    const normalizedJobId =
      normalizeId(
        jobId
      );

    rows =
      rows.filter(
        (row) =>
          normalizeId(
            row.jobId
          ) ===
          normalizedJobId
      );
  }

  if (status) {
    const normalizedStatus =
      normalizeStatus(
        status
      );

    rows =
      rows.filter(
        (row) =>
          normalizeStatus(
            row.status
          ) ===
          normalizedStatus
      );
  }

  rows.sort(
    (a, b) =>
      new Date(
        b.updatedAt ||
        b.createdAt ||
        b.startedAt ||
        0
      ) -
      new Date(
        a.updatedAt ||
        a.createdAt ||
        a.startedAt ||
        0
      )
  );

  const safeLimit =
    Math.min(
      Math.max(
        Number(limit) || 50,
        1
      ),
      100
    );

  return rows.slice(
    0,
    safeLimit
  );
}

/*
 * ============================================================
 * SHORTLISTED JOB LOOKUP
 * ============================================================
 */

async function getShortlistedJob({
  candidateEmail,
  jobId,
}) {
  const rows =
    await readSheet(
      SHORTLISTED_JOBS_SHEET
    );

  const normalizedCandidateEmail =
    normalizeEmail(
      candidateEmail
    );

  const normalizedJobId =
    normalizeId(
      jobId
    );

  return (
    rows.find(
      (row) =>
        normalizeEmail(
          row.candidateEmail
        ) ===
          normalizedCandidateEmail &&
        normalizeId(
          row.jobId
        ) ===
          normalizedJobId
    ) ||
    null
  );
}

/*
 * ============================================================
 * MARK SHORTLISTED JOB AS APPLIED
 * ============================================================
 */

async function markShortlistedJobApplied({
  candidateEmail,
  jobId,
}) {
  const job =
    await getShortlistedJob({
      candidateEmail,
      jobId,
    });

  if (!job) {
    console.warn(
      `[ApplicationAttempt] Shortlisted job not found for candidate=${candidateEmail} jobId=${jobId}`
    );

    return null;
  }

  job.status =
    "Applied";

  if (
    Object.prototype.hasOwnProperty.call(
      job,
      "updatedAt"
    )
  ) {
    job.updatedAt =
      nowIso();
  }

  await upsertRows(
    SHORTLISTED_JOBS_SHEET,
    [job],
    [
      "jobId",
      "candidateEmail",
    ]
  );

  return job;
}

/*
 * ============================================================
 * CREATE APPLICATION ATTEMPT
 * ============================================================
 */

async function createApplicationAttempt({
  applicationId,
  applicationMethod,
  applicationMode,
}) {
  await ensureApplicationSheets();

  const application =
    await getGeneratedApplication(
      applicationId
    );

  if (!application) {
    throw new Error(
      "Generated application not found"
    );
  }

  /*
   * Only an Approved application may begin the
   * actual submission process.
   */
  if (
    normalizeStatus(
      application.status
    ) !==
    "approved"
  ) {
    throw new Error(
      "Application must be Approved before starting an application attempt"
    );
  }

  const method =
    String(
      applicationMethod ||
      application.applicationMethod ||
      "unknown"
    )
      .trim()
      .toLowerCase();

  const mode =
    assertApplicationMode(
      applicationMode ||
      application.applicationMode ||
      "assisted"
    );

  const attemptId =
    randomUUID();

  const now =
    nowIso();

  const attempt = {
    attemptId,

    applicationId:
      application.applicationId,

    candidateEmail:
      application.candidateEmail,

    jobId:
      application.jobId,

    applicationMethod:
      method,

    applicationMode:
      mode,

    status:
      "pending",

    startedAt:
      now,

    completedAt:
      "",

    failureReason:
      "",

    confirmationReference:
      "",

    confirmationUrl:
      "",

    createdAt:
      now,

    updatedAt:
      now,
  };

  await persistApplicationAttempt(
    attempt
  );

  /*
   * Synchronize the parent Generated Application.
   */
  application.applicationMethod =
    method;

  application.applicationMode =
    mode;

  application.executionStatus =
    "applying";

  application.lastAttemptAt =
    now;

  application.attemptCount =
    toNumber(
      application.attemptCount
    ) + 1;

  application.failureReason =
    "";

  application.updatedAt =
    now;

  await persistGeneratedApplication(
    application
  );

  /*
   * Permanent activity record.
   */
  await logApplicationStarted(
    application,
    attempt
  );

  return attempt;
}

/*
 * ============================================================
 * UPDATE APPLICATION ATTEMPT
 * ============================================================
 */

async function updateApplicationAttempt(
  attemptId,
  {
    status,
    failureReason,
    confirmationReference,
    confirmationUrl,
  } = {}
) {
  await ensureApplicationSheets();

  const attempt =
    await getApplicationAttempt(
      attemptId
    );

  if (!attempt) {
    throw new Error(
      "Application attempt not found"
    );
  }

  const application =
    await getGeneratedApplication(
      attempt.applicationId
    );

  if (!application) {
    throw new Error(
      "Parent generated application not found"
    );
  }

  const now =
    nowIso();

  if (status !== undefined) {
    attempt.status =
      assertAttemptStatus(
        status
      );
  }

  if (
    failureReason !== undefined
  ) {
    attempt.failureReason =
      String(
        failureReason || ""
      );
  }

  if (
    confirmationReference !==
    undefined
  ) {
    attempt.confirmationReference =
      String(
        confirmationReference || ""
      );
  }

  if (
    confirmationUrl !== undefined
  ) {
    attempt.confirmationUrl =
      String(
        confirmationUrl || ""
      );
  }

  attempt.updatedAt =
    now;

  /*
   * Terminal attempt states receive completedAt.
   */
  if (
    attempt.status ===
      "submitted" ||
    attempt.status ===
      "failed"
  ) {
    attempt.completedAt =
      now;
  }

  /*
   * ==========================================================
   * SYNCHRONIZE PARENT APPLICATION EXECUTION STATE
   * ==========================================================
   */

  if (
    attempt.status ===
      "pending" ||
    attempt.status ===
      "applying"
  ) {
    application.executionStatus =
      "applying";
  }

  if (
    attempt.status ===
    "needs_review"
  ) {
    application.executionStatus =
      "needs_review";
  }

  if (
    attempt.status ===
    "failed"
  ) {
    application.executionStatus =
      "failed";

    application.failureReason =
      attempt.failureReason ||
      "Application attempt failed.";
  }

  if (
    attempt.status ===
    "submitted"
  ) {
    application.executionStatus =
      "submitted";

    application.status =
      "Applied";

    application.submittedAt =
      now;

    application.confirmationReference =
      attempt.confirmationReference ||
      "";

    application.failureReason =
      "";
  }

  application.updatedAt =
    now;

  await persistApplicationAttempt(
    attempt
  );

  await persistGeneratedApplication(
    application
  );

  return {
    attempt,
    application,
  };
}

/*
 * ============================================================
 * START ATTEMPT
 * ============================================================
 *
 * pending -> applying
 */

async function startApplicationAttempt(
  attemptId
) {
  return updateApplicationAttempt(
    attemptId,
    {
      status:
        "applying",
    }
  );
}

/*
 * ============================================================
 * PAUSE FOR HUMAN REVIEW
 * ============================================================
 */

async function markAttemptNeedsReview(
  attemptId,
  reason = ""
) {
  const result =
    await updateApplicationAttempt(
      attemptId,
      {
        status:
          "needs_review",

        failureReason:
          reason,
      }
    );

  await logApplicationNeedsReview(
    result.application,
    result.attempt,
    reason
  );

  return result;
}

/*
 * ============================================================
 * MARK ATTEMPT FAILED
 * ============================================================
 */

async function failApplicationAttempt(
  attemptId,
  reason
) {
  const finalReason =
    reason ||
    "Application attempt failed.";

  const result =
    await updateApplicationAttempt(
      attemptId,
      {
        status:
          "failed",

        failureReason:
          finalReason,
      }
    );

  await logApplicationFailed(
    result.application,
    result.attempt,
    finalReason
  );

  return result;
}

/*
 * ============================================================
 * MARK ATTEMPT SUBMITTED
 * ============================================================
 */

async function submitApplicationAttempt(
  attemptId,
  {
    confirmationReference,
    confirmationUrl,
  } = {}
) {
  /*
   * First finalize the attempt and parent application.
   */
  const result =
    await updateApplicationAttempt(
      attemptId,
      {
        status:
          "submitted",

        confirmationReference:
          confirmationReference ||
          "",

        confirmationUrl:
          confirmationUrl ||
          "",
      }
    );

    /*
 * ============================================================
 * CREATE POST-APPLICATION FOLLOW-UP
 * ============================================================
 *
 * Every successfully submitted application receives one
 * pending follow-up.
 *
 * createFollowUp() is idempotent, so retries will not create
 * duplicate pending follow-ups.
 */

let followUp =
  null;

try {
  followUp =
    await createFollowUp({
      applicationId:
        result.application
          .applicationId,

      candidateEmail:
        result.application
          .candidateEmail,

      jobId:
        result.application
          .jobId,

      company:
        result.application
          .company,

      jobTitle:
        result.application
          .jobTitle,

      days:
        7,

      note:
        "Follow up on submitted job application.",
    });
} catch (followUpError) {
  /*
   * Submission has already succeeded.
   *
   * A follow-up persistence failure should be logged rather
   * than pretending the application itself failed.
   */
  console.error(
    "[ApplicationAttempt] Failed to create follow-up:",
    followUpError
  );
}

  /*
   * Then synchronize the matching Shortlisted Job.
   */
  const appliedJob =
    await markShortlistedJobApplied({
      candidateEmail:
        result.application.candidateEmail,

      jobId:
        result.application.jobId,
    });

  /*
   * Permanent application activity.
   */
  await logApplicationSubmitted(
    result.application,
    result.attempt
  );

  /*
   * Permanent job activity.
   */
  if (appliedJob) {
    await logJobApplied(
      appliedJob
    );
  }

  return {
  ...result,

  job:
    appliedJob,

  followUp,
};
}

/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  createApplicationAttempt,

  getApplicationAttempt,
  listApplicationAttempts,

  updateApplicationAttempt,

  startApplicationAttempt,
  markAttemptNeedsReview,
  failApplicationAttempt,
  submitApplicationAttempt,

  markShortlistedJobApplied,
};