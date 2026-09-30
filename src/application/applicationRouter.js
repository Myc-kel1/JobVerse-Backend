/*
 * ============================================================
 * APPLICATION ROUTER
 * ============================================================
 *
 * Determines the most likely application submission method
 * for an approved/generated application.
 *
 * Supported methods:
 *
 * email
 * google_form
 * linkedin_easy_apply
 * ats_form
 * company_form
 * manual_only
 * unknown
 *
 * IMPORTANT:
 *
 * This file ONLY detects/routes.
 *
 * It does NOT:
 * - send emails
 * - submit forms
 * - open browsers
 * - click buttons
 *
 * Execution belongs in applicationExecutionService.js and
 * the individual channel handlers.
 */

/*
 * ============================================================
 * CONSTANTS
 * ============================================================
 */

const APPLICATION_METHODS =
  new Set([
    "email",
    "google_form",
    "linkedin_easy_apply",
    "ats_form",
    "company_form",
    "manual_only",
    "unknown"
  ]);

const ATS_HOST_PATTERNS = [
  "greenhouse.io",
  "boards.greenhouse.io",
  "lever.co",
  "jobs.lever.co",
  "ashbyhq.com",
  "jobs.ashbyhq.com",
  "workday.com",
  "myworkdayjobs.com",
  "smartrecruiters.com",
  "bamboohr.com",
  "icims.com",
  "jobvite.com",
  "teamtailor.com",
  "personio.com",
  "recruitee.com"
];

const GOOGLE_FORM_HOST_PATTERNS = [
  "docs.google.com/forms",
  "forms.gle"
];

const LINKEDIN_HOST_PATTERNS = [
  "linkedin.com"
];

/*
 * ============================================================
 * NORMALIZATION HELPERS
 * ============================================================
 */

function normalizeString(value) {
  return String(value || "")
    .trim();
}

function normalizeLower(value) {
  return normalizeString(value)
    .toLowerCase();
}

/*
 * ============================================================
 * URL HELPERS
 * ============================================================
 */

function safeUrl(value) {
  const raw =
    normalizeString(value);

  if (!raw) {
    return null;
  }

  try {
    return new URL(raw);
  } catch (_) {
    return null;
  }
}

function getUrlHost(value) {
  const parsed =
    safeUrl(value);

  if (!parsed) {
    return "";
  }

  return parsed.hostname
    .toLowerCase()
    .replace(/^www\./, "");
}

function urlContains(
  url,
  fragment
) {
  return normalizeLower(url)
    .includes(
      normalizeLower(fragment)
    );
}

/*
 * ============================================================
 * EMAIL HELPERS
 * ============================================================
 */

function extractEmails(text) {
  const input =
    normalizeString(text);

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
          email
            .trim()
            .toLowerCase()
      )
    )
  ];
}

/*
 * ============================================================
 * TEXT SIGNAL HELPERS
 * ============================================================
 */

function containsAny(
  value,
  terms
) {
  const text =
    normalizeLower(value);

  return terms.some(
    (term) =>
      text.includes(
        normalizeLower(term)
      )
  );
}

function looksLikeEmailApplicationText(
  description
) {
  return containsAny(
    description,
    [
      "send your cv",
      "send your resume",
      "send resume",
      "send cv",
      "email your cv",
      "email your resume",
      "submit your cv to",
      "submit your resume to",
      "apply via email",
      "apply by email",
      "email application",
      "forward your cv",
      "forward your resume"
    ]
  );
}

function looksLikeLinkedInEasyApply(
  job
) {
  const url =
    normalizeLower(
      job.applicationUrl ||
      job.url
    );

  const description =
    normalizeLower(
      job.description
    );

  /*
   * URL alone tells us this is LinkedIn, but not necessarily
   * Easy Apply.
   *
   * We therefore require an additional signal if available.
   */
  if (
    !url.includes(
      "linkedin.com"
    )
  ) {
    return false;
  }

  return (
    containsAny(
      description,
      [
        "easy apply",
        "linkedin easy apply"
      ]
    ) ||
    containsAny(
      job.applicationType,
      [
        "easy apply",
        "linkedin easy apply"
      ]
    ) ||
    containsAny(
      job.sourceName,
      [
        "linkedin"
      ]
    ) &&
    containsAny(
      job.applyType,
      [
        "easy"
      ]
    )
  );
}

