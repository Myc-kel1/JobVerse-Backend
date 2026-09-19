const crypto = require("crypto");

const {
  upsertRows
} = require("../googleSheets");

const {
  extractCandidateEvidenceWithGemini
} = require("../gemini");

/*
 * ============================================================
 * CACHE VERSION
 * ============================================================
 *
 * Increment this value whenever the verified-evidence schema
 * or extraction strategy changes significantly.
 *
 * This forces old cached evidence to be regenerated even when
 * the source CV itself has not changed.
 */

const EVIDENCE_CACHE_VERSION =
  "jobverse-evidence-v2";

/*
 * ============================================================
 * EMPTY EVIDENCE
 * ============================================================
 */

const EMPTY = {
  summary: "",
  skills: [],
  experience: [],
  projects: [],
  education: [],
  certifications: [],
  achievements: [],
  jobTitles: [],
  industries: []
};

/*
 * ============================================================
 * BASIC VALIDATION
 * ============================================================
 */

function validateEvidence(value) {
  if (
    !value ||
    typeof value !== "object"
  ) {
    return false;
  }

  if (
    typeof value.summary !==
    "string"
  ) {
    return false;
  }

  const arrays = [
    "skills",
    "experience",
    "projects",
    "education",
    "certifications",
    "achievements",
    "jobTitles",
    "industries"
  ];

  for (const key of arrays) {
    if (
      !Array.isArray(value[key])
    ) {
      return false;
    }
  }

  return true;
}

/*
 * ============================================================
 * SOURCE NORMALIZATION
 * ============================================================
 *
 * Normalize harmless line-ending differences so that the
 * same document does not unnecessarily invalidate its cache.
 */

function normalizeSourceText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

/*
 * ============================================================
 * SOURCE FINGERPRINT
 * ============================================================
 *
 * The evidence hash is based on:
 *
 * - cache/schema version
 * - extracted master CV text
 * - extracted master cover-letter text
 *
 * Candidate preferences are deliberately excluded because
 * preferences are not factual evidence.
 */

function buildEvidenceHash(candidate) {
  const source = JSON.stringify({
    version:
      EVIDENCE_CACHE_VERSION,

    masterCVText:
      normalizeSourceText(
        candidate.masterCVText
      ),

    masterCoverLetterText:
      normalizeSourceText(
        candidate.masterCoverLetterText
      )
  });

  return crypto
    .createHash("sha256")
    .update(source, "utf8")
    .digest("hex");
}

/*
 * ============================================================
 * CACHED EVIDENCE PARSER
 * ============================================================
 */

function parseCachedEvidence(candidate) {
  const raw =
    candidate
      ?.verifiedEvidenceJson;

  if (!raw) {
    return null;
  }

  try {
    const parsed =
      typeof raw === "string"
        ? JSON.parse(raw)
        : raw;

    if (
      !validateEvidence(parsed)
    ) {
      return null;
    }

    return parsed;
  } catch (_) {
    return null;
  }
}

/*
 * ============================================================
 * SAFE CACHE PERSISTENCE
 * ============================================================
 *
 * IMPORTANT:
 *
 * We preserve the ENTIRE existing candidate object.
 *
 * The previous implementation sent only:
 *
 * candidateEmail
 * verifiedEvidenceJson
 * verifiedEvidenceHash
 * verifiedEvidenceUpdatedAt
 *
 * If upsertRows rewrites a complete Google Sheets row, that
 * partial object can blank unrelated candidate columns such as:
 *
 * cvFile
 * coverLetterFile
 * masterCVText
 * masterCoverLetterText
 * preferredJobTitle
 * etc.
 *
 * This version prevents that.
 */

async function saveEvidenceCache(
  candidate,
  evidence,
  evidenceHash
) {
  if (
    !candidate ||
    !candidate.candidateEmail
  ) {
    throw new Error(
      "Cannot cache candidate evidence without candidateEmail"
    );
  }

  const updatedAt =
    new Date().toISOString();

  const serializedEvidence =
    JSON.stringify(evidence);

  const updatedCandidate = {
    /*
     * Preserve every field already loaded from Candidates.
     */
    ...candidate,

    /*
     * Normalize the key used for the upsert.
     */
    candidateEmail:
      candidate.candidateEmail,

    /*
     * Add/replace only our cache fields.
     */
    verifiedEvidenceJson:
      serializedEvidence,

    verifiedEvidenceHash:
      evidenceHash,

    verifiedEvidenceUpdatedAt:
      updatedAt
  };

  await upsertRows(
    "Candidates",
    [updatedCandidate],
    ["candidateEmail"]
  );

  /*
   * Keep the in-memory object synchronized so later stages in
   * this same request immediately see the new cache.
   */
  Object.assign(
    candidate,
    {
      verifiedEvidenceJson:
        serializedEvidence,

      verifiedEvidenceHash:
        evidenceHash,

      verifiedEvidenceUpdatedAt:
        updatedAt
    }
  );

  return {
    verifiedEvidenceJson:
      serializedEvidence,

    verifiedEvidenceHash:
      evidenceHash,

    verifiedEvidenceUpdatedAt:
      updatedAt
  };
}

