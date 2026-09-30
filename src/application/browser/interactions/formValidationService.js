const {
  FIELD_TYPES,
} = require(
  "../../formInspectionService"
);


const {
  resolveFieldLocator,
  FieldLocatorError,
} = require(
  "./fieldLocator"
);


const {
  isNativeRadioField,
  buildRadioGroupLocator,
  inspectRadioOptions,
} = require(
  "./radioInteractor"
);


const {
  isNativeCheckboxField,
  buildCheckboxLocator,
  inspectCheckboxOptions,
} = require(
  "./checkboxInteractor"
);


const {
  isNativeFileField,
  getAttachedFileCount,
} = require(
  "./fileInputInteractor"
);


const {
  isSupportedCustomControl,
  getCustomRole,
} = require(
  "./customControlInteractor"
);


/*
 * ============================================================
 * FORM POST-FILL VALIDATION
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * Re-inspect the CURRENT rendered page after JobVerse has filled
 * approved application-form answers.
 *
 * This validation pass confirms observable browser state such as:
 *
 * - text values are non-empty where required
 * - selects have a selected value
 * - radio groups have a checked option
 * - checkbox groups reflect a usable state
 * - file inputs contain an attached file
 * - custom ARIA controls expose a selected/checked state
 *
 *
 * ============================================================
 * IMPORTANT ARCHITECTURAL RULE
 * ============================================================
 *
 * This module DOES NOT:
 *
 * - change form values
 * - click controls
 * - resolve answers
 * - infer candidate data
 * - navigate to another step
 * - submit the form
 *
 * It only OBSERVES and REPORTS.
 * ============================================================
 */


/*
 * ============================================================
 * VALIDATION STATUSES
 * ============================================================
 */

const FIELD_VALIDATION_STATUSES =
  Object.freeze({
    VALID:
      "valid",

    INVALID:
      "invalid",

    SKIPPED:
      "skipped",

    NEEDS_REVIEW:
      "needs_review",

    NOT_FOUND:
      "not_found",
  });


const FORM_VALIDATION_STATUSES =
  Object.freeze({
    VALID:
      "valid",

    PARTIAL:
      "partial",

    INVALID:
      "invalid",

    NEEDS_REVIEW:
      "needs_review",
  });


/*
 * ============================================================
 * VALIDATION ERROR CODES
 * ============================================================
 */

