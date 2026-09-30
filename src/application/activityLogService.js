const { randomUUID } = require("crypto");

const {
  readSheet,
  upsertRows,
} = require("../googleSheets");

const {
  ensureApplicationSheets,
} = require("./applicationSheets");

/*
 * ============================================================
 * CONSTANTS
 * ============================================================
 */

const ACTIVITY_LOG_SHEET =
  "Activity Log";

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

function nowIso() {
  return new Date()
    .toISOString();
}

function safeMetadata(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return "{}";
  }

  if (typeof value === "string") {
    try {
      JSON.parse(value);

      return value;
    } catch (_) {
      return JSON.stringify({
        value,
      });
    }
  }

  try {
    return JSON.stringify(value);
  } catch (_) {
    return "{}";
  }
}

/*
 * ============================================================
 * PERSIST ACTIVITY
 * ============================================================
 */

async function persistActivity(
  row
) {
  await upsertRows(
    ACTIVITY_LOG_SHEET,
    [row],
    ["activityId"]
  );

  return row;
}

/*
 * ============================================================
 * CREATE ACTIVITY
 * ============================================================
 */

async function logActivity({
  candidateEmail,
  entityType,
  entityId,
  eventType,
  status = "",
  message = "",
  metadata = {},
}) {
  await ensureApplicationSheets();

  if (!candidateEmail) {
    throw new Error(
      "candidateEmail is required when logging activity"
    );
  }

  if (!entityType) {
    throw new Error(
      "entityType is required when logging activity"
    );
  }

  if (!entityId) {
    throw new Error(
      "entityId is required when logging activity"
    );
  }

  if (!eventType) {
    throw new Error(
      "eventType is required when logging activity"
    );
  }

  const row = {
    activityId:
      randomUUID(),

    candidateEmail:
      normalizeEmail(
        candidateEmail
      ),

    entityType:
      String(
        entityType
      )
        .trim()
        .toLowerCase(),

    entityId:
      normalizeId(
        entityId
      ),

    eventType:
      String(
        eventType
      )
        .trim()
        .toLowerCase(),

    status:
      String(
        status || ""
      )
        .trim(),

    message:
      String(
        message || ""
      )
        .trim(),

    metadata:
      safeMetadata(
        metadata
      ),

    createdAt:
      nowIso(),
  };

  await persistActivity(
    row
  );

  return row;
}

/*
 * ============================================================
 * GET ACTIVITY
 * ============================================================
 */

async function getActivity(
  activityId
) {
  await ensureApplicationSheets();

  const rows =
    await readSheet(
      ACTIVITY_LOG_SHEET
    );

  const normalizedActivityId =
    normalizeId(
      activityId
    );

  return (
    rows.find(
      (row) =>
        normalizeId(
          row.activityId
        ) ===
        normalizedActivityId
    ) ||
    null
  );
}

/*
 * ============================================================
 * LIST ACTIVITY
 * ============================================================
 */

async function listActivity({
  candidateEmail,
  entityType,
  entityId,
  eventType,
  status,
  limit = 100,
} = {}) {
  await ensureApplicationSheets();

  let rows =
    await readSheet(
      ACTIVITY_LOG_SHEET
    );

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

  if (entityType) {
    const normalizedEntityType =
      String(
        entityType
      )
        .trim()
        .toLowerCase();

    rows =
      rows.filter(
        (row) =>
          String(
            row.entityType || ""
          )
            .trim()
            .toLowerCase() ===
          normalizedEntityType
      );
  }

  if (entityId) {
    const normalizedEntityId =
      normalizeId(
        entityId
      );

    rows =
      rows.filter(
        (row) =>
          normalizeId(
            row.entityId
          ) ===
          normalizedEntityId
      );
  }

  if (eventType) {
    const normalizedEventType =
      String(
        eventType
      )
        .trim()
        .toLowerCase();

    rows =
      rows.filter(
        (row) =>
          String(
            row.eventType || ""
          )
            .trim()
            .toLowerCase() ===
          normalizedEventType
      );
  }

  if (status) {
    const normalizedStatus =
      String(
        status
      )
        .trim()
        .toLowerCase();

    rows =
      rows.filter(
        (row) =>
          String(
            row.status || ""
          )
            .trim()
            .toLowerCase() ===
          normalizedStatus
      );
  }

  rows.sort(
    (a, b) =>
      new Date(
        b.createdAt || 0
      ) -
      new Date(
        a.createdAt || 0
      )
  );

  const safeLimit =
    Math.min(
      Math.max(
        Number(limit) || 100,
        1
      ),
      500
    );

  return rows.slice(
    0,
    safeLimit
  );
}

