const { readSheet, upsertRows } = require("./googleSheets");
const { extractTextFromDriveUrl } = require("./fileExtraction");

// Google Forms uses the exact question text as the column header.
const FORM_FIELD_MAP = {
  "Email Address": "candidateEmail",
  "Full Name": "candidateName",
  "Preferred Job Title": "preferredJobTitle",
  "Job Type": "jobType",
  "Work Model": "workModel",
  "Minimum Salary": "salaryRangeMin",
  "Maximum Salary": "salaryRangeMax",
  "Desired Location": "desiredLocation",
  "Things You Want to Avoid": "exclusionRules",
  "Search Keywords(Separated with comma)": "searchKeywords",
  "Key Skills(Separated with commas)": "preferredSkills",
  "Upload Your CV/Resume": "cvFile",
  "Upload Your Cover Letter": "coverLetterFile"
};

const DEFAULT_CANDIDATE_CONFIG = {
  minimumMatchScore: 6,
  maxResults: 10,
  maxSearchPages: 3,
  jobRecencyDays: 7,
  excludedTitles:
    "Sales Representative, Sales Executive, Sales Manager",
  excludedKeywords:
    "commission-only, commission only, unpaid internship",
  status: "active",
  applicationsSentCount: 0,
  applicationTarget: 50
};

/**
 * Maps one raw Google Forms response row into
 * the Candidates sheet schema.
 */
function mapFormResponse(row) {
  const mapped = {};

  for (const [formQuestion, candidateField] of Object.entries(
    FORM_FIELD_MAP
  )) {
    if (row[formQuestion] !== undefined) {
      mapped[candidateField] = row[formQuestion];
    }
  }

  return {
    ...DEFAULT_CANDIDATE_CONFIG,
    ...mapped,
    dateRegistered: new Date().toISOString()
  };
}

/**
 * Normalizes email addresses so matching is not affected
 * by accidental casing or whitespace differences.
 */
function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/**
 * Sync Google Form responses into Candidates.
 *
 * Behaviour:
 * - New candidate -> create candidate.
 * - New CV -> extract CV text.
 * - Changed CV -> re-extract CV text.
 * - Unchanged CV -> preserve existing masterCVText.
 * - New cover letter -> extract text.
 * - Changed cover letter -> re-extract text.
 * - Unchanged cover letter -> preserve existing text.
 * - Extraction failure -> preserve previous successful extraction.
 *
 * Safe to run repeatedly from the scheduled intake sync.
 */
