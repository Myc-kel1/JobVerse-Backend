const express =
  require("express");

const {
  resolveApplicationQuestions,
  getUnresolvedApplicationQuestions,
  answerAndResolveApplicationQuestion,
  confirmApplicationQuestionAnswer,
  getApplicationQuestionAnswer,
  ApplicationQuestionError,
} = require(
  "../application/applicationQuestionService"
);


/*
 * ============================================================
 * APPLICATION QUESTION ROUTES
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * This router exposes JobVerse's Phase 3 candidate-question
 * workflow over HTTP.
 *
 * It acts as the transport layer between:
 *
 * React frontend
 *      ↓
 * Express routes
 *      ↓
 * applicationQuestionService.js
 *
 *
 * IMPORTANT ARCHITECTURE RULE
 * ------------------------------------------------------------
 *
 * This file contains HTTP concerns only.
 *
 * It does NOT:
 *
 * - match employer questions
 * - decide whether answers are trustworthy
 * - write directly to Google Sheets
 * - inspect application websites
 * - fill browser forms
 * - start Playwright
 * - submit job applications
 *
 * Those responsibilities live in their dedicated modules.
 * ============================================================
 */


/*
 * ============================================================
 * BASIC NORMALIZATION HELPERS
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
 * REQUEST VALUE HELPERS
 * ============================================================
 *
 * candidateEmail may arrive through:
 *
 * - request body for POST operations
 * - query parameter for GET operations
 *
 * Keeping extraction centralized avoids slightly different
 * behavior across endpoints.
 */

function getBodyCandidateEmail(
  req
) {
  return normalizeString(
    req.body?.candidateEmail
  );
}


function getQueryCandidateEmail(
  req
) {
  return normalizeString(
    req.query?.candidateEmail
  );
}


/*
 * ============================================================
 * SUCCESS RESPONSE HELPER
 * ============================================================
 *
 * JobVerse APIs generally return:
 *
 * {
 *   data: ...,
 *   fetchedAt: ...
 * }
 *
 * Keeping that shape consistent makes frontend integration
 * easier.
 */

function sendSuccess(
  res,
  data,
  statusCode = 200
) {
  return res
    .status(
      statusCode
    )
    .json({
      data,

      fetchedAt:
        new Date()
          .toISOString(),
    });
}


/*
 * ============================================================
 * ERROR RESPONSE HELPER
 * ============================================================
 *
 * Domain errors are intentionally converted into predictable
 * API responses.
 *
 * Unexpected internal errors do not expose full stack traces
 * or sensitive backend information to clients.
 */

function sendError(
  res,
  error
) {
  /*
   * Application Question domain error.
   */
  if (
    error instanceof
    ApplicationQuestionError
  ) {
    return res
      .status(
        error.statusCode ||
        400
      )
      .json({
        error:
          error.message,

        code:
          error.code ||
          "APPLICATION_QUESTION_ERROR",

        ...(
          error.details !==
          null
            ? {
                details:
                  error.details,
              }
            : {}
        ),
      });
  }


  /*
   * Some lower-level application/persistence services already
   * attach statusCode to their errors.
   *
   * Respect those without coupling this router to each service
   * implementation.
   */
  const statusCode =
    Number(
      error?.statusCode
    );


  if (
    Number.isInteger(
      statusCode
    ) &&
    statusCode >= 400 &&
    statusCode < 500
  ) {
    return res
      .status(
        statusCode
      )
      .json({
        error:
          normalizeString(
            error?.message
          ) ||
          "Request could not be completed.",
      });
  }


  /*
   * Unexpected error.
   *
   * Log server-side for debugging but return a generic response
   * to the client.
   */
  console.error(
    "[applicationQuestionRoutes]",
    error
  );


  return res
    .status(500)
    .json({
      error:
        "An unexpected error occurred while processing application questions.",

      code:
        "APPLICATION_QUESTION_INTERNAL_ERROR",
    });
}


/*
 * ============================================================
 * REQUIRE BODY CANDIDATE EMAIL
 * ============================================================
 */

