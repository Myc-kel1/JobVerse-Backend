const {
  randomUUID
} = require("crypto");

const {
  readSheet,
  upsertRows
} = require("../googleSheets");

/*
 * ============================================================
 * CANDIDATE EVIDENCE
 * ============================================================
 */

const {
  extractCandidateEvidence
} = require("./candidateEvidence");

/*
 * ============================================================
 * COMBINED REQUIREMENT EVALUATION
 * ============================================================
 *
 * Replaces:
 *
 * requirementAnalysis.js
 * +
 * requirementMatcher.js
 *
 * with ONE Groq call.
 */

const {
  evaluateJobRequirements
} = require("./requirementEvaluation");

/*
 * ============================================================
 * DOCUMENT GENERATORS
 * ============================================================
 */

const {
  generateTailoredCV
} = require("./cvGenerator");

const {
  generateTailoredCoverLetter
} = require("./coverLetterGenerator");

/*
 * ============================================================
 * LOCAL DETERMINISTIC VALIDATION
 * ============================================================
 *
 * Replaces documentValidator.js AI calls.
 */

const {
  validateGeneratedCV,
  validateGeneratedCoverLetter
} = require("./localDocumentValidator");

/*
 * ============================================================
 * DOCUMENT RENDERING
 * ============================================================
 */

const {
  renderCVDocx,
  renderCoverLetterDocx
} = require("./documentRenderer");

/*
 * ============================================================
 * STORAGE
 * ============================================================
 */

const {
  uploadGeneratedDocument
} = require("./documentStorage");

const {
  ensureApplicationSheets
} = require("./applicationSheets");

/*
 * ============================================================
 * GENERAL HELPERS
 * ============================================================
 */

function safeJson(value) {
  return JSON.stringify(
    value ?? []
  );
}

function parseJsonArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value) {
    return [];
  }

  try {
    const parsed =
      JSON.parse(value);

    return Array.isArray(parsed)
      ? parsed
      : [];
  } catch (_) {
    return [];
  }
}

function uniqueStrings(values) {
  return [
    ...new Set(
      (values || [])
        .map(
          (value) =>
            String(
              value || ""
            ).trim()
        )
        .filter(Boolean)
    )
  ];
}

/*
 * ============================================================
 * FINAL STATUS
 * ============================================================
 */

function getApplicationStatus(
  cvValidationStatus,
  coverValidationStatus
) {
  if (
    cvValidationStatus === "Valid" &&
    coverValidationStatus === "Valid"
  ) {
    return "Generated";
  }

  return "Rejected";
}

/*
 * ============================================================
 * CANDIDATE LOOKUP
 * ============================================================
 */

async function getCandidate(
  email
) {
  const rows =
    await readSheet(
      "Candidates"
    );

  const normalizedEmail =
    String(
      email || ""
    )
      .trim()
      .toLowerCase();

  return (
    rows.find(
      (row) =>
        String(
          row.candidateEmail ||
          ""
        )
          .trim()
          .toLowerCase() ===
        normalizedEmail
    ) ||
    null
  );
}

/*
 * ============================================================
 * JOB LOOKUP
 * ============================================================
 */

async function getJobForCandidate(
  jobId,
  candidateEmail
) {
  const [
    detailsRows,
    shortlistRows
  ] =
    await Promise.all([
      readSheet(
        "Job Details"
      ),

      readSheet(
        "Shortlisted Jobs"
      )
    ]);

  const normalizedEmail =
    String(
      candidateEmail || ""
    )
      .trim()
      .toLowerCase();

  const normalizedJobId =
    String(
      jobId || ""
    );

  const detail =
    detailsRows.find(
      (row) =>
        String(
          row.jobId || ""
        ) ===
          normalizedJobId &&
        String(
          row.candidateEmail ||
          ""
        )
          .trim()
          .toLowerCase() ===
          normalizedEmail
    );

  if (!detail) {
    return null;
  }

  const shortlist =
    shortlistRows.find(
      (row) =>
        String(
          row.jobId || ""
        ) ===
          normalizedJobId &&
        String(
          row.candidateEmail ||
          ""
        )
          .trim()
          .toLowerCase() ===
          normalizedEmail
    );

  return {
    ...detail,
    ...(shortlist || {})
  };
}

