const { randomUUID } = require("crypto");

const {
  readSheet,
  upsertRows,
} = require("../googleSheets");

/*
 * ============================================================
 * CANDIDATE EVIDENCE
 * ============================================================
 */

const {
  extractCandidateEvidence,
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
  evaluateJobRequirements,
} = require("./requirementEvaluation");

/*
 * ============================================================
 * DOCUMENT GENERATORS
 * ============================================================
 */

const {
  generateTailoredCV,
} = require("./cvGenerator");

const {
  generateTailoredCoverLetter,
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
  validateGeneratedCoverLetter,
} = require("./localDocumentValidator");

/*
 * ============================================================
 * DOCUMENT RENDERING
 * ============================================================
 */

const {
  renderCVDocx,
  renderCoverLetterDocx,
} = require("./documentRenderer");

/*
 * ============================================================
 * STORAGE
 * ============================================================
 */

const {
  uploadGeneratedDocument,
} = require("./documentStorage");

const {
  ensureApplicationSheets,
} = require("./applicationSheets");

/*
 * ============================================================
 * APPLICATION ELIGIBILITY / LIFECYCLE POLICY
 * ============================================================
 *
 * All review/workspace/execution eligibility rules live in one
 * central policy module.
 *
 * applicationService.js performs persistence and lifecycle
 * operations, while applicationEligibilityService.js decides
 * whether those operations are valid.
 *
 * This prevents lifecycle rules from being duplicated across:
 *
 * - API routes
 * - frontend components
 * - execution services
 * - generation services
 */

const {
  APPLICATION_STATUSES,
  EXECUTION_STATUSES,

  canEnterReview,
  isApplicationWorkspaceEligible,

  assertApplicationStatusTransition,

  getApplicationEligibilitySummary
} = require(
  "./applicationEligibilityService"
);

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
        .map((value) =>
          String(value || "").trim()
        )
        .filter(Boolean)
    ),
  ];
}

/*
 * ============================================================
 * APPLICATION NORMALIZATION HELPERS
 * ============================================================
 *
 * These helpers keep candidate/application comparisons
 * consistent throughout this service.
 */

function normalizeEmail(
  value
) {
  return String(
    value || ""
  )
    .trim()
    .toLowerCase();
}


function normalizeId(
  value
) {
  return String(
    value || ""
  ).trim();
}


function normalizeStatus(
  value
) {
  return String(
    value || ""
  )
    .trim()
    .toLowerCase();
}


/*
 * ============================================================
 * SAFE LIMIT
 * ============================================================
 *
 * Prevent API callers from requesting unexpectedly large
 * spreadsheet result sets.
 */

function normalizeListLimit(
  value,
  {
    defaultValue = 50,
    maxValue = 100
  } = {}
) {
  const parsed =
    Number(
      value
    );

  if (
    !Number.isFinite(
      parsed
    ) ||
    parsed <= 0
  ) {
    return defaultValue;
  }

  return Math.min(
    Math.floor(
      parsed
    ),
    maxValue
  );
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeId(value) {
  return String(value || "")
    .trim();
}

/*
 * ============================================================
 * APPLICATION ELIGIBILITY ENRICHMENT
 * ============================================================
 *
 * The frontend should not recreate lifecycle rules itself.
 *
 * Instead, when needed, the backend can return:
 *
 * application.eligibility.canEnterReview
 * application.eligibility.visibleInApplications
 * application.eligibility.canApprove
 * application.eligibility.canExecute
 *
 * This keeps React focused on presentation rather than domain
 * policy.
 */

function attachApplicationEligibility(
  application
) {
  if (
    !application
  ) {
    return null;
  }

  return {
    ...application,

    eligibility:
      getApplicationEligibilitySummary(
        application
      )
  };
}

/*
 * ============================================================
 * FINAL GENERATION STATUS
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

async function getCandidate(email) {
  const rows =
    await readSheet(
      "Candidates"
    );

  const normalizedEmail =
    normalizeEmail(email);

  return (
    rows.find(
      (row) =>
        normalizeEmail(
          row.candidateEmail
        ) === normalizedEmail
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
    shortlistRows,
  ] =
    await Promise.all([
      readSheet(
        "Job Details"
      ),

      readSheet(
        "Shortlisted Jobs"
      ),
    ]);

  const normalizedEmail =
    normalizeEmail(
      candidateEmail
    );

  const normalizedJobId =
    normalizeId(
      jobId
    );

  const detail =
    detailsRows.find(
      (row) =>
        normalizeId(
          row.jobId
        ) === normalizedJobId &&
        normalizeEmail(
          row.candidateEmail
        ) === normalizedEmail
    );

  if (!detail) {
    return null;
  }

  const shortlist =
    shortlistRows.find(
      (row) =>
        normalizeId(
          row.jobId
        ) === normalizedJobId &&
        normalizeEmail(
          row.candidateEmail
        ) === normalizedEmail
    );

  /*
   * Job Details is the main source of the full job.
   * Shortlisted Jobs is merged on top so stored shortlist
   * information such as scores/status remains available.
   */
  return {
    ...detail,
    ...(shortlist || {}),
  };
}