function requireBodyCandidateEmail(
  req
) {
  const candidateEmail =
    getBodyCandidateEmail(
      req
    );


  if (!candidateEmail) {
    throw new ApplicationQuestionError(
      "candidateEmail is required",
      {
        statusCode: 400,

        code:
          "CANDIDATE_EMAIL_REQUIRED",
      }
    );
  }


  return candidateEmail;
}


/*
 * ============================================================
 * REQUIRE QUERY CANDIDATE EMAIL
 * ============================================================
 */

function requireQueryCandidateEmail(
  req
) {
  const candidateEmail =
    getQueryCandidateEmail(
      req
    );


  if (!candidateEmail) {
    throw new ApplicationQuestionError(
      "candidateEmail is required",
      {
        statusCode: 400,

        code:
          "CANDIDATE_EMAIL_REQUIRED",
      }
    );
  }


  return candidateEmail;
}


/*
 * ============================================================
 * CREATE ROUTER
 * ============================================================
 *
 * Factory pattern keeps route creation consistent with the
 * modular application route structure.
 */

function createApplicationQuestionRouter({
  checkTriggerToken
} = {}) {
  const router =
    express.Router();


  /*
   * ==========================================================
   * POST /:applicationId/questions/resolve
   * ==========================================================
   *
   * PURPOSE
   * ----------------------------------------------------------
   *
   * Resolve all questions discovered during form inspection.
   *
   * Request:
   *
   * {
   *   "candidateEmail": "candidate@example.com",
   *   "questions": [
   *     {
   *       "questionText":
   *         "Do you require visa sponsorship?"
   *     }
   *   ]
   * }
   *
   *
   * Response tells us which questions are:
   *
   * - resolved
   * - missing
   * - needs_review
   */

  router.post(
    "/:applicationId/questions/resolve",

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


        const candidateEmail =
          requireBodyCandidateEmail(
            req
          );


        const questions =
          req.body?.questions;


        if (
          !Array.isArray(
            questions
          )
        ) {
          throw new ApplicationQuestionError(
            "questions must be an array",
            {
              statusCode:
                400,

              code:
                "INVALID_QUESTIONS",
            }
          );
        }


        const result =
          await resolveApplicationQuestions({
            applicationId,

            candidateEmail,

            questions,
          });


        return sendSuccess(
          res,
          result
        );
      } catch (error) {
        return sendError(
          res,
          error
        );
      }
    }
  );


  /*
   * ==========================================================
   * POST /:applicationId/questions/unresolved
   * ==========================================================
   *
   * PURPOSE
   * ----------------------------------------------------------
   *
   * Resolve the supplied inspected questions but return only
   * questions that require candidate attention.
   *
   * We use POST rather than GET because the discovered questions
   * are currently supplied by form inspection rather than being
   * persisted independently by applicationId.
   */

  router.post(
    "/:applicationId/questions/unresolved",

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


        const candidateEmail =
          requireBodyCandidateEmail(
            req
          );


        const questions =
          req.body?.questions;


        if (
          !Array.isArray(
            questions
          )
        ) {
          throw new ApplicationQuestionError(
            "questions must be an array",
            {
              statusCode:
                400,

              code:
                "INVALID_QUESTIONS",
            }
          );
        }


        const result =
          await getUnresolvedApplicationQuestions({
            applicationId,

            candidateEmail,

            questions,
          });


        return sendSuccess(
          res,
          result
        );
      } catch (error) {
        return sendError(
          res,
          error
        );
      }
    }
  );


  /*
   * ==========================================================
   * POST /:applicationId/questions/answer
   * ==========================================================
   *
   * PURPOSE
   * ----------------------------------------------------------
   *
   * Candidate supplies an answer to a missing or review-required
   * application question.
   *
   * The service:
   *
   * 1. checks application ownership
   * 2. saves the reusable candidate answer
   * 3. reads the typed value
   * 4. resolves the question again
   *
   *
   * Example request:
   *
   * {
   *   "candidateEmail": "candidate@example.com",
   *   "questionKey": "visa_sponsorship",
   *   "questionText":
   *     "Will you now or in the future require sponsorship?",
   *   "answer": false,
   *   "answerType": "boolean"
   * }
   */

  router.post(
    "/:applicationId/questions/answer",
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


        const candidateEmail =
          requireBodyCandidateEmail(
            req
          );


        const questionKey =
          normalizeString(
            req.body
              ?.questionKey
          );


        const questionText =
          normalizeString(
            req.body
              ?.questionText
          );


        /*
         * We deliberately check property presence rather than:
         *
         * if (!answer)
         *
         * because these are valid answers:
         *
         * false
         * 0
         */
        const hasAnswer =
          Object.prototype
            .hasOwnProperty.call(
              req.body || {},
              "answer"
            );


        if (!hasAnswer) {
          throw new ApplicationQuestionError(
            "answer is required",
            {
              statusCode:
                400,

              code:
                "ANSWER_REQUIRED",
            }
          );
        }


        if (
          !questionKey &&
          !questionText
        ) {
          throw new ApplicationQuestionError(
            "questionKey or questionText is required",
            {
              statusCode:
                400,

              code:
                "QUESTION_REQUIRED",
            }
          );
        }


        const answerType =
          normalizeString(
            req.body
              ?.answerType
          ) ||
          "string";


        /*
         * Candidate-submitted answers are explicit candidate
         * input, so verified defaults to true.
         *
         * If the frontend intentionally requests a separate
         * confirmation step it can send:
         *
         * verified: false
         */
        const verified =
          typeof req.body
            ?.verified ===
          "boolean"
            ? req.body
                .verified
            : true;


        const result =
          await answerAndResolveApplicationQuestion({
            applicationId,

            candidateEmail,

            questionKey,

            questionText,

            answer:
              req.body.answer,

            answerType,

            verified,
          });


        return sendSuccess(
          res,
          result,
          200
        );
      } catch (error) {
        return sendError(
          res,
          error
        );
      }
    }
  );


  /*
   * ==========================================================
   * POST
   * /:applicationId/questions/:questionKey/confirm
   * ==========================================================
   *
   * PURPOSE
   * ----------------------------------------------------------
   *
   * Candidate explicitly confirms an existing reusable answer.
   *
   * This is particularly important for:
   *
   * - unverified answers
   * - answers requiring candidate confirmation
   * - previously AI-inferred values
   *
   * applicationQuestionService.js handles the special AI case
   * by changing the authoritative source to "candidate" after
   * explicit confirmation.
   */

  router.post(
    "/:applicationId/questions/:questionKey/confirm",
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


        const questionKey =
          normalizeString(
            req.params
              .questionKey
          );


        const candidateEmail =
          requireBodyCandidateEmail(
            req
          );


        if (!questionKey) {
          throw new ApplicationQuestionError(
            "questionKey is required",
            {
              statusCode:
                400,

              code:
                "QUESTION_KEY_REQUIRED",
            }
          );
        }


        const result =
          await confirmApplicationQuestionAnswer({
            applicationId,

            candidateEmail,

            questionKey,
          });


        return sendSuccess(
          res,
          result
        );
      } catch (error) {
        return sendError(
          res,
          error
        );
      }
    }
  );


  /*
   * ==========================================================
   * GET
   * /:applicationId/questions/:questionKey/answer
   * ==========================================================
   *
   * PURPOSE
   * ----------------------------------------------------------
   *
   * Retrieve one stored reusable candidate answer.
   *
   * Example:
   *
   * GET
   * /api/applications/abc/questions/visa_sponsorship/answer
   * ?candidateEmail=candidate@example.com
   *
   * This endpoint does not modify the answer.
   */

  router.get(
    "/:applicationId/questions/:questionKey/answer",

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


        const questionKey =
          normalizeString(
            req.params
              .questionKey
          );


        const candidateEmail =
          requireQueryCandidateEmail(
            req
          );


        if (!questionKey) {
          throw new ApplicationQuestionError(
            "questionKey is required",
            {
              statusCode:
                400,

              code:
                "QUESTION_KEY_REQUIRED",
            }
          );
        }


        const result =
          await getApplicationQuestionAnswer({
            applicationId,

            candidateEmail,

            questionKey,
          });


        return sendSuccess(
          res,
          result
        );
      } catch (error) {
        return sendError(
          res,
          error
        );
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
  createApplicationQuestionRouter,
};