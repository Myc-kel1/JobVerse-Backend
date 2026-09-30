/*
 * ============================================================
 * QUESTION MATCHER
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * This module maps employer/application-form questions to our
 * canonical Candidate Application Answer keys.
 *
 * Example:
 *
 * Employer question:
 *
 * "Will you now or in the future require sponsorship?"
 *
 * Canonical key:
 *
 * "visa_sponsorship"
 *
 * WHY THIS FILE EXISTS
 * ------------------------------------------------------------
 *
 * Google Forms, ATS systems, LinkedIn, and company career pages
 * often ask the same question using different wording.
 *
 * We do NOT want every channel implementation to maintain its
 * own matching rules.
 *
 * This service gives us:
 *
 * - centralized question normalization
 * - deterministic matching
 * - reusable aliases
 * - confidence scores
 * - explicit human-review decisions
 *
 * IMPORTANT SAFETY RULE
 * ------------------------------------------------------------
 *
 * This matcher does NOT invent candidate answers.
 *
 * It only identifies the likely canonical question key.
 *
 * Actual candidate answers are retrieved separately through:
 *
 * candidateAnswerService.js
 * ============================================================
 */

const {
  normalizeQuestionKey,
  HIGH_RISK_QUESTION_KEYS,
} = require("./candidateAnswerService");

/*
 * ============================================================
 * CANONICAL QUESTION DEFINITIONS
 * ============================================================
 *
 * Each canonical question contains:
 *
 * key:
 *   stable JobVerse question identifier
 *
 * aliases:
 *   common employer wording variants
 *
 * keywords:
 *   important terms used for controlled fallback matching
 *
 * highRisk:
 *   indicates questions that should require stronger evidence
 *   before automatic reuse.
 */

const QUESTION_DEFINITIONS = [
  {
    key:
      "visa_sponsorship",

    aliases: [
      "do you require visa sponsorship",
      "will you require visa sponsorship",
      "will you now or in the future require sponsorship",
      "do you now or in the future require sponsorship",
      "will you need sponsorship",
      "do you need sponsorship",
      "require sponsorship",
      "need visa sponsorship",
      "sponsorship required",
    ],

    keywords: [
      "visa",
      "sponsorship",
      "sponsor",
    ],

    highRisk:
      true,
  },

  {
    key:
      "work_authorization",

    aliases: [
      "are you authorized to work",
      "are you legally authorized to work",
      "do you have authorization to work",
      "are you eligible to work",
      "do you have the right to work",
      "right to work",
      "work authorization",
      "legally eligible to work",
      "authorized to work in this country",
    ],

    keywords: [
      "authorized",
      "work",
      "eligible",
      "right",
    ],

    highRisk:
      true,
  },

  {
    key:
      "willing_to_relocate",

    aliases: [
      "are you willing to relocate",
      "would you be willing to relocate",
      "can you relocate",
      "open to relocation",
      "willing to relocate",
      "relocation",
    ],

    keywords: [
      "relocate",
      "relocation",
    ],

    highRisk:
      true,
  },

  {
    key:
      "notice_period",

    aliases: [
      "what is your notice period",
      "how much notice do you need",
      "when can you start",
      "when are you available to start",
      "earliest start date",
      "available start date",
      "availability to start",
      "notice period",
    ],

    keywords: [
      "notice",
      "start",
      "available",
      "availability",
    ],

    highRisk:
      true,
  },

  {
    key:
      "salary_expectation",

    aliases: [
      "what are your salary expectations",
      "what is your expected salary",
      "expected salary",
      "desired salary",
      "salary expectation",
      "salary expectations",
      "expected compensation",
      "desired compensation",
      "compensation expectation",
    ],

    keywords: [
      "salary",
      "compensation",
      "expected",
      "desired",
    ],

    highRisk:
      true,
  },

  {
    key:
      "remote_preference",

    aliases: [
      "do you prefer remote work",
      "remote work preference",
      "preferred work model",
      "preferred working model",
      "work arrangement preference",
      "remote preference",
      "hybrid or remote",
      "preferred workplace model",
    ],

    keywords: [
      "remote",
      "hybrid",
      "work",
      "preference",
      "model",
    ],

    highRisk:
      false,
  },

  {
    key:
      "years_python",

    aliases: [
      "how many years of python experience do you have",
      "years of python experience",
      "python years of experience",
      "how long have you used python",
      "python experience",
    ],

    keywords: [
      "python",
      "experience",
      "years",
    ],

    highRisk:
      false,
  },

  {
    key:
      "years_javascript",

    aliases: [
      "how many years of javascript experience do you have",
      "years of javascript experience",
      "javascript years of experience",
      "how long have you used javascript",
      "javascript experience",
    ],

    keywords: [
      "javascript",
      "experience",
      "years",
    ],

    highRisk:
      false,
  },

  {
    key:
      "years_nodejs",

    aliases: [
      "how many years of node js experience do you have",
      "years of node js experience",
      "node js experience",
      "nodejs experience",
      "how long have you used node js",
    ],

    keywords: [
      "node",
      "nodejs",
      "experience",
      "years",
    ],

    highRisk:
      false,
  },

  {
    key:
      "years_react",

    aliases: [
      "how many years of react experience do you have",
      "years of react experience",
      "react years of experience",
      "react experience",
      "how long have you used react",
    ],

    keywords: [
      "react",
      "experience",
      "years",
    ],

    highRisk:
      false,
  },
];

