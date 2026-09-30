const {
  FIELD_TYPES,
} = require(
  "../../formInspectionService"
);


const {
  buildFilledResult,
  buildFailedResult,
  buildNeedsReviewResult,
  buildBlockedResult,
} = require(
  "./interactionResult"
);


/*
 * ============================================================
 * TEXT FIELD INTERACTOR
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * Safely fill text-like application form controls using an
 * already-approved candidate answer.
 *
 * Supported JobVerse field types:
 *
 * - text
 * - textarea
 * - email
 * - phone
 * - number
 * - url
 * - date
 *
 *
 * ============================================================
 * IMPORTANT ARCHITECTURE RULE
 * ============================================================
 *
 * This module DOES NOT:
 *
 * - resolve candidate answers
 * - decide whether an answer is truthful
 * - locate form controls
 * - inspect application pages
 * - select dropdown options
 * - interact with radios/checkboxes
 * - navigate to another form step
 * - click Submit
 * - alter application lifecycle state
 *
 *
 * ============================================================
 * SAFETY RULE
 * ============================================================
 *
 * The caller must provide an answer that has already passed the
 * JobVerse resolution/verification workflow.
 *
 * This module still performs defensive validation before sending
 * the value to Playwright.
 * ============================================================
 */


/*
 * ============================================================
 * SUPPORTED FIELD TYPES
 * ============================================================
 */

const TEXT_FIELD_TYPES =
  new Set([
    FIELD_TYPES.TEXT,
    FIELD_TYPES.TEXTAREA,
    FIELD_TYPES.EMAIL,
    FIELD_TYPES.PHONE,
    FIELD_TYPES.NUMBER,
    FIELD_TYPES.URL,
    FIELD_TYPES.DATE,
  ]);


/*
 * ============================================================
 * ERROR CODES
 * ============================================================
 */

const TEXT_FIELD_ERROR_CODES =
  Object.freeze({
    LOCATOR_REQUIRED:
      "TEXT_FIELD_LOCATOR_REQUIRED",

    FIELD_REQUIRED:
      "TEXT_FIELD_REQUIRED",

    RESOLUTION_REQUIRED:
      "TEXT_FIELD_RESOLUTION_REQUIRED",

    UNSUPPORTED_TYPE:
      "TEXT_FIELD_UNSUPPORTED_TYPE",

    EMPTY_VALUE:
      "TEXT_FIELD_EMPTY_VALUE",

    INVALID_NUMBER:
      "TEXT_FIELD_INVALID_NUMBER",

    INVALID_DATE:
      "TEXT_FIELD_INVALID_DATE",

    INVALID_URL:
      "TEXT_FIELD_INVALID_URL",

    PASSWORD_BLOCKED:
      "TEXT_FIELD_PASSWORD_BLOCKED",

    NOT_VISIBLE:
      "TEXT_FIELD_NOT_VISIBLE",

    DISABLED:
      "TEXT_FIELD_DISABLED",

    NOT_EDITABLE:
      "TEXT_FIELD_NOT_EDITABLE",

    FILL_FAILED:
      "TEXT_FIELD_FILL_FAILED",

    VALUE_MISMATCH:
      "TEXT_FIELD_VALUE_MISMATCH",
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
 * SUPPORTED FIELD CHECK
 * ============================================================
 */

function isTextFieldType(
  fieldType
) {
  return TEXT_FIELD_TYPES.has(
    normalizeLower(
      fieldType
    )
  );
}


/*
 * ============================================================
 * PASSWORD DEFENSE
 * ============================================================
 *
 * Password inputs are already filtered by formInspector.js.
 *
 * We deliberately check again here because:
 *
 * inspection time
 *      ↓
 * DOM may change
 *      ↓
 * interaction time
 *
 * Defense in depth is appropriate for authentication fields.
 */

function isPasswordField(
  field
) {
  return (
    normalizeLower(
      field?.metadata
        ?.inputType
    ) ===
    "password"
  );
}


/*
 * ============================================================
 * DATE NORMALIZATION
 * ============================================================
 *
 * Native HTML date inputs expect:
 *
 * YYYY-MM-DD
 *
 * We deliberately do not interpret ambiguous values such as:
 *
 * 03/04/2026
 *
 * because that could mean March 4 or April 3 depending on locale.
 */

function normalizeDateValue(
  value
) {
  if (
    value instanceof Date
  ) {
    if (
      Number.isNaN(
        value.getTime()
      )
    ) {
      return null;
    }


    return value
      .toISOString()
      .slice(
        0,
        10
      );
  }


  const normalized =
    normalizeString(
      value
    );


  if (
    !/^\d{4}-\d{2}-\d{2}$/
      .test(
        normalized
      )
  ) {
    return null;
  }


  /*
   * Validate calendar correctness.
   *
   * Example:
   *
   * 2026-02-31
   *
   * matches the regex but is not a real calendar date.
   */
  const [
    year,
    month,
    day,
  ] =
    normalized
      .split("-")
      .map(Number);


  const parsed =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day
      )
    );


  if (
    parsed.getUTCFullYear() !==
      year ||
    parsed.getUTCMonth() !==
      month - 1 ||
    parsed.getUTCDate() !==
      day
  ) {
    return null;
  }


  return normalized;
}


