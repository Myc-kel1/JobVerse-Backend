const cheerio =
  require("cheerio");

const {
  getGeneratedApplication,
  getJobForCandidate,
} = require(
  "../applicationService"
);

const {
  buildFormInspection,
  FIELD_TYPES,
  INSPECTION_STATUSES,
  FORM_ACTION_TYPES,
  normalizeUrl,
} = require(
  "../formInspectionService"
);

const {
  resolveFormQuestions,
  summarizeResolvedQuestions,
  buildResolvedAnswerMap,
} = require(
  "../formAnswerResolver"
);

/*
 * ============================================================
 * GOOGLE FORM APPLICATION CHANNEL
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * This module is responsible for inspecting PUBLIC Google Forms
 * used during job applications.
 *
 * It:
 *
 * 1. validates the Google Form URL
 * 2. loads the public form
 * 3. extracts visible application questions
 * 4. detects field types
 * 5. detects required fields
 * 6. extracts choice options
 * 7. detects special conditions such as:
 *
 *      - Google sign-in requirement
 *      - file upload fields
 *      - CAPTCHA
 *      - multi-step forms
 *
 * 8. converts everything into the standard JobVerse form
 *    representation
 *
 * 9. resolves questions against reusable candidate answers
 *
 * ============================================================
 * IMPORTANT ARCHITECTURAL RULE
 * ============================================================
 *
 * THIS FILE DOES NOT SUBMIT THE GOOGLE FORM.
 *
 * Inspection and submission are deliberately separate.
 *
 * This lets JobVerse:
 *
 * - understand the form first
 * - identify missing information
 * - request candidate input
 * - review risky answers
 * - avoid incomplete submissions
 *
 * Submission will be added later as a separate execution step.
 *
 * ============================================================
 * IMPORTANT SAFETY RULE
 * ============================================================
 *
 * This service must NOT attempt to bypass:
 *
 * - CAPTCHA
 * - Google authentication
 * - OTP
 * - account verification
 *
 * When those are encountered, JobVerse stops and hands the
 * process to the candidate.
 * ============================================================
 */

/*
 * ============================================================
 * CONSTANTS
 * ============================================================
 */

/*
 * External web requests should never be allowed to hang
 * indefinitely.
 */
const DEFAULT_FETCH_TIMEOUT_MS =
  15000;

/*
 * Protect the backend from unexpectedly huge responses.
 *
 * Google Forms are normally much smaller than this.
 */
const MAX_FORM_HTML_BYTES =
  5 * 1024 * 1024;

/*
 * A reasonable browser-like User-Agent helps avoid endpoints
 * returning unusual bot-specific fallback responses.
 *
 * We are NOT pretending to bypass access restrictions.
 */
const USER_AGENT =
  "Mozilla/5.0 (compatible; JobVerse/1.0; ApplicationFormInspector)";

/*
 * ============================================================
 * BASIC HELPERS
 * ============================================================
 */

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

/*
 * ============================================================
 * GOOGLE FORM URL VALIDATION
 * ============================================================
 */

function isGoogleFormUrl(
  value
) {
  const normalized =
    normalizeString(
      value
    );

  if (!normalized) {
    return false;
  }

  try {
    const parsed =
      new URL(
        normalized
      );

    const host =
      parsed.hostname
        .toLowerCase()
        .replace(
          /^www\./,
          ""
        );

    /*
     * Short Google Forms links.
     */
    if (
      host ===
      "forms.gle"
    ) {
      return true;
    }

    /*
     * Full Google Forms URLs.
     */
    if (
      host ===
        "docs.google.com" &&
      parsed.pathname
        .toLowerCase()
        .includes(
          "/forms/"
        )
    ) {
      return true;
    }

    return false;
  } catch (_) {
    return false;
  }
}

/*
 * ============================================================
 * FETCH FORM HTML
 * ============================================================
 *
 * Fetch follows redirects automatically.
 *
 * This is important because forms.gle links usually redirect to
 * the full docs.google.com/forms URL.
 */

