const express =
  require(
    "express"
  );


const {
  resumeApplicationExecution,
} = require(
  "../application/execution/executionResumeService"
);


/*
 * ============================================================
 * APPLICATION RESUME ROUTES
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * Exposes the HTTP boundary for resuming an EXISTING application
 * execution attempt.
 *
 *
 * IMPORTANT
 * ------------------------------------------------------------
 *
 * This router does NOT:
 *
 * - create a new Application Attempt
 * - decide resume eligibility
 * - inspect browser forms itself
 * - fill forms
 * - submit applications
 * - bypass login
 * - bypass CAPTCHA
 * - bypass OTP
 *
 * All business rules remain inside:
 *
 *     executionResumeService.js
 *
 * and:
 *
 *     executionGuard.js
 *
 *
 * ROUTE
 * ------------------------------------------------------------
 *
 * POST
 *
 * /api/applications/:applicationId/attempts/:attemptId/resume
 *
 * When mounted at:
 *
 *     /api/applications
 *
 * the router itself receives:
 *
 *     /:applicationId/attempts/:attemptId/resume
 */


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
 * CREATE ROUTER
 * ============================================================
 */

function createApplicationResumeRouter({
  checkTriggerToken,
} = {}) {
  const router =
    express.Router();


  /*
   * ==========================================================
   * RESUME APPLICATION EXECUTION
   * ==========================================================
   *
   * Resumes the SAME existing attempt.
   *
   * Example:
   *
   * attempt = needs_review
   *
   * candidate supplies answers
   *
   * POST resume
   *
   *     ↓
   *
   * same attempt is re-evaluated
   *
   *     ↓
   *
   * complete_google_form_answers
   *
   * or:
   *
   * review_google_form
   */

  router.post(
    "/:applicationId/attempts/:attemptId/resume",

    /*
     * Resume is a mutating/protected workflow operation.
     *
     * Keep the same trigger-token protection used by execution,
     * review mutations, and answer mutations.
     */
    ...(typeof checkTriggerToken ===
    "function"
      ? [
          checkTriggerToken
        ]
      : []),

    async (
      req,
      res
    ) => {
      try {
        /*
         * ======================================================
         * APPLICATION ID
         * ======================================================
         */

        const applicationId =
          normalizeString(
            req.params
              ?.applicationId
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
                "applicationId is required.",

              code:
                "APPLICATION_ID_REQUIRED",
            });
        }


        /*
         * ======================================================
         * ATTEMPT ID
         * ======================================================
         */

        const attemptId =
          normalizeString(
            req.params
              ?.attemptId
          );


        if (
          !attemptId
        ) {
          return res
            .status(
              400
            )
            .json({
              error:
                "attemptId is required.",

              code:
                "APPLICATION_ATTEMPT_REQUIRED",
            });
        }


        /*
         * ======================================================
         * CANDIDATE OWNERSHIP INPUT
         * ======================================================
         *
         * candidateEmail is required for this candidate-facing
         * endpoint.
         *
         * IMPORTANT:
         *
         * This is still an ownership consistency check rather
         * than authentication.
         *
         * Proper user authentication remains a separate concern.
         */

        const candidateEmail =
          normalizeString(
            req.body
              ?.candidateEmail
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
                "candidateEmail is required.",

              code:
                "CANDIDATE_EMAIL_REQUIRED",
            });
        }


        /*
         * ======================================================
         * DOMAIN SERVICE
         * ======================================================
         */

        const data =
          await resumeApplicationExecution({
            applicationId,

            attemptId,

            candidateEmail,
          });


        /*
         * Resume is accepted and processed synchronously for the
         * current Phase 3 re-evaluation operation.
         *
         * We are not launching a background browser worker here.
         */
        return res.json({
          data,

          fetchedAt:
            new Date()
              .toISOString(),
        });
      } catch (
        error
      ) {
        /*
         * ======================================================
         * STRUCTURED DOMAIN ERRORS
         * ======================================================
         *
         * Both executionGuard and executionResumeService attach:
         *
         * statusCode
         * code
         * details
         *
         * Preserve them rather than converting everything to 500.
         */

        const statusCode =
          Number.isInteger(
            error?.statusCode
          )
            ? error.statusCode
            : 500;


        if (
          statusCode >=
          500
        ) {
          console.error(
            "[ApplicationResume]",
            error
          );
        }


        return res
          .status(
            statusCode
          )
          .json({
            error:
              error?.message ||
              "Failed to resume application execution.",

            code:
              error?.code ||
              "APPLICATION_EXECUTION_RESUME_ERROR",

            /*
             * Do not fabricate details.
             *
             * Include only domain-provided safe diagnostics.
             */
            ...(
              error?.details &&
              typeof error.details ===
                "object"
                ? {
                    details:
                      error.details
                  }
                : {}
            ),
          });
      }
    }
  );


  return router;
}


/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  createApplicationResumeRouter,
};