const {
  readSheet,
  upsertRows
} = require(
  "../googleSheets"
);

const {
  ensureApplicationSheets
} = require(
  "./applicationSheets"
);


/*
 * ============================================================
 * APPLICATION PERSISTENCE
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * Central persistence layer for rows stored in:
 *
 *     Generated Applications
 *
 * This module is intentionally concerned ONLY with:
 *
 * - reading application records
 * - locating application records
 * - saving application records
 * - filtering records by persistence identifiers
 *
 * ============================================================
 * THIS FILE DOES NOT
 * ============================================================
 *
 * - decide whether an application can enter review
 * - approve applications
 * - reject applications
 * - execute applications
 * - generate CVs
 * - generate cover letters
 * - determine frontend visibility
 * - apply lifecycle rules
 *
 * Those responsibilities belong to higher-level services.
 *
 * ============================================================
 * WHY THIS FILE EXISTS
 * ============================================================
 *
 * Without a dedicated persistence layer, every service would
 * eventually contain code like:
 *
 *     readSheet("Generated Applications")
 *
 * and:
 *
 *     upsertRows(...)
 *
 * That would tightly couple business logic to Google Sheets.
 *
 * Instead:
 *
 *     review/query/execution services
 *                 ↓
 *     applicationPersistence.js
 *                 ↓
 *          googleSheets.js
 *
 * This gives JobVerse a clean storage boundary.
 *
 * If JobVerse later moves application data from Google Sheets
 * to PostgreSQL, most business services should not need major
 * rewrites.
 *
 * ============================================================
 */


/*
 * ============================================================
 * CONSTANTS
 * ============================================================
 */

const APPLICATION_SHEET =
  "Generated Applications";


/*
 * ============================================================
 * NORMALIZATION HELPERS
 * ============================================================
 *
 * Persistence lookups should compare normalized values.
 *
 * These helpers remain local because they are currently used
 * only by this persistence module.
 *
 * If normalization becomes widely shared later, it can move to:
 *
 *     src/utils/normalization.js
 */

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


/*
 * ============================================================
 * ENSURE STORAGE
 * ============================================================
 *
 * Application services should not need to remember to create
 * Sheets before accessing them.
 */

async function ensureApplicationStorage() {
  await ensureApplicationSheets();
}


/*
 * ============================================================
 * READ ALL APPLICATIONS
 * ============================================================
 *
 * This is deliberately a low-level persistence operation.
 *
 * Higher-level services are responsible for filtering by:
 *
 * - lifecycle
 * - eligibility
 * - review state
 * - execution state
 */

async function readAllApplications() {
  await ensureApplicationStorage();

  const rows =
    await readSheet(
      APPLICATION_SHEET
    );

  if (
    !Array.isArray(
      rows
    )
  ) {
    return [];
  }

  return rows;
}


/*
 * ============================================================
 * GET APPLICATION BY ID
 * ============================================================
 */

