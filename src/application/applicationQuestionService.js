const {
  requireApplicationById,
  assertApplicationBelongsToCandidate,
} = require("./applicationPersistence");

const {
  saveCandidateAnswer,
  getTypedCandidateAnswer,
  verifyCandidateAnswer,
  normalizeQuestionKey,
} = require("./candidateAnswerService");

const {
  resolveFormQuestion,
  resolveFormQuestions,
  summarizeResolvedQuestions,
  RESOLUTION_STATUSES,
} = require("./formAnswerResolver");


/*
 * ============================================================
 * APPLICATION QUESTION SERVICE
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * This service coordinates application-specific question and
 * answer workflows.
 *
 * Existing services already handle:
 *
 * candidateAnswerService.js
 *   → reusable candidate answer storage
 *
 * questionMatcher.js
 *   → employer question → canonical JobVerse question key
 *
 * formAnswerResolver.js
 *   → safe answer resolution
 *
 * This file adds the missing APPLICATION context:
 *
 * application
 *   ↓
 * candidate ownership
 *   ↓
 * inspected form questions
 *   ↓
 * resolution
 *   ↓
 * missing / needs_review / resolved
 *
 *
 * IMPORTANT SAFETY RULE
 * ------------------------------------------------------------
 *
 * This service NEVER invents candidate answers.
 *
 * Missing information remains missing.
 *
 * Untrusted information remains needs_review.
 *
 * Sensitive or high-risk answers continue through the safety
 * rules already defined in:
 *
 * candidateAnswerService.js
 * questionMatcher.js
 * formAnswerResolver.js
 *
 *
 * IMPORTANT ARCHITECTURE RULE
 * ------------------------------------------------------------
 *
 * This service does NOT:
 *
 * - inspect browser pages
 * - fill form fields
 * - click application buttons
 * - bypass CAPTCHA
 * - bypass login
 * - bypass OTP
 * - submit applications
 *
 * Those responsibilities belong to later phases.
 * ============================================================
 */


/*
 * ============================================================
 * ERROR TYPE
 * ============================================================
 *
 * Having a domain-specific error gives API routes a predictable
 * way to distinguish:
 *
 * - invalid user input
 * - missing application
 * - ownership mismatch
 * - unexpected server errors
 *
 * without coupling this service directly to Express.
 */

class ApplicationQuestionError extends Error {
  constructor(
    message,
    {
      statusCode = 400,
      code = "APPLICATION_QUESTION_ERROR",
      details = null,
    } = {}
  ) {
    super(message);

    this.name =
      "ApplicationQuestionError";

    this.statusCode =
      statusCode;

    this.code =
      code;

    this.details =
      details;
  }
}


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


function normalizeEmail(
  value
) {
  return normalizeString(
    value
  ).toLowerCase();
}


/*
 * ============================================================
 * NORMALIZE FORM QUESTION
 * ============================================================
 *
 * Browser/form inspectors may return question information in
 * slightly different shapes.
 *
 * Examples:
 *
 * {
 *   questionText: "Do you require sponsorship?"
 * }
 *
 * {
 *   label: "Do you require sponsorship?"
 * }
 *
 * {
 *   text: "Do you require sponsorship?"
 * }
 *
 * This helper converts those forms into one predictable shape.
 *
 * We preserve any original metadata because Phase 4 will later
 * need things such as:
 *
 * - selector
 * - field type
 * - required state
 * - options
 * - field name
 */

function normalizeApplicationQuestion(
  question,
  index = 0
) {
  /*
   * Plain strings are supported because some channels may
   * provide only labels rather than structured field objects.
   */
  if (
    typeof question ===
    "string"
  ) {
    const questionText =
      normalizeString(
        question
      );

    return {
      questionText,

      /*
       * This is a temporary form-level identifier.
       *
       * It is NOT the canonical questionKey.
       *
       * The canonical key comes from questionMatcher.js.
       */
      formQuestionId:
        `question_${index + 1}`,
    };
  }


  if (
    !question ||
    typeof question !==
      "object"
  ) {
    return {
      questionText: "",

      formQuestionId:
        `question_${index + 1}`,
    };
  }


  const questionText =
    normalizeString(
      question.questionText ||
      question.label ||
      question.text ||
      question.title ||
      question.name
    );


  return {
    /*
     * Preserve inspector/channel metadata.
     */
    ...question,

    questionText,

    /*
     * Use an existing field identifier if one exists.
     *
     * Otherwise create a deterministic local identifier.
     */
    formQuestionId:
      normalizeString(
        question.formQuestionId ||
        question.fieldId ||
        question.id ||
        question.name
      ) ||
      `question_${index + 1}`,
  };
}