/*
 * ============================================================
 * APPLICATION PERSISTENCE
 * ============================================================
 */

async function persistApplication(row) {
  await upsertRows(
    "Generated Applications",
    [row],
    ["applicationId"]
  );

  return row;
}

/*
 * ============================================================
 * EXISTING APPLICATION LOOKUP
 * ============================================================
 *
 * Prevent accidental duplicate generation for a candidate/job
 * combination that already has a usable generated application.
 *
 * Rejected applications are intentionally excluded so a failed
 * generation may be retried.
 */

async function findExistingApplication(
  candidateEmail,
  jobId
) {
  const rows =
    await readSheet(
      "Generated Applications"
    );

  const normalizedEmail =
    normalizeEmail(
      candidateEmail
    );

  const normalizedJobId =
    normalizeId(
      jobId
    );

  /*
   * These statuses indicate that generation already succeeded
   * or the application has progressed beyond generation.
   */
  const reusableStatuses =
    new Set([
      "generated",
      "under review",
      "approved",
      "applied",
    ]);

  return (
    rows.find((row) => {
      const sameCandidate =
        normalizeEmail(
          row.candidateEmail
        ) === normalizedEmail;

      const sameJob =
        normalizeId(
          row.jobId
        ) === normalizedJobId;

      const status =
        String(
          row.status || ""
        )
          .trim()
          .toLowerCase();

      return (
        sameCandidate &&
        sameJob &&
        reusableStatuses.has(status)
      );
    }) ||
    null
  );
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
  ).map((item) => ({
    requirement:
      item.requirement,

    reason:
      item.reason,
  }));
}