/*
 * ============================================================
 * APPLICATION PERSISTENCE
 * ============================================================
 */

async function persistApplication(
  row
) {
  await upsertRows(
    "Generated Applications",
    [row],
    ["applicationId"]
  );

  return row;
}

/*
 * ============================================================
 * CENTRALIZED FACTUAL STATE
 * ============================================================
 */

function buildMissingRequirements(
  evaluation
) {
  return (
    evaluation
      .requiredUnsupportedRequirements ||
    []
  ).map(
    (item) => ({
      requirement:
        item.requirement,

      reason:
        item.reason
    })
  );
}

function buildKeyAlignmentPoints(
  evaluation
) {
  return (
    evaluation
      .supportedRequiredRequirements ||
    []
  ).map(
    (item) => ({
      requirement:
        item.requirement,

      evidence:
        item.evidence,

      reason:
        item.reason,

      priority:
        item.priority,

      relevance:
        item.relevance,

      evidenceStrength:
        item.evidenceStrength
    })
  );
}

function buildFactualWarnings(
  evaluation
) {
  const warnings = [];

  /*
   * Fully unsupported required qualifications.
   */
  for (
    const item of
    evaluation
      .requiredUnsupportedRequirements ||
    []
  ) {
    warnings.push(
      `Unsupported required qualification: ${item.requirement}`
    );
  }

  /*
   * Partially supported required qualifications.
   */
  for (
    const item of
    evaluation
      .requiredPartialRequirements ||
    []
  ) {
    warnings.push(
      `Partially supported required qualification: ${item.requirement}`
    );
  }

  return uniqueStrings(
    warnings
  );
}

/*
 * ============================================================
 * WARNING MERGE
 * ============================================================
 */

function mergeWarnings(
  existing,
  additional
) {
  return uniqueStrings([
    ...parseJsonArray(
      existing
    ),

    ...(
      additional ||
      []
    )
  ]);
}

/*
 * ============================================================
 * MAIN APPLICATION GENERATION
 * ============================================================
 */

