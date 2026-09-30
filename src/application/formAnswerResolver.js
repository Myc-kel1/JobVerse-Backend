const {
  matchQuestion,
  canUseMatchAutomatically,
} = require("./questionMatcher");

const {
  getTypedCandidateAnswer,
  requiresHumanReview:
    answerRequiresHumanReview,
} = require("./candidateAnswerService");

/*
 * ============================================================
 * FORM ANSWER RESOLVER
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * This service combines:
 *
 * 1. questionMatcher.js
 * 2. candidateAnswerService.js
 *
 * to determine whether an application-form question can be
 * answered safely using stored candidate data.
 *
 * It returns one of three states:
 *
 * resolved
 * needs_review
 * missing
 *
 * ------------------------------------------------------------
 * WHY THIS SERVICE EXISTS
 * ------------------------------------------------------------
 *
 * Application channels should NOT independently decide whether
 * a candidate answer is safe to reuse.
 *
 * Google Forms, ATS forms, company forms, and LinkedIn flows
 * should all use this resolver.
 *
 * This provides:
 *
 * - one decision layer
 * - consistent safety behavior
 * - reusable answer resolution
 * - simpler channel implementations
 *
 * ------------------------------------------------------------
 * IMPORTANT RULE
 * ------------------------------------------------------------
 *
 * This service NEVER invents answers.
 *
 * If the answer does not exist or cannot be trusted, the
 * result becomes:
 *
 * needs_review
 *
 * or:
 *
 * missing
 * ============================================================
 */

/*
 * ============================================================
 * RESOLUTION STATUSES
 * ============================================================
 */

const RESOLUTION_STATUSES =
  Object.freeze({
    RESOLVED:
      "resolved",

    NEEDS_REVIEW:
      "needs_review",

    MISSING:
      "missing",
  });

/*
 * ============================================================
 * BASIC HELPERS
 * ============================================================
 */

function normalizeString(
  value
) {
  return String(
    value ?? ""
  ).trim();
}

function normalizeQuestionText(
  value
) {
  return normalizeString(
    value
  );
}

/*
 * ============================================================
 * RESULT BUILDERS
 * ============================================================
 *
 * Keeping result construction centralized prevents inconsistent
 * response shapes.
 */

function buildResolvedResult({
  questionText,
  match,
  answer,
}) {
  return {
    status:
      RESOLUTION_STATUSES
        .RESOLVED,

    resolved:
      true,

    questionText,

    questionKey:
      match.questionKey,

    value:
      answer.value,

    answerType:
      answer.answerType,

    verified:
      Boolean(
        answer.verified
      ),

    source:
      answer.source,

    confidence:
      match.confidence,

    matchType:
      match.matchType,

    highRisk:
      Boolean(
        match.highRisk
      ),

    requiresHumanReview:
      false,

    reason:
      "Verified candidate answer found and approved for reuse.",
  };
}

function buildNeedsReviewResult({
  questionText,
  questionKey = null,
  confidence = 0,
  matchType = "none",
  answer = null,
  reason,
}) {
  return {
    status:
      RESOLUTION_STATUSES
        .NEEDS_REVIEW,

    resolved:
      false,

    questionText,

    questionKey,

    value:
      answer
        ? answer.value
        : null,

    answerType:
      answer
        ? answer.answerType
        : null,

    verified:
      answer
        ? Boolean(
            answer.verified
          )
        : false,

    source:
      answer
        ? answer.source
        : null,

    confidence:
      Number(
        confidence || 0
      ),

    matchType,

    requiresHumanReview:
      true,

    reason:
      normalizeString(
        reason
      ),
  };
}

function buildMissingResult({
  questionText,
  questionKey = null,
  confidence = 0,
  matchType = "none",
  reason,
}) {
  return {
    status:
      RESOLUTION_STATUSES
        .MISSING,

    resolved:
      false,

    questionText,

    questionKey,

    value:
      null,

    answerType:
      null,

    verified:
      false,

    source:
      null,

    confidence:
      Number(
        confidence || 0
      ),

    matchType,

    requiresHumanReview:
      true,

    reason:
      normalizeString(
        reason
      ),
  };
}

/*
 * ============================================================
 * RESOLVE SINGLE QUESTION
 * ============================================================
 */

