const express =
  require(
    "express"
  );

const {
  moveApplicationToReview,
  approveApplication,
  rejectApplication,
  getApplicationReviewState,

  ApplicationReviewError
} = require(
  "../application/applicationReviewService"
);

const {
  ApplicationEligibilityError
} = require(
  "../application/applicationEligibilityService"
);


/*
 * ============================================================
 * APPLICATION REVIEW ROUTES
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * HTTP interface for JobVerse's candidate-controlled application
 * review lifecycle.
 *
 * This module exposes:
 *
 *     GET  /:applicationId/review
 *     POST /:applicationId/review
 *     POST /:applicationId/approve
 *     POST /:applicationId/reject
 *
 * ============================================================
 * RESPONSIBILITY BOUNDARY
 * ============================================================
 *
 * ROUTER:
 *
 * - reads HTTP parameters
 * - validates basic request presence
 * - calls applicationReviewService
 * - converts known domain errors into HTTP responses
 *
 * SERVICE:
 *
 * - owns review business rules
 * - owns lifecycle transitions
 * - owns execution-status synchronization
 *
 * PERSISTENCE:
 *
 * - owns Google Sheets reads/writes
 *
 * ============================================================
 * IMPORTANT
 * ============================================================
 *
 * This router MUST NOT:
 *
 * - directly call readSheet()
 * - directly call upsertRows()
 * - manually set application.status
 * - manually set executionStatus
 * - implement eligibility rules
 *
 * ============================================================
 */


/*
 * ============================================================
 * ROUTER FACTORY
 * ============================================================
 *
 * checkTriggerToken is injected rather than imported from
 * api.js.
 *
 * This avoids:
 *
 *     applicationReviewRoutes -> api.js
 *
 * which could create circular dependencies.
 *
 * Usage later:
 *
 *     createApplicationReviewRouter({
 *       checkTriggerToken
 *     })
 */

function createApplicationReviewRouter({
  checkTriggerToken
} = {}) {
  const router =
    express.Router();


  /*
   * ----------------------------------------------------------
   * MUTATION AUTHORIZATION
   * ----------------------------------------------------------
   *
   * State-changing application review operations must use the
   * same trigger protection already used by the backend.
   */

  if (
    typeof checkTriggerToken !==
    "function"
  ) {
    throw new Error(
      "createApplicationReviewRouter requires checkTriggerToken middleware"
    );
  }


  /*
   * ==========================================================
   * GET REVIEW STATE
   * ==========================================================
   *
   * Example:
   *
   * GET
   * /api/applications/:applicationId/review
   *
   * Optional:
   *
   * ?candidateEmail=user@example.com
   *
   * Candidate-facing callers should send candidateEmail so the
   * service can verify ownership.
   *
   * This endpoint does NOT mutate the application.
   */

  router.get(
    "/:applicationId/review",

    async (
      req,
      res
    ) => {
      try {
        const applicationId =
          normalizeString(
            req.params
              .applicationId
          );

        if (
          !applicationId
        ) {
          return res
            .status(
              400
            )
            .json({
              error:
                "applicationId is required",

              code:
                "APPLICATION_ID_REQUIRED"
            });
        }


        const data =
          await getApplicationReviewState(
            applicationId,
            {
              candidateEmail:
                normalizeString(
                  req.query
                    .candidateEmail
                ) ||
                undefined
            }
          );


        return res.json({
          data
        });
      } catch (err) {
        return sendReviewError(
          res,
          err,
          "Failed to load application review state"
        );
      }
    }
  );


  /*
   * ==========================================================
   * ENTER REVIEW
   * ==========================================================
   *
   * Generated
   *     ↓
   * Under Review
   *
   * Required by eligibility policy:
   *
   * - generated application exists
   * - status = Generated
   * - CV exists
   * - cover letter exists
   *
   * This is the explicit gate that makes a generated package
   * part of the Applications workflow.
   */

  router.post(
    "/:applicationId/review",

    checkTriggerToken,

    async (
      req,
      res
    ) => {
      try {
        const applicationId =
          normalizeString(
            req.params
              .applicationId
          );

        if (
          !applicationId
        ) {
          return res
            .status(
              400
            )
            .json({
              error:
                "applicationId is required",

              code:
                "APPLICATION_ID_REQUIRED"
            });
        }


        const result =
          await moveApplicationToReview(
            applicationId,
            {
              candidateEmail:
                getCandidateEmail(
                  req
                ) ||
                undefined
            }
          );


        return res.json({
          data:
            result
        });
      } catch (err) {
        return sendReviewError(
          res,
          err,
          "Failed to move application into review"
        );
      }
    }
  );


  /*
   * ==========================================================
   * APPROVE APPLICATION
   * ==========================================================
   *
   * Under Review
   *     ↓
   * Approved
   *
   * Result:
   *
   *     executionStatus = ready
   *
   * IMPORTANT:
   *
   * Approval does NOT start application execution.
   */

  router.post(
    "/:applicationId/approve",

    checkTriggerToken,

    async (
      req,
      res
    ) => {
      try {
        const applicationId =
          normalizeString(
            req.params
              .applicationId
          );

        if (
          !applicationId
        ) {
          return res
            .status(
              400
            )
            .json({
              error:
                "applicationId is required",

              code:
                "APPLICATION_ID_REQUIRED"
            });
        }


        const result =
          await approveApplication(
            applicationId,
            {
              candidateEmail:
                getCandidateEmail(
                  req
                ) ||
                undefined
            }
          );


        return res.json({
          data:
            result
        });
      } catch (err) {
        return sendReviewError(
          res,
          err,
          "Failed to approve application"
        );
      }
    }
  );


  /*
   * ==========================================================
   * REJECT APPLICATION
   * ==========================================================
   *
   * Under Review
   *      ↓
   * Rejected
   *
   * or:
   *
   * Approved + ready
   *      ↓
   * Rejected
   *
   * Active/submitted execution states are protected by the
   * review service.
   */

  router.post(
    "/:applicationId/reject",

    checkTriggerToken,

    async (
      req,
      res
    ) => {
      try {
        const applicationId =
          normalizeString(
            req.params
              .applicationId
          );

        if (
          !applicationId
        ) {
          return res
            .status(
              400
            )
            .json({
              error:
                "applicationId is required",

              code:
                "APPLICATION_ID_REQUIRED"
            });
        }


        const result =
          await rejectApplication(
            applicationId,
            {
              candidateEmail:
                getCandidateEmail(
                  req
                ) ||
                undefined
            }
          );


        return res.json({
          data:
            result
        });
      } catch (err) {
        return sendReviewError(
          res,
          err,
          "Failed to reject application"
        );
      }
    }
  );


  return router;
}