const FORM_VALIDATION_ERROR_CODES =
  Object.freeze({
    FIELD_NOT_FOUND:
      "VALIDATION_FIELD_NOT_FOUND",

    REQUIRED_EMPTY:
      "VALIDATION_REQUIRED_EMPTY",

    VALUE_MISSING:
      "VALIDATION_VALUE_MISSING",

    OPTION_NOT_SELECTED:
      "VALIDATION_OPTION_NOT_SELECTED",

    RADIO_NOT_SELECTED:
      "VALIDATION_RADIO_NOT_SELECTED",

    CHECKBOX_STATE_INVALID:
      "VALIDATION_CHECKBOX_STATE_INVALID",

    FILE_NOT_ATTACHED:
      "VALIDATION_FILE_NOT_ATTACHED",

    ARIA_STATE_UNKNOWN:
      "VALIDATION_ARIA_STATE_UNKNOWN",

    CONTROL_UNSUPPORTED:
      "VALIDATION_CONTROL_UNSUPPORTED",

    BROWSER_ERROR:
      "VALIDATION_BROWSER_ERROR",
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
 * RESULT BUILDERS
 * ============================================================
 */

function buildFieldValidationResult({
  field,
  status,
  reason = null,
  errorCode = null,
  metadata = {},
}) {
  return {
    fieldId:
      normalizeString(
        field?.fieldId
      ) ||
      null,

    platformFieldId:
      normalizeString(
        field?.platformFieldId
      ) ||
      null,

    platformFieldName:
      normalizeString(
        field?.platformFieldName
      ) ||
      null,

    label:
      normalizeString(
        field?.label
      ),

    fieldType:
      normalizeString(
        field?.fieldType
      ),

    required:
      Boolean(
        field?.required
      ),

    status,

    reason:
      normalizeString(
        reason
      ) ||
      null,

    errorCode:
      normalizeString(
        errorCode
      ) ||
      null,

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
 * TEXT-LIKE VALIDATION
 * ============================================================
 */

function isTextLikeField(
  field
) {
  return [
    FIELD_TYPES.TEXT,
    FIELD_TYPES.TEXTAREA,
    FIELD_TYPES.EMAIL,
    FIELD_TYPES.PHONE,
    FIELD_TYPES.NUMBER,
    FIELD_TYPES.DATE,
    FIELD_TYPES.URL,
  ].includes(
    field?.fieldType
  );
}


async function validateTextLikeField({
  locator,
  field,
}) {
  try {
    const value =
      await locator
        .inputValue();


    const hasValue =
      normalizeString(
        value
      ).length >
      0;


    if (
      field.required &&
      !hasValue
    ) {
      return buildFieldValidationResult({
        field,

        status:
          FIELD_VALIDATION_STATUSES
            .INVALID,

        reason:
          "Required text field is empty after interaction.",

        errorCode:
          FORM_VALIDATION_ERROR_CODES
            .REQUIRED_EMPTY,
      });
    }


    return buildFieldValidationResult({
      field,

      status:
        FIELD_VALIDATION_STATUSES
          .VALID,

      metadata: {
        hasValue,

        valueLength:
          String(
            value ??
            ""
          ).length,
      },
    });
  } catch (
    error
  ) {
    return buildFieldValidationResult({
      field,

      status:
        FIELD_VALIDATION_STATUSES
          .INVALID,

      reason:
        "Unable to read the live text-field value.",

      errorCode:
        FORM_VALIDATION_ERROR_CODES
          .BROWSER_ERROR,

      metadata: {
        browserError:
          normalizeString(
            error?.message
          ) ||
          null,
      },
    });
  }
}


/*
 * ============================================================
 * NATIVE SELECT VALIDATION
 * ============================================================
 */

async function validateNativeSelect({
  locator,
  field,
}) {
  try {
    const value =
      await locator
        .inputValue();


    const selected =
      normalizeString(
        value
      ).length >
      0;


    if (
      field.required &&
      !selected
    ) {
      return buildFieldValidationResult({
        field,

        status:
          FIELD_VALIDATION_STATUSES
            .INVALID,

        reason:
          "Required dropdown does not currently have a selected value.",

        errorCode:
          FORM_VALIDATION_ERROR_CODES
            .OPTION_NOT_SELECTED,
      });
    }


    return buildFieldValidationResult({
      field,

      status:
        FIELD_VALIDATION_STATUSES
          .VALID,

      metadata: {
        hasSelection:
          selected,
      },
    });
  } catch (
    error
  ) {
    return buildFieldValidationResult({
      field,

      status:
        FIELD_VALIDATION_STATUSES
          .INVALID,

      reason:
        "Unable to validate native dropdown state.",

      errorCode:
        FORM_VALIDATION_ERROR_CODES
          .BROWSER_ERROR,

      metadata: {
        browserError:
          normalizeString(
            error?.message
          ) ||
          null,
      },
    });
  }
}


/*
 * ============================================================
 * RADIO VALIDATION
 * ============================================================
 */

async function validateRadioField({
  page,
  field,
}) {
  const groupLocator =
    buildRadioGroupLocator({
      page,
      field,
    });


  if (
    !groupLocator
  ) {
    return buildFieldValidationResult({
      field,

      status:
        FIELD_VALIDATION_STATUSES
          .NOT_FOUND,

      reason:
        "Radio group could not be located for post-fill validation.",

      errorCode:
        FORM_VALIDATION_ERROR_CODES
          .FIELD_NOT_FOUND,
    });
  }


  try {
    const options =
      await inspectRadioOptions(
        groupLocator
      );


    const selected =
      options.filter(
        (option) =>
          option.checked
      );


    if (
      field.required &&
      selected.length ===
      0
    ) {
      return buildFieldValidationResult({
        field,

        status:
          FIELD_VALIDATION_STATUSES
            .INVALID,

        reason:
          "Required radio group has no selected option.",

        errorCode:
          FORM_VALIDATION_ERROR_CODES
            .RADIO_NOT_SELECTED,
      });
    }


    if (
      selected.length >
      1
    ) {
      return buildFieldValidationResult({
        field,

        status:
          FIELD_VALIDATION_STATUSES
            .NEEDS_REVIEW,

        reason:
          "Radio group reports more than one checked option.",

        errorCode:
          FORM_VALIDATION_ERROR_CODES
            .RADIO_NOT_SELECTED,
      });
    }


    return buildFieldValidationResult({
      field,

      status:
        FIELD_VALIDATION_STATUSES
          .VALID,

      metadata: {
        selectedCount:
          selected.length,

        optionCount:
          options.length,
      },
    });
  } catch (
    error
  ) {
    return buildFieldValidationResult({
      field,

      status:
        FIELD_VALIDATION_STATUSES
          .INVALID,

      reason:
        "Unable to validate radio group.",

      errorCode:
        FORM_VALIDATION_ERROR_CODES
          .BROWSER_ERROR,

      metadata: {
        browserError:
          normalizeString(
            error?.message
          ) ||
          null,
      },
    });
  }
}


/*
 * ============================================================
 * CHECKBOX VALIDATION
 * ============================================================
 */

async function validateCheckboxField({
  page,
  field,
}) {
  const locator =
    buildCheckboxLocator({
      page,
      field,
    });


  if (
    !locator
  ) {
    return buildFieldValidationResult({
      field,

      status:
        FIELD_VALIDATION_STATUSES
          .NOT_FOUND,

      reason:
        "Checkbox control could not be located for validation.",

      errorCode:
        FORM_VALIDATION_ERROR_CODES
          .FIELD_NOT_FOUND,
    });
  }


  try {
    const options =
      await inspectCheckboxOptions(
        locator
      );


    const checkedCount =
      options.filter(
        (option) =>
          option.checked
      ).length;


    /*
     * Required multi-choice checkbox groups should have at least
     * one selected member.
     *
     * Boolean/consent semantics are handled more conservatively,
     * because required=true does not always mean checked=true for
     * every external system.
     */
    if (
      field.required &&
      field.fieldType ===
        FIELD_TYPES.MULTI_CHOICE &&
      checkedCount ===
        0
    ) {
      return buildFieldValidationResult({
        field,

        status:
          FIELD_VALIDATION_STATUSES
            .INVALID,

        reason:
          "Required checkbox group has no selected option.",

        errorCode:
          FORM_VALIDATION_ERROR_CODES
            .CHECKBOX_STATE_INVALID,
      });
    }


    return buildFieldValidationResult({
      field,

      status:
        FIELD_VALIDATION_STATUSES
          .VALID,

      metadata: {
        optionCount:
          options.length,

        checkedCount,
      },
    });
  } catch (
    error
  ) {
    return buildFieldValidationResult({
      field,

      status:
        FIELD_VALIDATION_STATUSES
          .INVALID,

      reason:
        "Unable to validate checkbox state.",

      errorCode:
        FORM_VALIDATION_ERROR_CODES
          .BROWSER_ERROR,

      metadata: {
        browserError:
          normalizeString(
            error?.message
          ) ||
          null,
      },
    });
  }
}


/*
 * ============================================================
 * FILE INPUT VALIDATION
 * ============================================================
 */

async function validateFileField({
  locator,
  field,
}) {
  const count =
    await getAttachedFileCount(
      locator
    );


  if (
    field.required &&
    count ===
      0
  ) {
    return buildFieldValidationResult({
      field,

      status:
        FIELD_VALIDATION_STATUSES
          .INVALID,

      reason:
        "Required file input has no attached document.",

      errorCode:
        FORM_VALIDATION_ERROR_CODES
          .FILE_NOT_ATTACHED,
    });
  }


  return buildFieldValidationResult({
    field,

    status:
      FIELD_VALIDATION_STATUSES
        .VALID,

    metadata: {
      attachedCount:
        count,
    },
  });
}


/*
 * ============================================================
 * CUSTOM / ARIA VALIDATION
 * ============================================================
 */

async function validateCustomControl({
  page,
  field,
}) {
  const role =
    getCustomRole(
      field
    );

  const label =
    normalizeString(
      field?.label
    );


  if (
    !role ||
    !label
  ) {
    return buildFieldValidationResult({
      field,

      status:
        FIELD_VALIDATION_STATUSES
          .NEEDS_REVIEW,

      reason:
        "Custom control does not expose enough accessible information for validation.",

      errorCode:
        FORM_VALIDATION_ERROR_CODES
          .ARIA_STATE_UNKNOWN,
    });
  }


  try {
    const locator =
      page.getByRole(
        role,
        {
          name:
            label,

          exact:
            true,
        }
      );


    const count =
      await locator.count();


    if (
      count !==
      1
    ) {
      return buildFieldValidationResult({
        field,

        status:
          count === 0
            ? FIELD_VALIDATION_STATUSES
                .NOT_FOUND
            : FIELD_VALIDATION_STATUSES
                .NEEDS_REVIEW,

        reason:
          count === 0
            ? "Custom control could not be found for validation."
            : "Custom control is ambiguous during validation.",

        errorCode:
          FORM_VALIDATION_ERROR_CODES
            .FIELD_NOT_FOUND,
      });
    }


    /*
     * Checkbox/radio style ARIA controls expose aria-checked.
     */
    if (
      [
        "checkbox",
        "radio",
      ].includes(
        role
      )
    ) {
      const checked =
        await locator
          .getAttribute(
            "aria-checked"
          );


      if (
        ![
          "true",
          "false",
        ].includes(
          checked
        )
      ) {
        return buildFieldValidationResult({
          field,

          status:
            FIELD_VALIDATION_STATUSES
              .NEEDS_REVIEW,

          reason:
            "Custom control does not expose a reliable aria-checked state.",

          errorCode:
            FORM_VALIDATION_ERROR_CODES
              .ARIA_STATE_UNKNOWN,
        });
      }


      return buildFieldValidationResult({
        field,

        status:
          FIELD_VALIDATION_STATUSES
            .VALID,

        metadata: {
          ariaChecked:
            checked,
        },
      });
    }


    /*
     * Custom combobox validation is intentionally conservative.
     *
     * Different component libraries expose selected state through
     * different properties.
     *
     * Stage 8 confirms that the control remains present and usable,
     * while exact selected-value verification stays with its
     * Stage 6 handler until we have a standard cross-framework
     * representation.
     */
    if (
      role ===
      "combobox"
    ) {
      const visible =
        await locator.isVisible();

      const enabled =
        await locator.isEnabled();


      if (
        !visible ||
        !enabled
      ) {
        return buildFieldValidationResult({
          field,

          status:
            FIELD_VALIDATION_STATUSES
              .INVALID,

          reason:
            "Custom combobox is no longer interactable after filling.",

          errorCode:
            FORM_VALIDATION_ERROR_CODES
              .ARIA_STATE_UNKNOWN,
        });
      }


      return buildFieldValidationResult({
        field,

        status:
          FIELD_VALIDATION_STATUSES
            .VALID,

        metadata: {
          visible,
          enabled,
        },
      });
    }


    return buildFieldValidationResult({
      field,

      status:
        FIELD_VALIDATION_STATUSES
          .NEEDS_REVIEW,

      reason:
        "Custom control validation is not implemented for this ARIA role.",

      errorCode:
        FORM_VALIDATION_ERROR_CODES
          .CONTROL_UNSUPPORTED,
    });
  } catch (
    error
  ) {
    return buildFieldValidationResult({
      field,

      status:
        FIELD_VALIDATION_STATUSES
          .INVALID,

      reason:
        "Unable to validate custom control.",

      errorCode:
        FORM_VALIDATION_ERROR_CODES
          .BROWSER_ERROR,

      metadata: {
        browserError:
          normalizeString(
            error?.message
          ) ||
          null,
      },
    });
  }
}


/*
 * ============================================================
 * VALIDATE ONE FIELD
 * ============================================================
 */

async function validateFilledField({
  page,
  field,
}) {
  /*
   * ----------------------------------------------------------
   * GROUP / DIRECT CONTROLS
   * ----------------------------------------------------------
   */

  if (
    isNativeRadioField(
      field
    )
  ) {
    return validateRadioField({
      page,
      field,
    });
  }


  if (
    isNativeCheckboxField(
      field
    )
  ) {
    return validateCheckboxField({
      page,
      field,
    });
  }


  if (
    isSupportedCustomControl(
      field
    )
  ) {
    return validateCustomControl({
      page,
      field,
    });
  }


  /*
   * ----------------------------------------------------------
   * UNIQUE CONTROLS
   * ----------------------------------------------------------
   */

  let located;


  try {
    located =
      await resolveFieldLocator({
        page,
        field,
      });
  } catch (
    error
  ) {
    if (
      error instanceof
      FieldLocatorError
    ) {
      return buildFieldValidationResult({
        field,

        status:
          FIELD_VALIDATION_STATUSES
            .NOT_FOUND,

        reason:
          error.message,

        errorCode:
          FORM_VALIDATION_ERROR_CODES
            .FIELD_NOT_FOUND,
      });
    }


    throw error;
  }


  const locator =
    located.locator;


  if (
    isTextLikeField(
      field
    )
  ) {
    return validateTextLikeField({
      locator,
      field,
    });
  }


  if (
    field?.fieldType ===
      FIELD_TYPES.CHOICE &&
    normalizeLower(
      field?.metadata
        ?.tagName
    ) ===
      "select"
  ) {
    return validateNativeSelect({
      locator,
      field,
    });
  }


  if (
    isNativeFileField(
      field
    )
  ) {
    return validateFileField({
      locator,
      field,
    });
  }


  return buildFieldValidationResult({
    field,

    status:
      FIELD_VALIDATION_STATUSES
        .SKIPPED,

    reason:
      "No post-fill validator exists for this field type.",

    errorCode:
      FORM_VALIDATION_ERROR_CODES
        .CONTROL_UNSUPPORTED,
  });
}


/*
 * ============================================================
 * SUMMARY
 * ============================================================
 */

function summarizeFieldValidation(
  results
) {
  const safeResults =
    Array.isArray(
      results
    )
      ? results
      : [];


  const count =
    (
      status
    ) =>
      safeResults.filter(
        (result) =>
          result?.status ===
          status
      ).length;


  return {
    total:
      safeResults.length,

    valid:
      count(
        FIELD_VALIDATION_STATUSES
          .VALID
      ),

    invalid:
      count(
        FIELD_VALIDATION_STATUSES
          .INVALID
      ),

    needsReview:
      count(
        FIELD_VALIDATION_STATUSES
          .NEEDS_REVIEW
      ),

    notFound:
      count(
        FIELD_VALIDATION_STATUSES
          .NOT_FOUND
      ),

    skipped:
      count(
        FIELD_VALIDATION_STATUSES
          .SKIPPED
      ),
  };
}


/*
 * ============================================================
 * FORM VALIDATION STATUS
 * ============================================================
 */

function deriveFormValidationStatus(
  summary
) {
  if (
    summary.invalid >
      0 ||
    summary.notFound >
      0
  ) {
    return FORM_VALIDATION_STATUSES
      .INVALID;
  }


  if (
    summary.needsReview >
    0
  ) {
    return FORM_VALIDATION_STATUSES
      .NEEDS_REVIEW;
  }


  if (
    summary.skipped >
    0
  ) {
    return FORM_VALIDATION_STATUSES
      .PARTIAL;
  }


  return FORM_VALIDATION_STATUSES
    .VALID;
}


/*
 * ============================================================
 * VALIDATE COMPLETE CURRENT FORM
 * ============================================================
 */

async function validateCurrentForm({
  page,
  fields,
}) {
  if (
    !page
  ) {
    throw new Error(
      "Playwright page is required for form validation"
    );
  }


  const safeFields =
    Array.isArray(
      fields
    )
      ? fields
      : [];


  const results =
    [];


  /*
   * Sequential validation is intentional for predictable browser
   * behavior and diagnostic ordering.
   */
  for (
    const field of
    safeFields
  ) {
    const result =
      await validateFilledField({
        page,
        field,
      });


    results.push(
      result
    );
  }


  const summary =
    summarizeFieldValidation(
      results
    );


  return {
    status:
      deriveFormValidationStatus(
        summary
      ),

    valid:
      summary.invalid ===
        0 &&
      summary.notFound ===
        0 &&
      summary.needsReview ===
        0,

    summary,

    fields:
      results,
  };
}


/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  FIELD_VALIDATION_STATUSES,

  FORM_VALIDATION_STATUSES,

  FORM_VALIDATION_ERROR_CODES,

  buildFieldValidationResult,

  isTextLikeField,

  validateTextLikeField,

  validateNativeSelect,

  validateRadioField,

  validateCheckboxField,

  validateFileField,

  validateCustomControl,

  validateFilledField,

  summarizeFieldValidation,

  deriveFormValidationStatus,

  validateCurrentForm,
};