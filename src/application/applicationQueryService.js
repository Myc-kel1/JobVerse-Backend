const {
  APPLICATION_STATUSES,

  canEnterReview,
  isApplicationWorkspaceEligible,
  getApplicationEligibilitySummary
} = require(
  "./applicationEligibilityService"
);

const {
  readAllApplications,
  getApplicationById,
  getApplicationsByCandidate,
  applicationBelongsToCandidate,
  sortApplicationsNewestFirst
} = require(
  "./applicationPersistence"
);

const {
  getAvailableReviewActions
} = require(
  "./applicationReviewService"
);


/*
 * ============================================================
 * APPLICATION QUERY SERVICE
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * Central read/query layer for Generated Applications.
 *
 * This module answers questions such as:
 *
 * - What applications exist for this candidate?
 * - Which generated applications are ready to enter review?
 * - Which applications belong in the Applications workspace?
 * - Which application should be returned to the frontend?
 * - Which statuses are visible in each part of the product?
 *
 * ============================================================
 * THIS MODULE DOES NOT
 * ============================================================
 *
 * - generate application documents
 * - update application status
 * - approve/reject applications
 * - execute applications
 * - submit applications
 * - directly call Google Sheets
 *
 * ============================================================
 * WHY THIS FILE EXISTS
 * ============================================================
 *
 * Query rules are business logic.
 *
 * They should not be duplicated in:
 *
 *     api.js
 *     React pages
 *     applicationService.js
 *
 * Instead:
 *
 *     API
 *      ↓
 *     applicationQueryService.js
 *      ↓
 *     applicationPersistence.js
 *
 * while eligibility decisions come from:
 *
 *     applicationEligibilityService.js
 *
 * ============================================================
 */


/*
 * ============================================================
 * DEFAULT QUERY LIMITS
 * ============================================================
 */

const DEFAULT_APPLICATION_LIMIT =
  50;

const MAX_APPLICATION_LIMIT =
  100;


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


function normalizeEmail(
  value
) {
  return normalizeLower(
    value
  );
}


/*
 * ============================================================
 * SAFE LIMIT
 * ============================================================
 *
 * Protects Google Sheets reads/API responses from unexpectedly
 * large result requests.
 */

function normalizeLimit(
  value,
  {
    defaultValue =
      DEFAULT_APPLICATION_LIMIT,

    maxValue =
      MAX_APPLICATION_LIMIT
  } = {}
) {
  const parsed =
    Number(
      value
    );

  if (
    !Number.isFinite(
      parsed
    ) ||
    parsed <= 0
  ) {
    return defaultValue;
  }

  return Math.min(
    Math.floor(
      parsed
    ),
    maxValue
  );
}


/*
 * ============================================================
 * PAGINATION
 * ============================================================
 *
 * Even though Google Sheets is currently the persistence layer,
 * frontend APIs should still expose predictable pagination.
 *
 * This will make migration to PostgreSQL easier later.
 */

function paginateApplications(
  applications,
  {
    page = 1,
    pageSize = 20
  } = {}
) {
  const safePage =
    Math.max(
      Number(
        page
      ) || 1,
      1
    );

  const safePageSize =
    Math.min(
      Math.max(
        Number(
          pageSize
        ) || 20,
        1
      ),
      100
    );

  const total =
    applications.length;

  const totalPages =
    total === 0
      ? 0
      : Math.ceil(
          total /
          safePageSize
        );

  const start =
    (
      safePage -
      1
    ) *
    safePageSize;

  const end =
    start +
    safePageSize;

  return {
    data:
      applications.slice(
        start,
        end
      ),

    meta: {
      page:
        safePage,

      pageSize:
        safePageSize,

      total,

      totalPages,

      hasNextPage:
        safePage <
        totalPages,

      hasPreviousPage:
        safePage >
        1 &&
        totalPages >
        0
    }
  };
}


/*
 * ============================================================
 * APPLICATION ENRICHMENT
 * ============================================================
 *
 * API/frontend consumers should receive computed lifecycle
 * information from the backend rather than rebuilding rules in
 * React.
 */

function enrichApplication(
  application
) {
  if (
    !application
  ) {
    return null;
  }

  return {
    ...application,

    eligibility:
      getApplicationEligibilitySummary(
        application
      ),

    reviewActions:
      getAvailableReviewActions(
        application
      )
  };
}


/*
 * ============================================================
 * ENRICH APPLICATION LIST
 * ============================================================
 */

function enrichApplications(
  applications
) {
  return (
    applications || []
  ).map(
    enrichApplication
  );
}


/*
 * ============================================================
 * GET APPLICATION
 * ============================================================
 *
 * Candidate ownership can optionally be enforced here.
 *
 * Candidate-facing endpoints SHOULD provide candidateEmail.
 */

