const { ensureSheetWithHeaders } = require("../googleSheets");

const GENERATED_APPLICATION_HEADERS = [
  "applicationId", "jobId", "candidateEmail", "candidateName", "jobTitle", "company", "overallScore",
  "applicationType", "cvStatus", "coverLetterStatus", "cvFile", "coverLetterFile", "cvText", "coverLetterText",
  "cvValidationStatus", "coverLetterValidationStatus", "factualWarnings", "missingRequirements", "keyAlignmentPoints",
  "status", "createdAt", "updatedAt"
];

const JOB_DETAILS_HEADERS = [
  "jobId", "candidateEmail", "title", "company", "location", "workModel", "jobType", "salaryMin", "salaryMax",
  "salaryCurrency", "salaryPeriod", "url", "postedDate", "sourceName", "overallScore", "description", "capturedAt", "updatedAt"
];

async function ensureApplicationSheets() {
  await ensureSheetWithHeaders("Generated Applications", GENERATED_APPLICATION_HEADERS);
  await ensureSheetWithHeaders("Job Details", JOB_DETAILS_HEADERS);
}

module.exports = { ensureApplicationSheets, GENERATED_APPLICATION_HEADERS, JOB_DETAILS_HEADERS };
