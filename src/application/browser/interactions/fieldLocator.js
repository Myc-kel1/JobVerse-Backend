/*
 * ============================================================
 * FIELD LOCATOR
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * Resolve a normalized JobVerse form field into a safe
 * Playwright Locator pointing at the corresponding live control.
 *
 * The form inspector already gives us:
 *
 * - platformFieldId
 * - platformFieldName
 * - label
 * - placeholder
 * - metadata.tagName
 * - metadata.inputType
 * - metadata.role
 *
 * This module converts that information into a deterministic
 * locator strategy.
 *
 * ============================================================
 * IMPORTANT ARCHITECTURE RULE
 * ============================================================
 *
 * This file DOES NOT:
 *
 * - fill form values
 * - resolve candidate answers
 * - choose select/radio options
 * - upload files
 * - click Next
 * - click Submit
 * - change application lifecycle state
 *
 * It ONLY locates browser controls.
 * ============================================================
 */


/*
 * ============================================================
 * LOCATOR STRATEGIES
 * ============================================================
 *
 * These are returned in metadata so tests and later execution
 * logs can tell HOW JobVerse located a field without exposing
 * the candidate answer.
 */

const FIELD_LOCATOR_STRATEGIES =
  Object.freeze({
    PLATFORM_ID:
      "platform_id",

    PLATFORM_NAME:
      "platform_name",

    LABEL:
      "label",

    ROLE:
      "role",

    PLACEHOLDER:
      "placeholder",
  });


/*
 * ============================================================
 * ERROR CODES
 * ============================================================
 */

const FIELD_LOCATOR_ERROR_CODES =
  Object.freeze({
    PAGE_REQUIRED:
      "PAGE_REQUIRED",

    FIELD_REQUIRED:
      "FIELD_REQUIRED",

    NOT_FOUND:
      "FIELD_NOT_FOUND",

    AMBIGUOUS:
      "FIELD_LOCATOR_AMBIGUOUS",

    UNSUPPORTED:
      "FIELD_LOCATOR_UNSUPPORTED",
  });


/*
 * ============================================================
 * ERROR TYPE
 * ============================================================
 */

class FieldLocatorError extends Error {
  constructor(
    message,
    {
      code =
        FIELD_LOCATOR_ERROR_CODES
          .NOT_FOUND,

      details = null,
    } = {}
  ) {
    super(message);

    this.name =
      "FieldLocatorError";

    this.code =
      code;

    this.details =
      details;
  }
}


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
 * CSS ESCAPING
 * ============================================================
 *
 * Playwright accepts normal CSS selectors.
 *
 * External systems may use IDs/names containing characters such
 * as:
 *
 * :
 * .
 * [
 * ]
 * /
 *
 * Instead of manually escaping those values into CSS syntax, we
 * use attribute selectors and quote/escape the attribute value.
 */

function escapeCssAttributeValue(
  value
) {
  return normalizeString(
    value
  )
    .replace(
      /\\/g,
      "\\\\"
    )
    .replace(
      /"/g,
      '\\"'
    );
}


/*
 * ============================================================
 * CONTROL METADATA
 * ============================================================
 */

function getFieldMetadata(
  field
) {
  const metadata =
    field?.metadata &&
    typeof field.metadata ===
      "object"
      ? field.metadata
      : {};

  return {
    tagName:
      normalizeLower(
        metadata.tagName
      ),

    inputType:
      normalizeLower(
        metadata.inputType
      ),

    role:
      normalizeLower(
        metadata.role
      ),
  };
}


/*
 * ============================================================
 * PASSWORD SAFETY
 * ============================================================
 *
 * Password fields must never enter automated application-answer
 * handling.
 *
 * The current inspector already excludes password inputs, but we
 * keep this second defensive guard because live DOM state may
 * differ from earlier inspection.
 */

function isPasswordField(
  field
) {
  const {
    inputType,
  } =
    getFieldMetadata(
      field
    );

  return (
    inputType ===
    "password"
  );
}


/*
 * ============================================================
 * EXPECTED ROLE
 * ============================================================
 *
 * Used only as a semantic fallback.
 *
 * We do not blindly infer exotic roles. Only ordinary native/
 * accessible control mappings are allowed here.
 */

