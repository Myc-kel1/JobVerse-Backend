const {
  getGeneratedApplication,
  getJobForCandidate
} = require(
  "../applicationService"
);

/*
 * ============================================================
 * MANUAL APPLICATION CHANNEL
 * ============================================================
 *
 * Used when:
 *
 * - application method is manual_only
 * - application route could not be classified reliably
 * - candidate must complete final submission themselves
 *
 * This file does NOT submit anything.
 *
 * It prepares everything the candidate needs for a clean
 * handoff.
 */

/*
 * ============================================================
 * HELPERS
 * ============================================================
 */

function normalizeString(
  value
) {
  return String(
    value || ""
  ).trim();
}

/*
 * ============================================================
 * BUILD DOCUMENTS
 * ============================================================
 */

function buildDocuments(
  application
) {
  const documents =
    [];

  if (
    application.cvFile
  ) {
    documents.push({
      type:
        "cv",

      label:
        "Tailored CV",

      url:
        application.cvFile
    });
  }

  if (
    application.coverLetterFile
  ) {
    documents.push({
      type:
        "cover_letter",

      label:
        "Tailored Cover Letter",

      url:
        application.coverLetterFile
    });
  }

  return documents;
}

/*
 * ============================================================
 * BUILD MANUAL INSTRUCTIONS
 * ============================================================
 */

function buildManualInstructions({
  application,
  job,
  route
}) {
  const instructions =
    [];

  if (
    route.applicationUrl
  ) {
    instructions.push(
      "Open the application link."
    );
  }

  instructions.push(
    "Review the job application form or instructions."
  );

  if (
    application.cvFile
  ) {
    instructions.push(
      "Upload the tailored CV where requested."
    );
  }

  if (
    application.coverLetterFile
  ) {
    instructions.push(
      "Upload or paste the tailored cover letter where requested."
    );
  }

  instructions.push(
    "Answer any employer-specific questions using accurate personal information."
  );

  instructions.push(
    "Review all information before submitting."
  );

  instructions.push(
    "After submission, return to JobVerse and confirm that the application was submitted."
  );

  return instructions;
}

/*
 * ============================================================
 * PREPARE MANUAL APPLICATION
 * ============================================================
 */

async function prepareManualApplication({
  applicationId,
  route = {}
}) {
  const application =
    await getGeneratedApplication(
      applicationId
    );

  if (!application) {
    throw new Error(
      "Generated application not found"
    );
  }

  const job =
    await getJobForCandidate(
      application.jobId,
      application.candidateEmail
    );

  if (!job) {
    throw new Error(
      "Full job details not found for this application"
    );
  }

  const applicationUrl =
    normalizeString(
      route.applicationUrl ||
      application.applicationUrl ||
      job.applicationUrl ||
      job.applyUrl ||
      job.url
    );

  const documents =
    buildDocuments(
      application
    );

  const instructions =
    buildManualInstructions({
      application,
      job,
      route: {
        ...route,
        applicationUrl
      }
    });

  return {
    ready:
      true,

    requiresHumanReview:
      true,

    applicationId:
      application.applicationId,

    jobId:
      application.jobId,

    candidateEmail:
      application.candidateEmail,

    jobTitle:
      application.jobTitle ||
      job.title,

    company:
      application.company ||
      job.company,

    applicationUrl,

    applicationMethod:
      route.applicationMethod ||
      application.applicationMethod ||
      "manual_only",

    documents,

    instructions
  };
}

/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  prepareManualApplication,
  buildDocuments,
  buildManualInstructions
};