/*
 * ============================================================
 * NORMALIZE QUESTION COLLECTION
 * ============================================================
 */

function normalizeApplicationQuestions(
  questions
) {
  if (
    !Array.isArray(
      questions
    )
  ) {
    throw new ApplicationQuestionError(
      "questions must be an array",
      {
        statusCode: 400,
        code:
          "INVALID_QUESTIONS",
      }
    );
  }


  return questions.map(
    (
      question,
      index
    ) =>
      normalizeApplicationQuestion(
        question,
        index
      )
  );
}


/*
 * ============================================================
 * LOAD + AUTHORIZE APPLICATION
 * ============================================================
 *
 * Every application-question operation must first establish:
 *
 * 1. the application exists
 * 2. the candidate owns that application
 *
 * The frontend must not be able to supply:
 *
 * applicationId from Candidate A
 * +
 * candidateEmail from Candidate B
 *
 * and access Candidate A's questions.
 */

async function requireOwnedApplication({
  applicationId,
  candidateEmail,
}) {
  const normalizedApplicationId =
    normalizeString(
      applicationId
    );

  const normalizedCandidateEmail =
    normalizeEmail(
      candidateEmail
    );


  if (
    !normalizedApplicationId
  ) {
    throw new ApplicationQuestionError(
      "applicationId is required",
      {
        statusCode: 400,
        code:
          "APPLICATION_ID_REQUIRED",
      }
    );
  }


  if (
    !normalizedCandidateEmail
  ) {
    throw new ApplicationQuestionError(
      "candidateEmail is required",
      {
        statusCode: 400,
        code:
          "CANDIDATE_EMAIL_REQUIRED",
      }
    );
  }


  /*
   * Persistence remains responsible for locating applications.
   */
  const application =
    await requireApplicationById(
      normalizedApplicationId
    );


  /*
   * Ownership logic remains centralized in persistence.
   *
   * We do not duplicate candidate ownership rules here.
   */
  await assertApplicationBelongsToCandidate(
    application,
    normalizedCandidateEmail
  );


  return {
    application,

    applicationId:
      normalizedApplicationId,

    candidateEmail:
      normalizedCandidateEmail,
  };
}


/*
 * ============================================================
 * BUILD QUESTION WORKFLOW RESULT
 * ============================================================
 *
 * Centralized response construction keeps API responses
 * consistent across:
 *
 * - Google Forms
 * - ATS forms
 * - company forms
 * - later Playwright-based form inspection
 */

function buildQuestionWorkflowResult({
  application,
  questions,
  resolutions,
}) {
  const summary =
    summarizeResolvedQuestions(
      resolutions
    );


  return {
    applicationId:
      application.applicationId,

    candidateEmail:
      application.candidateEmail,

    status:
      application.status,

    executionStatus:
      application.executionStatus,

    questions,

    resolutions,

    summary,

    /*
     * Only unresolved questions need candidate attention.
     */
    unresolvedQuestions:
      resolutions.filter(
        (item) =>
          item.status ===
            RESOLUTION_STATUSES
              .MISSING ||
          item.status ===
            RESOLUTION_STATUSES
              .NEEDS_REVIEW
      ),

    /*
     * This flag means candidate-answer resolution is complete.
     *
     * It does NOT mean the job application itself may be
     * submitted.
     *
     * Execution eligibility is still handled separately by the
     * execution guard.
     */
    answerReady:
      summary.missing ===
        0 &&
      summary.needsReview ===
        0,
  };
}


/*
 * ============================================================
 * RESOLVE APPLICATION QUESTIONS
 * ============================================================
 *
 * Main Phase 3 workflow.
 *
 * inspected questions
 *        ↓
 * application ownership
 *        ↓
 * formAnswerResolver
 *        ↓
 * resolved
 * missing
 * needs_review
 */