/*
 * ============================================================
 * NUMBER NORMALIZATION
 * ============================================================
 */

function normalizeNumberValue(
  value
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }


  const number =
    Number(
      value
    );


  if (
    !Number.isFinite(
      number
    )
  ) {
    return null;
  }


  return String(
    value
  ).trim();
}


/*
 * ============================================================
 * URL NORMALIZATION
 * ============================================================
 *
 * Only normal web URLs are accepted.
 *
 * This prevents schemes such as:
 *
 * javascript:
 * data:
 * file:
 */

function normalizeUrlValue(
  value
) {
  const normalized =
    normalizeString(
      value
    );


  if (
    !normalized
  ) {
    return null;
  }


  try {
    const parsed =
      new URL(
        normalized
      );


    if (
      ![
        "http:",
        "https:",
      ].includes(
        parsed.protocol
      )
    ) {
      return null;
    }


    return parsed.toString();
  } catch (_) {
    return null;
  }
}


/*
 * ============================================================
 * NORMALIZE VALUE FOR FIELD
 * ============================================================
 */

function normalizeTextFieldValue({
  field,
  value,
}) {
  const fieldType =
    normalizeLower(
      field?.fieldType
    );


  switch (
    fieldType
  ) {
    case FIELD_TYPES.NUMBER: {
      const normalized =
        normalizeNumberValue(
          value
        );


      if (
        normalized === null
      ) {
        return {
          valid:
            false,

          code:
            TEXT_FIELD_ERROR_CODES
              .INVALID_NUMBER,

          reason:
            "Candidate answer is not a valid finite number.",
        };
      }


      return {
        valid:
          true,

        value:
          normalized,
      };
    }


    case FIELD_TYPES.DATE: {
      const normalized =
        normalizeDateValue(
          value
        );


      if (
        normalized === null
      ) {
        return {
          valid:
            false,

          code:
            TEXT_FIELD_ERROR_CODES
              .INVALID_DATE,

          reason:
            "Date answer must use an unambiguous YYYY-MM-DD value.",
        };
      }


      return {
        valid:
          true,

        value:
          normalized,
      };
    }


    case FIELD_TYPES.URL: {
      const normalized =
        normalizeUrlValue(
          value
        );


      if (
        normalized === null
      ) {
        return {
          valid:
            false,

          code:
            TEXT_FIELD_ERROR_CODES
              .INVALID_URL,

          reason:
            "Candidate answer is not a valid HTTP(S) URL.",
        };
      }


      return {
        valid:
          true,

        value:
          normalized,
      };
    }


    default: {
      /*
       * TEXT / TEXTAREA / EMAIL / PHONE
       *
       * We preserve the actual candidate-provided content but
       * reject completely empty values.
       */
      const normalized =
        String(
          value ??
          ""
        );


      if (
        !normalized.trim()
      ) {
        return {
          valid:
            false,

          code:
            TEXT_FIELD_ERROR_CODES
              .EMPTY_VALUE,

          reason:
            "Candidate answer is empty.",
        };
      }


      return {
        valid:
          true,

        value:
          normalized,
      };
    }
  }
}


