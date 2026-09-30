const { randomUUID } = require("crypto");

const {
  readSheet,
  upsertRows,
} = require("../googleSheets");

const {
  ensureApplicationSheets,
} = require("./applicationSheets");

/*
 * ============================================================
 * CANDIDATE ANSWER SERVICE
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * This service is the centralized storage and retrieval layer
 * for reusable candidate answers used during job applications.
 *
 * Examples:
 *
 * - work authorization
 * - visa sponsorship
 * - notice period
 * - relocation
 * - salary expectation
 * - years of experience
 * - work-model preference
 *
 * WHY THIS SERVICE EXISTS
 * ------------------------------------------------------------
 *
 * Application channels should NOT independently invent,
 * duplicate, or permanently store candidate answers.
 *
 * For example:
 *
 * googleFormApplication.js
 * atsApplication.js
 * linkedinApplication.js
 *
 * should all obtain reusable candidate answers through this
 * service.
 *
 * This provides:
 *
 * - one source of truth
 * - consistent answers
 * - verification tracking
 * - source tracking
 * - less duplicated logic
 *
 * IMPORTANT SAFETY RULE
 * ------------------------------------------------------------
 *
 * This service stores answers.
 *
 * It does NOT invent missing answers.
 *
 * Sensitive, legal, employment-eligibility, identity, salary,
 * sponsorship, or declaration questions should preferably come
 * directly from the candidate or another verified source.
 * ============================================================
 */

/*
 * ============================================================
 * CONSTANTS
 * ============================================================
 */

const CANDIDATE_ANSWERS_SHEET =
  "Candidate Application Answers";

/*
 * Supported answer storage types.
 *
 * Keeping these limited makes downstream application form
 * mapping much more predictable.
 */
const VALID_ANSWER_TYPES =
  new Set([
    "string",
    "boolean",
    "number",
    "date",
    "choice",
  ]);

/*
 * Trusted/recognized answer origins.
 *
 * "ai_inferred" exists for non-sensitive convenience fields,
 * but it must NEVER automatically become verified.
 */
const VALID_ANSWER_SOURCES =
  new Set([
    "candidate",
    "cv",
    "profile",
    "form_response",
    "ai_inferred",
  ]);

/*
 * These question types should not normally rely on AI guesses.
 *
 * We keep them here so later form-processing services can make
 * safer decisions.
 */
const HIGH_RISK_QUESTION_KEYS =
  new Set([
    "work_authorization",
    "visa_sponsorship",
    "salary_expectation",
    "notice_period",
    "willing_to_relocate",
    "criminal_record",
    "legal_declaration",
    "identity_confirmation",
  ]);

/*
 * ============================================================
 * BASIC HELPERS
 * ============================================================
 */

function nowIso() {
  return new Date()
    .toISOString();
}

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
 * QUESTION KEY NORMALIZATION
 * ============================================================
 *
 * Convert:
 *
 * "Visa Sponsorship?"
 *
 * into:
 *
 * "visa_sponsorship"
 *
 * This keeps keys stable across application platforms.
 */

function normalizeQuestionKey(
  value
) {
  const raw =
    normalizeLower(
      value
    );

  if (!raw) {
    return "";
  }

  return raw
    .replace(
      /[^a-z0-9]+/g,
      "_"
    )
    .replace(
      /^_+|_+$/g,
      ""
    )
    .replace(
      /_+/g,
      "_"
    );
}

/*
 * ============================================================
 * BOOLEAN NORMALIZATION
 * ============================================================
 */

function normalizeBoolean(
  value
) {
  if (
    typeof value ===
    "boolean"
  ) {
    return value;
  }

  const normalized =
    normalizeLower(
      value
    );

  if (
    [
      "true",
      "yes",
      "y",
      "1",
    ].includes(
      normalized
    )
  ) {
    return true;
  }

  if (
    [
      "false",
      "no",
      "n",
      "0",
    ].includes(
      normalized
    )
  ) {
    return false;
  }

  throw new Error(
    `Invalid boolean value: ${value}`
  );
}

/*
 * ============================================================
 * ANSWER TYPE NORMALIZATION
 * ============================================================
 */

function normalizeAnswerType(
  answerType
) {
  const normalized =
    normalizeLower(
      answerType ||
      "string"
    );

  if (
    !VALID_ANSWER_TYPES.has(
      normalized
    )
  ) {
    throw new Error(
      `Invalid answer type: ${answerType}`
    );
  }

  return normalized;
}

/*
 * ============================================================
 * ANSWER SOURCE NORMALIZATION
 * ============================================================
 */