async function syncFormResponsesToCandidates() {
  const [formRows, existingCandidates] = await Promise.all([
    readSheet("Form Responses 1"),
    readSheet("Candidates")
  ]);

  console.log(
    `[intake sync] Form responses found: ${formRows.length}`
  );

  console.log(
    `[intake sync] Existing candidates found: ${existingCandidates.length}`
  );

  /*
   * Map existing candidates by normalized email.
   */
  const existingByEmail = new Map(
    existingCandidates
      .filter((candidate) => candidate.candidateEmail)
      .map((candidate) => [
        normalizeEmail(candidate.candidateEmail),
        candidate
      ])
  );

  const results = [];

  for (const row of formRows) {
    const mapped = mapFormResponse(row);

    if (!mapped.candidateEmail) {
      console.warn(
        "[intake sync] Skipping form row because candidate email is missing."
      );

      continue;
    }

    /*
     * Normalize the email before using it as our identity key.
     */
    mapped.candidateEmail = normalizeEmail(mapped.candidateEmail);

    const existing = existingByEmail.get(mapped.candidateEmail);

    /*
     * Preserve existing runtime/application state.
     *
     * Existing values are loaded first, then current Form values
     * overwrite profile fields.
     */
    const candidate = existing
      ? {
          ...existing,
          ...mapped,

          /*
           * These fields belong to application runtime state,
           * not the Google Form.
           */
          status:
            existing.status ||
            mapped.status,

          applicationsSentCount:
            existing.applicationsSentCount ??
            mapped.applicationsSentCount,

          applicationTarget:
            existing.applicationTarget ??
            mapped.applicationTarget,

          /*
           * Registration date must represent when the candidate
           * was first registered, not the most recent sync.
           */
          dateRegistered:
            existing.dateRegistered ||
            mapped.dateRegistered
        }
      : mapped;

    /*
     * ==========================================================
     * CV EXTRACTION
     * ==========================================================
     *
     * Extract only when:
     *
     * 1. Candidate has supplied a CV, AND
     * 2. Candidate is new, OR
     * 3. CV URL changed, OR
     * 4. We don't have extracted CV text yet.
     */
    const cvFileChanged =
      Boolean(candidate.cvFile) &&
      (
        !existing ||
        candidate.cvFile !== existing.cvFile ||
        !existing.masterCVText
      );

    if (cvFileChanged) {
      try {
        console.log(
          `[intake sync] Extracting CV for ${candidate.candidateEmail}`
        );

        const cv = await extractTextFromDriveUrl(
          candidate.cvFile
        );

        candidate.masterCVText = cv?.text || "";

        /*
         * Clear any previous extraction error because
         * this extraction succeeded.
         */
        candidate.cvExtractionError = "";

        console.log(
          `[intake sync] CV extracted successfully. Characters: ${
            candidate.masterCVText.length
          }`
        );
      } catch (err) {
        console.error(
          `[intake sync] CV extraction failed for ${candidate.candidateEmail}:`,
          err.message
        );

        /*
         * IMPORTANT:
         *
         * Never destroy previously extracted candidate evidence
         * because Drive temporarily failed.
         */
        candidate.masterCVText =
          existing?.masterCVText ||
          candidate.masterCVText ||
          "";

        candidate.cvExtractionError = err.message;
      }
    } else if (existing?.masterCVText) {
      /*
       * CV hasn't changed.
       *
       * Keep the successful extraction we already have.
       */
      candidate.masterCVText =
        existing.masterCVText;

      candidate.cvExtractionError =
        existing.cvExtractionError || "";

      console.log(
        `[intake sync] CV unchanged for ${candidate.candidateEmail}; preserving existing extracted text.`
      );
    }

    /*
     * ==========================================================
     * COVER LETTER EXTRACTION
     * ==========================================================
     *
     * Same policy as CV extraction.
     */
    const coverLetterFileChanged =
      Boolean(candidate.coverLetterFile) &&
      (
        !existing ||
        candidate.coverLetterFile !==
          existing.coverLetterFile ||
        !existing.masterCoverLetterText
      );

    if (coverLetterFileChanged) {
      try {
        console.log(
          `[intake sync] Extracting cover letter for ${candidate.candidateEmail}`
        );

        const coverLetter =
          await extractTextFromDriveUrl(
            candidate.coverLetterFile
          );

        candidate.masterCoverLetterText =
          coverLetter?.text || "";

        /*
         * Clear previous extraction error after success.
         */
        candidate.coverLetterExtractionError = "";

        console.log(
          `[intake sync] Cover letter extracted successfully. Characters: ${
            candidate.masterCoverLetterText.length
          }`
        );
      } catch (err) {
        console.error(
          `[intake sync] Cover letter extraction failed for ${candidate.candidateEmail}:`,
          err.message
        );

        /*
         * Preserve the last successful extraction.
         */
        candidate.masterCoverLetterText =
          existing?.masterCoverLetterText ||
          candidate.masterCoverLetterText ||
          "";

        candidate.coverLetterExtractionError =
          err.message;
      }
    } else if (existing?.masterCoverLetterText) {
      /*
       * Cover letter hasn't changed.
       */
      candidate.masterCoverLetterText =
        existing.masterCoverLetterText;

      candidate.coverLetterExtractionError =
        existing.coverLetterExtractionError || "";

      console.log(
        `[intake sync] Cover letter unchanged for ${candidate.candidateEmail}; preserving existing extracted text.`
      );
    }

    /*
     * ==========================================================
     * SAVE CANDIDATE
     * ==========================================================
     */
    await upsertRows(
      "Candidates",
      [candidate],
      ["candidateEmail"]
    );

    /*
     * Update the in-memory map.
     *
     * This is important if multiple Form responses belonging
     * to the same candidate exist in the same sync run.
     */
    existingByEmail.set(
      candidate.candidateEmail,
      candidate
    );

    results.push({
      candidateEmail: candidate.candidateEmail,
      status: existing ? "updated" : "created",

      hasCV: Boolean(candidate.cvFile),
      hasCoverLetter: Boolean(
        candidate.coverLetterFile
      ),

      hasCVText: Boolean(
        candidate.masterCVText
      ),

      hasCoverLetterText: Boolean(
        candidate.masterCoverLetterText
      ),

      cvExtractedThisRun: cvFileChanged,
      coverLetterExtractedThisRun:
        coverLetterFileChanged
    });
  }

  console.log(
    `[intake sync] Completed. Candidates processed: ${results.length}`
  );

  return results;
}

module.exports = {
  syncFormResponsesToCandidates,
  mapFormResponse,
  FORM_FIELD_MAP
};