async function generateApplicationForJob({
  candidateEmail,
  jobId,
  applicationType = null
}) {
  /*
   * Ensure application-related sheets exist.
   */
  await ensureApplicationSheets();

  /*
   * ==========================================================
   * LOAD CANDIDATE
   * ==========================================================
   */

  const candidate =
    await getCandidate(
      candidateEmail
    );

  if (!candidate) {
    throw new Error(
      "Candidate not found"
    );
  }

  /*
   * ==========================================================
   * LOAD JOB
   * ==========================================================
   */

  const job =
    await getJobForCandidate(
      jobId,
      candidateEmail
    );

  if (!job) {
    throw new Error(
      "Full job details not found for this job. Run discovery again so Job Details contains this candidate/job combination."
    );
  }

  /*
   * ==========================================================
   * INITIAL APPLICATION RECORD
   * ==========================================================
   */

  const applicationId =
    randomUUID();

  const now =
    new Date().toISOString();

  let row = {
    applicationId,

    jobId:
      job.jobId,

    candidateEmail:
      candidate.candidateEmail,

    candidateName:
      candidate.candidateName,

    jobTitle:
      job.title,

    company:
      job.company,

    overallScore:
      job.overallScore || "",

    applicationType:
      applicationType ||
      "Standard",

    cvStatus:
      "Pending",

    coverLetterStatus:
      "Pending",

    cvFile:
      "",

    coverLetterFile:
      "",

    cvText:
      "",

    coverLetterText:
      "",

    cvValidationStatus:
      "Pending",

    coverLetterValidationStatus:
      "Pending",

    factualWarnings:
      "[]",

    missingRequirements:
      "[]",

    keyAlignmentPoints:
      "[]",

    status:
      "Generating",

    createdAt:
      now,

    updatedAt:
      now
  };

  await persistApplication(
    row
  );

  try {
    /*
     * ========================================================
     * STEP 1
     *
     * VERIFIED CANDIDATE EVIDENCE
     * ========================================================
     *
     * Normal behavior after first successful extraction:
     *
     * CACHE HIT
     *
     * Gemini only runs when:
     *
     * - no cache exists
     * - CV source changed
     * - cover-letter source changed
     * - cache version changed
     * - forceRefresh is requested elsewhere
     */

    const evidence =
      await extractCandidateEvidence(
        candidate
      );

    /*
     * ========================================================
     * STEP 2
     *
     * REQUIREMENT EXTRACTION + MATCHING
     * ========================================================
     *
     * ONE Groq call.
     *
     * This replaces:
     *
     * analyzeJobRequirements()
     *
     * +
     *
     * matchEvidenceToRequirements()
     */

    console.log(
      "[Application] Evaluating job requirements and candidate match"
    );

    const evaluation =
      await evaluateJobRequirements(
        job,
        evidence,
        applicationType
      );

    /*
     * Store authoritative application type.
     */
    row.applicationType =
      evaluation.applicationType ||
      applicationType ||
      "Standard";

    /*
     * One authoritative source for all factual qualification
     * state.
     */
    row.missingRequirements =
      safeJson(
        buildMissingRequirements(
          evaluation
        )
      );

    row.keyAlignmentPoints =
      safeJson(
        buildKeyAlignmentPoints(
          evaluation
        )
      );

    row.factualWarnings =
      safeJson(
        buildFactualWarnings(
          evaluation
        )
      );

    row.updatedAt =
      new Date().toISOString();

    await persistApplication(
      row
    );

    /*
     * ========================================================
     * STEP 3
     *
     * CV GENERATION
     * ========================================================
     *
     * Groq call #2.
     *
     * evaluation is deliberately supplied as both:
     *
     * requirements
     * requirementMatch
     *
     * because the combined evaluator contains BOTH structures.
     *
     * This keeps the existing cvGenerator.js contract intact.
     */

    row.cvStatus =
      "Generating";

    row.updatedAt =
      new Date().toISOString();

    await persistApplication(
      row
    );

    console.log(
      "[Application] Generating tailored CV"
    );

    let cv =
      await generateTailoredCV(
        candidate,
        evidence,

        evaluation,
        evaluation,

        job,

        row.applicationType
      );

    /*
     * ========================================================
     * STEP 4
     *
     * LOCAL CV VALIDATION
     * ========================================================
     *
     * ZERO AI calls.
     */

    let cvValidation =
      validateGeneratedCV(
        cv,
        evidence,
        evaluation
      );

    /*
     * If deterministic validation finds an actual unsupported
     * claim, allow ONE correction attempt.
     *
     * This may create one additional Groq call only on the
     * exceptional path.
     */

    if (
      !cvValidation.valid
    ) {
      console.warn(
        "[Local CV validation] First CV failed:",
        cvValidation
          .unsupportedClaims
      );

      console.log(
        "[Application] Regenerating CV with local validation feedback"
      );

      cv =
        await generateTailoredCV(
          candidate,
          evidence,

          evaluation,
          evaluation,

          job,

          row.applicationType,

          cvValidation
        );

      cvValidation =
        validateGeneratedCV(
          cv,
          evidence,
          evaluation
        );
    }

    /*
     * ========================================================
     * FINAL CV VALIDATION FAILURE
     * ========================================================
     */

    if (
      !cvValidation.valid
    ) {
      row.cvStatus =
        "ValidationFailed";

      row.cvValidationStatus =
        "Invalid";

      row.cvText =
        JSON.stringify(cv);

      row.factualWarnings =
        safeJson(
          mergeWarnings(
            row.factualWarnings,
            cvValidation
              .unsupportedClaims
          )
        );

      row.status =
        "Rejected";

      row.updatedAt =
        new Date().toISOString();

      await persistApplication(
        row
      );

      return row;
    }

    /*
     * CV passed.
     */

    row.cvStatus =
      "Validated";

    row.cvValidationStatus =
      "Valid";

    row.cvText =
      JSON.stringify(cv);

    row.updatedAt =
      new Date().toISOString();

    await persistApplication(
      row
    );

    /*
     * ========================================================
     * STEP 5
     *
     * COVER LETTER GENERATION
     * ========================================================
     *
     * Groq call #3.
     */

    row.coverLetterStatus =
      "Generating";

    row.updatedAt =
      new Date().toISOString();

    await persistApplication(
      row
    );

    console.log(
      "[Application] Generating tailored cover letter"
    );

    let cover =
      await generateTailoredCoverLetter(
        candidate,
        evidence,

        evaluation,
        evaluation,

        job,

        row.applicationType
      );

    /*
     * ========================================================
     * STEP 6
     *
     * LOCAL COVER-LETTER VALIDATION
     * ========================================================
     *
     * ZERO AI calls.
     */

    let coverValidation =
      validateGeneratedCoverLetter(
        cover,
        evidence,
        evaluation
      );

    /*
     * One exceptional correction attempt when local validation
     * detects an actual unsupported claim.
     */

    if (
      !coverValidation.valid
    ) {
      console.warn(
        "[Local cover validation] First cover letter failed:",
        coverValidation
          .unsupportedClaims
      );

      console.log(
        "[Application] Regenerating cover letter with local validation feedback"
      );

      cover =
        await generateTailoredCoverLetter(
          candidate,
          evidence,

          evaluation,
          evaluation,

          job,

          row.applicationType,

          coverValidation
        );

      coverValidation =
        validateGeneratedCoverLetter(
          cover,
          evidence,
          evaluation
        );
    }

    /*
     * ========================================================
     * FINAL COVER VALIDATION FAILURE
     * ========================================================
     */

    if (
      !coverValidation.valid
    ) {
      row.coverLetterStatus =
        "ValidationFailed";

      row.coverLetterValidationStatus =
        "Invalid";

      row.coverLetterText =
        cover.coverLetter ||
        "";

      row.factualWarnings =
        safeJson(
          mergeWarnings(
            row.factualWarnings,
            coverValidation
              .unsupportedClaims
          )
        );

      row.status =
        "Rejected";

      row.updatedAt =
        new Date().toISOString();

      await persistApplication(
        row
      );

      return row;
    }

    /*
     * Cover passed.
     */

    row.coverLetterStatus =
      "Validated";

    row.coverLetterValidationStatus =
      "Valid";

    row.coverLetterText =
      cover.coverLetter;

    row.updatedAt =
      new Date().toISOString();

    await persistApplication(
      row
    );

    /*
     * ========================================================
     * STEP 7
     *
     * RENDER DOCUMENTS
     * ========================================================
     */

    console.log(
      "[Application] Rendering DOCX files"
    );

    const cvBuffer =
      await renderCVDocx(
        candidate,
        cv
      );

    const coverBuffer =
      await renderCoverLetterDocx(
        candidate,
        job,
        cover
      );

    /*
     * ========================================================
     * SAFE FILENAMES
     * ========================================================
     */

    const safeName =
      String(
        candidate.candidateName ||
        "Candidate"
      ).replace(
        /[^a-z0-9-_]+/gi,
        "_"
      );

    const safeJob =
      String(
        job.title ||
        "Role"
      ).replace(
        /[^a-z0-9-_]+/gi,
        "_"
      );

    /*
     * ========================================================
     * STEP 8
     *
     * UPLOAD DOCUMENTS
     * ========================================================
     */

    console.log(
      "[Application] Uploading generated documents"
    );

    const [
      cvFile,
      coverLetterFile
    ] =
      await Promise.all([
        uploadGeneratedDocument({
          buffer:
            cvBuffer,

          fileName:
            `${safeName}_${safeJob}_CV.docx`,

          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        }),

        uploadGeneratedDocument({
          buffer:
            coverBuffer,

          fileName:
            `${safeName}_${safeJob}_Cover_Letter.docx`,

          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        })
      ]);

    /*
     * ========================================================
     * STEP 9
     *
     * FINAL SUCCESS STATE
     * ========================================================
     */

    row.cvStatus =
      "Generated";

    row.coverLetterStatus =
      "Generated";

    row.cvFile =
      cvFile.url;

    row.coverLetterFile =
      coverLetterFile.url;

    row.cvText =
      JSON.stringify(cv);

    row.coverLetterText =
      cover.coverLetter;

    row.cvValidationStatus =
      "Valid";

    row.coverLetterValidationStatus =
      "Valid";

    /*
     * Rebuild authoritative fields from the exact same
     * combined evaluation before final persistence.
     */

    row.missingRequirements =
      safeJson(
        buildMissingRequirements(
          evaluation
        )
      );

    row.keyAlignmentPoints =
      safeJson(
        buildKeyAlignmentPoints(
          evaluation
        )
      );

    row.factualWarnings =
      safeJson(
        buildFactualWarnings(
          evaluation
        )
      );

    row.status =
      getApplicationStatus(
        row.cvValidationStatus,
        row.coverLetterValidationStatus
      );

    row.updatedAt =
      new Date().toISOString();

    await persistApplication(
      row
    );

    console.log(
      `[Application] Generation completed successfully: ${applicationId}`
    );

    return row;
  } catch (err) {
    /*
     * ========================================================
     * RUNTIME FAILURE
     * ========================================================
     */

    console.error(
      "Application generation error:",
      err
    );

    row.status =
      "Rejected";

    /*
     * Mark whichever stage was still active.
     */

    if (
      row.cvStatus ===
        "Pending" ||
      row.cvStatus ===
        "Generating"
    ) {
      row.cvStatus =
        "Failed";
    }

    if (
      row.coverLetterStatus ===
        "Pending" ||
      row.coverLetterStatus ===
        "Generating"
    ) {
      row.coverLetterStatus =
        "Failed";
    }

    /*
     * Preserve existing authoritative warnings instead of
     * destroying them with the runtime error.
     */

    row.factualWarnings =
      safeJson(
        mergeWarnings(
          row.factualWarnings,

          [
            `Generation error: ${
              err?.message ||
              String(err)
            }`
          ]
        )
      );

    row.updatedAt =
      new Date().toISOString();

    await persistApplication(
      row
    );

    throw err;
  }
}