/*
 * ============================================================
 * GOOGLE FORM DETECTION
 * ============================================================
 */

function isGoogleFormUrl(
  value
) {
  const lower =
    normalizeLower(value);

  return GOOGLE_FORM_HOST_PATTERNS.some(
    (pattern) =>
      lower.includes(
        pattern
      )
  );
}

/*
 * ============================================================
 * ATS DETECTION
 * ============================================================
 */

function isKnownAtsUrl(
  value
) {
  const host =
    getUrlHost(value);

  if (!host) {
    return false;
  }

  return ATS_HOST_PATTERNS.some(
    (pattern) =>
      host === pattern ||
      host.endsWith(
        `.${pattern}`
      )
  );
}

/*
 * ============================================================
 * LINKEDIN DETECTION
 * ============================================================
 */

function isLinkedInUrl(
  value
) {
  const lower =
    normalizeLower(value);

  return LINKEDIN_HOST_PATTERNS.some(
    (pattern) =>
      lower.includes(
        pattern
      )
  );
}

/*
 * ============================================================
 * COMPANY FORM DETECTION
 * ============================================================
 */

function looksLikeCompanyApplicationUrl(
  value
) {
  const url =
    normalizeLower(value);

  if (!url) {
    return false;
  }

  /*
   * Known third-party services are handled before this helper.
   *
   * This mainly detects company-hosted career/application paths.
   */
  return containsAny(
    url,
    [
      "/careers/",
      "/career/",
      "/jobs/",
      "/job/",
      "/apply/",
      "/application/",
      "careers.",
      "jobs."
    ]
  );
}

/*
 * ============================================================
 * APPLICATION ROUTE OBJECT
 * ============================================================
 */

function buildRoute({
  applicationMethod,
  applicationUrl = "",
  applicationRecipient = "",
  confidence = 0,
  reason = "",
  requiresHumanReview = true
}) {
  const method =
    APPLICATION_METHODS.has(
      applicationMethod
    )
      ? applicationMethod
      : "unknown";

  return {
    applicationMethod:
      method,

    applicationUrl:
      normalizeString(
        applicationUrl
      ),

    applicationRecipient:
      normalizeString(
        applicationRecipient
      ),

    confidence:
      Number(
        confidence
      ) || 0,

    reason:
      normalizeString(
        reason
      ),

    requiresHumanReview:
      Boolean(
        requiresHumanReview
      )
  };
}

/*
 * ============================================================
 * DETECT APPLICATION METHOD
 * ============================================================
 */

