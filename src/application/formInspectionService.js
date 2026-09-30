const { createHash } = require("crypto");

/*
 * ============================================================
 * FORM INSPECTION SERVICE
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * This module defines the STANDARD JobVerse representation of
 * an external application form.
 *
 * Different platforms expose form fields differently:
 *
 * Google Forms
 * Greenhouse
 * Lever
 * Workday
 * Ashby
 * LinkedIn
 * Company career websites
 *
 * Platform-specific inspectors are responsible for reading
 * those systems.
 *
 * This service is responsible for converting their results into
 * one predictable internal format.
 *
 * ------------------------------------------------------------
 * IMPORTANT ARCHITECTURAL RULE
 * ------------------------------------------------------------
 *
 * This service does NOT:
 *
 * - fetch websites
 * - submit forms
 * - invent answers
 * - click buttons
 * - bypass authentication
 * - bypass CAPTCHA
 *
 * It ONLY normalizes and validates information discovered by a
 * form inspector.
 *
 * Actual inspection belongs to the channel/platform modules.
 *
 * Answer resolution belongs to:
 *
 * formAnswerResolver.js
 *
 * Submission belongs to:
 *
 * applicationExecutionService.js
 * and channel execution handlers.
 *
 * ============================================================
 */

/*
 * ============================================================
 * SUPPORTED FIELD TYPES
 * ============================================================
 *
 * Every external platform field should eventually map to one of
 * these JobVerse field types.
 */

const FIELD_TYPES =
  Object.freeze({
    TEXT:
      "text",

    TEXTAREA:
      "textarea",

    EMAIL:
      "email",

    PHONE:
      "phone",

    NUMBER:
      "number",

    DATE:
      "date",

    CHOICE:
      "choice",

    MULTI_CHOICE:
      "multi_choice",

    BOOLEAN:
      "boolean",

    FILE:
      "file",

    URL:
      "url",

    CONSENT:
      "consent",

    UNKNOWN:
      "unknown",
  });

const VALID_FIELD_TYPES =
  new Set(
    Object.values(
      FIELD_TYPES
    )
  );

/*
 * ============================================================
 * INSPECTION STATUS
 * ============================================================
 */

const INSPECTION_STATUSES =
  Object.freeze({
    SUCCESS:
      "success",

    PARTIAL:
      "partial",

    NEEDS_AUTH:
      "needs_auth",

    BLOCKED:
      "blocked",

    UNSUPPORTED:
      "unsupported",

    FAILED:
      "failed",
  });

const VALID_INSPECTION_STATUSES =
  new Set(
    Object.values(
      INSPECTION_STATUSES
    )
  );

/*
 * ============================================================
 * FORM ACTION TYPES
 * ============================================================
 *
 * These tell the execution layer whether the form appears to
 * support normal submission or needs human intervention.
 */

const FORM_ACTION_TYPES =
  Object.freeze({
    SUBMIT:
      "submit",

    NEXT:
      "next",

    REVIEW:
      "review",

    LOGIN:
      "login",

    UNKNOWN:
      "unknown",
  });

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
 * BOOLEAN NORMALIZATION
 * ============================================================
 */

function normalizeBoolean(
  value,
  fallback = false
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
      "1",
      "required",
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
      "0",
      "optional",
    ].includes(
      normalized
    )
  ) {
    return false;
  }

  return fallback;
}

/*
 * ============================================================
 * URL NORMALIZATION
 * ============================================================
 */

function normalizeUrl(
  value
) {
  const raw =
    normalizeString(
      value
    );

  if (!raw) {
    return "";
  }

  try {
    const parsed =
      new URL(
        raw
      );

    /*
     * Only normal web protocols are supported by application
     * inspection.
     */
    if (
      ![
        "http:",
        "https:",
      ].includes(
        parsed.protocol
      )
    ) {
      return "";
    }

    return parsed
      .toString();
  } catch (_) {
    return "";
  }
}

/*
 * ============================================================
 * OPTION NORMALIZATION
 * ============================================================
 *
 * Employer systems sometimes expose duplicate or blank options.
 *
 * Example:
 *
 * [
 *   "Yes",
 *   "No",
 *   "",
 *   "Yes"
 * ]
 *
 * becomes:
 *
 * [
 *   "Yes",
 *   "No"
 * ]
 */

function normalizeOptions(
  values
) {
  if (
    !Array.isArray(
      values
    )
  ) {
    return [];
  }

  const seen =
    new Set();

  const options =
    [];

  for (
    const value of
    values
  ) {
    const normalized =
      normalizeString(
        typeof value ===
        "object"
          ? value?.label ??
            value?.value
          : value
      );

    if (!normalized) {
      continue;
    }

    const key =
      normalized
        .toLowerCase();

    if (
      seen.has(
        key
      )
    ) {
      continue;
    }

    seen.add(
      key
    );

    options.push(
      normalized
    );
  }

  return options;
}

