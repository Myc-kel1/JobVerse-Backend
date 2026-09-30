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
 * FOLLOW-UP SERVICE
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * This service manages post-application follow-up tasks.
 *
 * When an application is successfully submitted, JobVerse
 * should not simply mark the application as Applied and stop.
 *
 * A follow-up record gives us a persistent reminder that the
 * candidate may need to:
 *
 * - check application progress
 * - contact the employer
 * - send a follow-up email
 * - update the application status
 * - record an interview/rejection/response
 *
 * WHY THIS FILE EXISTS
 * ------------------------------------------------------------
 *
 * Follow-up logic should not live inside:
 *
 * - applicationAttemptService.js
 * - emailApplication.js
 * - ATS handlers
 * - frontend components
 *
 * Those files may TRIGGER follow-up creation, but this service
 * owns the actual follow-up lifecycle.
 *
 * This gives JobVerse:
 *
 * - one source of truth
 * - consistent follow-up behavior
 * - persistent reminders
 * - reusable follow-up APIs
 * - cleaner separation of concerns
 *
 * ============================================================
 */

/*
 * ============================================================
 * CONSTANTS
 * ============================================================
 */

const FOLLOW_UPS_SHEET =
  "Follow Ups";

/*
 * Supported follow-up statuses.
 *
 * pending:
 *   follow-up still needs attention
 *
 * completed:
 *   candidate completed the follow-up
 *
 * dismissed:
 *   follow-up intentionally closed without action
 */
const VALID_FOLLOW_UP_STATUSES =
  new Set([
    "pending",
    "completed",
    "dismissed",
  ]);

/*
 * Default number of days after submission before a follow-up
 * becomes due.
 *
 * Keeping this as a constant makes it easy to move into config
 * later without changing the service's public API.
 */
const DEFAULT_FOLLOW_UP_DAYS =
  7;

/*
 * ============================================================
 * BASIC HELPERS
 * ============================================================
 */

function nowIso() {
  return new Date()
    .toISOString();
}

function normalizeString(
  value
) {
  return String(
    value ?? ""
  ).trim();
}

function normalizeEmail(
  value
) {
  return normalizeString(
    value
  ).toLowerCase();
}

function normalizeId(
  value
) {
  return normalizeString(
    value
  );
}

function normalizeStatus(
  value
) {
  return normalizeString(
    value
  ).toLowerCase();
}

/*
 * ============================================================
 * STATUS VALIDATION
 * ============================================================
 */

function assertFollowUpStatus(
  status
) {
  const normalized =
    normalizeStatus(
      status
    );

  if (
    !VALID_FOLLOW_UP_STATUSES.has(
      normalized
    )
  ) {
    throw new Error(
      `Invalid follow-up status: ${status}`
    );
  }

  return normalized;
}

/*
 * ============================================================
 * DATE HELPERS
 * ============================================================
 */

/*
 * Calculate a future due date.
 *
 * Example:
 *
 * submission:
 *   2026-09-25
 *
 * days:
 *   7
 *
 * dueAt:
 *   2026-10-02
 */
function calculateDueAt(
  baseDate = new Date(),
  days =
    DEFAULT_FOLLOW_UP_DAYS
) {
  const parsedDays =
    Number(
      days
    );

  if (
    !Number.isFinite(
      parsedDays
    ) ||
    parsedDays < 0
  ) {
    throw new Error(
      "Follow-up days must be a valid non-negative number"
    );
  }

  const date =
    new Date(
      baseDate
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    throw new Error(
      "Invalid base date for follow-up"
    );
  }

  date.setUTCDate(
    date.getUTCDate() +
    parsedDays
  );

  return date
    .toISOString();
}

/*
 * ============================================================
 * FOLLOW-UP PERSISTENCE
 * ============================================================
 */

async function persistFollowUp(
  row
) {
  await ensureApplicationSheets();

  await upsertRows(
    FOLLOW_UPS_SHEET,
    [
      row
    ],
    [
      "followUpId"
    ]
  );

  return row;
}

/*
 * ============================================================
 * GET ONE FOLLOW-UP
 * ============================================================
 */

async function getFollowUp(
  followUpId
) {
  await ensureApplicationSheets();

  const rows =
    await readSheet(
      FOLLOW_UPS_SHEET
    );

  const normalizedId =
    normalizeId(
      followUpId
    );

  return (
    rows.find(
      (row) =>
        normalizeId(
          row.followUpId
        ) ===
        normalizedId
    ) ||
    null
  );
}

/*
 * ============================================================
 * FIND FOLLOW-UP BY APPLICATION
 * ============================================================
 *
 * Used primarily to prevent duplicate follow-up creation.
 *
 * One successful application should normally have one active
 * follow-up at a time.
 */

async function findFollowUpForApplication(
  applicationId
) {
  await ensureApplicationSheets();

  const rows =
    await readSheet(
      FOLLOW_UPS_SHEET
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
        normalizedApplicationId &&
        normalizeStatus(
          row.status
        ) ===
        "pending"
    ) ||
    null
  );
}