async function fetchGoogleFormHtml(
  formUrl,
  {
    timeoutMs =
      DEFAULT_FETCH_TIMEOUT_MS,
  } = {}
) {
  if (
    typeof fetch !==
    "function"
  ) {
    throw new Error(
      "Global fetch is unavailable. Use Node.js 18 or newer."
    );
  }

  if (
    !isGoogleFormUrl(
      formUrl
    )
  ) {
    throw new Error(
      "Invalid Google Form URL"
    );
  }

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => {
        controller.abort();
      },
      timeoutMs
    );

  try {
    const response =
      await fetch(
        formUrl,
        {
          method:
            "GET",

          redirect:
            "follow",

          signal:
            controller.signal,

          headers: {
            "User-Agent":
              USER_AGENT,

            Accept:
              "text/html,application/xhtml+xml",
          },
        }
      );

    if (
      !response.ok
    ) {
      throw new Error(
        `Google Form request failed with HTTP ${response.status}`
      );
    }

    const contentType =
      normalizeLower(
        response.headers.get(
          "content-type"
        )
      );

    if (
      !contentType.includes(
        "text/html"
      )
    ) {
      throw new Error(
        `Unexpected Google Form response type: ${contentType || "unknown"}`
      );
    }

    /*
     * Check reported content length first where available.
     */
    const contentLength =
      Number(
        response.headers.get(
          "content-length"
        )
      );

    if (
      Number.isFinite(
        contentLength
      ) &&
      contentLength >
        MAX_FORM_HTML_BYTES
    ) {
      throw new Error(
        "Google Form response is unexpectedly large"
      );
    }

    const html =
      await response.text();

    /*
     * Content-Length is not always present, so enforce the
     * limit after reading as well.
     */
    if (
      Buffer.byteLength(
        html,
        "utf8"
      ) >
      MAX_FORM_HTML_BYTES
    ) {
      throw new Error(
        "Google Form response exceeded the maximum allowed size"
      );
    }

    return {
      html,

      finalUrl:
        response.url ||
        formUrl,

      status:
        response.status,
    };
  } catch (err) {
    if (
      err?.name ===
      "AbortError"
    ) {
      throw new Error(
        "Google Form inspection timed out"
      );
    }

    throw err;
  } finally {
    clearTimeout(
      timeout
    );
  }
}

/*
 * ============================================================
 * DETECT GOOGLE LOGIN REQUIREMENT
 * ============================================================
 */

function detectGoogleLoginRequired({
  finalUrl,
  html,
}) {
  const url =
    normalizeLower(
      finalUrl
    );

  /*
   * Redirect to Google's authentication service.
   */
  if (
    url.includes(
      "accounts.google.com"
    )
  ) {
    return true;
  }

  const text =
    normalizeLower(
      html
    );

  /*
   * Heuristics for sign-in-required forms.
   */
  return (
    text.includes(
      "sign in to continue"
    ) ||
    text.includes(
      "you must sign in"
    ) ||
    text.includes(
      "requires sign in"
    )
  );
}

/*
 * ============================================================
 * CAPTCHA DETECTION
 * ============================================================
 *
 * CAPTCHA presence always requires human interaction.
 */

function detectCaptcha(
  $
) {
  if (
    $(
      ".g-recaptcha"
    ).length >
    0
  ) {
    return true;
  }

  if (
    $(
      'iframe[src*="recaptcha"]'
    ).length >
    0
  ) {
    return true;
  }

  const html =
    normalizeLower(
      $.html()
    );

  return (
    html.includes(
      "recaptcha"
    ) ||
    html.includes(
      "captcha"
    )
  );
}

/*
 * ============================================================
 * FORM TITLE
 * ============================================================
 */

function extractFormTitle(
  $
) {
  /*
   * Prefer Open Graph metadata.
   */
  const ogTitle =
    normalizeString(
      $(
        'meta[property="og:title"]'
      ).attr(
        "content"
      )
    );

  if (
    ogTitle
  ) {
    return ogTitle;
  }

  /*
   * Then normal document title.
   */
  const title =
    normalizeString(
      $("title")
        .first()
        .text()
    );

  if (
    title
  ) {
    return title;
  }

  /*
   * Google Forms frequently stores the visible form title in
   * role="heading".
   */
  return normalizeString(
    $(
      '[role="heading"]'
    )
      .first()
      .text()
  );
}

/*
 * ============================================================
 * FORM DESCRIPTION
 * ============================================================
 */

function extractFormDescription(
  $
) {
  const meta =
    normalizeString(
      $(
        'meta[property="og:description"]'
      ).attr(
        "content"
      )
    );

  if (
    meta
  ) {
    return meta;
  }

  return normalizeString(
    $(
      'meta[name="description"]'
    ).attr(
      "content"
    )
  );
}