/*
 * ============================================================
 * CHECK LIVE CONTROL STATE
 * ============================================================
 */

async function inspectTextControlState(
  locator
) {
  const [
    visible,
    enabled,
    editable,
  ] =
    await Promise.all([
      locator.isVisible(),
      locator.isEnabled(),
      locator.isEditable(),
    ]);


  return {
    visible,
    enabled,
    editable,
  };
}


/*
 * ============================================================
 * READ INPUT TYPE FROM LIVE DOM
 * ============================================================
 *
 * We do not read the field value here.
 *
 * We only inspect the control's type attribute so that a page
 * that changed after inspection cannot trick the automation into
 * filling a password control.
 */

async function getLiveInputType(
  locator
) {
  try {
    return normalizeLower(
      await locator
        .getAttribute(
          "type"
        )
    );
  } catch (_) {
    return "";
  }
}


/*
 * ============================================================
 * VERIFY FILLED VALUE
 * ============================================================
 *
 * Stage 8 will introduce broader post-fill validation.
 *
 * Stage 2 still performs a minimal immediate verification because
 * a successful Playwright .fill() call does not guarantee that a
 * framework did not immediately rewrite/reject the value.
 */

async function verifyTextFieldValue({
  locator,
  expectedValue,
}) {
  try {
    const actualValue =
      await locator
        .inputValue();


    return {
      matches:
        actualValue ===
        expectedValue,

      actualLength:
        actualValue.length,

      expectedLength:
        expectedValue.length,
    };
  } catch (_) {
    return {
      matches:
        false,

      actualLength:
        null,

      expectedLength:
        expectedValue.length,
    };
  }
}


/*
 * ============================================================
 * FILL TEXT FIELD
 * ============================================================
 *
 * MAIN PUBLIC FUNCTION.
 */