function inferExpectedRole(
  field
) {
  const {
    tagName,
    inputType,
    role,
  } =
    getFieldMetadata(
      field
    );

  /*
   * Prefer the explicit inspected ARIA role.
   */
  if (
    role
  ) {
    return role;
  }


  if (
    tagName ===
    "textarea"
  ) {
    return "textbox";
  }


  if (
    tagName ===
    "select"
  ) {
    return "combobox";
  }


  if (
    tagName ===
    "input"
  ) {
    if (
      inputType ===
      "radio"
    ) {
      return "radio";
    }


    if (
      inputType ===
      "checkbox"
    ) {
      return "checkbox";
    }


    if (
      [
        "",
        "text",
        "email",
        "tel",
        "number",
        "url",
        "date",
        "search",
      ].includes(
        inputType
      )
    ) {
      return "textbox";
    }
  }


  return null;
}


/*
 * ============================================================
 * BUILD LOCATOR CANDIDATES
 * ============================================================
 *
 * Priority:
 *
 * 1. external DOM ID
 * 2. external name
 * 3. accessible label
 * 4. role + accessible name
 * 5. placeholder
 *
 * We intentionally do NOT generate brittle nth-child paths.
 */

function buildLocatorCandidates({
  page,
  field,
}) {
  const candidates =
    [];

  const platformFieldId =
    normalizeString(
      field?.platformFieldId
    );

  const platformFieldName =
    normalizeString(
      field?.platformFieldName
    );

  const label =
    normalizeString(
      field?.label
    );

  const placeholder =
    normalizeString(
      field?.placeholder
    );

  const expectedRole =
    inferExpectedRole(
      field
    );


  /*
   * ----------------------------------------------------------
   * 1. PLATFORM FIELD ID
   * ----------------------------------------------------------
   */

  if (
    platformFieldId
  ) {
    const escaped =
      escapeCssAttributeValue(
        platformFieldId
      );

    candidates.push({
      strategy:
        FIELD_LOCATOR_STRATEGIES
          .PLATFORM_ID,

      locator:
        page.locator(
          `[id="${escaped}"]`
        ),

      description:
        `id="${platformFieldId}"`,
    });
  }


  /*
   * ----------------------------------------------------------
   * 2. PLATFORM FIELD NAME
   * ----------------------------------------------------------
   */

  if (
    platformFieldName
  ) {
    const escaped =
      escapeCssAttributeValue(
        platformFieldName
      );

    candidates.push({
      strategy:
        FIELD_LOCATOR_STRATEGIES
          .PLATFORM_NAME,

      locator:
        page.locator(
          `[name="${escaped}"]`
        ),

      description:
        `name="${platformFieldName}"`,
    });
  }


  /*
   * ----------------------------------------------------------
   * 3. ACCESSIBLE LABEL
   * ----------------------------------------------------------
   *
   * Playwright's getByLabel handles:
   *
   * <label for="">
   * wrapping labels
   * aria-label
   * aria-labelledby
   *
   * which makes it much stronger than manually walking DOM
   * relationships.
   */

  if (
    label
  ) {
    candidates.push({
      strategy:
        FIELD_LOCATOR_STRATEGIES
          .LABEL,

      locator:
        page.getByLabel(
          label,
          {
            exact: true,
          }
        ),

      description:
        `label="${label}"`,
    });
  }


  /*
   * ----------------------------------------------------------
   * 4. ROLE + ACCESSIBLE NAME
   * ----------------------------------------------------------
   */

  if (
    expectedRole &&
    label
  ) {
    candidates.push({
      strategy:
        FIELD_LOCATOR_STRATEGIES
          .ROLE,

      locator:
        page.getByRole(
          expectedRole,
          {
            name:
              label,

            exact:
              true,
          }
        ),

      description:
        `role="${expectedRole}", name="${label}"`,
    });
  }


  /*
   * ----------------------------------------------------------
   * 5. PLACEHOLDER
   * ----------------------------------------------------------
   */

  if (
    placeholder
  ) {
    candidates.push({
      strategy:
        FIELD_LOCATOR_STRATEGIES
          .PLACEHOLDER,

      locator:
        page.getByPlaceholder(
          placeholder,
          {
            exact: true,
          }
        ),

      description:
        `placeholder="${placeholder}"`,
    });
  }


  return candidates;
}