/*
 * ============================================================
 * LIST GENERATED APPLICATIONS
 * ============================================================
 */

async function listGeneratedApplications(
  candidateEmail,
  {
    status,
    limit = 50
  } = {}
) {
  let rows =
    await readSheet(
      "Generated Applications"
    );

  const normalizedEmail =
    String(
      candidateEmail || ""
    )
      .trim()
      .toLowerCase();

  rows =
    rows.filter(
      (row) =>
        String(
          row.candidateEmail ||
          ""
        )
          .trim()
          .toLowerCase() ===
        normalizedEmail
    );

  if (status) {
    const normalizedStatus =
      String(status)
        .trim()
        .toLowerCase();

    rows =
      rows.filter(
        (row) =>
          String(
            row.status ||
            ""
          )
            .trim()
            .toLowerCase() ===
          normalizedStatus
      );
  }

  rows.sort(
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

  const safeLimit =
    Math.min(
      Math.max(
        Number(limit) ||
        50,
        1
      ),
      100
    );

  return rows.slice(
    0,
    safeLimit
  );
}

/*
 * ============================================================
 * GET GENERATED APPLICATION
 * ============================================================
 */

async function getGeneratedApplication(
  applicationId
) {
  const rows =
    await readSheet(
      "Generated Applications"
    );

  return (
    rows.find(
      (row) =>
        String(
          row.applicationId ||
          ""
        ) ===
        String(
          applicationId ||
          ""
        )
    ) ||
    null
  );
}

/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  generateApplicationForJob,

  listGeneratedApplications,
  getGeneratedApplication,

  getCandidate,
  getJobForCandidate,

  buildFactualWarnings,
  buildMissingRequirements,
  buildKeyAlignmentPoints,

  mergeWarnings
};