async function resolveApplicationQuestions({
  applicationId,
  candidateEmail,
  questions,
}) {
  const {
    application,
  } =
    await requireOwnedApplication({
      applicationId,
      candidateEmail,
    });


  const normalizedQuestions =
    normalizeApplicationQuestions(
      questions
    );


  /*
   * Empty arrays are valid.
   *
   * A form may have no custom candidate questions.
   */
  if (
    normalizedQuestions.length ===
    0
  ) {
    return buildQuestionWorkflowResult({
      application,

      questions:
        normalizedQuestions,

      resolutions: [],
    });
  }


  const resolutions =
    await resolveFormQuestions({
      candidateEmail:
        application.candidateEmail,

      questions:
        normalizedQuestions,
    });


  return buildQuestionWorkflowResult({
    application,

    questions:
      normalizedQuestions,

    resolutions,
  });
}


/*
 * ============================================================
 * GET UNRESOLVED APPLICATION QUESTIONS
 * ============================================================
 *
 * Convenience method for API routes and later browser channels.
 *
 * Only:
 *
 * - missing
 * - needs_review
 *
 * are returned.
 */

async function getUnresolvedApplicationQuestions({
  applicationId,
  candidateEmail,
  questions,
}) {
  const workflow =
    await resolveApplicationQuestions({
      applicationId,
      candidateEmail,
      questions,
    });


  return {
    applicationId:
      workflow.applicationId,

    candidateEmail:
      workflow.candidateEmail,

    answerReady:
      workflow.answerReady,

    summary:
      workflow.summary,

    unresolvedQuestions:
      workflow
        .unresolvedQuestions,
  };
}


/*
 * ============================================================
 * SAVE CANDIDATE ANSWER FOR APPLICATION QUESTION
 * ============================================================
 *
 * The candidate is explicitly supplying this answer.
 *
 * Therefore:
 *
 * source = candidate
 *
 * and, by default:
 *
 * verified = true
 *
 * because entering/submitting the answer is itself an explicit
 * candidate confirmation.
 *
 * API/UI layers may still choose verified=false when they need
 * a separate confirmation screen.
 */

async function saveApplicationQuestionAnswer({
  applicationId,
  candidateEmail,
  questionKey,
  questionText,
  answer,
  answerType = "string",
  verified = true,
}) {
  const {
    application,
  } =
    await requireOwnedApplication({
      applicationId,
      candidateEmail,
    });


  const normalizedQuestionText =
    normalizeString(
      questionText
    );


  const normalizedKey =
    normalizeQuestionKey(
      questionKey ||
      normalizedQuestionText
    );


  if (
    !normalizedKey
  ) {
    throw new ApplicationQuestionError(
      "questionKey or questionText is required",
      {
        statusCode: 400,
        code:
          "QUESTION_KEY_REQUIRED",
      }
    );
  }


  /*
   * The reusable answer service remains the only component that
   * actually persists candidate answers.
   *
   * This coordinator does not write to Google Sheets directly.
   */
  const savedAnswer =
    await saveCandidateAnswer({
      candidateEmail:
        application.candidateEmail,

      questionKey:
        normalizedKey,

      questionText:
        normalizedQuestionText ||
        normalizedKey,

      answer,

      answerType,

      verified:
        Boolean(
          verified
        ),

      source:
        "candidate",
    });


  /*
   * Immediately read the typed form.
   *
   * This gives the API/frontend:
   *
   * "true" → true
   * "5"    → 5
   *
   * rather than forcing every consumer to deserialize Sheet
   * values independently.
   */
  const typedAnswer =
    await getTypedCandidateAnswer(
      application.candidateEmail,
      normalizedKey
    );


  return {
    applicationId:
      application.applicationId,

    candidateEmail:
      application.candidateEmail,

    answer:
      typedAnswer ||
      savedAnswer,
  };
}


/*
 * ============================================================
 * SAVE ANSWER AND RE-RESOLVE QUESTION
 * ============================================================
 *
 * This is especially useful for the frontend.
 *
 * Flow:
 *
 * candidate sees missing question
 *        ↓
 * enters answer
 *        ↓
 * save answer
 *        ↓
 * resolve same question again
 *        ↓
 * question becomes resolved when safe
 */

async function answerAndResolveApplicationQuestion({
  applicationId,
  candidateEmail,
  questionKey,
  questionText,
  answer,
  answerType = "string",
  verified = true,
}) {
  const saved =
    await saveApplicationQuestionAnswer({
      applicationId,
      candidateEmail,
      questionKey,
      questionText,
      answer,
      answerType,
      verified,
    });


  const resolution =
    await resolveFormQuestion({
      candidateEmail:
        saved.candidateEmail,

      questionText,
    });


  return {
    ...saved,

    resolution,

    resolved:
      resolution.status ===
      RESOLUTION_STATUSES
        .RESOLVED,
  };
}