function buildKeyAlignmentPoints(
  evaluation
) {
  return (
    evaluation
      .supportedRequiredRequirements ||
    []
  ).map((item) => ({
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
      item.evidenceStrength,
  }));
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
    ),
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
  applicationType = null,
}) {
  /*
   * Ensure all application-related spreadsheet tabs and
   * headers exist.
   */
  await ensureApplicationSheets();

  /*
   * ==========================================================
   * DUPLICATE GENERATION PROTECTION
   * ==========================================================
   *
   * If this candidate/job already has a generated application
   * that is still valid, return that application instead of
   * spending AI credits and creating another record.
   */

  const existingApplication =
    await findExistingApplication(
      candidateEmail,
      jobId
    );

  if (existingApplication) {
    console.log(
      `[Application] Existing application found: ${existingApplication.applicationId}`
    );

    return existingApplication;
  }

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
    new Date()
      .toISOString();

  let row = {
    /*
     * Identity
     */
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

    /*
     * Generation type.
     *
     * This is NOT the same thing as applicationMethod.
     */
    applicationType:
      applicationType ||
      "Standard",

    /*
     * Document generation state.
     */
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

    /*
     * Existing factual state.
     */
    factualWarnings:
      "[]",

    missingRequirements:
      "[]",

    keyAlignmentPoints:
      "[]",

    /*
     * Main application lifecycle.
     */
    status:
      "Generating",

    /*
     * ========================================================
     * APPLICATION EXECUTION STATE
     * ========================================================
     *
     * applicationMethod:
     *   email
     *   google_form
     *   linkedin_easy_apply
     *   ats_form
     *   company_form
     *   manual_only
     *   unknown
     *
     * applicationMode:
     *   manual
     *   assisted
     *   automatic
     *
     * executionStatus:
     *   not_ready
     *   ready
     *   applying
     *   needs_review
     *   submitted
     *   failed
     */

    applicationMethod:
      "unknown",

    applicationMode:
      "assisted",

    executionStatus:
      "not_ready",

    /*
     * Initially use the stored job URL.
     *
     * applicationRouter.js can later replace this with a more
     * precise application URL when one is detected.
     */
    applicationUrl:
      job.url || "",

    applicationRecipient:
      "",

    submittedAt:
      "",

    lastAttemptAt:
      "",

    attemptCount:
      0,

    confirmationReference:
      "",

    failureReason:
      "",

    createdAt:
      now,

    updatedAt:
      now,
  };

  /*
   * Persist immediately so generation progress remains visible.
   */
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
      new Date()
        .toISOString();

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
      new Date()
        .toISOString();

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
        JSON.stringify(
          cv
        );

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

      row.executionStatus =
        "failed";

      row.failureReason =
        "Generated CV failed local validation.";

      row.updatedAt =
        new Date()
          .toISOString();

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
      JSON.stringify(
        cv
      );

    row.updatedAt =
      new Date()
        .toISOString();

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
      new Date()
        .toISOString();

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
     * FINAL COVER-LETTER VALIDATION FAILURE
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

      row.executionStatus =
        "failed";

      row.failureReason =
        "Generated cover letter failed local validation.";

      row.updatedAt =
        new Date()
          .toISOString();

      await persistApplication(
        row
      );

      return row;
    }

    /*
     * Cover letter passed.
     */

    row.coverLetterStatus =
      "Validated";

    row.coverLetterValidationStatus =
      "Valid";

    row.coverLetterText =
      cover.coverLetter;

    row.updatedAt =
      new Date()
        .toISOString();

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
      coverLetterFile,
    ] =
      await Promise.all([
        uploadGeneratedDocument({
          buffer:
            cvBuffer,

          fileName:
            `${safeName}_${safeJob}_CV.docx`,

          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),

        uploadGeneratedDocument({
          buffer:
            coverBuffer,

          fileName:
            `${safeName}_${safeJob}_Cover_Letter.docx`,

          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
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
      JSON.stringify(
        cv
      );

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

    /*
     * Existing generation status behavior remains intact.
     */
    row.status =
      getApplicationStatus(
        row.cvValidationStatus,
        row.coverLetterValidationStatus
      );

    /*
     * Successful document generation does NOT mean that the
     * application is ready to submit yet.
     *
     * The application must still be reviewed/approved.
     */
    if (
      row.status ===
      "Generated"
    ) {
      row.executionStatus =
        "not_ready";

      row.failureReason =
        "";
    }

    row.updatedAt =
      new Date()
        .toISOString();

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

    row.executionStatus =
      "failed";

    row.failureReason =
      err?.message ||
      String(err);

    /*
     * Mark whichever generation stage was still active.
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
            }`,
          ]
        )
      );

    row.updatedAt =
      new Date()
        .toISOString();

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
    limit = 50,
  } = {}
) {
  let rows =
    await readSheet(
      "Generated Applications"
    );

  const normalizedEmail =
    normalizeEmail(
      candidateEmail
    );

  rows =
    rows.filter(
      (row) =>
        normalizeEmail(
          row.candidateEmail
        ) === normalizedEmail
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
  normalizeListLimit(
    limit
  );

  return rows.slice(
    0,
    safeLimit
  );
}

/*
 * ============================================================
 * LIST REVIEWABLE APPLICATIONS
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * Returns applications that have successfully completed
 * document generation and are eligible to ENTER review.
 *
 * These applications are still:
 *
 *     status = Generated
 *
 * They do NOT yet belong in the main Applications workspace.
 *
 * This function can later power a:
 *
 *     "Ready for Review"
 *
 * section or action in the Review Queue.
 *
 * ============================================================
 */

async function listReviewableApplications(
  candidateEmail,
  {
    limit = 50
  } = {}
) {
  await ensureApplicationSheets();

  const normalizedEmail =
    normalizeEmail(
      candidateEmail
    );

  if (
    !normalizedEmail
  ) {
    throw new Error(
      "candidateEmail is required"
    );
  }

  const rows =
    await readSheet(
      "Generated Applications"
    );

  /*
   * Only records belonging to this candidate are considered.
   */
  const candidateRows =
    rows.filter(
      (row) =>
        normalizeEmail(
          row.candidateEmail
        ) ===
        normalizedEmail
    );

  /*
   * canEnterReview() performs the authoritative checks:
   *
   * - status = Generated
   * - CV exists
   * - cover letter exists
   */
  const eligibleRows =
    candidateRows.filter(
      (row) =>
        canEnterReview(
          row
        ).eligible
    );

  /*
   * Most recently updated applications first.
   */
  eligibleRows.sort(
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
    normalizeListLimit(
      limit
    );

  return eligibleRows
    .slice(
      0,
      safeLimit
    )
    .map(
      attachApplicationEligibility
    );
}

/*
 * ============================================================
 * LIST APPLICATIONS WORKSPACE RECORDS
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * This is the authoritative data source for the frontend
 * Applications workspace.
 *
 * A Generated application does NOT automatically appear here.
 *
 * Current workspace lifecycle:
 *
 *     Under Review
 *          ↓
 *       Approved
 *          ↓
 *        Applied
 *
 * Required generated documents must also still exist.
 *
 * ============================================================
 */

async function listWorkspaceApplications(
  candidateEmail,
  {
    status,
    limit = 50
  } = {}
) {
  await ensureApplicationSheets();

  const normalizedEmail =
    normalizeEmail(
      candidateEmail
    );

  if (
    !normalizedEmail
  ) {
    throw new Error(
      "candidateEmail is required"
    );
  }

  let rows =
    await readSheet(
      "Generated Applications"
    );

  /*
   * Candidate isolation.
   */
  rows =
    rows.filter(
      (row) =>
        normalizeEmail(
          row.candidateEmail
        ) ===
        normalizedEmail
    );

  /*
   * ==========================================================
   * AUTHORITATIVE WORKSPACE ELIGIBILITY FILTER
   * ==========================================================
   *
   * This enforces:
   *
   * - Under Review / Approved / Applied lifecycle state
   * - CV exists
   * - Cover letter exists
   *
   * Generated applications are deliberately excluded.
   */
  rows =
    rows.filter(
      (row) =>
        isApplicationWorkspaceEligible(
          row
        ).eligible
    );

  /*
   * Optional workspace-status filter.
   */
  if (
    status
  ) {
    const requestedStatus =
      normalizeStatus(
        status
      );

    rows =
      rows.filter(
        (row) =>
          normalizeStatus(
            row.status
          ) ===
          requestedStatus
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
    normalizeListLimit(
      limit
    );

  /*
   * Return backend-computed eligibility information.
   *
   * React should display these decisions rather than trying to
   * calculate lifecycle rules itself.
   */
  return rows
    .slice(
      0,
      safeLimit
    )
    .map(
      attachApplicationEligibility
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

  const normalizedApplicationId =
    normalizeId(
      applicationId
    );

  return (
    rows.find(
      (row) =>
        normalizeId(
          row.applicationId
        ) ===
        normalizedApplicationId
    ) ||
    null
  );
}

/*
 * ============================================================
 * GET APPLICATION WITH ELIGIBILITY
 * ============================================================
 *
 * Intended primarily for API/frontend consumption.
 *
 * Internal services can continue using:
 *
 *     getGeneratedApplication()
 *
 * when they need the raw persistence record.
 */

async function getApplicationWithEligibility(
  applicationId
) {
  const application =
    await getGeneratedApplication(
      applicationId
    );

  if (
    !application
  ) {
    return null;
  }

  return attachApplicationEligibility(
    application
  );
}

/*
 * ============================================================
 * TRANSITION APPLICATION REVIEW STATUS
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * Centralized persistence operation for candidate-controlled
 * review transitions.
 *
 * Supported targets:
 *
 *     Under Review
 *     Approved
 *     Rejected
 *
 * IMPORTANT:
 *
 * Applied is NOT allowed through this function.
 *
 * An application becomes Applied only after a successful real
 * application submission through applicationAttemptService.
 *
 * Generated is also NOT manually assignable.
 *
 * Generation itself owns the Generated status.
 *
 * ============================================================
 */

async function transitionApplicationReviewStatus(
  applicationId,
  requestedStatus
) {
  await ensureApplicationSheets();

  const normalizedApplicationId =
    normalizeId(
      applicationId
    );

  if (
    !normalizedApplicationId
  ) {
    throw new Error(
      "applicationId is required"
    );
  }

  const application =
    await getGeneratedApplication(
      normalizedApplicationId
    );

  if (
    !application
  ) {
    throw new Error(
      "Generated application not found"
    );
  }

  /*
   * ==========================================================
   * ALLOWED USER REVIEW TARGETS
   * ==========================================================
   *
   * Generated:
   *     controlled by generation pipeline
   *
   * Applied:
   *     controlled by confirmed application submission
   */

  const allowedReviewTargets =
    new Set([
      APPLICATION_STATUSES
        .UNDER_REVIEW,

      APPLICATION_STATUSES
        .APPROVED,

      APPLICATION_STATUSES
        .REJECTED
    ]);

  const canonicalRequestedStatus =
    Object.values(
      APPLICATION_STATUSES
    ).find(
      (status) =>
        normalizeStatus(
          status
        ) ===
        normalizeStatus(
          requestedStatus
        )
    );

  if (
    !canonicalRequestedStatus ||
    !allowedReviewTargets.has(
      canonicalRequestedStatus
    )
  ) {
    throw new Error(
      "Review status must be Under Review, Approved, or Rejected"
    );
  }

  /*
   * ==========================================================
   * IDEMPOTENT REQUEST
   * ==========================================================
   *
   * Repeating the same status request should not rewrite the
   * row unnecessarily.
   */

  if (
    normalizeStatus(
      application.status
    ) ===
    normalizeStatus(
      canonicalRequestedStatus
    )
  ) {
    return attachApplicationEligibility(
      application
    );
  }

  /*
   * ==========================================================
   * CENTRAL POLICY CHECK
   * ==========================================================
   *
   * This validates transitions such as:
   *
   * Generated -> Under Review
   * Under Review -> Approved
   * Under Review -> Rejected
   * Approved -> Rejected
   *
   * and rejects invalid lifecycle jumps.
   */

  assertApplicationStatusTransition(
    application,
    canonicalRequestedStatus
  );

  const now =
    new Date()
      .toISOString();

  const updated = {
    ...application,

    status:
      canonicalRequestedStatus,

    updatedAt:
      now
  };

  /*
   * ==========================================================
   * EXECUTION STATE SYNCHRONIZATION
   * ==========================================================
   */

  switch (
    canonicalRequestedStatus
  ) {
    /*
     * Entering review does NOT authorize job submission.
     */
    case APPLICATION_STATUSES
      .UNDER_REVIEW:
      updated.executionStatus =
        EXECUTION_STATUSES
          .NOT_READY;

      break;


    /*
     * Approval explicitly unlocks execution.
     */
    case APPLICATION_STATUSES
      .APPROVED:
      updated.executionStatus =
        EXECUTION_STATUSES
          .READY;

      /*
       * Any old execution error should not continue displaying
       * after a legitimate approval transition.
       *
       * Generation failures cannot reach this point because
       * their application status is Rejected.
       */
      updated.failureReason =
        "";

      break;


    /*
     * Candidate rejection immediately removes execution
     * eligibility.
     */
    case APPLICATION_STATUSES
      .REJECTED:
      updated.executionStatus =
        EXECUTION_STATUSES
          .NOT_READY;

      break;


    default:
      /*
       * Defensive branch.
       */
      throw new Error(
        "Unsupported review lifecycle transition"
      );
  }

  await persistApplication(
    updated
  );

  return attachApplicationEligibility(
    updated
  );
}

/*
 * ============================================================
 * MOVE APPLICATION TO REVIEW
 * ============================================================
 *
 * Candidate explicitly chooses to review a successfully
 * generated application package.
 */

async function moveApplicationToReview(
  applicationId
) {
  return transitionApplicationReviewStatus(
    applicationId,
    APPLICATION_STATUSES
      .UNDER_REVIEW
  );
}


/*
 * ============================================================
 * APPROVE APPLICATION
 * ============================================================
 *
 * Approval means:
 *
 * - candidate reviewed generated documents
 * - candidate accepts the application package
 * - executionStatus becomes ready
 */

async function approveApplication(
  applicationId
) {
  return transitionApplicationReviewStatus(
    applicationId,
    APPLICATION_STATUSES
      .APPROVED
  );
}


/*
 * ============================================================
 * REJECT APPLICATION
 * ============================================================
 *
 * Candidate declines the prepared application.
 *
 * Rejected applications cannot be executed.
 */

async function rejectApplication(
  applicationId
) {
  return transitionApplicationReviewStatus(
    applicationId,
    APPLICATION_STATUSES
      .REJECTED
  );
}

/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  /*
   * ==========================================================
   * APPLICATION GENERATION
   * ==========================================================
   */

  generateApplicationForJob,


  /*
   * ==========================================================
   * APPLICATION RETRIEVAL
   * ==========================================================
   */

  /*
   * All generation records.
   */
  listGeneratedApplications,

  /*
   * Generated applications whose documents are complete and
   * are eligible to enter review.
   */
  listReviewableApplications,

  /*
   * Actual Applications workspace:
   *
   * Under Review
   * Approved
   * Applied
   *
   * with required generated documents.
   */
  listWorkspaceApplications,

  /*
   * Raw persistence record.
   */
  getGeneratedApplication,

  /*
   * API/domain-enriched record.
   */
  getApplicationWithEligibility,

  findExistingApplication,


  /*
   * ==========================================================
   * REVIEW LIFECYCLE
   * ==========================================================
   */

  transitionApplicationReviewStatus,

  moveApplicationToReview,
  approveApplication,
  rejectApplication,


  /*
   * ==========================================================
   * APPLICATION ELIGIBILITY ENRICHMENT
   * ==========================================================
   */

  attachApplicationEligibility,


  /*
   * ==========================================================
   * CANDIDATE / JOB LOOKUPS
   * ==========================================================
   */

  getCandidate,
  getJobForCandidate,


  /*
   * ==========================================================
   * FACTUAL GENERATION HELPERS
   * ==========================================================
   */

  buildFactualWarnings,
  buildMissingRequirements,
  buildKeyAlignmentPoints,

  mergeWarnings
};
