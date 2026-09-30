const express =
  require(
    "express"
  );

const {
  getWorkspaceApplicationsPage,
  getReadyForReviewApplicationsPage,
  getApplicationCounts
} = require(
  "../application/applicationQueryService"
);


/*
 * ============================================================
 * APPLICATION QUERY ROUTES
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * Read-only HTTP endpoints for application lifecycle queries.
 *
 * This router exposes:
 *
 *     GET /workspace
 *     GET /ready-for-review
 *     GET /counts
 *
 * When mounted at:
 *
 *     /api/applications
 *
 * the final endpoints become:
 *
 *     GET /api/applications/workspace
 *     GET /api/applications/ready-for-review
 *     GET /api/applications/counts
 *
 * ============================================================
 * RESPONSIBILITY BOUNDARY
 * ============================================================
 *
 * This router:
 *
 * - validates basic HTTP input
 * - calls applicationQueryService
 * - shapes API responses
 * - handles HTTP errors
 *
 * This router does NOT:
 *
 * - decide application eligibility
 * - read Google Sheets directly
 * - change application status
 * - approve/reject applications
 * - start application execution
 *
 * ============================================================
 */


/*
 * ============================================================
 * ROUTER FACTORY
 * ============================================================
 */

function createApplicationQueryRouter() {
  const router =
    express.Router();


  /*
   * ==========================================================
   * APPLICATIONS WORKSPACE
   * ==========================================================
   *
   * GET
   *
   * /api/applications/workspace
   *
   * Required:
   *
   *     candidateEmail
   *
   * Optional:
   *
   *     status
   *     page
   *     pageSize
   *
   * IMPORTANT:
   *
   * applicationQueryService is responsible for enforcing:
   *
   *     Under Review
   *     Approved
   *     Applied
   *
   * plus required generated documents.
   *
   * Generated-but-not-reviewed applications are therefore
   * excluded from this endpoint.
   */

  router.get(
    "/workspace",

    async (
      req,
      res
    ) => {
      try {
        const candidateEmail =
          normalizeEmail(
            req.query
              .candidateEmail
          );


        if (
          !candidateEmail
        ) {
          return res
            .status(
              400
            )
            .json({
              error:
                "candidateEmail is required",

              code:
                "CANDIDATE_EMAIL_REQUIRED"
            });
        }


        const result =
          await getWorkspaceApplicationsPage(
            candidateEmail,
            {
              /*
               * Query service owns status filtering rules.
               */
              status:
                normalizeString(
                  req.query
                    .status
                ) ||
                undefined,

              page:
                req.query
                  .page,

              pageSize:
                req.query
                  .pageSize
            }
          );


        return res.json({
          /*
           * Strip internal generated text from list responses.
           *
           * Frontend listing pages primarily require metadata,
           * status, eligibility and generated document links.
           */
          data:
            result.data.map(
              sanitizeApplicationForApi
            ),

          meta:
            result.meta,

          fetchedAt:
            new Date()
              .toISOString()
        });
      } catch (err) {
        return sendQueryError(
          res,
          err,
          "Failed to load application workspace"
        );
      }
    }
  );


  /*
   * ==========================================================
   * READY FOR REVIEW
   * ==========================================================
   *
   * GET
   *
   * /api/applications/ready-for-review
   *
   * This endpoint does NOT move anything into review.
   *
   * It only returns applications that are currently eligible
   * for:
   *
   *     Generated -> Under Review
   *
   * according to applicationEligibilityService.
   */

  router.get(
    "/ready-for-review",

    async (
      req,
      res
    ) => {
      try {
        const candidateEmail =
          normalizeEmail(
            req.query
              .candidateEmail
          );


        if (
          !candidateEmail
        ) {
          return res
            .status(
              400
            )
            .json({
              error:
                "candidateEmail is required",

              code:
                "CANDIDATE_EMAIL_REQUIRED"
            });
        }


        const result =
          await getReadyForReviewApplicationsPage(
            candidateEmail,
            {
              page:
                req.query
                  .page,

              pageSize:
                req.query
                  .pageSize
            }
          );


        return res.json({
          data:
            result.data.map(
              sanitizeApplicationForApi
            ),

          meta:
            result.meta,

          fetchedAt:
            new Date()
              .toISOString()
        });
      } catch (err) {
        return sendQueryError(
          res,
          err,
          "Failed to load applications ready for review"
        );
      }
    }
  );


  /*
   * ==========================================================
   * APPLICATION COUNTS
   * ==========================================================
   *
   * GET
   *
   * /api/applications/counts
   *
   * Useful for:
   *
   * - sidebar badges
   * - dashboard cards
   * - workflow counters
   *
   * Avoids downloading all application records just to count
   * them in React.
   */

  router.get(
    "/counts",

    async (
      req,
      res
    ) => {
      try {
        const candidateEmail =
          normalizeEmail(
            req.query
              .candidateEmail
          );


        if (
          !candidateEmail
        ) {
          return res
            .status(
              400
            )
            .json({
              error:
                "candidateEmail is required",

              code:
                "CANDIDATE_EMAIL_REQUIRED"
            });
        }


        const counts =
          await getApplicationCounts(
            candidateEmail
          );


        return res.json({
          data:
            counts,

          fetchedAt:
            new Date()
              .toISOString()
        });
      } catch (err) {
        return sendQueryError(
          res,
          err,
          "Failed to load application counts"
        );
      }
    }
  );


  return router;
}


/*
 * ============================================================
 * API RESPONSE SANITIZER
 * ============================================================
 *
 * Generated CV/cover-letter raw text can be large and contains
 * candidate-specific information.
 *
 * List endpoints do not need to send those fields repeatedly.
 *
 * We keep document links and application metadata intact.
 */

function sanitizeApplicationForApi(
  application
) {
  if (
    !application ||
    typeof application !==
      "object"
  ) {
    return application;
  }


  const {
    cvText,
    coverLetterText,

    /*
     * Everything else remains available.
     */
    ...safeApplication
  } =
    application;


  return safeApplication;
}


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


function normalizeEmail(
  value
) {
  return normalizeString(
    value
  ).toLowerCase();
}


/*
 * ============================================================
 * QUERY ERROR RESPONSE
 * ============================================================
 *
 * Query routes should not expose stack traces or raw internal
 * errors to the frontend.
 */

function sendQueryError(
  res,
  err,
  fallbackMessage
) {
  /*
   * Some service/persistence errors already provide an HTTP
   * status code.
   */

  if (
    Number.isInteger(
      err?.statusCode
    )
  ) {
    return res
      .status(
        normalizeHttpStatus(
          err.statusCode,
          500
        )
      )
      .json({
        error:
          err?.message ||
          fallbackMessage,

        code:
          err?.code ||
          "APPLICATION_QUERY_ERROR"
      });
  }


  /*
   * Unknown internal error.
   */

  console.error(
    "[ApplicationQueryRoutes]",
    err
  );


  return res
    .status(
      500
    )
    .json({
      error:
        fallbackMessage,

      code:
        "INTERNAL_APPLICATION_QUERY_ERROR"
    });
}


/*
 * ============================================================
 * HTTP STATUS NORMALIZATION
 * ============================================================
 */

function normalizeHttpStatus(
  value,
  fallback
) {
  const status =
    Number(
      value
    );


  if (
    Number.isInteger(
      status
    ) &&
    status >=
      400 &&
    status <=
      599
  ) {
    return status;
  }


  return fallback;
}


/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  createApplicationQueryRouter,

  /*
   * Export helpers primarily for tests.
   */
  sanitizeApplicationForApi,
  sendQueryError,
  normalizeHttpStatus
};