/*
 * ============================================================
 * FIELD LABEL EXTRACTION
 * ============================================================
 *
 * Google Forms markup may change over time.
 *
 * We therefore use several increasingly broad strategies
 * rather than relying on one CSS class.
 */

function findFieldLabel(
  $,
  element
) {
  const current =
    $(element);

  /*
   * 1. ARIA label.
   */
  const ariaLabel =
    normalizeString(
      current.attr(
        "aria-label"
      )
    );

  if (
    ariaLabel
  ) {
    return ariaLabel;
  }

  /*
   * 2. Explicit HTML label.
   */
  const id =
    normalizeString(
      current.attr(
        "id"
      )
    );

  if (
    id
  ) {
    const explicitLabel =
      normalizeString(
        $(
          `label[for="${id}"]`
        )
          .first()
          .text()
      );

    if (
      explicitLabel
    ) {
      return explicitLabel;
    }
  }

  /*
   * 3. Search the closest Google Forms question container.
   *
   * role=listitem is common for public Google Form questions.
   */
  const container =
    current.closest(
      '[role="listitem"]'
    );

  if (
    container.length >
    0
  ) {
    /*
     * Visible question headings.
     */
    const heading =
      normalizeString(
        container
          .find(
            '[role="heading"]'
          )
          .first()
          .text()
      );

    if (
      heading
    ) {
      return heading;
    }

    /*
     * Google Forms has historically used M7eMe for question
     * labels. This is only a fallback because Google can change
     * generated class names.
     */
    const googleLabel =
      normalizeString(
        container
          .find(
            ".M7eMe"
          )
          .first()
          .text()
      );

    if (
      googleLabel
    ) {
      return googleLabel;
    }
  }

  /*
   * 4. Placeholder fallback.
   */
  const placeholder =
    normalizeString(
      current.attr(
        "placeholder"
      )
    );

  if (
    placeholder
  ) {
    return placeholder;
  }

  return "";
}

/*
 * ============================================================
 * REQUIRED FIELD DETECTION
 * ============================================================
 */

function detectRequiredField(
  $,
  element
) {
  const current =
    $(element);

  if (
    current.attr(
      "required"
    ) !==
    undefined
  ) {
    return true;
  }

  if (
    normalizeLower(
      current.attr(
        "aria-required"
      )
    ) ===
    "true"
  ) {
    return true;
  }

  const container =
    current.closest(
      '[role="listitem"]'
    );

  if (
    container.length >
    0
  ) {
    const text =
      normalizeString(
        container.text()
      );

    /*
     * Google Forms often displays a visible * on required
     * questions.
     */
    if (
      text.includes(
        "*"
      )
    ) {
      return true;
    }
  }

  return false;
}

/*
 * ============================================================
 * MAP HTML INPUT TYPE
 * ============================================================
 */

function mapInputType(
  inputType
) {
  const type =
    normalizeLower(
      inputType ||
      "text"
    );

  switch (
    type
  ) {
    case "email":
      return FIELD_TYPES
        .EMAIL;

    case "tel":
      return FIELD_TYPES
        .PHONE;

    case "number":
      return FIELD_TYPES
        .NUMBER;

    case "date":
      return FIELD_TYPES
        .DATE;

    case "url":
      return FIELD_TYPES
        .URL;

    case "radio":
      return FIELD_TYPES
        .CHOICE;

    case "checkbox":
      return FIELD_TYPES
        .MULTI_CHOICE;

    case "file":
      return FIELD_TYPES
        .FILE;

    default:
      return FIELD_TYPES
        .TEXT;
  }
}

/*
 * ============================================================
 * EXTRACT STANDARD HTML FORM FIELDS
 * ============================================================
 *
 * Google Forms public HTML exposes enough standard controls in
 * many forms for deterministic inspection.
 *
 * We group radio and checkbox inputs by their submission name.
 */