async function fillTextField({
  locator,
  field,
  resolution,
}) {
  /*
   * ----------------------------------------------------------
   * BASIC INPUT VALIDATION
   * ----------------------------------------------------------
   */

  if (
    !locator
  ) {
    return buildBlockedResult(
      field,
      "Playwright locator is required for text-field interaction.",
      {
        errorCode:
          TEXT_FIELD_ERROR_CODES
            .LOCATOR_REQUIRED,
      }
    );
  }


  if (
    !field ||
    typeof field !==
      "object"
  ) {
    return buildBlockedResult(
      field || {},
      "Normalized form field is required.",
      {
        errorCode:
          TEXT_FIELD_ERROR_CODES
            .FIELD_REQUIRED,
      }
    );
  }


  if (
    !resolution ||
    typeof resolution !==
      "object"
  ) {
    return buildNeedsReviewResult(
      field,
      "Approved candidate answer is required before the field can be filled.",
      {
        errorCode:
          TEXT_FIELD_ERROR_CODES
            .RESOLUTION_REQUIRED,
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * FIELD TYPE
   * ----------------------------------------------------------
   */

  if (
    !isTextFieldType(
      field.fieldType
    )
  ) {
    return buildFailedResult(
      field,
      `Field type "${normalizeString(
        field.fieldType
      )}" is not supported by the text-field interactor.`,
      {
        errorCode:
          TEXT_FIELD_ERROR_CODES
            .UNSUPPORTED_TYPE,
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * PASSWORD SAFETY — INSPECTED METADATA
   * ----------------------------------------------------------
   */

  if (
    isPasswordField(
      field
    )
  ) {
    return buildBlockedResult(
      field,
      "Password fields are never eligible for JobVerse form filling.",
      {
        errorCode:
          TEXT_FIELD_ERROR_CODES
            .PASSWORD_BLOCKED,
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * PASSWORD SAFETY — LIVE DOM
   * ----------------------------------------------------------
   */

  const liveInputType =
    await getLiveInputType(
      locator
    );


  if (
    liveInputType ===
    "password"
  ) {
    return buildBlockedResult(
      field,
      "The live form control is a password field and cannot be automated.",
      {
        errorCode:
          TEXT_FIELD_ERROR_CODES
            .PASSWORD_BLOCKED,
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * ANSWER NORMALIZATION
   * ----------------------------------------------------------
   */

  const normalizedValue =
    normalizeTextFieldValue({
      field,

      value:
        resolution.value,
    });


  if (
    !normalizedValue.valid
  ) {
    return buildNeedsReviewResult(
      field,
      normalizedValue.reason,
      {
        errorCode:
          normalizedValue.code,
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * CONTROL STATE
   * ----------------------------------------------------------
   */

  let controlState;


  try {
    controlState =
      await inspectTextControlState(
        locator
      );
  } catch (
    error
  ) {
    return buildBlockedResult(
      field,
      "Unable to inspect the live form control before filling.",
      {
        errorCode:
          TEXT_FIELD_ERROR_CODES
            .FILL_FAILED,

        metadata: {
          browserError:
            normalizeString(
              error?.message
            ) ||
            null,
        },
      }
    );
  }


  if (
    !controlState.visible
  ) {
    return buildBlockedResult(
      field,
      "The form control is not currently visible.",
      {
        errorCode:
          TEXT_FIELD_ERROR_CODES
            .NOT_VISIBLE,
      }
    );
  }


  if (
    !controlState.enabled
  ) {
    return buildBlockedResult(
      field,
      "The form control is disabled.",
      {
        errorCode:
          TEXT_FIELD_ERROR_CODES
            .DISABLED,
      }
    );
  }


  if (
    !controlState.editable
  ) {
    return buildBlockedResult(
      field,
      "The form control is not editable.",
      {
        errorCode:
          TEXT_FIELD_ERROR_CODES
            .NOT_EDITABLE,
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * PLAYWRIGHT FILL
   * ----------------------------------------------------------
   */

  try {
    await locator.fill(
      normalizedValue.value
    );
  } catch (
    error
  ) {
    return buildFailedResult(
      field,
      "Playwright could not fill the form control.",
      {
        errorCode:
          TEXT_FIELD_ERROR_CODES
            .FILL_FAILED,

        metadata: {
          browserError:
            normalizeString(
              error?.message
            ) ||
            null,
        },
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * IMMEDIATE VERIFICATION
   * ----------------------------------------------------------
   */

  const verification =
    await verifyTextFieldValue({
      locator,

      expectedValue:
        normalizedValue.value,
    });


  if (
    !verification.matches
  ) {
    return buildFailedResult(
      field,
      "The browser control did not retain the expected value after filling.",
      {
        errorCode:
          TEXT_FIELD_ERROR_CODES
            .VALUE_MISMATCH,

        metadata: {
          expectedLength:
            verification
              .expectedLength,

          actualLength:
            verification
              .actualLength,
        },
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * SUCCESS
   * ----------------------------------------------------------
   *
   * Notice that we deliberately do NOT return the candidate's
   * raw value.
   *
   * This reduces sensitive data exposure in logs and API results.
   */

  return buildFilledResult(
    field,
    {
      interaction:
        "fill",

      verified:
        true,

      valueLength:
        normalizedValue
          .value
          .length,
    }
  );
}


/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  TEXT_FIELD_TYPES,

  TEXT_FIELD_ERROR_CODES,

  isTextFieldType,

  normalizeDateValue,

  normalizeNumberValue,

  normalizeUrlValue,

  normalizeTextFieldValue,

  inspectTextControlState,

  getLiveInputType,

  verifyTextFieldValue,

  fillTextField,
};