/*
 * ============================================================
 * CONFIRM STORED ANSWER
 * ============================================================
 *
 * Used when:
 *
 * - a stored answer exists
 * - the candidate is being asked to confirm it
 * - it is currently unverified
 *
 *
 * SPECIAL AI-INFERRED CASE
 * ------------------------------------------------------------
 *
 * candidateAnswerService intentionally prevents:
 *
 * ai_inferred
 *    ↓
 * verifyCandidateAnswer()
 *
 * because merely flipping a verification flag would incorrectly
 * preserve AI as the authoritative source.
 *
 * When the candidate explicitly confirms an AI-inferred value,
 * we re-save the same value as:
 *
 * source = candidate
 * verified = true
 *
 * This accurately records that the candidate has now taken
 * ownership of the answer.
 */

async function confirmApplicationQuestionAnswer({
  applicationId,
  candidateEmail,
  questionKey,
}) {
  const {
    application,
  } =
    await requireOwnedApplication({
      applicationId,
      candidateEmail,
    });


  const normalizedKey =
    normalizeQuestionKey(
      questionKey
    );


  if (
    !normalizedKey
  ) {
    throw new ApplicationQuestionError(
      "questionKey is required",
      {
        statusCode: 400,
        code:
          "QUESTION_KEY_REQUIRED",
      }
    );
  }


  const existing =
    await getTypedCandidateAnswer(
      application.candidateEmail,
      normalizedKey
    );


  if (!existing) {
    throw new ApplicationQuestionError(
      "Candidate answer not found",
      {
        statusCode: 404,
        code:
          "CANDIDATE_ANSWER_NOT_FOUND",
      }
    );
  }


  /*
   * AI-inferred answers require explicit candidate adoption.
   */
  if (
    normalizeString(
      existing.source
    ).toLowerCase() ===
    "ai_inferred"
  ) {
    await saveCandidateAnswer({
      candidateEmail:
        application.candidateEmail,

      questionKey:
        normalizedKey,

      questionText:
        existing.questionText ||
        normalizedKey,

      answer:
        existing.value,

      answerType:
        existing.answerType ||
        "string",

      verified: true,

      source:
        "candidate",
    });
  } else {
    /*
     * Non-AI answers can use the normal verification workflow.
     */
    await verifyCandidateAnswer(
      application.candidateEmail,
      normalizedKey
    );
  }


  const confirmedAnswer =
    await getTypedCandidateAnswer(
      application.candidateEmail,
      normalizedKey
    );


  return {
    applicationId:
      application.applicationId,

    candidateEmail:
      application.candidateEmail,

    answer:
      confirmedAnswer,
  };
}


/*
 * ============================================================
 * GET APPLICATION QUESTION ANSWER
 * ============================================================
 *
 * Read-only helper useful for:
 *
 * - API routes
 * - frontend confirmation screens
 * - future form-interaction services
 */

async function getApplicationQuestionAnswer({
  applicationId,
  candidateEmail,
  questionKey,
}) {
  const {
    application,
  } =
    await requireOwnedApplication({
      applicationId,
      candidateEmail,
    });


  const normalizedKey =
    normalizeQuestionKey(
      questionKey
    );


  if (
    !normalizedKey
  ) {
    throw new ApplicationQuestionError(
      "questionKey is required",
      {
        statusCode: 400,
        code:
          "QUESTION_KEY_REQUIRED",
      }
    );
  }


  const answer =
    await getTypedCandidateAnswer(
      application.candidateEmail,
      normalizedKey
    );


  return {
    applicationId:
      application.applicationId,

    candidateEmail:
      application.candidateEmail,

    answer,
  };
}


/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  /*
   * Main workflow.
   */
  resolveApplicationQuestions,
  getUnresolvedApplicationQuestions,

  /*
   * Candidate input.
   */
  saveApplicationQuestionAnswer,
  answerAndResolveApplicationQuestion,
  confirmApplicationQuestionAnswer,

  /*
   * Reads.
   */
  getApplicationQuestionAnswer,

  /*
   * Shared helpers.
   */
  normalizeApplicationQuestion,
  normalizeApplicationQuestions,
  requireOwnedApplication,

  /*
   * Domain error.
   */
  ApplicationQuestionError,
};