function extractHtmlFormFields(
  $
) {
  const fieldMap =
    new Map();

  const selectors =
    [
      'input[name^="entry."]',
      'textarea[name^="entry."]',
      'select[name^="entry."]',
    ].join(
      ","
    );

  $(
    selectors
  ).each(
    (
      index,
      element
    ) => {
      const current =
        $(element);

      const tagName =
        normalizeLower(
          element.tagName
        );

      const fieldName =
        normalizeString(
          current.attr(
            "name"
          )
        );

      if (
        !fieldName
      ) {
        return;
      }

      /*
       * Group controls sharing the same entry ID.
       *
       * This is especially important for radio buttons and
       * checkboxes.
       */
      let existing =
        fieldMap.get(
          fieldName
        );

      let fieldType;

      if (
        tagName ===
        "textarea"
      ) {
        fieldType =
          FIELD_TYPES
            .TEXTAREA;
      } else if (
        tagName ===
        "select"
      ) {
        fieldType =
          FIELD_TYPES
            .CHOICE;
      } else {
        fieldType =
          mapInputType(
            current.attr(
              "type"
            )
          );
      }

      const label =
        findFieldLabel(
          $,
          element
        );

      const required =
        detectRequiredField(
          $,
          element
        );

      if (
        !existing
      ) {
        existing = {
          platformFieldId:
            fieldName,

          platformFieldName:
            fieldName,

          label,

          fieldType,

          required,

          options:
            [],

          metadata: {
            source:
              "html_control",
          },
        };

        fieldMap.set(
          fieldName,
          existing
        );
      }

      /*
       * Prefer a non-empty label if the first control in a
       * radio group did not expose one.
       */
      if (
        !existing.label &&
        label
      ) {
        existing.label =
          label;
      }

      existing.required =
        existing.required ||
        required;

      /*
       * Radio / checkbox values.
       */
      if (
        fieldType ===
          FIELD_TYPES.CHOICE ||
        fieldType ===
          FIELD_TYPES.MULTI_CHOICE
      ) {
        const optionValue =
          normalizeString(
            current.attr(
              "value"
            )
          );

        if (
          optionValue
        ) {
          existing
            .options
            .push(
              optionValue
            );
        }
      }

      /*
       * Select options.
       */
      if (
        tagName ===
        "select"
      ) {
        current
          .find(
            "option"
          )
          .each(
            (
              _,
              option
            ) => {
              const optionValue =
                normalizeString(
                  $(option)
                    .attr(
                      "value"
                    ) ||
                  $(option)
                    .text()
                );

              if (
                optionValue
              ) {
                existing
                  .options
                  .push(
                    optionValue
                  );
              }
            }
          );
      }
    }
  );

  /*
   * Remove duplicate options.
   */
  return [
    ...fieldMap.values(),
  ].map(
    (field) => ({
      ...field,

      options:
        [
          ...new Set(
            field.options
          ),
        ],
    })
  );
}

/*
 * ============================================================
 * FILE UPLOAD DETECTION
 * ============================================================
 *
 * Google Forms file uploads generally require Google sign-in.
 */

function detectFileUpload(
  $,
  fields
) {
  if (
    fields.some(
      (field) =>
        field.fieldType ===
        FIELD_TYPES.FILE
    )
  ) {
    return true;
  }

  const pageText =
    normalizeLower(
      $("body")
        .text()
    );

  return (
    pageText.includes(
      "file upload"
    ) ||
    pageText.includes(
      "upload a file"
    )
  );
}

/*
 * ============================================================
 * MULTI-STEP DETECTION
 * ============================================================
 */

function detectMultiStepForm(
  $
) {
  const buttons =
    [];

  $(
    '[role="button"], button, input[type="button"], input[type="submit"]'
  ).each(
    (
      _,
      element
    ) => {
      const text =
        normalizeLower(
          $(element)
            .text() ||
          $(element)
            .attr(
              "value"
            ) ||
          $(element)
            .attr(
              "aria-label"
            )
        );

      if (
        text
      ) {
        buttons.push(
          text
        );
      }
    }
  );

  return buttons.some(
    (value) =>
      value ===
        "next" ||
      value.includes(
        "next"
      )
  );
}

/*
 * ============================================================
 * DETECT FORM ACTION TYPE
 * ============================================================
 */

function detectFormActionType(
  $,
  {
    requiresLogin,
  } = {}
) {
  if (
    requiresLogin
  ) {
    return FORM_ACTION_TYPES
      .LOGIN;
  }

  const pageText =
    normalizeLower(
      $("body")
        .text()
    );

  if (
    pageText.includes(
      "next"
    )
  ) {
    return FORM_ACTION_TYPES
      .NEXT;
  }

  if (
    pageText.includes(
      "submit"
    )
  ) {
    return FORM_ACTION_TYPES
      .SUBMIT;
  }

  return FORM_ACTION_TYPES
    .UNKNOWN;
}