/*
 * ============================================================
 * FIELD TYPE NORMALIZATION
 * ============================================================
 *
 * Platform-specific field names are mapped to our canonical
 * JobVerse types.
 */

function normalizeFieldType(
  value
) {
  const type =
    normalizeLower(
      value
    )
      .replace(
        /[\s-]+/g,
        "_"
      );

  /*
   * Already canonical.
   */
  if (
    VALID_FIELD_TYPES.has(
      type
    )
  ) {
    return type;
  }

  /*
   * Common text variations.
   */
  if (
    [
      "short_answer",
      "short_text",
      "single_line",
      "input",
      "string",
    ].includes(
      type
    )
  ) {
    return FIELD_TYPES
      .TEXT;
  }

  if (
    [
      "long_answer",
      "long_text",
      "paragraph",
      "multiline",
      "multi_line",
    ].includes(
      type
    )
  ) {
    return FIELD_TYPES
      .TEXTAREA;
  }

  /*
   * Choice types.
   */
  if (
    [
      "radio",
      "dropdown",
      "select",
      "single_choice",
      "multiple_choice",
    ].includes(
      type
    )
  ) {
    return FIELD_TYPES
      .CHOICE;
  }

  if (
    [
      "checkbox",
      "checkboxes",
      "multi_select",
      "multiple_select",
    ].includes(
      type
    )
  ) {
    return FIELD_TYPES
      .MULTI_CHOICE;
  }

  /*
   * Boolean style.
   */
  if (
    [
      "yes_no",
      "true_false",
      "switch",
      "toggle",
    ].includes(
      type
    )
  ) {
    return FIELD_TYPES
      .BOOLEAN;
  }

  /*
   * File upload.
   */
  if (
    [
      "upload",
      "file_upload",
      "attachment",
      "document",
    ].includes(
      type
    )
  ) {
    return FIELD_TYPES
      .FILE;
  }

  /*
   * Consent / declarations.
   */
  if (
    [
      "agreement",
      "declaration",
      "terms",
      "acknowledgement",
      "acknowledgment",
    ].includes(
      type
    )
  ) {
    return FIELD_TYPES
      .CONSENT;
  }

  return FIELD_TYPES
    .UNKNOWN;
}

/*
 * ============================================================
 * STABLE FIELD ID
 * ============================================================
 *
 * Some external forms do not expose a useful field ID.
 *
 * In that case we generate a deterministic hash from:
 *
 * source + label + position
 *
 * This is preferable to random UUIDs because repeated
 * inspections of the same form can still refer to the same
 * field where possible.
 */

function generateFieldId({
  source,
  label,
  position,
}) {
  const input =
    [
      normalizeLower(
        source
      ),
      normalizeLower(
        label
      ),
      Number(
        position
      ) || 0,
    ].join(
      "|"
    );

  return createHash(
    "sha256"
  )
    .update(
      input
    )
    .digest(
      "hex"
    )
    .slice(
      0,
      24
    );
}

/*
 * ============================================================
 * NORMALIZE ONE FIELD
 * ============================================================
 */

function normalizeFormField(
  field,
  {
    source = "unknown",
    position = 0,
  } = {}
) {
  if (
    !field ||
    typeof field !==
      "object"
  ) {
    throw new Error(
      "Form field must be an object"
    );
  }

  const label =
    normalizeString(
      field.label ||
      field.questionText ||
      field.title ||
      field.name
    );

  /*
   * A form control with no readable label can still exist, but
   * JobVerse cannot safely answer it automatically.
   */
  const fieldType =
    normalizeFieldType(
      field.fieldType ||
      field.type
    );

  const providedId =
    normalizeString(
      field.fieldId ||
      field.id ||
      field.name
    );

  const fieldId =
    providedId ||
    generateFieldId({
      source,
      label,
      position,
    });

  const options =
    normalizeOptions(
      field.options ||
      field.choices ||
      field.values
    );

  const normalized = {
    fieldId,

    label,

    description:
      normalizeString(
        field.description ||
        field.helpText
      ),

    fieldType,

    required:
      normalizeBoolean(
        field.required,
        false
      ),

    options,

    placeholder:
      normalizeString(
        field.placeholder
      ),

    position:
      Number.isFinite(
        Number(
          position
        )
      )
        ? Number(
            position
          )
        : 0,

    /*
     * platformFieldId preserves the original external
     * identifier required later for form submission.
     */
    platformFieldId:
      normalizeString(
        field.platformFieldId ||
        field.entryId ||
        field.id
      ),

    /*
     * Name is preserved because normal HTML forms often submit
     * using the input name rather than the element ID.
     */
    platformFieldName:
      normalizeString(
        field.platformFieldName ||
        field.name
      ),

    /*
     * Some platforms use special values for file uploads or
     * hidden controls. These belong in metadata rather than the
     * standard form schema.
     */
    metadata:
      field.metadata &&
      typeof field.metadata ===
        "object"
        ? {
            ...field.metadata,
          }
        : {},
  };

  /*
   * Fields that cannot be classified should be reviewed.
   */
  normalized.requiresHumanReview =
    fieldType ===
      FIELD_TYPES.UNKNOWN ||
    !label;

  return normalized;
}