function normalizeAnswerSource(
  source
) {
  const normalized =
    normalizeLower(
      source ||
      "candidate"
    );

  if (
    !VALID_ANSWER_SOURCES.has(
      normalized
    )
  ) {
    throw new Error(
      `Invalid answer source: ${source}`
    );
  }

  return normalized;
}

/*
 * ============================================================
 * ANSWER VALUE SERIALIZATION
 * ============================================================
 *
 * Google Sheets ultimately stores scalar values.
 *
 * We normalize them consistently before saving.
 */

function serializeAnswer(
  answer,
  answerType
) {
  switch (
    answerType
  ) {
    case "boolean":
      return normalizeBoolean(
        answer
      )
        ? "true"
        : "false";

    case "number": {
      const number =
        Number(
          answer
        );

      if (
        !Number.isFinite(
          number
        )
      ) {
        throw new Error(
          `Invalid numeric answer: ${answer}`
        );
      }

      return String(
        number
      );
    }

    case "date": {
      const raw =
        normalizeString(
          answer
        );

      const parsed =
        new Date(
          raw
        );

      if (
        Number.isNaN(
          parsed.getTime()
        )
      ) {
        throw new Error(
          `Invalid date answer: ${answer}`
        );
      }

      return parsed
        .toISOString()
        .slice(
          0,
          10
        );
    }

    case "choice":
    case "string":
    default:
      return normalizeString(
        answer
      );
  }
}

/*
 * ============================================================
 * ANSWER DESERIALIZATION
 * ============================================================
 *
 * Downstream services should receive typed values rather than
 * always receiving raw spreadsheet strings.
 */

function deserializeAnswer(
  answer,
  answerType
) {
  switch (
    answerType
  ) {
    case "boolean":
      try {
        return normalizeBoolean(
          answer
        );
      } catch (_) {
        return false;
      }

    case "number": {
      const parsed =
        Number(
          answer
        );

      return Number.isFinite(
        parsed
      )
        ? parsed
        : null;
    }

    case "date":
    case "choice":
    case "string":
    default:
      return normalizeString(
        answer
      );
  }
}

/*
 * ============================================================
 * VERIFIED VALUE NORMALIZATION
 * ============================================================
 */

function normalizeVerified(
  value
) {
  if (
    typeof value ===
    "boolean"
  ) {
    return value;
  }

  const normalized =
    normalizeLower(
      value
    );

  return [
    "true",
    "yes",
    "1",
  ].includes(
    normalized
  );
}

/*
 * ============================================================
 * LIST ALL ANSWERS FOR CANDIDATE
 * ============================================================
 */

async function listCandidateAnswers(
  candidateEmail,
  {
    verifiedOnly = false,
  } = {}
) {
  await ensureApplicationSheets();

  const normalizedEmail =
    normalizeEmail(
      candidateEmail
    );

  if (!normalizedEmail) {
    throw new Error(
      "candidateEmail is required"
    );
  }

  const rows =
    await readSheet(
      CANDIDATE_ANSWERS_SHEET
    );

  let answers =
    rows.filter(
      (row) =>
        normalizeEmail(
          row.candidateEmail
        ) ===
        normalizedEmail
    );

  if (
    verifiedOnly
  ) {
    answers =
      answers.filter(
        (row) =>
          normalizeVerified(
            row.verified
          )
      );
  }

  answers.sort(
    (a, b) =>
      new Date(
        b.updatedAt ||
        b.createdAt ||
        0
      ) -
      new Date(
        a.updatedAt ||
        a.createdAt ||
        0
      )
  );

  return answers;
}

/*
 * ============================================================
 * GET ANSWER BY QUESTION KEY
 * ============================================================
 */

async function getCandidateAnswer(
  candidateEmail,
  questionKey
) {
  await ensureApplicationSheets();

  const normalizedEmail =
    normalizeEmail(
      candidateEmail
    );

  const normalizedKey =
    normalizeQuestionKey(
      questionKey
    );

  if (!normalizedEmail) {
    throw new Error(
      "candidateEmail is required"
    );
  }

  if (!normalizedKey) {
    throw new Error(
      "questionKey is required"
    );
  }

  const rows =
    await readSheet(
      CANDIDATE_ANSWERS_SHEET
    );

  return (
    rows.find(
      (row) =>
        normalizeEmail(
          row.candidateEmail
        ) ===
          normalizedEmail &&
        normalizeQuestionKey(
          row.questionKey
        ) ===
          normalizedKey
    ) ||
    null
  );
}

/*
 * ============================================================
 * GET TYPED ANSWER
 * ============================================================
 *
 * Convenience helper for form processors.
 */