/*
 * ============================================================
 * CANDIDATE EMAIL
 * ============================================================
 *
 * For mutation endpoints we allow candidateEmail to come from:
 *
 *     req.body.candidateEmail
 *
 * or:
 *
 *     req.query.candidateEmail
 *
 * This is currently an ownership consistency check.
 *
 * IMPORTANT:
 *
 * candidateEmail itself is NOT authentication.
 *
 * Real user authentication/authorization can later provide the
 * candidate identity directly from req.user/session instead.
 */

function getCandidateEmail(
  req
) {
  return (
    normalizeString(
      req.body
        ?.candidateEmail
    ) ||
    normalizeString(
      req.query
        ?.candidateEmail
    )
  );
}


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


/*
 * ============================================================
 * ERROR RESPONSE
 * ============================================================
 *
 * Domain/service errors already contain useful:
 *
 *     code
 *     statusCode
 *     details
 *
 * Convert them into a consistent HTTP response without
 * exposing stack traces.
 */

function sendReviewError(
  res,
  err,
  fallbackMessage
) {
  /*
   * ----------------------------------------------------------
   * KNOWN REVIEW ERROR
   * ----------------------------------------------------------
   */

  if (
    err instanceof
    ApplicationReviewError
  ) {
    return res
      .status(
        normalizeHttpStatus(
          err.statusCode,
          409
        )
      )
      .json({
        error:
          err.message,

        code:
          err.code,

        details:
          err.details ||
          {}
      });
  }


  /*
   * ----------------------------------------------------------
   * KNOWN ELIGIBILITY ERROR
   * ----------------------------------------------------------
   */

  if (
    err instanceof
    ApplicationEligibilityError
  ) {
    return res
      .status(
        normalizeHttpStatus(
          err.statusCode,
          409
        )
      )
      .json({
        error:
          err.message,

        code:
          err.code,

        details:
          err.details ||
          {}
      });
  }


  /*
   * ----------------------------------------------------------
   * PERSISTENCE/SERVICE ERROR WITH STATUS METADATA
   * ----------------------------------------------------------
   *
   * applicationPersistence.js currently creates errors such as:
   *
   *     APPLICATION_NOT_FOUND
   *     statusCode = 404
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
          "APPLICATION_REVIEW_ERROR"
      });
  }


  /*
   * ----------------------------------------------------------
   * UNKNOWN SERVER ERROR
   * ----------------------------------------------------------
   */

  console.error(
    "[ApplicationReviewRoutes]",
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
        "INTERNAL_APPLICATION_REVIEW_ERROR"
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
  createApplicationReviewRouter,

  /*
   * Exported primarily for unit tests.
   */
  getCandidateEmail,
  sendReviewError,
  normalizeHttpStatus
};