/*
 * ============================================================
 * LIST FOLLOW-UPS
 * ============================================================
 *
 * Filters are optional.
 *
 * This method will later support:
 *
 * GET /api/follow-ups
 *
 * and:
 *
 * GET /api/follow-ups?candidateEmail=...
 * GET /api/follow-ups?status=pending
 */

async function listFollowUps({
  candidateEmail,
  applicationId,
  jobId,
  status,
  dueBefore,
  dueAfter,
  limit = 100,
} = {}) {
  await ensureApplicationSheets();

  let rows =
    await readSheet(
      FOLLOW_UPS_SHEET
    );

  /*
   * Candidate filter.
   */
  if (
    candidateEmail
  ) {
    const normalizedEmail =
      normalizeEmail(
        candidateEmail
      );

    rows =
      rows.filter(
        (row) =>
          normalizeEmail(
            row.candidateEmail
          ) ===
          normalizedEmail
      );
  }

  /*
   * Application filter.
   */
  if (
    applicationId
  ) {
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

  /*
   * Job filter.
   */
  if (
    jobId
  ) {
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

  /*
   * Status filter.
   */
  if (
    status
  ) {
    const normalizedStatus =
      assertFollowUpStatus(
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

  /*
   * Due-date range filtering.
   */
  if (
    dueBefore
  ) {
    const before =
      new Date(
        dueBefore
      );

    if (
      Number.isNaN(
        before.getTime()
      )
    ) {
      throw new Error(
        "Invalid dueBefore date"
      );
    }

    rows =
      rows.filter(
        (row) => {
          const due =
            new Date(
              row.dueAt
            );

          return (
            !Number.isNaN(
              due.getTime()
            ) &&
            due <= before
          );
        }
      );
  }

  if (
    dueAfter
  ) {
    const after =
      new Date(
        dueAfter
      );

    if (
      Number.isNaN(
        after.getTime()
      )
    ) {
      throw new Error(
        "Invalid dueAfter date"
      );
    }

    rows =
      rows.filter(
        (row) => {
          const due =
            new Date(
              row.dueAt
            );

          return (
            !Number.isNaN(
              due.getTime()
            ) &&
            due >= after
          );
        }
      );
  }

  /*
   * Earliest due follow-ups first.
   *
   * This makes the Follow-ups page naturally show the most
   * urgent items first.
   */
  rows.sort(
    (a, b) =>
      new Date(
        a.dueAt ||
        0
      ) -
      new Date(
        b.dueAt ||
        0
      )
  );

  const safeLimit =
    Math.min(
      Math.max(
        Number(
          limit
        ) || 100,
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
 * CREATE FOLLOW-UP
 * ============================================================
 *
 * This is normally called after a successful application
 * submission.
 *
 * IMPORTANT:
 *
 * Duplicate pending follow-ups for the same application are
 * prevented.
 */

async function createFollowUp({
  applicationId,
  candidateEmail,
  jobId,
  company,
  jobTitle,
  dueAt,
  days =
    DEFAULT_FOLLOW_UP_DAYS,
  note = "",
}) {
  await ensureApplicationSheets();

  const normalizedApplicationId =
    normalizeId(
      applicationId
    );

  const normalizedEmail =
    normalizeEmail(
      candidateEmail
    );

  const normalizedJobId =
    normalizeId(
      jobId
    );

  if (
    !normalizedApplicationId
  ) {
    throw new Error(
      "applicationId is required"
    );
  }

  if (
    !normalizedEmail
  ) {
    throw new Error(
      "candidateEmail is required"
    );
  }

  if (
    !normalizedJobId
  ) {
    throw new Error(
      "jobId is required"
    );
  }

  /*
   * Idempotency protection.
   *
   * If submission handling is retried, JobVerse should not
   * create multiple identical pending follow-ups.
   */
  const existing =
    await findFollowUpForApplication(
      normalizedApplicationId
    );

  if (
    existing
  ) {
    return existing;
  }

  const now =
    nowIso();

  let resolvedDueAt;

  if (
    dueAt
  ) {
    const parsedDue =
      new Date(
        dueAt
      );

    if (
      Number.isNaN(
        parsedDue.getTime()
      )
    ) {
      throw new Error(
        "Invalid follow-up due date"
      );
    }

    resolvedDueAt =
      parsedDue
        .toISOString();
  } else {
    resolvedDueAt =
      calculateDueAt(
        now,
        days
      );
  }

  const row = {
    followUpId:
      randomUUID(),

    applicationId:
      normalizedApplicationId,

    candidateEmail:
      normalizedEmail,

    jobId:
      normalizedJobId,

    company:
      normalizeString(
        company
      ),

    jobTitle:
      normalizeString(
        jobTitle
      ),

    dueAt:
      resolvedDueAt,

    status:
      "pending",

    note:
      normalizeString(
        note
      ),

    completedAt:
      "",

    createdAt:
      now,

    updatedAt:
      now,
  };

  await persistFollowUp(
    row
  );

  return row;
}

/*
 * ============================================================
 * UPDATE FOLLOW-UP
 * ============================================================
 *
 * Generic update method for supported mutable fields.
 *
 * Keeping updates centralized prevents different API routes
 * from applying inconsistent business rules.
 */

async function updateFollowUp(
  followUpId,
  {
    status,
    dueAt,
    note,
  } = {}
) {
  const existing =
    await getFollowUp(
      followUpId
    );

  if (
    !existing
  ) {
    throw new Error(
      "Follow-up not found"
    );
  }

  const now =
    nowIso();

  const updated = {
    ...existing,
  };

  /*
   * Status update.
   */
  if (
    status !== undefined
  ) {
    updated.status =
      assertFollowUpStatus(
        status
      );
  }

  /*
   * Due date update.
   */
  if (
    dueAt !== undefined
  ) {
    const parsedDue =
      new Date(
        dueAt
      );

    if (
      Number.isNaN(
        parsedDue.getTime()
      )
    ) {
      throw new Error(
        "Invalid follow-up due date"
      );
    }

    updated.dueAt =
      parsedDue
        .toISOString();
  }

  /*
   * Note update.
   */
  if (
    note !== undefined
  ) {
    updated.note =
      normalizeString(
        note
      );
  }

  /*
   * Terminal status handling.
   */
  if (
    updated.status ===
      "completed" ||
    updated.status ===
      "dismissed"
  ) {
    updated.completedAt =
      existing.completedAt ||
      now;
  }

  /*
   * If moved back to pending, clear completedAt.
   */
  if (
    updated.status ===
    "pending"
  ) {
    updated.completedAt =
      "";
  }

  updated.updatedAt =
    now;

  await persistFollowUp(
    updated
  );

  return updated;
}

/*
 * ============================================================
 * COMPLETE FOLLOW-UP
 * ============================================================
 */

async function completeFollowUp(
  followUpId,
  note
) {
  return updateFollowUp(
    followUpId,
    {
      status:
        "completed",

      ...(note !== undefined
        ? {
            note,
          }
        : {}),
    }
  );
}

/*
 * ============================================================
 * DISMISS FOLLOW-UP
 * ============================================================
 */

async function dismissFollowUp(
  followUpId,
  note
) {
  return updateFollowUp(
    followUpId,
    {
      status:
        "dismissed",

      ...(note !== undefined
        ? {
            note,
          }
        : {}),
    }
  );
}

/*
 * ============================================================
 * RESCHEDULE FOLLOW-UP
 * ============================================================
 *
 * Rescheduling automatically returns the task to pending.
 */

async function rescheduleFollowUp(
  followUpId,
  dueAt
) {
  return updateFollowUp(
    followUpId,
    {
      status:
        "pending",

      dueAt,
    }
  );
}

/*
 * ============================================================
 * GET OVERDUE FOLLOW-UPS
 * ============================================================
 *
 * Convenience helper for:
 *
 * - dashboard notifications
 * - Follow-ups page
 * - future scheduled reminders
 */

async function getOverdueFollowUps(
  candidateEmail
) {
  const now =
    new Date();

  const rows =
    await listFollowUps({
      candidateEmail,
      status:
        "pending",
    });

  return rows.filter(
    (row) => {
      const due =
        new Date(
          row.dueAt
        );

      if (
        Number.isNaN(
          due.getTime()
        )
      ) {
        return false;
      }

      return due < now;
    }
  );
}

/*
 * ============================================================
 * GET UPCOMING FOLLOW-UPS
 * ============================================================
 *
 * Useful for frontend sections such as:
 *
 * Due today
 * Upcoming
 */

async function getUpcomingFollowUps(
  candidateEmail,
  days = 7
) {
  const now =
    new Date();

  const upperBound =
    new Date(
      now
    );

  upperBound.setUTCDate(
    upperBound.getUTCDate() +
    Number(
      days
    )
  );

  const rows =
    await listFollowUps({
      candidateEmail,
      status:
        "pending",
    });

  return rows.filter(
    (row) => {
      const due =
        new Date(
          row.dueAt
        );

      if (
        Number.isNaN(
          due.getTime()
        )
      ) {
        return false;
      }

      return (
        due >= now &&
        due <= upperBound
      );
    }
  );
}

/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  /*
   * Core operations.
   */
  createFollowUp,
  getFollowUp,
  listFollowUps,
  updateFollowUp,

  /*
   * Lifecycle actions.
   */
  completeFollowUp,
  dismissFollowUp,
  rescheduleFollowUp,

  /*
   * Queries.
   */
  getOverdueFollowUps,
  getUpcomingFollowUps,
  findFollowUpForApplication,

  /*
   * Helpers/constants.
   */
  calculateDueAt,
  VALID_FOLLOW_UP_STATUSES,
  DEFAULT_FOLLOW_UP_DAYS,
};