/*
 * ============================================================
 * CACHE VALIDITY
 * ============================================================
 */

function cacheIsValid(
  candidate,
  evidenceHash
) {
  const cachedHash =
    String(
      candidate
        ?.verifiedEvidenceHash ||
      ""
    ).trim();

  if (!cachedHash) {
    return false;
  }

  if (
    cachedHash !==
    evidenceHash
  ) {
    return false;
  }

  return Boolean(
    parseCachedEvidence(
      candidate
    )
  );
}

/*
 * ============================================================
 * EVIDENCE EXTRACTION
 * ============================================================
 */

async function extractCandidateEvidence(
  candidate,
  {
    forceRefresh = false
  } = {}
) {
  if (!candidate) {
    throw new Error(
      "Candidate is required for evidence extraction"
    );
  }

  const cvText =
    normalizeSourceText(
      candidate.masterCVText
    );

  const coverLetterText =
    normalizeSourceText(
      candidate.masterCoverLetterText
    );

  const hasCV =
    Boolean(cvText);

  const hasCoverLetter =
    Boolean(
      coverLetterText
    );

  if (
    !hasCV &&
    !hasCoverLetter
  ) {
    throw new Error(
      "Candidate has no extracted CV or cover-letter source text"
    );
  }

  const evidenceHash =
    buildEvidenceHash(
      candidate
    );

  /*
   * ==========================================================
   * CACHE HIT
   * ==========================================================
   */

  if (
    !forceRefresh &&
    cacheIsValid(
      candidate,
      evidenceHash
    )
  ) {
    const cachedEvidence =
      parseCachedEvidence(
        candidate
      );

    console.log(
      `[Candidate evidence] Cache hit for ${candidate.candidateEmail}`
    );

    console.log(
      `[Candidate evidence] ` +
      `skills=${cachedEvidence.skills.length}, ` +
      `experience=${cachedEvidence.experience.length}, ` +
      `projects=${cachedEvidence.projects.length}, ` +
      `education=${cachedEvidence.education.length}, ` +
      `certifications=${cachedEvidence.certifications.length}`
    );

    return cachedEvidence;
  }

  /*
   * ==========================================================
   * CACHE MISS
   * ==========================================================
   */

  if (forceRefresh) {
    console.log(
      `[Candidate evidence] Forced refresh for ${candidate.candidateEmail}`
    );
  } else {
    console.log(
      `[Candidate evidence] Cache miss for ${candidate.candidateEmail}; running Gemini extraction`
    );
  }

  /*
   * Gemini reads the candidate source only when necessary.
   */
  const evidence =
    await extractCandidateEvidenceWithGemini(
      candidate
    );

  if (
    !validateEvidence(evidence)
  ) {
    throw new Error(
      "Gemini returned invalid candidate evidence"
    );
  }

  /*
   * Only write the new cache AFTER Gemini succeeded.
   *
   * A failed extraction must never destroy the previous
   * candidate row or previous evidence cache.
   */
  await saveEvidenceCache(
    candidate,
    evidence,
    evidenceHash
  );

  console.log(
    `[Candidate evidence] Cached evidence for ${candidate.candidateEmail}`
  );

  console.log(
    `[Candidate evidence] ` +
    `skills=${evidence.skills.length}, ` +
    `experience=${evidence.experience.length}, ` +
    `projects=${evidence.projects.length}`
  );

  return evidence;
}

/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  EVIDENCE_CACHE_VERSION,
  EMPTY,

  validateEvidence,
  normalizeSourceText,

  buildEvidenceHash,
  parseCachedEvidence,
  cacheIsValid,

  saveEvidenceCache,
  extractCandidateEvidence
};