/*
 * ============================================================
 * INSPECT GOOGLE FORM
 * ============================================================
 */

async function inspectGoogleForm({
  formUrl,
}) {
  if (
    !formUrl
  ) {
    throw new Error(
      "Google Form URL is required"
    );
  }

  const normalizedUrl =
    normalizeUrl(
      formUrl
    );

  if (
    !normalizedUrl ||
    !isGoogleFormUrl(
      normalizedUrl
    )
  ) {
    throw new Error(
      "Invalid Google Form URL"
    );
  }

  const {
    html,
    finalUrl,
  } =
    await fetchGoogleFormHtml(
      normalizedUrl
    );

  /*
   * Google may redirect forms.gle to docs.google.com.
   */
  const $ =
    cheerio.load(
      html
    );

  const requiresLogin =
    detectGoogleLoginRequired({
      finalUrl,
      html,
    });

  const hasCaptcha =
    detectCaptcha(
      $
    );

  const fields =
    extractHtmlFormFields(
      $
    );

  const hasFileUpload =
    detectFileUpload(
      $,
      fields
    );

  const multiStep =
    detectMultiStepForm(
      $
    );

  const warnings =
    [];

  /*
   * Static HTML inspection cannot always expose every question
   * on dynamically rendered or multi-step Google Forms.
   *
   * We explicitly report that rather than pretending inspection
   * was complete.
   */
  if (
    fields.length ===
    0 &&
    !requiresLogin
  ) {
    warnings.push(
      "No standard Google Form fields could be extracted from the static page. Dynamic inspection may be required."
    );
  }

  if (
    hasFileUpload
  ) {
    warnings.push(
      "Google Form contains a file-upload requirement. Candidate authentication and human interaction may be required."
    );
  }

  if (
    multiStep
  ) {
    warnings.push(
      "Google Form appears to contain multiple steps. Additional pages may contain more questions."
    );
  }

  let status =
    INSPECTION_STATUSES
      .SUCCESS;

  if (
    requiresLogin
  ) {
    status =
      INSPECTION_STATUSES
        .NEEDS_AUTH;
  } else if (
    fields.length ===
      0
  ) {
    status =
      INSPECTION_STATUSES
        .PARTIAL;
  }

  return buildFormInspection({
    applicationMethod:
      "google_form",

    url:
      finalUrl,

    title:
      extractFormTitle(
        $
      ),

    description:
      extractFormDescription(
        $
      ),

    source:
      "google_forms",

    status,

    fields,

    actionType:
      detectFormActionType(
        $,
        {
          requiresLogin,
        }
      ),

    requiresLogin,

    hasCaptcha,

    multiStep,

    metadata: {
      hasFileUpload,

      originalUrl:
        normalizedUrl,

      finalUrl,
    },

    warnings,
  });
}

/*
 * ============================================================
 * RESOLVE GOOGLE FORM QUESTIONS
 * ============================================================
 *
 * After inspection, every readable question is passed through
 * our shared answer resolution engine.
 */

async function resolveGoogleFormQuestions({
  candidateEmail,
  inspection,
}) {
  if (
    !inspection
  ) {
    throw new Error(
      "Form inspection is required"
    );
  }

  if (
    !candidateEmail
  ) {
    throw new Error(
      "candidateEmail is required"
    );
  }

  const questions =
    inspection.fields.map(
      (field) => ({
        fieldId:
          field.fieldId,

        platformFieldId:
          field.platformFieldId,

        platformFieldName:
          field.platformFieldName,

        questionText:
          field.label,

        fieldType:
          field.fieldType,

        required:
          field.required,

        options:
          field.options,

        metadata:
          field.metadata,
      })
    );

  return resolveFormQuestions({
    candidateEmail,
    questions,
  });
}

/*
 * ============================================================
 * PREPARE GOOGLE FORM APPLICATION
 * ============================================================
 *
 * This is the main function used by
 * applicationExecutionService.js.
 *
 * It:
 *
 * 1. loads the application
 * 2. loads the job
 * 3. finds the Google Form URL
 * 4. inspects the form
 * 5. resolves known answers
 * 6. identifies missing/review-required answers
 *
 * NO FORM IS SUBMITTED HERE.
 */