async function getApplication(
  applicationId,
  {
    candidateEmail
  } = {}
) {
  const application =
    await getApplicationById(
      applicationId
    );

  if (
    !application
  ) {
    return null;
  }


  /*
   * ----------------------------------------------------------
   * CANDIDATE OWNERSHIP
   * ----------------------------------------------------------
   */

  if (
    normalizeString(
      candidateEmail
    )
  ) {
    const belongs =
      applicationBelongsToCandidate(
        application,
        candidateEmail
      );

    if (
      !belongs
    ) {
      /*
       * Returning null prevents leaking whether another
       * candidate's application exists.
       */
      return null;
    }
  }


  return enrichApplication(
    application
  );
}


/*
 * ============================================================
 * LIST ALL CANDIDATE APPLICATION RECORDS
 * ============================================================
 *
 * This is a broad query.
 *
 * It includes:
 *
 * - Generating
 * - Generated
 * - Under Review
 * - Approved
 * - Rejected
 * - Applied
 *
 * depending on what exists in storage.
 *
 * This function should NOT power the Applications workspace.
 */

async function listCandidateApplications(
  candidateEmail,
  {
    status,
    limit =
      DEFAULT_APPLICATION_LIMIT
  } = {}
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


  let rows =
    await getApplicationsByCandidate(
      normalizedCandidateEmail
    );


  /*
   * Optional status filtering.
   */
  if (
    normalizeString(
      status
    )
  ) {
    const normalizedStatus =
      normalizeLower(
        status
      );

    rows =
      rows.filter(
        (row) =>
          normalizeLower(
            row.status
          ) ===
          normalizedStatus
      );
  }


  rows =
    sortApplicationsNewestFirst(
      rows
    );


  const safeLimit =
    normalizeLimit(
      limit
    );


  return enrichApplications(
    rows.slice(
      0,
      safeLimit
    )
  );
}


/*
 * ============================================================
 * LIST READY-FOR-REVIEW APPLICATIONS
 * ============================================================
 *
 * IMPORTANT PRODUCT RULE
 * ------------------------------------------------------------
 *
 * These applications have:
 *
 *     status = Generated
 *
 * and:
 *
 *     generated CV
 *     generated cover letter
 *
 * They are READY to be moved into review.
 *
 * They do NOT yet belong in the Applications workspace.
 */

async function listReadyForReviewApplications(
  candidateEmail,
  {
    limit =
      DEFAULT_APPLICATION_LIMIT
  } = {}
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


  let rows =
    await getApplicationsByCandidate(
      normalizedCandidateEmail
    );


  /*
   * Authoritative eligibility check.
   */
  rows =
    rows.filter(
      (application) =>
        canEnterReview(
          application
        ).eligible
    );


  rows =
    sortApplicationsNewestFirst(
      rows
    );


  const safeLimit =
    normalizeLimit(
      limit
    );


  return enrichApplications(
    rows.slice(
      0,
      safeLimit
    )
  );
}


/*
 * ============================================================
 * LIST APPLICATIONS WORKSPACE
 * ============================================================
 *
 * This is the authoritative source for the main Applications
 * page.
 *
 * Workspace-eligible states:
 *
 *     Under Review
 *     Approved
 *     Applied
 *
 * AND:
 *
 *     generated CV exists
 *     generated cover letter exists
 *
 * Generated alone is intentionally excluded.
 */

async function listWorkspaceApplications(
  candidateEmail,
  {
    status,
    limit =
      DEFAULT_APPLICATION_LIMIT
  } = {}
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


  let rows =
    await getApplicationsByCandidate(
      normalizedCandidateEmail
    );


  /*
   * ==========================================================
   * WORKSPACE ELIGIBILITY
   * ==========================================================
   */

  rows =
    rows.filter(
      (application) =>
        isApplicationWorkspaceEligible(
          application
        ).eligible
    );


  /*
   * Optional workspace status filter.
   */
  if (
    normalizeString(
      status
    )
  ) {
    const normalizedStatus =
      normalizeLower(
        status
      );

    rows =
      rows.filter(
        (row) =>
          normalizeLower(
            row.status
          ) ===
          normalizedStatus
      );
  }


  rows =
    sortApplicationsNewestFirst(
      rows
    );


  const safeLimit =
    normalizeLimit(
      limit
    );


  return enrichApplications(
    rows.slice(
      0,
      safeLimit
    )
  );
}


/*
 * ============================================================
 * PAGINATED APPLICATIONS WORKSPACE
 * ============================================================
 *
 * Recommended for frontend usage.
 */

async function getWorkspaceApplicationsPage(
  candidateEmail,
  {
    status,

    page = 1,

    pageSize = 20
  } = {}
) {
  const normalizedCandidateEmail =
    normalizeEmail(
      candidateEmail
    );

  if (
    !normalizedCandidateEmail
  ) {
    return {
      data: [],

      meta: {
        page:
          1,

        pageSize:
          Math.min(
            Math.max(
              Number(
                pageSize
              ) || 20,
              1
            ),
            100
          ),

        total:
          0,

        totalPages:
          0,

        hasNextPage:
          false,

        hasPreviousPage:
          false
      }
    };
  }


  let rows =
    await getApplicationsByCandidate(
      normalizedCandidateEmail
    );


  /*
   * Workspace-only applications.
   */
  rows =
    rows.filter(
      (application) =>
        isApplicationWorkspaceEligible(
          application
        ).eligible
    );


  /*
   * Optional status filter.
   */
  if (
    normalizeString(
      status
    )
  ) {
    const normalizedStatus =
      normalizeLower(
        status
      );

    rows =
      rows.filter(
        (row) =>
          normalizeLower(
            row.status
          ) ===
          normalizedStatus
      );
  }


  rows =
    sortApplicationsNewestFirst(
      rows
    );


  /*
   * Add eligibility/review actions before returning.
   */
  const enriched =
    enrichApplications(
      rows
    );


  return paginateApplications(
    enriched,
    {
      page,
      pageSize
    }
  );
}