/*
 * ============================================================
 * APPLICATION ACTIVITY HELPERS
 * ============================================================
 */

async function logApplicationGenerated(
  application
) {
  return logActivity({
    candidateEmail:
      application.candidateEmail,

    entityType:
      "application",

    entityId:
      application.applicationId,

    eventType:
      "application_generated",

    status:
      application.status,

    message:
      `${application.jobTitle || "Application"} generated for ${application.company || "company"}.`,

    metadata: {
      jobId:
        application.jobId,

      jobTitle:
        application.jobTitle,

      company:
        application.company,

      overallScore:
        application.overallScore,
    },
  });
}

async function logApplicationUnderReview(
  application
) {
  return logActivity({
    candidateEmail:
      application.candidateEmail,

    entityType:
      "application",

    entityId:
      application.applicationId,

    eventType:
      "application_under_review",

    status:
      "Under Review",

    message:
      `${application.jobTitle || "Application"} moved to review.`,

    metadata: {
      jobId:
        application.jobId,

      company:
        application.company,
    },
  });
}

async function logApplicationApproved(
  application
) {
  return logActivity({
    candidateEmail:
      application.candidateEmail,

    entityType:
      "application",

    entityId:
      application.applicationId,

    eventType:
      "application_approved",

    status:
      "Approved",

    message:
      `${application.jobTitle || "Application"} approved for submission.`,

    metadata: {
      jobId:
        application.jobId,

      company:
        application.company,

      applicationMethod:
        application.applicationMethod,

      applicationMode:
        application.applicationMode,
    },
  });
}

async function logApplicationRejected(
  application
) {
  return logActivity({
    candidateEmail:
      application.candidateEmail,

    entityType:
      "application",

    entityId:
      application.applicationId,

    eventType:
      "application_rejected",

    status:
      "Rejected",

    message:
      `${application.jobTitle || "Application"} was rejected.`,

    metadata: {
      jobId:
        application.jobId,

      company:
        application.company,
    },
  });
}

async function logApplicationStarted(
  application,
  attempt
) {
  return logActivity({
    candidateEmail:
      application.candidateEmail,

    entityType:
      "application_attempt",

    entityId:
      attempt.attemptId,

    eventType:
      "application_started",

    status:
      attempt.status,

    message:
      `Application attempt started for ${application.jobTitle || "job"} at ${application.company || "company"}.`,

    metadata: {
      applicationId:
        application.applicationId,

      jobId:
        application.jobId,

      applicationMethod:
        attempt.applicationMethod,

      applicationMode:
        attempt.applicationMode,
    },
  });
}

async function logApplicationNeedsReview(
  application,
  attempt,
  reason = ""
) {
  return logActivity({
    candidateEmail:
      application.candidateEmail,

    entityType:
      "application_attempt",

    entityId:
      attempt.attemptId,

    eventType:
      "application_needs_review",

    status:
      "needs_review",

    message:
      reason ||
      `Application requires human review.`,

    metadata: {
      applicationId:
        application.applicationId,

      jobId:
        application.jobId,

      applicationMethod:
        attempt.applicationMethod,
    },
  });
}

async function logApplicationFailed(
  application,
  attempt,
  reason = ""
) {
  return logActivity({
    candidateEmail:
      application.candidateEmail,

    entityType:
      "application_attempt",

    entityId:
      attempt.attemptId,

    eventType:
      "application_failed",

    status:
      "failed",

    message:
      reason ||
      "Application attempt failed.",

    metadata: {
      applicationId:
        application.applicationId,

      jobId:
        application.jobId,

      applicationMethod:
        attempt.applicationMethod,
    },
  });
}