async function getApplicationById(
  applicationId
) {
  const normalizedApplicationId =
    normalizeId(
      applicationId
    );

  if (
    !normalizedApplicationId
  ) {
    return null;
  }

  const rows =
    await readAllApplications();

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
 * REQUIRE APPLICATION BY ID
 * ============================================================
 *
 * Useful when an application MUST exist.
 *
 * Higher-level services can use this instead of repeating:
 *
 *     if (!application) ...
 */

async function requireApplicationById(
  applicationId
) {
  const application =
    await getApplicationById(
      applicationId
    );

  if (
    !application
  ) {
    const error =
      new Error(
        "Generated application not found"
      );

    error.code =
      "APPLICATION_NOT_FOUND";

    error.statusCode =
      404;

    throw error;
  }

  return application;
}


/*
 * ============================================================
 * GET APPLICATIONS FOR CANDIDATE
 * ============================================================
 *
 * Persistence-level filtering only.
 *
 * This does NOT decide whether the records belong in the
 * Applications workspace.
 */

async function getApplicationsByCandidate(
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

  const rows =
    await readAllApplications();

  return rows.filter(
    (row) =>
      normalizeEmail(
        row.candidateEmail
      ) ===
      normalizedCandidateEmail
  );
}


/*
 * ============================================================
 * GET APPLICATION FOR CANDIDATE + JOB
 * ============================================================
 *
 * Useful for:
 *
 * - duplicate generation checks
 * - application lookup
 * - candidate/job ownership validation
 */

async function getApplicationsByCandidateAndJob(
  candidateEmail,
  jobId
) {
  const normalizedCandidateEmail =
    normalizeEmail(
      candidateEmail
    );

  const normalizedJobId =
    normalizeId(
      jobId
    );

  if (
    !normalizedCandidateEmail ||
    !normalizedJobId
  ) {
    return [];
  }

  const rows =
    await getApplicationsByCandidate(
      normalizedCandidateEmail
    );

  return rows.filter(
    (row) =>
      normalizeId(
        row.jobId
      ) ===
      normalizedJobId
  );
}


/*
 * ============================================================
 * GET MOST RECENT APPLICATION FOR CANDIDATE + JOB
 * ============================================================
 *
 * There may eventually be multiple attempts/generation records
 * for the same job after earlier records were rejected.
 *
 * Therefore we should not assume candidateEmail + jobId is
 * globally unique.
 */

async function getLatestApplicationForCandidateAndJob(
  candidateEmail,
  jobId
) {
  const rows =
    await getApplicationsByCandidateAndJob(
      candidateEmail,
      jobId
    );

  if (
    rows.length ===
    0
  ) {
    return null;
  }

  const sorted =
    [...rows].sort(
      (a, b) =>
        getApplicationTimestamp(
          b
        ) -
        getApplicationTimestamp(
          a
        )
    );

  return (
    sorted[0] ||
    null
  );
}


/*
 * ============================================================
 * TIMESTAMP HELPER
 * ============================================================
 */

function getApplicationTimestamp(
  application
) {
  const value =
    application?.updatedAt ||
    application?.createdAt ||
    "";

  const parsed =
    Date.parse(
      value
    );

  return Number.isFinite(
    parsed
  )
    ? parsed
    : 0;
}


/*
 * ============================================================
 * SAVE APPLICATION
 * ============================================================
 *
 * Upserts using applicationId as the persistence key.
 *
 * IMPORTANT:
 *
 * This function deliberately does not validate lifecycle state.
 *
 * The caller must perform domain validation first.
 *
 * Example:
 *
 *     eligibilityService
 *             ↓
 *     reviewService
 *             ↓
 *     saveApplication()
 */

async function saveApplication(
  application
) {
  if (
    !application ||
    typeof application !==
      "object"
  ) {
    throw new TypeError(
      "Application record must be an object"
    );
  }

  const applicationId =
    normalizeId(
      application.applicationId
    );

  if (
    !applicationId
  ) {
    throw new Error(
      "applicationId is required before an application can be persisted"
    );
  }

  await ensureApplicationStorage();

  /*
   * Do not silently mutate the object supplied by the caller.
   *
   * Higher-level services may still need their original
   * in-memory object.
   */
  const row = {
    ...application,

    applicationId
  };

  await upsertRows(
    APPLICATION_SHEET,
    [
      row
    ],
    [
      "applicationId"
    ]
  );

  return row;
}


/*
 * ============================================================
 * SAVE APPLICATION WITH UPDATED TIMESTAMP
 * ============================================================
 *
 * Most application mutations need updatedAt.
 *
 * This helper prevents every service from repeating:
 *
 *     updatedAt: new Date().toISOString()
 */

async function saveUpdatedApplication(
  application
) {
  if (
    !application ||
    typeof application !==
      "object"
  ) {
    throw new TypeError(
      "Application record must be an object"
    );
  }

  return saveApplication({
    ...application,

    updatedAt:
      new Date()
        .toISOString()
  });
}


/*
 * ============================================================
 * SAVE MULTIPLE APPLICATIONS
 * ============================================================
 *
 * Included for batch operations and future migration utilities.
 *
 * Business services should still avoid bulk overwrites unless
 * they genuinely need them.
 */

async function saveApplications(
  applications
) {
  if (
    !Array.isArray(
      applications
    )
  ) {
    throw new TypeError(
      "Applications must be an array"
    );
  }

  if (
    applications.length ===
    0
  ) {
    return [];
  }

  const rows =
    applications.map(
      (
        application
      ) => {
        if (
          !application ||
          typeof application !==
            "object"
        ) {
          throw new TypeError(
            "Every application record must be an object"
          );
        }

        const applicationId =
          normalizeId(
            application.applicationId
          );

        if (
          !applicationId
        ) {
          throw new Error(
            "Every application must have an applicationId before persistence"
          );
        }

        return {
          ...application,

          applicationId
        };
      }
    );

  await ensureApplicationStorage();

  await upsertRows(
    APPLICATION_SHEET,
    rows,
    [
      "applicationId"
    ]
  );

  return rows;
}


/*
 * ============================================================
 * APPLICATION EXISTS
 * ============================================================
 */

async function applicationExists(
  applicationId
) {
  const application =
    await getApplicationById(
      applicationId
    );

  return Boolean(
    application
  );
}


/*
 * ============================================================
 * BELONGS TO CANDIDATE
 * ============================================================
 *
 * Useful as an ownership check before exposing an application
 * through candidate-facing API endpoints.
 */

function applicationBelongsToCandidate(
  application,
  candidateEmail
) {
  if (
    !application
  ) {
    return false;
  }

  const applicationEmail =
    normalizeEmail(
      application.candidateEmail
    );

  const requestedEmail =
    normalizeEmail(
      candidateEmail
    );

  if (
    !applicationEmail ||
    !requestedEmail
  ) {
    return false;
  }

  return (
    applicationEmail ===
    requestedEmail
  );
}


/*
 * ============================================================
 * REQUIRE CANDIDATE OWNERSHIP
 * ============================================================
 */

function assertApplicationBelongsToCandidate(
  application,
  candidateEmail
) {
  if (
    !applicationBelongsToCandidate(
      application,
      candidateEmail
    )
  ) {
    const error =
      new Error(
        "Application does not belong to this candidate"
      );

    error.code =
      "APPLICATION_CANDIDATE_MISMATCH";

    /*
     * 404 is intentional.
     *
     * It avoids exposing whether another candidate's application
     * exists.
     */
    error.statusCode =
      404;

    throw error;
  }

  return application;
}


/*
 * ============================================================
 * SORT APPLICATIONS
 * ============================================================
 *
 * Query services can reuse this without duplicating timestamp
 * parsing.
 */

function sortApplicationsNewestFirst(
  applications
) {
  return [
    ...(
      applications ||
      []
    )
  ].sort(
    (a, b) =>
      getApplicationTimestamp(
        b
      ) -
      getApplicationTimestamp(
        a
      )
  );
}


/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  /*
   * Storage configuration.
   */
  APPLICATION_SHEET,
  ensureApplicationStorage,

  /*
   * Reads.
   */
  readAllApplications,
  getApplicationById,
  requireApplicationById,

  getApplicationsByCandidate,
  getApplicationsByCandidateAndJob,
  getLatestApplicationForCandidateAndJob,

  /*
   * Writes.
   */
  saveApplication,
  saveUpdatedApplication,
  saveApplications,

  /*
   * Checks.
   */
  applicationExists,
  applicationBelongsToCandidate,
  assertApplicationBelongsToCandidate,

  /*
   * Utilities.
   */
  sortApplicationsNewestFirst,
  getApplicationTimestamp
};