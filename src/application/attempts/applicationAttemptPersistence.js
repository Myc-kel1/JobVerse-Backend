const {
  readSheet,
  upsertRows
} = require(
  "../../googleSheets"
);

const {
  ensureApplicationSheets
} = require(
  "../applicationSheets"
);


/*
 * ============================================================
 * APPLICATION ATTEMPT PERSISTENCE
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * Storage boundary for rows in:
 *
 *     Application Attempts
 *
 * This module performs persistence operations only.
 *
 * It does NOT decide:
 *
 * - whether execution may start
 * - whether an attempt is resumable
 * - whether an attempt is active
 * - whether an application was successfully submitted
 * - whether retries are allowed
 *
 * Those are business rules and belong in higher-level services.
 *
 * ============================================================
 */


const APPLICATION_ATTEMPTS_SHEET =
  "Application Attempts";


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


function normalizeEmail(
  value
) {
  return normalizeLower(
    value
  );
}


/*
 * ============================================================
 * TIMESTAMP
 * ============================================================
 */

function getAttemptTimestamp(
  attempt
) {
  const value =
    attempt?.updatedAt ||
    attempt?.completedAt ||
    attempt?.startedAt ||
    attempt?.createdAt ||
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
 * ENSURE STORAGE
 * ============================================================
 */

async function ensureAttemptStorage() {
  /*
   * Application Attempts is created by the shared
   * application-sheet initialization.
   */
  await ensureApplicationSheets();
}


/*
 * ============================================================
 * READ ALL ATTEMPTS
 * ============================================================
 *
 * Low-level operation.
 *
 * Candidate/application/status filtering belongs in the query
 * service rather than here.
 */

async function readAllAttempts() {
  await ensureAttemptStorage();

  const rows =
    await readSheet(
      APPLICATION_ATTEMPTS_SHEET
    );

  return Array.isArray(
    rows
  )
    ? rows
    : [];
}


/*
 * ============================================================
 * GET ATTEMPT BY ID
 * ============================================================
 */

async function getAttemptById(
  attemptId
) {
  const normalizedAttemptId =
    normalizeString(
      attemptId
    );

  if (
    !normalizedAttemptId
  ) {
    return null;
  }


  const attempts =
    await readAllAttempts();


  return (
    attempts.find(
      (attempt) =>
        normalizeString(
          attempt.attemptId
        ) ===
        normalizedAttemptId
    ) ||
    null
  );
}


/*
 * ============================================================
 * REQUIRE ATTEMPT BY ID
 * ============================================================
 */

async function requireAttemptById(
  attemptId
) {
  const attempt =
    await getAttemptById(
      attemptId
    );


  if (
    !attempt
  ) {
    const error =
      new Error(
        "Application attempt not found"
      );

    error.code =
      "APPLICATION_ATTEMPT_NOT_FOUND";

    error.statusCode =
      404;

    throw error;
  }


  return attempt;
}


/*
 * ============================================================
 * ATTEMPTS FOR APPLICATION
 * ============================================================
 */

async function getAttemptsByApplicationId(
  applicationId
) {
  const normalizedApplicationId =
    normalizeString(
      applicationId
    );

  if (
    !normalizedApplicationId
  ) {
    return [];
  }


  const attempts =
    await readAllAttempts();


  return attempts.filter(
    (attempt) =>
      normalizeString(
        attempt.applicationId
      ) ===
      normalizedApplicationId
  );
}


/*
 * ============================================================
 * ATTEMPTS FOR CANDIDATE
 * ============================================================
 */

async function getAttemptsByCandidate(
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


  const attempts =
    await readAllAttempts();


  return attempts.filter(
    (attempt) =>
      normalizeEmail(
        attempt.candidateEmail
      ) ===
      normalizedCandidateEmail
  );
}


/*
 * ============================================================
 * ATTEMPTS FOR CANDIDATE + APPLICATION
 * ============================================================
 *
 * Useful for candidate-facing APIs when ownership should be
 * enforced at persistence/query boundaries.
 */

async function getAttemptsByCandidateAndApplication(
  candidateEmail,
  applicationId
) {
  const normalizedCandidateEmail =
    normalizeEmail(
      candidateEmail
    );

  const normalizedApplicationId =
    normalizeString(
      applicationId
    );


  if (
    !normalizedCandidateEmail ||
    !normalizedApplicationId
  ) {
    return [];
  }


  const attempts =
    await getAttemptsByApplicationId(
      normalizedApplicationId
    );


  return attempts.filter(
    (attempt) =>
      normalizeEmail(
        attempt.candidateEmail
      ) ===
      normalizedCandidateEmail
  );
}


/*
 * ============================================================
 * SAVE ATTEMPT
 * ============================================================
 *
 * Upserts using:
 *
 *     attemptId
 *
 * as the unique persistence key.
 *
 * Lifecycle validation is deliberately NOT performed here.
 */

async function saveAttempt(
  attempt
) {
  if (
    !attempt ||
    typeof attempt !==
      "object"
  ) {
    throw new TypeError(
      "Application attempt must be an object"
    );
  }


  const attemptId =
    normalizeString(
      attempt.attemptId
    );


  if (
    !attemptId
  ) {
    throw new Error(
      "attemptId is required before an application attempt can be persisted"
    );
  }


  await ensureAttemptStorage();


  /*
   * Avoid mutating the caller's object.
   */
  const row = {
    ...attempt,

    attemptId
  };


  await upsertRows(
    APPLICATION_ATTEMPTS_SHEET,
    [
      row
    ],
    [
      "attemptId"
    ]
  );


  return row;
}


/*
 * ============================================================
 * SAVE UPDATED ATTEMPT
 * ============================================================
 */

async function saveUpdatedAttempt(
  attempt
) {
  if (
    !attempt ||
    typeof attempt !==
      "object"
  ) {
    throw new TypeError(
      "Application attempt must be an object"
    );
  }


  return saveAttempt({
    ...attempt,

    updatedAt:
      new Date()
        .toISOString()
  });
}


/*
 * ============================================================
 * SAVE MULTIPLE ATTEMPTS
 * ============================================================
 *
 * Primarily useful later for recovery/migration operations.
 */

async function saveAttempts(
  attempts
) {
  if (
    !Array.isArray(
      attempts
    )
  ) {
    throw new TypeError(
      "Application attempts must be an array"
    );
  }


  if (
    attempts.length ===
    0
  ) {
    return [];
  }


  const rows =
    attempts.map(
      (attempt) => {
        if (
          !attempt ||
          typeof attempt !==
            "object"
        ) {
          throw new TypeError(
            "Every application attempt must be an object"
          );
        }


        const attemptId =
          normalizeString(
            attempt.attemptId
          );


        if (
          !attemptId
        ) {
          throw new Error(
            "Every application attempt must have an attemptId"
          );
        }


        return {
          ...attempt,

          attemptId
        };
      }
    );


  await ensureAttemptStorage();


  await upsertRows(
    APPLICATION_ATTEMPTS_SHEET,
    rows,
    [
      "attemptId"
    ]
  );


  return rows;
}


/*
 * ============================================================
 * ATTEMPT EXISTS
 * ============================================================
 */

async function attemptExists(
  attemptId
) {
  return Boolean(
    await getAttemptById(
      attemptId
    )
  );
}


/*
 * ============================================================
 * ATTEMPT BELONGS TO APPLICATION
 * ============================================================
 */

function attemptBelongsToApplication(
  attempt,
  applicationId
) {
  if (
    !attempt
  ) {
    return false;
  }


  const attemptApplicationId =
    normalizeString(
      attempt.applicationId
    );

  const expectedApplicationId =
    normalizeString(
      applicationId
    );


  if (
    !attemptApplicationId ||
    !expectedApplicationId
  ) {
    return false;
  }


  return (
    attemptApplicationId ===
    expectedApplicationId
  );
}


/*
 * ============================================================
 * ATTEMPT BELONGS TO CANDIDATE
 * ============================================================
 */

function attemptBelongsToCandidate(
  attempt,
  candidateEmail
) {
  if (
    !attempt
  ) {
    return false;
  }


  const attemptCandidateEmail =
    normalizeEmail(
      attempt.candidateEmail
    );

  const expectedCandidateEmail =
    normalizeEmail(
      candidateEmail
    );


  if (
    !attemptCandidateEmail ||
    !expectedCandidateEmail
  ) {
    return false;
  }


  return (
    attemptCandidateEmail ===
    expectedCandidateEmail
  );
}


/*
 * ============================================================
 * SORT ATTEMPTS NEWEST FIRST
 * ============================================================
 */

function sortAttemptsNewestFirst(
  attempts
) {
  return [
    ...(
      attempts ||
      []
    )
  ].sort(
    (a, b) =>
      getAttemptTimestamp(
        b
      ) -
      getAttemptTimestamp(
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
   * Storage.
   */
  APPLICATION_ATTEMPTS_SHEET,
  ensureAttemptStorage,

  /*
   * Reads.
   */
  readAllAttempts,

  getAttemptById,
  requireAttemptById,

  getAttemptsByApplicationId,
  getAttemptsByCandidate,
  getAttemptsByCandidateAndApplication,

  /*
   * Writes.
   */
  saveAttempt,
  saveUpdatedAttempt,
  saveAttempts,

  /*
   * Checks.
   */
  attemptExists,
  attemptBelongsToApplication,
  attemptBelongsToCandidate,

  /*
   * Utilities.
   */
  getAttemptTimestamp,
  sortAttemptsNewestFirst
};