async function getTypedCandidateAnswer(
  candidateEmail,
  questionKey
) {
  const row =
    await getCandidateAnswer(
      candidateEmail,
      questionKey
    );

  if (!row) {
    return null;
  }

  return {
    ...row,

    verified:
      normalizeVerified(
        row.verified
      ),

    value:
      deserializeAnswer(
        row.answer,
        normalizeAnswerType(
          row.answerType ||
          "string"
        )
      ),
  };
}

/*
 * ============================================================
 * SAVE / UPSERT ANSWER
 * ============================================================
 *
 * One row represents:
 *
 * one candidate
 * +
 * one normalized question key
 *
 * This makes updates idempotent.
 */

async function saveCandidateAnswer({
  candidateEmail,
  questionKey,
  questionText,
  answer,
  answerType = "string",
  verified = false,
  source = "candidate",
}) {
  await ensureApplicationSheets();

  const normalizedEmail =
    normalizeEmail(
      candidateEmail
    );

  if (!normalizedEmail) {
    throw new Error(
      "candidateEmail is required"
    );
  }

  const normalizedKey =
    normalizeQuestionKey(
      questionKey ||
      questionText
    );

  if (!normalizedKey) {
    throw new Error(
      "questionKey or questionText is required"
    );
  }

  const normalizedType =
    normalizeAnswerType(
      answerType
    );

  const normalizedSource =
    normalizeAnswerSource(
      source
    );

  const serializedAnswer =
    serializeAnswer(
      answer,
      normalizedType
    );

  if (
    serializedAnswer === ""
  ) {
    throw new Error(
      "Candidate answer cannot be empty"
    );
  }

  /*
   * AI-derived answers must never become verified
   * automatically.
   */
  let normalizedVerified =
    Boolean(
      verified
    );

  if (
    normalizedSource ===
    "ai_inferred"
  ) {
    normalizedVerified =
      false;
  }

  /*
   * High-risk answers should not be marked verified if their
   * source is AI inference.
   */
  if (
    HIGH_RISK_QUESTION_KEYS.has(
      normalizedKey
    ) &&
    normalizedSource ===
    "ai_inferred"
  ) {
    normalizedVerified =
      false;
  }

  const existing =
    await getCandidateAnswer(
      normalizedEmail,
      normalizedKey
    );

  const now =
    nowIso();

  /*
   * Preserve the original creation time when updating.
   */
  const row = {
    candidateEmail:
      normalizedEmail,

    questionKey:
      normalizedKey,

    questionText:
      normalizeString(
        questionText ||
        existing?.questionText ||
        normalizedKey
      ),

    answer:
      serializedAnswer,

    answerType:
      normalizedType,

    verified:
      normalizedVerified
        ? "TRUE"
        : "FALSE",

    source:
      normalizedSource,

    createdAt:
      existing?.createdAt ||
      now,

    updatedAt:
      now,
  };

  /*
   * Composite key:
   *
   * candidateEmail + questionKey
   *
   * ensures there is only one canonical answer for each
   * candidate/question combination.
   */
  await upsertRows(
    CANDIDATE_ANSWERS_SHEET,
    [
      row
    ],
    [
      "candidateEmail",
      "questionKey",
    ]
  );

  return row;
}

/*
 * ============================================================
 * VERIFY EXISTING ANSWER
 * ============================================================
 *
 * Useful when:
 *
 * - candidate confirms a previously unverified answer
 * - admin validates a stored answer
 */

async function verifyCandidateAnswer(
  candidateEmail,
  questionKey
) {
  const existing =
    await getCandidateAnswer(
      candidateEmail,
      questionKey
    );

  if (!existing) {
    throw new Error(
      "Candidate answer not found"
    );
  }

  /*
   * We do not silently convert AI inference into a verified
   * answer without explicit candidate confirmation.
   */
  if (
    normalizeAnswerSource(
      existing.source
    ) ===
    "ai_inferred"
  ) {
    throw new Error(
      "AI-inferred answers require candidate confirmation before verification"
    );
  }

  const updated = {
    ...existing,

    verified:
      "TRUE",

    updatedAt:
      nowIso(),
  };

  await upsertRows(
    CANDIDATE_ANSWERS_SHEET,
    [
      updated
    ],
    [
      "candidateEmail",
      "questionKey",
    ]
  );

  return updated;
}

/*
 * ============================================================
 * MARK ANSWER UNVERIFIED
 * ============================================================
 */

async function unverifyCandidateAnswer(
  candidateEmail,
  questionKey
) {
  const existing =
    await getCandidateAnswer(
      candidateEmail,
      questionKey
    );

  if (!existing) {
    throw new Error(
      "Candidate answer not found"
    );
  }

  const updated = {
    ...existing,

    verified:
      "FALSE",

    updatedAt:
      nowIso(),
  };

  await upsertRows(
    CANDIDATE_ANSWERS_SHEET,
    [
      updated
    ],
    [
      "candidateEmail",
      "questionKey",
    ]
  );

  return updated;
}