/*
 * ============================================================
 * MATCH THRESHOLDS
 * ============================================================
 *
 * We deliberately use stricter thresholds for high-risk
 * questions such as:
 *
 * - work authorization
 * - sponsorship
 * - salary
 * - relocation
 *
 * These should not be matched loosely.
 */

const HIGH_CONFIDENCE_THRESHOLD =
  0.9;

const STANDARD_MATCH_THRESHOLD =
  0.72;

const HIGH_RISK_MATCH_THRESHOLD =
  0.85;

/*
 * ============================================================
 * STRING NORMALIZATION
 * ============================================================
 */

function normalizeText(
  value
) {
  return String(
    value || ""
  )
    .toLowerCase()
    .replace(
      /[^a-z0-9\s]/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

/*
 * ============================================================
 * TOKENIZATION
 * ============================================================
 */

function tokenize(
  value
) {
  const normalized =
    normalizeText(
      value
    );

  if (!normalized) {
    return [];
  }

  return normalized
    .split(" ")
    .filter(Boolean);
}

/*
 * ============================================================
 * UNIQUE VALUES
 * ============================================================
 */

function unique(
  values
) {
  return [
    ...new Set(
      values
    ),
  ];
}

/*
 * ============================================================
 * TOKEN OVERLAP SCORE
 * ============================================================
 *
 * Returns:
 *
 * 0.0 → no similarity
 * 1.0 → all important terms match
 *
 * We use this only after exact alias checks.
 */

function calculateTokenOverlap(
  question,
  target
) {
  const questionTokens =
    unique(
      tokenize(
        question
      )
    );

  const targetTokens =
    unique(
      tokenize(
        target
      )
    );

  if (
    questionTokens.length ===
      0 ||
    targetTokens.length ===
      0
  ) {
    return 0;
  }

  const targetSet =
    new Set(
      targetTokens
    );

  const matching =
    questionTokens.filter(
      (token) =>
        targetSet.has(
          token
        )
    );

  /*
   * Compare against the shorter phrase so an employer adding
   * extra wording does not unnecessarily destroy confidence.
   */
  const denominator =
    Math.min(
      questionTokens.length,
      targetTokens.length
    );

  if (
    denominator ===
    0
  ) {
    return 0;
  }

  return (
    matching.length /
    denominator
  );
}

/*
 * ============================================================
 * KEYWORD MATCH SCORE
 * ============================================================
 */

function calculateKeywordScore(
  question,
  keywords
) {
  const questionTokens =
    new Set(
      tokenize(
        question
      )
    );

  const normalizedKeywords =
    unique(
      (keywords || [])
        .map(
          (keyword) =>
            normalizeText(
              keyword
            )
        )
        .filter(Boolean)
    );

  if (
    normalizedKeywords.length ===
    0
  ) {
    return 0;
  }

  let matches =
    0;

  for (
    const keyword of
    normalizedKeywords
  ) {
    if (
      questionTokens.has(
        keyword
      )
    ) {
      matches +=
        1;
    }
  }

  return (
    matches /
    normalizedKeywords.length
  );
}

/*
 * ============================================================
 * FIND DEFINITION
 * ============================================================
 */

function getQuestionDefinition(
  questionKey
) {
  const normalizedKey =
    normalizeQuestionKey(
      questionKey
    );

  return (
    QUESTION_DEFINITIONS.find(
      (definition) =>
        definition.key ===
        normalizedKey
    ) ||
    null
  );
}

/*
 * ============================================================
 * EXACT ALIAS MATCH
 * ============================================================
 */

function findExactAliasMatch(
  questionText
) {
  const normalizedQuestion =
    normalizeText(
      questionText
    );

  if (
    !normalizedQuestion
  ) {
    return null;
  }

  for (
    const definition of
    QUESTION_DEFINITIONS
  ) {
    for (
      const alias of
      definition.aliases
    ) {
      if (
        normalizeText(
          alias
        ) ===
        normalizedQuestion
      ) {
        return {
          definition,

          confidence:
            1,

          matchType:
            "exact_alias",
        };
      }
    }
  }

  return null;
}

/*
 * ============================================================
 * CANONICAL KEY MATCH
 * ============================================================
 *
 * A form field might already use a useful machine-readable
 * identifier.
 */

function findCanonicalKeyMatch(
  questionText
) {
  const generatedKey =
    normalizeQuestionKey(
      questionText
    );

  if (
    !generatedKey
  ) {
    return null;
  }

  const definition =
    QUESTION_DEFINITIONS.find(
      (item) =>
        item.key ===
        generatedKey
    );

  if (
    !definition
  ) {
    return null;
  }

  return {
    definition,

    confidence:
      1,

    matchType:
      "canonical_key",
  };
}

/*
 * ============================================================
 * FUZZY DEFINITION SCORE
 * ============================================================
 *
 * Deterministic only.
 *
 * No AI call is made here.
 */

function scoreDefinition(
  questionText,
  definition
) {
  let bestAliasScore =
    0;

  for (
    const alias of
    definition.aliases
  ) {
    const score =
      calculateTokenOverlap(
        questionText,
        alias
      );

    bestAliasScore =
      Math.max(
        bestAliasScore,
        score
      );
  }

  const keywordScore =
    calculateKeywordScore(
      questionText,
      definition.keywords
    );

  /*
   * Alias similarity has more weight because phrase-level
   * wording is usually more informative than individual tokens.
   */
  const confidence =
    (
      bestAliasScore *
      0.7
    ) +
    (
      keywordScore *
      0.3
    );

  return Math.min(
    Math.max(
      confidence,
      0
    ),
    1
  );
}

/*
 * ============================================================
 * MATCH QUESTION
 * ============================================================
 */

function matchQuestion(
  questionText
) {
  const normalizedQuestion =
    normalizeText(
      questionText
    );

  if (
    !normalizedQuestion
  ) {
    return {
      matched:
        false,

      questionKey:
        null,

      confidence:
        0,

      matchType:
        "none",

      requiresHumanReview:
        true,

      reason:
        "Question text is empty.",
    };
  }

  /*
   * ----------------------------------------------------------
   * 1. EXACT CANONICAL KEY
   * ----------------------------------------------------------
   */

  const canonicalMatch =
    findCanonicalKeyMatch(
      normalizedQuestion
    );

  if (
    canonicalMatch
  ) {
    return buildMatchResult(
      canonicalMatch
    );
  }

  /*
   * ----------------------------------------------------------
   * 2. EXACT ALIAS
   * ----------------------------------------------------------
   */

  const exactMatch =
    findExactAliasMatch(
      normalizedQuestion
    );

  if (
    exactMatch
  ) {
    return buildMatchResult(
      exactMatch
    );
  }

  /*
   * ----------------------------------------------------------
   * 3. DETERMINISTIC SIMILARITY
   * ----------------------------------------------------------
   */

  const scored =
    QUESTION_DEFINITIONS
      .map(
        (definition) => ({
          definition,

          confidence:
            scoreDefinition(
              normalizedQuestion,
              definition
            ),

          matchType:
            "token_similarity",
        })
      )
      .sort(
        (a, b) =>
          b.confidence -
          a.confidence
      );

  const best =
    scored[0];

  if (
    !best
  ) {
    return {
      matched:
        false,

      questionKey:
        null,

      confidence:
        0,

      matchType:
        "none",

      requiresHumanReview:
        true,

      reason:
        "No question definition matched.",
    };
  }

  const threshold =
    best.definition
      .highRisk
      ? HIGH_RISK_MATCH_THRESHOLD
      : STANDARD_MATCH_THRESHOLD;

  if (
    best.confidence <
    threshold
  ) {
    return {
      matched:
        false,

      questionKey:
        null,

      confidence:
        Number(
          best.confidence
            .toFixed(
              3
            )
        ),

      matchType:
        best.matchType,

      possibleQuestionKey:
        best.definition.key,

      requiresHumanReview:
        true,

      reason:
        `Best match confidence ${best.confidence.toFixed(
          2
        )} is below the required threshold ${threshold.toFixed(
          2
        )}.`,
    };
  }

  return buildMatchResult(
    best
  );
}

/*
 * ============================================================
 * BUILD MATCH RESULT
 * ============================================================
 */

function buildMatchResult(
  match
) {
  const definition =
    match.definition;

  const confidence =
    Number(
      Number(
        match.confidence ||
        0
      ).toFixed(
        3
      )
    );

  const highRisk =
    Boolean(
      definition.highRisk ||
      HIGH_RISK_QUESTION_KEYS.has(
        definition.key
      )
    );

  /*
   * Even a recognized high-risk field should require review
   * unless the match itself is extremely strong.
   */
  const requiresHumanReview =
    highRisk &&
    confidence <
      HIGH_CONFIDENCE_THRESHOLD;

  return {
    matched:
      true,

    questionKey:
      definition.key,

    confidence,

    matchType:
      match.matchType,

    highRisk,

    requiresHumanReview,

    reason:
      requiresHumanReview
        ? "High-risk question matched, but confidence is not high enough for automatic use."
        : "Question matched a canonical JobVerse application question.",
  };
}

/*
 * ============================================================
 * MATCH MANY QUESTIONS
 * ============================================================
 *
 * Useful when a form contains multiple fields.
 */

function matchQuestions(
  questions
) {
  if (
    !Array.isArray(
      questions
    )
  ) {
    throw new Error(
      "questions must be an array"
    );
  }

  return questions.map(
    (question) => {
      if (
        typeof question ===
        "string"
      ) {
        return {
          questionText:
            question,

          ...matchQuestion(
            question
          ),
        };
      }

      const questionText =
        String(
          question?.questionText ||
          question?.label ||
          question?.text ||
          ""
        ).trim();

      return {
        ...question,

        questionText,

        ...matchQuestion(
          questionText
        ),
      };
    }
  );
}

/*
 * ============================================================
 * CHECK AUTO-USE ELIGIBILITY
 * ============================================================
 *
 * This function only considers question matching confidence.
 *
 * Candidate answer verification is checked separately by
 * candidateAnswerService.requiresHumanReview().
 */

function canUseMatchAutomatically(
  match
) {
  if (
    !match ||
    !match.matched
  ) {
    return false;
  }

  if (
    match.requiresHumanReview
  ) {
    return false;
  }

  if (
    Number(
      match.confidence ||
      0
    ) <
    STANDARD_MATCH_THRESHOLD
  ) {
    return false;
  }

  return true;
}

/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  QUESTION_DEFINITIONS,

  matchQuestion,
  matchQuestions,

  getQuestionDefinition,
  canUseMatchAutomatically,

  normalizeText,
  tokenize,
  calculateTokenOverlap,
  calculateKeywordScore,

  HIGH_CONFIDENCE_THRESHOLD,
  STANDARD_MATCH_THRESHOLD,
  HIGH_RISK_MATCH_THRESHOLD,
};