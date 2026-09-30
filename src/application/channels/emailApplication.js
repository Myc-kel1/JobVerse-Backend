const {
  getGeneratedApplication,
  getJobForCandidate
} = require(
  "../applicationService"
);

/*
 * ============================================================
 * EMAIL APPLICATION CHANNEL
 * ============================================================
 *
 * Responsibilities:
 *
 * - load the approved/generated application
 * - determine the recipient
 * - prepare subject
 * - prepare email body
 * - expose CV and cover-letter attachment URLs
 *
 * This file does NOT send the email yet.
 *
 * Gmail sending will be added after we verify that the
 * preparation flow is correct.
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

function normalizeEmail(
  value
) {
  return normalizeString(
    value
  ).toLowerCase();
}

function extractEmails(
  text
) {
  const input =
    normalizeString(
      text
    );

  if (!input) {
    return [];
  }

  const matches =
    input.match(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
    ) || [];

  return [
    ...new Set(
      matches.map(
        (email) =>
          normalizeEmail(
            email
          )
      )
    )
  ];
}

/*
 * ============================================================
 * RESOLVE EMAIL RECIPIENT
 * ============================================================
 */

function resolveRecipient({
  application,
  job
}) {
  /*
   * Prefer an explicitly detected recipient.
   */
  if (
    application
      .applicationRecipient
  ) {
    return normalizeEmail(
      application
        .applicationRecipient
    );
  }

  /*
   * Then explicit job fields.
   */
  if (
    job.applicationEmail
  ) {
    return normalizeEmail(
      job.applicationEmail
    );
  }

  if (
    job.contactEmail
  ) {
    return normalizeEmail(
      job.contactEmail
    );
  }

  /*
   * Finally inspect job text.
   */
  const emails =
    extractEmails(
      [
        job.description,
        job.requirements,
        job.applicationInstructions,
        job.rationale
      ]
        .filter(Boolean)
        .join("\n")
    );

  return (
    emails[0] ||
    ""
  );
}

/*
 * ============================================================
 * EMAIL SUBJECT
 * ============================================================
 */

function buildEmailSubject({
  application,
  job
}) {
  const candidateName =
    normalizeString(
      application.candidateName
    ) ||
    "Candidate";

  const jobTitle =
    normalizeString(
      application.jobTitle ||
      job.title
    ) ||
    "Position";

  return (
    `Application for ${jobTitle} - ${candidateName}`
  );
}

/*
 * ============================================================
 * EMAIL BODY
 * ============================================================
 */

function buildEmailBody({
  application,
  job
}) {
  const candidateName =
    normalizeString(
      application.candidateName
    );

  const jobTitle =
    normalizeString(
      application.jobTitle ||
      job.title
    );

  const company =
    normalizeString(
      application.company ||
      job.company
    );

  /*
   * Prefer the generated cover letter if one exists.
   *
   * This keeps the email aligned with the same tailored
   * application documents already produced for this job.
   */
  const coverLetter =
    normalizeString(
      application.coverLetterText
    );

  if (coverLetter) {
    return coverLetter;
  }

  /*
   * Safe fallback if the stored cover-letter text is empty.
   */
  return [
    "Dear Hiring Team,",
    "",
    `I am writing to apply for the ${jobTitle || "available"} position${company ? ` at ${company}` : ""}.`,
    "",
    "Please find my CV and supporting application documents attached for your consideration.",
    "",
    "Thank you for your time and consideration.",
    "",
    candidateName
      ? `Kind regards,\n${candidateName}`
      : "Kind regards"
  ].join("\n");
}

/*
 * ============================================================
 * BUILD ATTACHMENTS
 * ============================================================
 */

function buildAttachments(
  application
) {
  const attachments =
    [];

  if (
    application.cvFile
  ) {
    attachments.push({
      type:
        "cv",

      name:
        `${normalizeString(
          application.candidateName
        ) || "Candidate"}_${normalizeString(
          application.jobTitle
        ) || "Role"}_CV.docx`,

      url:
        application.cvFile
    });
  }

  if (
    application.coverLetterFile
  ) {
    attachments.push({
      type:
        "cover_letter",

      name:
        `${normalizeString(
          application.candidateName
        ) || "Candidate"}_${normalizeString(
          application.jobTitle
        ) || "Role"}_Cover_Letter.docx`,

      url:
        application.coverLetterFile
    });
  }

  return attachments;
}

/*
 * ============================================================
 * PREPARE EMAIL APPLICATION
 * ============================================================
 */

async function prepareEmailApplication({
  applicationId
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

  const recipient =
    resolveRecipient({
      application,
      job
    });

  if (!recipient) {
    return {
      ready:
        false,

      reason:
        "No application email recipient could be determined reliably.",

      requiresHumanReview:
        true,

      applicationId:
        application.applicationId,

      jobId:
        application.jobId,

      candidateEmail:
        application.candidateEmail,

      recipient:
        "",

      subject:
        buildEmailSubject({
          application,
          job
        }),

      body:
        buildEmailBody({
          application,
          job
        }),

      attachments:
        buildAttachments(
          application
        )
    };
  }

  const attachments =
    buildAttachments(
      application
    );

  /*
   * An application without a generated CV should not be sent.
   */
  const hasCV =
    attachments.some(
      (item) =>
        item.type ===
        "cv"
    );

  if (!hasCV) {
    return {
      ready:
        false,

      reason:
        "Generated CV attachment is missing.",

      requiresHumanReview:
        true,

      applicationId:
        application.applicationId,

      jobId:
        application.jobId,

      candidateEmail:
        application.candidateEmail,

      recipient,

      subject:
        buildEmailSubject({
          application,
          job
        }),

      body:
        buildEmailBody({
          application,
          job
        }),

      attachments
    };
  }

  return {
    ready:
      true,

    reason:
      "",

    requiresHumanReview:
      true,

    applicationId:
      application.applicationId,

    jobId:
      application.jobId,

    candidateEmail:
      application.candidateEmail,

    recipient,

    subject:
      buildEmailSubject({
        application,
        job
      }),

    body:
      buildEmailBody({
        application,
        job
      }),

    attachments
  };
}

/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  prepareEmailApplication,
  resolveRecipient,
  buildEmailSubject,
  buildEmailBody,
  buildAttachments,
  extractEmails
};