/*
 * ============================================================
 * FIND ANSWER BY QUESTION TEXT
 * ============================================================
 *
 * This is a basic deterministic text matcher.
 *
 * It helps forms such as:
 *
 * "Will you now or in the future require sponsorship?"
 *
 * map to a stored reusable answer when possible.
 *
 * Later we can add a separate question-matching service for
 * more advanced semantic matching.
 */

async function findCandidateAnswerByText(
  candidateEmail,
  questionText,
  {
    verifiedOnly = true,
  } = {}
) {
  const normalizedQuestion =
    normalizeLower(
      questionText
    );

  if (!normalizedQuestion) {
    return null;
  }

  const answers =
    await listCandidateAnswers(
      candidateEmail,
      {
        verifiedOnly,
      }
    );

  /*
   * Exact normalized question-text match first.
   */
  const exactMatch =
    answers.find(
      (row) =>
        normalizeLower(
          row.questionText
        ) ===
        normalizedQuestion
    );

  if (
    exactMatch
  ) {
    return exactMatch;
  }

  /*
   * Then compare normalized generated question keys.
   */
  const generatedKey =
    normalizeQuestionKey(
      questionText
    );

  return (
    answers.find(
      (row) =>
        normalizeQuestionKey(
          row.questionKey
        ) ===
        generatedKey
    ) ||
    null
  );
}

/*
 * ============================================================
 * BUILD ANSWER MAP
 * ============================================================
 *
 * Converts spreadsheet rows into:
 *
 * {
 *   visa_sponsorship: {
 *     value: false,
 *     verified: true,
 *     ...
 *   }
 * }
 *
 * This will be useful for Google Forms and ATS processors.
 */

async function buildCandidateAnswerMap(
  candidateEmail,
  {
    verifiedOnly = true,
  } = {}
) {
  const rows =
    await listCandidateAnswers(
      candidateEmail,
      {
        verifiedOnly,
      }
    );

  const answerMap =
    {};

  for (
    const row of rows
  ) {
    const questionKey =
      normalizeQuestionKey(
        row.questionKey
      );

    if (!questionKey) {
      continue;
    }

    const answerType =
      normalizeAnswerType(
        row.answerType ||
        "string"
      );

    answerMap[
      questionKey
    ] = {
      questionKey,

      questionText:
        row.questionText,

      value:
        deserializeAnswer(
          row.answer,
          answerType
        ),

      answerType,

      verified:
        normalizeVerified(
          row.verified
        ),

      source:
        row.source,

      updatedAt:
        row.updatedAt,
    };
  }

  return answerMap;
}

/*
 * ============================================================
 * CHECK WHETHER ANSWER REQUIRES HUMAN REVIEW
 * ============================================================
 *
 * Downstream form handlers can call this before automatically
 * using a stored answer.
 */

function requiresHumanReview(
  answer
) {
  if (!answer) {
    return true;
  }

  const questionKey =
    normalizeQuestionKey(
      answer.questionKey
    );

  const source =
    normalizeLower(
      answer.source
    );

  const verified =
    normalizeVerified(
      answer.verified
    );

  /*
   * Unverified answers must be reviewed.
   */
  if (!verified) {
    return true;
  }

  /*
   * AI-derived answers should be reviewed.
   */
  if (
    source ===
    "ai_inferred"
  ) {
    return true;
  }

  /*
   * Verified candidate/profile/form values are generally safe
   * for reuse.
   */
  if (
    HIGH_RISK_QUESTION_KEYS.has(
      questionKey
    )
  ) {
    return ![
      "candidate",
      "profile",
      "form_response",
    ].includes(
      source
    );
  }

  return false;
}

/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  /*
   * Core CRUD-style operations.
   */
  saveCandidateAnswer,
  getCandidateAnswer,
  getTypedCandidateAnswer,
  listCandidateAnswers,

  /*
   * Verification.
   */
  verifyCandidateAnswer,
  unverifyCandidateAnswer,

  /*
   * Matching.
   */
  findCandidateAnswerByText,
  buildCandidateAnswerMap,

  /*
   * Safety.
   */
  requiresHumanReview,

  /*
   * Utilities.
   */
  normalizeQuestionKey,
  normalizeAnswerType,
  normalizeAnswerSource,
  serializeAnswer,
  deserializeAnswer,

  /*
   * Constants exposed for future channel services.
   */
  VALID_ANSWER_TYPES,
  VALID_ANSWER_SOURCES,
  HIGH_RISK_QUESTION_KEYS,
};