async function prepareGoogleFormApplication({
  applicationId,
  formUrl,
}) {
  const application =
    await getGeneratedApplication(
      applicationId
    );

  if (
    !application
  ) {
    throw new Error(
      "Generated application not found"
    );
  }

  const job =
    await getJobForCandidate(
      application.jobId,
      application.candidateEmail
    );

  if (
    !job
  ) {
    throw new Error(
      "Full job details not found for this application"
    );
  }

  const resolvedFormUrl =
    normalizeString(
      formUrl ||
      application.applicationUrl ||
      job.applicationUrl ||
      job.applyUrl ||
      job.url
    );

  if (
    !resolvedFormUrl
  ) {
    throw new Error(
      "Google Form URL not found"
    );
  }

  /*
   * ----------------------------------------------------------
   * INSPECT FORM
   * ----------------------------------------------------------
   */

  const inspection =
    await inspectGoogleForm({
      formUrl:
        resolvedFormUrl,
    });

  /*
   * If authentication is required, stop before attempting answer
   * resolution.
   */
  if (
    inspection.requiresLogin
  ) {
    return {
      ready:
        false,

      status:
        "needs_review",

      reason:
        "Google authentication is required before the application form can be inspected completely.",

      applicationId:
        application.applicationId,

      jobId:
        application.jobId,

      candidateEmail:
        application.candidateEmail,

      inspection,

      resolutions:
        [],

      summary: {
        total:
          0,

        resolved:
          0,

        needsReview:
          0,

        missing:
          0,

        canSubmitAutomatically:
          false,
      },

      answerMap:
        {},
    };
  }

  /*
   * CAPTCHA always requires user interaction.
   */
  if (
    inspection.hasCaptcha
  ) {
    return {
      ready:
        false,

      status:
        "needs_review",

      reason:
        "CAPTCHA was detected. Candidate interaction is required.",

      applicationId:
        application.applicationId,

      jobId:
        application.jobId,

      candidateEmail:
        application.candidateEmail,

      inspection,

      resolutions:
        [],

      summary: {
        total:
          inspection.fieldCount,

        resolved:
          0,

        needsReview:
          inspection.fieldCount,

        missing:
          0,

        canSubmitAutomatically:
          false,
      },

      answerMap:
        {},
    };
  }

  /*
   * ----------------------------------------------------------
   * RESOLVE QUESTIONS
   * ----------------------------------------------------------
   */

  const resolutions =
    await resolveGoogleFormQuestions({
      candidateEmail:
        application.candidateEmail,

      inspection,
    });

  const summary =
    summarizeResolvedQuestions(
      resolutions
    );

  const answerMap =
    buildResolvedAnswerMap(
      resolutions
    );

  /*
   * ----------------------------------------------------------
   * DETERMINE READINESS
   * ----------------------------------------------------------
   *
   * "ready" means the form has enough information to proceed to
   * the REVIEW/SUBMISSION stage.
   *
   * It does NOT mean the form has already been submitted.
   */

  const ready =
    summary
      .canSubmitAutomatically &&
    inspection.status ===
      INSPECTION_STATUSES
        .SUCCESS &&
    !inspection.requiresLogin &&
    !inspection.hasCaptcha;

  let reason =
    "";

  if (
    summary.missing >
    0
  ) {
    reason =
      `${summary.missing} application question(s) are missing candidate answers.`;
  } else if (
    summary.needsReview >
    0
  ) {
    reason =
      `${summary.needsReview} application question(s) require candidate review.`;
  } else if (
    inspection.status !==
    INSPECTION_STATUSES.SUCCESS
  ) {
    reason =
      "Google Form inspection was incomplete.";
  }

  return {
    ready,

    status:
      ready
        ? "ready_for_review"
        : "needs_review",

    reason,

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

    applicationUrl:
      inspection.url,

    inspection,

    resolutions,

    summary,

    answerMap,

    /*
     * Submission is deliberately disabled in this version.
     */
    submissionEnabled:
      false,
  };
}

/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  /*
   * Main application preparation.
   */
  prepareGoogleFormApplication,

  /*
   * Form inspection.
   */
  inspectGoogleForm,

  /*
   * Question resolution.
   */
  resolveGoogleFormQuestions,

  /*
   * Google-specific parsing helpers.
   */
  isGoogleFormUrl,
  fetchGoogleFormHtml,
  extractHtmlFormFields,

  /*
   * Detection helpers useful for tests.
   */
  detectGoogleLoginRequired,
  detectCaptcha,
  detectFileUpload,
  detectMultiStepForm,
};