/*
 * ============================================================
 * PAGINATED READY-FOR-REVIEW LIST
 * ============================================================
 */

async function getReadyForReviewApplicationsPage(
  candidateEmail,
  {
    page = 1,
    pageSize = 20
  } = {}
) {
  const normalizedCandidateEmail =
    normalizeEmail(
      candidateEmail
    );

  if (
    !normalizedCandidateEmail
  ) {
    return paginateApplications(
      [],
      {
        page,
        pageSize
      }
    );
  }


  let rows =
    await getApplicationsByCandidate(
      normalizedCandidateEmail
    );


  rows =
    rows.filter(
      (application) =>
        canEnterReview(
          application
        ).eligible
    );


  rows =
    sortApplicationsNewestFirst(
      rows
    );


  const enriched =
    enrichApplications(
      rows
    );


  return paginateApplications(
    enriched,
    {
      page,
      pageSize
    }
  );
}


/*
 * ============================================================
 * APPLICATION COUNTS
 * ============================================================
 *
 * Useful for dashboard/sidebar badges.
 *
 * Avoid making React load every record just to count them.
 */

async function getApplicationCounts(
  candidateEmail
) {
  const normalizedCandidateEmail =
    normalizeEmail(
      candidateEmail
    );

  if (
    !normalizedCandidateEmail
  ) {
    return {
      total:
        0,

      readyForReview:
        0,

      underReview:
        0,

      approved:
        0,

      applied:
        0,

      rejected:
        0
    };
  }


  const rows =
    await getApplicationsByCandidate(
      normalizedCandidateEmail
    );


  let readyForReview =
    0;

  let underReview =
    0;

  let approved =
    0;

  let applied =
    0;

  let rejected =
    0;


  for (
    const application of
    rows
  ) {
    if (
      canEnterReview(
        application
      ).eligible
    ) {
      readyForReview +=
        1;
    }


    const status =
      normalizeLower(
        application.status
      );


    if (
      status ===
      normalizeLower(
        APPLICATION_STATUSES
          .UNDER_REVIEW
      )
    ) {
      underReview +=
        1;
    }


    if (
      status ===
      normalizeLower(
        APPLICATION_STATUSES
          .APPROVED
      )
    ) {
      approved +=
        1;
    }


    if (
      status ===
      normalizeLower(
        APPLICATION_STATUSES
          .APPLIED
      )
    ) {
      applied +=
        1;
    }


    if (
      status ===
      normalizeLower(
        APPLICATION_STATUSES
          .REJECTED
      )
    ) {
      rejected +=
        1;
    }
  }


  return {
    total:
      rows.length,

    readyForReview,

    underReview,

    approved,

    applied,

    rejected
  };
}


/*
 * ============================================================
 * ADMIN / INTERNAL LIST ALL
 * ============================================================
 *
 * This intentionally does NOT enforce candidate filtering.
 *
 * It should only be used by trusted/internal APIs.
 */

async function listAllApplications({
  status,
  limit =
    DEFAULT_APPLICATION_LIMIT
} = {}) {
  let rows =
    await readAllApplications();


  if (
    normalizeString(
      status
    )
  ) {
    const normalizedStatus =
      normalizeLower(
        status
      );

    rows =
      rows.filter(
        (row) =>
          normalizeLower(
            row.status
          ) ===
          normalizedStatus
      );
  }


  rows =
    sortApplicationsNewestFirst(
      rows
    );


  const safeLimit =
    normalizeLimit(
      limit
    );


  return enrichApplications(
    rows.slice(
      0,
      safeLimit
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
   * Single application.
   */
  getApplication,


  /*
   * Candidate-level queries.
   */
  listCandidateApplications,

  listReadyForReviewApplications,

  listWorkspaceApplications,


  /*
   * Paginated frontend queries.
   */
  getWorkspaceApplicationsPage,

  getReadyForReviewApplicationsPage,


  /*
   * Counts / badges.
   */
  getApplicationCounts,


  /*
   * Internal/admin query.
   */
  listAllApplications,


  /*
   * Shared transformation helpers.
   */
  enrichApplication,
  enrichApplications,

  paginateApplications,
  normalizeLimit,


  /*
   * Limits.
   */
  DEFAULT_APPLICATION_LIMIT,
  MAX_APPLICATION_LIMIT
};