/*
 * ============================================================
 * REMOVE DUPLICATE FIELDS
 * ============================================================
 */

function deduplicateFields(
  fields
) {
  const seen =
    new Set();

  const result =
    [];

  for (
    const field of
    fields
  ) {
    /*
     * Prefer platform identifiers.
     */
    const identity =
      field.platformFieldId ||
      field.platformFieldName ||
      field.fieldId;

    if (
      !identity
    ) {
      continue;
    }

    const key =
      String(
        identity
      );

    if (
      seen.has(
        key
      )
    ) {
      continue;
    }

    seen.add(
      key
    );

    result.push(
      field
    );
  }

  return result;
}

/*
 * ============================================================
 * NORMALIZE FORM FIELDS
 * ============================================================
 */

function normalizeFormFields(
  fields,
  {
    source = "unknown",
  } = {}
) {
  if (
    !Array.isArray(
      fields
    )
  ) {
    throw new Error(
      "Form fields must be an array"
    );
  }

  const normalized =
    fields.map(
      (
        field,
        index
      ) =>
        normalizeFormField(
          field,
          {
            source,

            position:
              index,
          }
        )
    );

  return deduplicateFields(
    normalized
  );
}

/*
 * ============================================================
 * NORMALIZE INSPECTION STATUS
 * ============================================================
 */

function normalizeInspectionStatus(
  value
) {
  const normalized =
    normalizeLower(
      value
    );

  if (
    VALID_INSPECTION_STATUSES.has(
      normalized
    )
  ) {
    return normalized;
  }

  return INSPECTION_STATUSES
    .FAILED;
}

/*
 * ============================================================
 * BUILD FORM INSPECTION RESULT
 * ============================================================
 *
 * This is the main standardization function.
 */

function buildFormInspection({
  applicationMethod,
  url,
  title = "",
  description = "",
  source = "",
  status =
    INSPECTION_STATUSES.SUCCESS,
  fields = [],
  actionType =
    FORM_ACTION_TYPES.UNKNOWN,
  requiresLogin = false,
  hasCaptcha = false,
  multiStep = false,
  currentStep = 1,
  totalSteps = null,
  metadata = {},
  warnings = [],
}) {
  const normalizedSource =
    normalizeString(
      source ||
      applicationMethod ||
      "unknown"
    );

  const normalizedFields =
    normalizeFormFields(
      fields,
      {
        source:
          normalizedSource,
      }
    );

  const normalizedWarnings =
    Array.isArray(
      warnings
    )
      ? [
          ...new Set(
            warnings
              .map(
                normalizeString
              )
              .filter(Boolean)
          ),
        ]
      : [];

  const unknownFields =
    normalizedFields.filter(
      (field) =>
        field.fieldType ===
        FIELD_TYPES.UNKNOWN
    );

  /*
   * Unknown fields make the inspection partial rather than
   * pretending we completely understand the form.
   */
  let resolvedStatus =
    normalizeInspectionStatus(
      status
    );

  if (
    resolvedStatus ===
      INSPECTION_STATUSES.SUCCESS &&
    unknownFields.length >
      0
  ) {
    resolvedStatus =
      INSPECTION_STATUSES.PARTIAL;

    normalizedWarnings.push(
      `${unknownFields.length} form field(s) could not be classified.`
    );
  }

  /*
   * Authentication requirements should be explicit.
   */
  if (
    normalizeBoolean(
      requiresLogin
    )
  ) {
    resolvedStatus =
      INSPECTION_STATUSES.NEEDS_AUTH;
  }

  /*
   * CAPTCHA should always force a human handoff.
   *
   * JobVerse must not attempt to bypass CAPTCHA.
   */
  if (
    normalizeBoolean(
      hasCaptcha
    )
  ) {
    normalizedWarnings.push(
      "CAPTCHA detected. Human interaction is required."
    );
  }

  return {
    applicationMethod:
      normalizeString(
        applicationMethod
      ),

    source:
      normalizedSource,

    url:
      normalizeUrl(
        url
      ),

    title:
      normalizeString(
        title
      ),

    description:
      normalizeString(
        description
      ),

    status:
      resolvedStatus,

    fields:
      normalizedFields,

    fieldCount:
      normalizedFields.length,

    requiredFieldCount:
      normalizedFields.filter(
        (field) =>
          field.required
      ).length,

    actionType:
      Object.values(
        FORM_ACTION_TYPES
      ).includes(
        actionType
      )
        ? actionType
        : FORM_ACTION_TYPES
            .UNKNOWN,

    requiresLogin:
      normalizeBoolean(
        requiresLogin
      ),

    hasCaptcha:
      normalizeBoolean(
        hasCaptcha
      ),

    multiStep:
      normalizeBoolean(
        multiStep
      ),

    currentStep:
      Math.max(
        Number(
          currentStep
        ) || 1,
        1
      ),

    totalSteps:
      totalSteps ===
        null ||
      totalSteps ===
        undefined ||
      totalSteps ===
        ""
        ? null
        : Math.max(
            Number(
              totalSteps
            ) || 1,
            1
          ),

    warnings:
      [
        ...new Set(
          normalizedWarnings
        ),
      ],

    metadata:
      metadata &&
      typeof metadata ===
        "object"
        ? {
            ...metadata,
          }
        : {},
  };
}