function detectApplicationMethod({
  job = {},
  application = {}
} = {}) {
  /*
   * Prefer the most specific application URL we already have.
   */
  const applicationUrl =
    normalizeString(
      application.applicationUrl ||
      job.applicationUrl ||
      job.applyUrl ||
      job.url ||
      ""
    );

  const description =
    [
      job.description,
      job.requirements,
      job.rationale,
      job.applicationInstructions,
      application.applicationInstructions
    ]
      .filter(Boolean)
      .join("\n");

  /*
   * ==========================================================
   * 1. EMAIL APPLICATION
   * ==========================================================
   */

  const emails =
    extractEmails(
      [
        description,
        job.applicationEmail,
        job.contactEmail,
        application.applicationRecipient
      ]
        .filter(Boolean)
        .join("\n")
    );

  if (
    emails.length > 0 &&
    (
      looksLikeEmailApplicationText(
        description
      ) ||
      job.applicationEmail ||
      application.applicationRecipient
    )
  ) {
    return buildRoute({
      applicationMethod:
        "email",

      applicationUrl,

      applicationRecipient:
        emails[0],

      confidence:
        0.98,

      reason:
        "Job contains an application email address and email application instructions.",

      requiresHumanReview:
        true
    });
  }

  /*
   * ==========================================================
   * 2. GOOGLE FORM
   * ==========================================================
   */

  if (
    isGoogleFormUrl(
      applicationUrl
    )
  ) {
    return buildRoute({
      applicationMethod:
        "google_form",

      applicationUrl,

      confidence:
        0.99,

      reason:
        "Application URL is a Google Forms URL.",

      requiresHumanReview:
        true
    });
  }

  /*
   * Sometimes the Google Form URL exists inside the description
   * rather than the main job URL.
   */
  const googleFormUrlMatch =
    description.match(
      /https?:\/\/(?:docs\.google\.com\/forms\/[^\s)"']+|forms\.gle\/[^\s)"']+)/i
    );

  if (
    googleFormUrlMatch
  ) {
    return buildRoute({
      applicationMethod:
        "google_form",

      applicationUrl:
        googleFormUrlMatch[0],

      confidence:
        0.99,

      reason:
        "Google Forms application link found in the job description.",

      requiresHumanReview:
        true
    });
  }

  /*
   * ==========================================================
   * 3. LINKEDIN EASY APPLY
   * ==========================================================
   */

  if (
    isLinkedInUrl(
      applicationUrl
    ) &&
    looksLikeLinkedInEasyApply({
      ...job,
      applicationUrl
    })
  ) {
    return buildRoute({
      applicationMethod:
        "linkedin_easy_apply",

      applicationUrl,

      confidence:
        0.9,

      reason:
        "LinkedIn URL with Easy Apply indicators detected.",

      requiresHumanReview:
        true
    });
  }

  /*
   * LinkedIn without a reliable Easy Apply signal.
   *
   * We don't guess.
   */
  if (
    isLinkedInUrl(
      applicationUrl
    )
  ) {
    return buildRoute({
      applicationMethod:
        "manual_only",

      applicationUrl,

      confidence:
        0.8,

      reason:
        "LinkedIn job detected, but Easy Apply could not be confirmed.",

      requiresHumanReview:
        true
    });
  }

  /*
   * ==========================================================
   * 4. KNOWN ATS
   * ==========================================================
   */

  if (
    isKnownAtsUrl(
      applicationUrl
    )
  ) {
    return buildRoute({
      applicationMethod:
        "ats_form",

      applicationUrl,

      confidence:
        0.98,

      reason:
        "Application URL belongs to a known applicant tracking system.",

      requiresHumanReview:
        true
    });
  }

  /*
   * ==========================================================
   * 5. COMPANY CAREER / APPLICATION FORM
   * ==========================================================
   */

  if (
    looksLikeCompanyApplicationUrl(
      applicationUrl
    )
  ) {
    return buildRoute({
      applicationMethod:
        "company_form",

      applicationUrl,

      confidence:
        0.75,

      reason:
        "Application URL appears to be a company career or application page.",

      requiresHumanReview:
        true
    });
  }

  /*
   * ==========================================================
   * 6. EMAIL ADDRESS WITHOUT EXPLICIT EMAIL INSTRUCTION
   * ==========================================================
   *
   * We deliberately lower confidence here.
   *
   * A job description may contain an HR/contact email that is
   * not actually the application destination.
   */

  if (
    emails.length > 0
  ) {
    return buildRoute({
      applicationMethod:
        "email",

      applicationUrl,

      applicationRecipient:
        emails[0],

      confidence:
        0.6,

      reason:
        "Email address found, but explicit email application instructions were not detected.",

      requiresHumanReview:
        true
    });
  }

  /*
   * ==========================================================
   * 7. MANUAL URL
   * ==========================================================
   */

  if (
    applicationUrl
  ) {
    return buildRoute({
      applicationMethod:
        "manual_only",

      applicationUrl,

      confidence:
        0.5,

      reason:
        "An application URL exists, but its submission method could not be safely classified.",

      requiresHumanReview:
        true
    });
  }

  /*
   * ==========================================================
   * 8. UNKNOWN
   * ==========================================================
   */

  return buildRoute({
    applicationMethod:
      "unknown",

    confidence:
      0,

    reason:
      "No reliable application method or application URL was detected.",

    requiresHumanReview:
      true
  });
}

/*
 * ============================================================
 * ROUTE APPLICATION
 * ============================================================
 *
 * Convenience wrapper for callers that already have both the
 * job and generated application.
 */

function routeApplication({
  job,
  application
}) {
  return detectApplicationMethod({
    job,
    application
  });
}

/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  APPLICATION_METHODS,

  detectApplicationMethod,
  routeApplication,

  extractEmails,
  isGoogleFormUrl,
  isKnownAtsUrl,
  isLinkedInUrl,
  looksLikeCompanyApplicationUrl
};