async function logApplicationSubmitted(
  application,
  attempt
) {
  return logActivity({
    candidateEmail:
      application.candidateEmail,

    entityType:
      "application_attempt",

    entityId:
      attempt.attemptId,

    eventType:
      "application_submitted",

    status:
      "submitted",

    message:
      `${application.jobTitle || "Application"} submitted to ${application.company || "company"}.`,

    metadata: {
      applicationId:
        application.applicationId,

      jobId:
        application.jobId,

      applicationMethod:
        attempt.applicationMethod,

      applicationMode:
        attempt.applicationMode,

      confirmationReference:
        attempt.confirmationReference,

      confirmationUrl:
        attempt.confirmationUrl,
    },
  });
}

/*
 * ============================================================
 * JOB ACTIVITY HELPERS
 * ============================================================
 */

async function logJobQueued(
  job
) {
  return logActivity({
    candidateEmail:
      job.candidateEmail,

    entityType:
      "job",

    entityId:
      job.jobId,

    eventType:
      "job_queued",

    status:
      "Queued",

    message:
      `${job.title || "Job"} at ${job.company || "company"} added to review queue.`,

    metadata: {
      company:
        job.company,

      title:
        job.title,

      sourceName:
        job.sourceName,

      overallScore:
        job.overallScore,
    },
  });
}

async function logJobUnqueued(
  job
) {
  return logActivity({
    candidateEmail:
      job.candidateEmail,

    entityType:
      "job",

    entityId:
      job.jobId,

    eventType:
      "job_unqueued",

    status:
      "New",

    message:
      `${job.title || "Job"} removed from review queue.`,

    metadata: {
      company:
        job.company,

      title:
        job.title,
    },
  });
}

async function logJobApplied(
  job
) {
  return logActivity({
    candidateEmail:
      job.candidateEmail,

    entityType:
      "job",

    entityId:
      job.jobId,

    eventType:
      "job_applied",

    status:
      "Applied",

    message:
      `${job.title || "Job"} at ${job.company || "company"} marked as applied.`,

    metadata: {
      company:
        job.company,

      title:
        job.title,
    },
  });
}

/*
 * ============================================================
 * SEARCH ACTIVITY HELPERS
 * ============================================================
 */

async function logSearchStarted(
  run
) {
  return logActivity({
    candidateEmail:
      run.candidateEmail,

    entityType:
      "search_run",

    entityId:
      run.runId,

    eventType:
      "search_started",

    status:
      run.status || "running",

    message:
      "Job search started.",

    metadata: {
      startedAt:
        run.startedAt,
    },
  });
}

async function logSearchCompleted(
  run
) {
  return logActivity({
    candidateEmail:
      run.candidateEmail,

    entityType:
      "search_run",

    entityId:
      run.runId,

    eventType:
      "search_completed",

    status:
      "completed",

    message:
      "Job search completed.",

    metadata: {
      totalJobsFound:
        run.totalJobsFound,

      qualifiedJobs:
        run.qualifiedJobs,

      sourceSummary:
        run.sourceSummary,
    },
  });
}

async function logSearchFailed(
  run,
  reason = ""
) {
  return logActivity({
    candidateEmail:
      run.candidateEmail,

    entityType:
      "search_run",

    entityId:
      run.runId,

    eventType:
      "search_failed",

    status:
      "failed",

    message:
      reason ||
      "Job search failed.",

    metadata: {
      error:
        run.error || reason,
    },
  });
}

/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  logActivity,

  getActivity,
  listActivity,

  logApplicationGenerated,
  logApplicationUnderReview,
  logApplicationApproved,
  logApplicationRejected,

  logApplicationStarted,
  logApplicationNeedsReview,
  logApplicationFailed,
  logApplicationSubmitted,

  logJobQueued,
  logJobUnqueued,
  logJobApplied,

  logSearchStarted,
  logSearchCompleted,
  logSearchFailed,
};