async function resolveFormQuestion({
  candidateEmail,
  questionText,
}) {
  const normalizedQuestion =
    normalizeQuestionText(
      questionText
    );

  if (!candidateEmail) {
    throw new Error(
      "candidateEmail is required"
    );
  }

  if (!normalizedQuestion) {
    return buildMissingResult({
      questionText:
        "",

      reason:
        "Question text is empty.",
    });
  }

  /*
   * ==========================================================
   * STEP 1 — MATCH QUESTION
   * ==========================================================
   */

  const match =
    matchQuestion(
      normalizedQuestion
    );

  /*
   * If the question itself cannot be matched confidently, we
   * must not guess which stored answer should be used.
   */
  if (
    !match.matched
  ) {
    return buildNeedsReviewResult({
      questionText:
        normalizedQuestion,

      questionKey:
        match.possibleQuestionKey ||
        null,

      confidence:
        match.confidence,

      matchType:
        match.matchType,

      reason:
        match.reason ||
        "Question could not be matched confidently.",
    });
  }

  /*
   * ==========================================================
   * STEP 2 — CHECK MATCH SAFETY
   * ==========================================================
   */

  if (
    !canUseMatchAutomatically(
      match
    )
  ) {
    return buildNeedsReviewResult({
      questionText:
        normalizedQuestion,

      questionKey:
        match.questionKey,

      confidence:
        match.confidence,

      matchType:
        match.matchType,

      reason:
        match.reason ||
        "Question match requires human review.",
    });
  }

  /*
   * ==========================================================
   * STEP 3 — GET STORED CANDIDATE ANSWER
   * ==========================================================
   */

  const answer =
    await getTypedCandidateAnswer(
      candidateEmail,
      match.questionKey
    );

  if (!answer) {
    return buildMissingResult({
      questionText:
        normalizedQuestion,

      questionKey:
        match.questionKey,

      confidence:
        match.confidence,

      matchType:
        match.matchType,

      reason:
        "No stored candidate answer exists for this question.",
    });
  }

  /*
   * ==========================================================
   * STEP 4 — CHECK ANSWER SAFETY
   * ==========================================================
   */

  if (
    answerRequiresHumanReview(
      answer
    )
  ) {
    return buildNeedsReviewResult({
      questionText:
        normalizedQuestion,

      questionKey:
        match.questionKey,

      confidence:
        match.confidence,

      matchType:
        match.matchType,

      answer,

      reason:
        "Stored answer exists but is not trusted for automatic reuse.",
    });
  }

  /*
   * ==========================================================
   * STEP 5 — RESOLVED
   * ==========================================================
   */

  return buildResolvedResult({
    questionText:
      normalizedQuestion,

    match,

    answer,
  });
}

/*
 * ============================================================
 * RESOLVE MULTIPLE QUESTIONS
 * ============================================================
 *
 * Useful for:
 *
 * - Google Forms
 * - ATS forms
 * - company application forms
 *
 * Every question is resolved independently.
 */

async function resolveFormQuestions({
  candidateEmail,
  questions,
}) {
  if (
    !Array.isArray(
      questions
    )
  ) {
    throw new Error(
      "questions must be an array"
    );
  }

  const results =
    [];

  /*
   * Sequential execution is intentional here.
   *
   * Google Sheets is our current persistence layer and these
   * operations are lightweight. Sequential processing gives us
   * predictable behavior and avoids unnecessary concurrent
   * reads.
   */
  for (
    const question of
    questions
  ) {
    const questionText =
      typeof question ===
      "string"
        ? question
        : question?.questionText ||
          question?.label ||
          question?.text ||
          "";

    const resolution =
      await resolveFormQuestion({
        candidateEmail,
        questionText,
      });

    /*
     * Preserve form-specific metadata if the caller supplied an
     * object instead of a plain string.
     */
    if (
      typeof question ===
      "object" &&
      question !== null
    ) {
      results.push({
        ...question,

        ...resolution,
      });
    } else {
      results.push(
        resolution
      );
    }
  }

  return results;
}

/*
 * ============================================================
 * SUMMARIZE RESOLUTION RESULTS
 * ============================================================
 *
 * This is useful for execution services and the frontend.
 */

function summarizeResolvedQuestions(
  results
) {
  const safeResults =
    Array.isArray(
      results
    )
      ? results
      : [];

  const resolved =
    safeResults.filter(
      (item) =>
        item.status ===
        RESOLUTION_STATUSES
          .RESOLVED
    );

  const needsReview =
    safeResults.filter(
      (item) =>
        item.status ===
        RESOLUTION_STATUSES
          .NEEDS_REVIEW
    );

  const missing =
    safeResults.filter(
      (item) =>
        item.status ===
        RESOLUTION_STATUSES
          .MISSING
    );

  return {
    total:
      safeResults.length,

    resolved:
      resolved.length,

    needsReview:
      needsReview.length,

    missing:
      missing.length,

    canSubmitAutomatically:
      safeResults.length > 0 &&
      needsReview.length === 0 &&
      missing.length === 0,

    resolvedQuestions:
      resolved,

    reviewQuestions:
      needsReview,

    missingQuestions:
      missing,
  };
}

/*
 * ============================================================
 * CHECK WHETHER FORM CAN CONTINUE
 * ============================================================
 *
 * A form can proceed without candidate intervention only when:
 *
 * - every question is resolved
 * - nothing needs review
 * - nothing is missing
 */

function canProceedWithoutReview(
  results
) {
  const summary =
    summarizeResolvedQuestions(
      results
    );

  return (
    summary
      .canSubmitAutomatically
  );
}

/*
 * ============================================================
 * BUILD RESOLVED ANSWER MAP
 * ============================================================
 *
 * Converts:
 *
 * [
 *   {
 *     questionKey: "visa_sponsorship",
 *     value: false
 *   }
 * ]
 *
 * into:
 *
 * {
 *   visa_sponsorship: false
 * }
 *
 * Useful for channel handlers.
 */

function buildResolvedAnswerMap(
  results
) {
  const answerMap =
    {};

  for (
    const item of
    results || []
  ) {
    if (
      item.status !==
      RESOLUTION_STATUSES
        .RESOLVED
    ) {
      continue;
    }

    if (
      !item.questionKey
    ) {
      continue;
    }

    answerMap[
      item.questionKey
    ] =
      item.value;
  }

  return answerMap;
}

/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  /*
   * Core resolver.
   */
  resolveFormQuestion,
  resolveFormQuestions,

  /*
   * Result analysis.
   */
  summarizeResolvedQuestions,
  canProceedWithoutReview,
  buildResolvedAnswerMap,

  /*
   * Shared statuses.
   */
  RESOLUTION_STATUSES,
};