/*
 * ============================================================
 * CHECK LOCATOR
 * ============================================================
 *
 * A candidate locator is considered usable only when it resolves
 * to exactly ONE element.
 *
 * Zero:
 *   not found by this strategy.
 *
 * More than one:
 *   ambiguous; do not guess.
 */

async function inspectLocatorCandidate(
  candidate
) {
  const count =
    await candidate
      .locator
      .count();

  return {
    ...candidate,

    count,
  };
}


/*
 * ============================================================
 * RESOLVE FIELD LOCATOR
 * ============================================================
 *
 * This is the main public function.
 *
 * It returns:
 *
 * {
 *   locator,
 *   strategy,
 *   description
 * }
 *
 * It does NOT interact with the locator.
 */

async function resolveFieldLocator({
  page,
  field,
}) {
  if (
    !page
  ) {
    throw new FieldLocatorError(
      "Playwright page is required.",
      {
        code:
          FIELD_LOCATOR_ERROR_CODES
            .PAGE_REQUIRED,
      }
    );
  }


  if (
    !field ||
    typeof field !==
      "object"
  ) {
    throw new FieldLocatorError(
      "Normalized form field is required.",
      {
        code:
          FIELD_LOCATOR_ERROR_CODES
            .FIELD_REQUIRED,
      }
    );
  }


  /*
   * Passwords remain blocked even if they somehow escaped
   * inspection filtering.
   */
  if (
    isPasswordField(
      field
    )
  ) {
    throw new FieldLocatorError(
      "Password fields are not eligible for automated interaction.",
      {
        code:
          FIELD_LOCATOR_ERROR_CODES
            .UNSUPPORTED,

        details: {
          fieldId:
            normalizeString(
              field.fieldId
            ) ||
            null,
        },
      }
    );
  }


  const candidates =
    buildLocatorCandidates({
      page,
      field,
    });


  if (
    candidates.length ===
    0
  ) {
    throw new FieldLocatorError(
      "No safe locator strategy could be built for the form field.",
      {
        code:
          FIELD_LOCATOR_ERROR_CODES
            .NOT_FOUND,

        details: {
          fieldId:
            normalizeString(
              field.fieldId
            ) ||
            null,

          label:
            normalizeString(
              field.label
            ) ||
            null,
        },
      }
    );
  }


  const ambiguousStrategies =
    [];


  for (
    const candidate of
    candidates
  ) {
    const inspected =
      await inspectLocatorCandidate(
        candidate
      );


    /*
     * Exactly one match is safe.
     */
    if (
      inspected.count ===
      1
    ) {
      return {
        locator:
          inspected.locator,

        strategy:
          inspected.strategy,

        description:
          inspected.description,
      };
    }


    /*
     * Preserve ambiguity information so we do not silently fall
     * through and pretend nothing matched.
     */
    if (
      inspected.count >
      1
    ) {
      ambiguousStrategies.push({
        strategy:
          inspected.strategy,

        description:
          inspected.description,

        count:
          inspected.count,
      });
    }
  }


  /*
   * If a strong identifier matched multiple elements, the field
   * is ambiguous and requires review.
   */
  if (
    ambiguousStrategies.length >
    0
  ) {
    throw new FieldLocatorError(
      "Form field locator matched multiple browser controls.",
      {
        code:
          FIELD_LOCATOR_ERROR_CODES
            .AMBIGUOUS,

        details: {
          fieldId:
            normalizeString(
              field.fieldId
            ) ||
            null,

          label:
            normalizeString(
              field.label
            ) ||
            null,

          ambiguousStrategies,
        },
      }
    );
  }


  throw new FieldLocatorError(
    "Form field could not be found on the current page.",
    {
      code:
        FIELD_LOCATOR_ERROR_CODES
          .NOT_FOUND,

      details: {
        fieldId:
          normalizeString(
            field.fieldId
          ) ||
          null,

        platformFieldId:
          normalizeString(
            field.platformFieldId
          ) ||
          null,

        platformFieldName:
          normalizeString(
            field.platformFieldName
          ) ||
          null,

        label:
          normalizeString(
            field.label
          ) ||
          null,
      },
    }
  );
}


/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  FIELD_LOCATOR_STRATEGIES,

  FIELD_LOCATOR_ERROR_CODES,

  FieldLocatorError,

  inferExpectedRole,

  buildLocatorCandidates,

  resolveFieldLocator,
};