/*
 * ============================================================
 * CHECK WHETHER INSPECTION CAN BE RESOLVED
 * ============================================================
 */

function canResolveInspection(
  inspection
) {
  if (!inspection) {
    return false;
  }

  if (
    inspection.status ===
      INSPECTION_STATUSES.FAILED ||
    inspection.status ===
      INSPECTION_STATUSES.BLOCKED ||
    inspection.status ===
      INSPECTION_STATUSES.UNSUPPORTED
  ) {
    return false;
  }

  if (
    inspection.requiresLogin
  ) {
    return false;
  }

  if (
    inspection.hasCaptcha
  ) {
    return false;
  }

  if (
    !Array.isArray(
      inspection.fields
    )
  ) {
    return false;
  }

  return true;
}

/*
 * ============================================================
 * GET FIELDS REQUIRING HUMAN REVIEW
 * ============================================================
 */

function getInspectionReviewFields(
  inspection
) {
  if (
    !inspection ||
    !Array.isArray(
      inspection.fields
    )
  ) {
    return [];
  }

  return inspection.fields.filter(
    (field) =>
      field.requiresHumanReview
  );
}

/*
 * ============================================================
 * GET REQUIRED FIELDS
 * ============================================================
 */

function getRequiredFields(
  inspection
) {
  if (
    !inspection ||
    !Array.isArray(
      inspection.fields
    )
  ) {
    return [];
  }

  return inspection.fields.filter(
    (field) =>
      field.required
  );
}

/*
 * ============================================================
 * INSPECTION SUMMARY
 * ============================================================
 *
 * Useful for API responses and frontend display.
 */

function summarizeInspection(
  inspection
) {
  if (!inspection) {
    return {
      valid:
        false,

      fieldCount:
        0,

      requiredFieldCount:
        0,

      reviewFieldCount:
        0,

      canResolve:
        false,
    };
  }

  const reviewFields =
    getInspectionReviewFields(
      inspection
    );

  return {
    valid:
      true,

    status:
      inspection.status,

    fieldCount:
      Number(
        inspection.fieldCount ||
        0
      ),

    requiredFieldCount:
      Number(
        inspection.requiredFieldCount ||
        0
      ),

    reviewFieldCount:
      reviewFields.length,

    requiresLogin:
      Boolean(
        inspection.requiresLogin
      ),

    hasCaptcha:
      Boolean(
        inspection.hasCaptcha
      ),

    multiStep:
      Boolean(
        inspection.multiStep
      ),

    canResolve:
      canResolveInspection(
        inspection
      ),
  };
}

/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  /*
   * Main inspection builder.
   */
  buildFormInspection,

  /*
   * Field normalization.
   */
  normalizeFormField,
  normalizeFormFields,
  normalizeFieldType,
  normalizeOptions,

  /*
   * Inspection evaluation.
   */
  canResolveInspection,
  getInspectionReviewFields,
  getRequiredFields,
  summarizeInspection,

  /*
   * Utilities.
   */
  generateFieldId,
  normalizeUrl,

  /*
   * Shared constants.
   */
  FIELD_TYPES,
  VALID_FIELD_TYPES,
  INSPECTION_STATUSES,
  FORM_ACTION_TYPES,
};