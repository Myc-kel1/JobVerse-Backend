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
 * CUSTOM / ARIA CONTROL INTERACTOR
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * Safely interact with accessible custom controls that are not
 * ordinary native HTML form elements.
 *
 * Supported initial controls:
 *
 * - role="combobox"
 * - role="radio"
 * - role="radiogroup"
 * - role="checkbox"
 *
 *
 * ============================================================
 * IMPORTANT ARCHITECTURE RULE
 * ============================================================
 *
 * This module only operates controls that expose meaningful ARIA
 * semantics.
 *
 * It DOES NOT:
 *
 * - click arbitrary div/span elements
 * - guess control purpose
 * - infer candidate answers
 * - bypass authentication/CAPTCHA
 * - use brittle nth-child selectors
 * - click final Submit
 *
 * ============================================================
 */


/*
 * ============================================================
 * ERROR CODES
 * ============================================================
 */

const CUSTOM_CONTROL_ERROR_CODES =
  Object.freeze({
    PAGE_REQUIRED:
      "CUSTOM_CONTROL_PAGE_REQUIRED",

    FIELD_REQUIRED:
      "CUSTOM_CONTROL_FIELD_REQUIRED",

    RESOLUTION_REQUIRED:
      "CUSTOM_CONTROL_RESOLUTION_REQUIRED",

    UNSUPPORTED_ROLE:
      "CUSTOM_CONTROL_UNSUPPORTED_ROLE",

    CONTROL_NOT_FOUND:
      "CUSTOM_CONTROL_NOT_FOUND",

    CONTROL_AMBIGUOUS:
      "CUSTOM_CONTROL_AMBIGUOUS",

    OPTION_NOT_FOUND:
      "CUSTOM_CONTROL_OPTION_NOT_FOUND",

    OPTION_AMBIGUOUS:
      "CUSTOM_CONTROL_OPTION_AMBIGUOUS",

    NOT_VISIBLE:
      "CUSTOM_CONTROL_NOT_VISIBLE",

    DISABLED:
      "CUSTOM_CONTROL_DISABLED",

    INTERACTION_FAILED:
      "CUSTOM_CONTROL_INTERACTION_FAILED",

    VALUE_MISMATCH:
      "CUSTOM_CONTROL_VALUE_MISMATCH",
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


function normalizeComparable(
  value
) {
  return normalizeString(
    value
  ).toLowerCase();
}


/*
 * ============================================================
 * ROLE HELPERS
 * ============================================================
 */

function getCustomRole(
  field
) {
  return normalizeComparable(
    field?.metadata
      ?.role
  );
}


function isCustomComboboxField(
  field
) {
  return (
    getCustomRole(
      field
    ) ===
      "combobox" &&
    field?.fieldType ===
      FIELD_TYPES.CHOICE
  );
}


function isCustomRadioField(
  field
) {
  const role =
    getCustomRole(
      field
    );


  return (
    (
      role ===
        "radiogroup" ||
      role ===
        "radio"
    ) &&
    field?.fieldType ===
      FIELD_TYPES.CHOICE
  );
}


function isCustomCheckboxField(
  field
) {
  return (
    getCustomRole(
      field
    ) ===
      "checkbox" &&
    [
      FIELD_TYPES.BOOLEAN,
      FIELD_TYPES.MULTI_CHOICE,
      FIELD_TYPES.CONSENT,
    ].includes(
      field?.fieldType
    )
  );
}


function isSupportedCustomControl(
  field
) {
  return Boolean(
    isCustomComboboxField(
      field
    ) ||
    isCustomRadioField(
      field
    ) ||
    isCustomCheckboxField(
      field
    )
  );
}


/*
 * ============================================================
 * ACCESSIBLE CONTROL LOCATOR
 * ============================================================
 *
 * ARIA widgets should be targeted using role + accessible name.
 *
 * We deliberately avoid generated CSS selectors.
 */

async function resolveCustomControlLocator({
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
    return {
      found:
        false,

      reason:
        "Custom control does not expose both a supported role and readable label.",
    };
  }


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
    count ===
    1
  ) {
    return {
      found:
        true,

      locator,

      role,
    };
  }


  if (
    count >
    1
  ) {
    return {
      found:
        false,

      ambiguous:
        true,

      count,

      reason:
        "Accessible role/name matches multiple controls.",
    };
  }


  return {
    found:
      false,

    reason:
      "Accessible custom control could not be found.",
  };
}


/*
 * ============================================================
 * EXACT OPTION MATCHING
 * ============================================================
 */

function findExactCustomOption({
  options,
  answer,
}) {
  const target =
    normalizeString(
      answer
    );


  if (
    !target
  ) {
    return {
      matched:
        false,
    };
  }


  const safeOptions =
    Array.isArray(
      options
    )
      ? options
      : [];


  let matches =
    safeOptions.filter(
      (value) =>
        normalizeString(
          typeof value ===
            "object"
            ? value?.label ??
              value?.value
            : value
        ) ===
        target
    );


  if (
    matches.length ===
    1
  ) {
    return {
      matched:
        true,

      value:
        normalizeString(
          typeof matches[0] ===
            "object"
            ? matches[0]?.label ??
              matches[0]?.value
            : matches[0]
        ),

      matchType:
        "exact",
    };
  }


  if (
    matches.length >
    1
  ) {
    return {
      matched:
        false,

      ambiguous:
        true,
    };
  }


  const comparableTarget =
    normalizeComparable(
      target
    );


  matches =
    safeOptions.filter(
      (value) =>
        normalizeComparable(
          typeof value ===
            "object"
            ? value?.label ??
              value?.value
            : value
        ) ===
        comparableTarget
    );


  if (
    matches.length ===
    1
  ) {
    return {
      matched:
        true,

      value:
        normalizeString(
          typeof matches[0] ===
            "object"
            ? matches[0]?.label ??
              matches[0]?.value
            : matches[0]
        ),

      matchType:
        "normalized_exact",
    };
  }


  return {
    matched:
      false,

    ambiguous:
      matches.length >
      1,
  };
}


/*
 * ============================================================
 * CUSTOM COMBOBOX
 * ============================================================
 */

async function fillCustomCombobox({
  page,
  field,
  resolution,
}) {
  const resolved =
    await resolveCustomControlLocator({
      page,
      field,
    });


  if (
    !resolved.found
  ) {
    return buildNeedsReviewResult(
      field,
      resolved.reason,
      {
        errorCode:
          resolved.ambiguous
            ? CUSTOM_CONTROL_ERROR_CODES
                .CONTROL_AMBIGUOUS
            : CUSTOM_CONTROL_ERROR_CODES
                .CONTROL_NOT_FOUND,
      }
    );
  }


  const optionMatch =
    findExactCustomOption({
      options:
        field?.options,

      answer:
        resolution.value,
    });


  if (
    optionMatch.ambiguous
  ) {
    return buildNeedsReviewResult(
      field,
      "Candidate answer matches multiple custom combobox options.",
      {
        errorCode:
          CUSTOM_CONTROL_ERROR_CODES
            .OPTION_AMBIGUOUS,
      }
    );
  }


  if (
    !optionMatch.matched
  ) {
    return buildNeedsReviewResult(
      field,
      "Candidate answer does not exactly match an available custom combobox option.",
      {
        errorCode:
          CUSTOM_CONTROL_ERROR_CODES
            .OPTION_NOT_FOUND,
      }
    );
  }


  const control =
    resolved.locator;


  if (
    !await control.isVisible()
  ) {
    return buildNeedsReviewResult(
      field,
      "Custom combobox is not visible.",
      {
        errorCode:
          CUSTOM_CONTROL_ERROR_CODES
            .NOT_VISIBLE,
      }
    );
  }


  if (
    !await control.isEnabled()
  ) {
    return buildBlockedResult(
      field,
      "Custom combobox is disabled.",
      {
        errorCode:
          CUSTOM_CONTROL_ERROR_CODES
            .DISABLED,
      }
    );
  }


  try {
    /*
     * Open the custom dropdown.
     */
    await control.click();


    /*
     * Select an exact accessible option.
     */
    const option =
      page.getByRole(
        "option",
        {
          name:
            optionMatch.value,

          exact:
            true,
        }
      );


    const optionCount =
      await option.count();


    if (
      optionCount !==
      1
    ) {
      return buildNeedsReviewResult(
        field,
        optionCount >
        1
          ? "Multiple visible custom options match the approved answer."
          : "Approved custom option could not be located after opening the combobox.",
        {
          errorCode:
            optionCount >
            1
              ? CUSTOM_CONTROL_ERROR_CODES
                  .OPTION_AMBIGUOUS
              : CUSTOM_CONTROL_ERROR_CODES
                  .OPTION_NOT_FOUND,
        }
      );
    }


    await option.click();
  } catch (
    error
  ) {
    return buildFailedResult(
      field,
      "Playwright could not interact with the custom combobox.",
      {
        errorCode:
          CUSTOM_CONTROL_ERROR_CODES
            .INTERACTION_FAILED,

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


  return buildFilledResult(
    field,
    {
      interaction:
        "aria_combobox",

      verified:
        true,

      matchType:
        optionMatch.matchType,
    }
  );
}


/*
 * ============================================================
 * CUSTOM RADIO
 * ============================================================
 */

async function fillCustomRadio({
  page,
  field,
  resolution,
}) {
  const optionMatch =
    findExactCustomOption({
      options:
        field?.options,

      answer:
        resolution.value,
    });


  if (
    optionMatch.ambiguous
  ) {
    return buildNeedsReviewResult(
      field,
      "Candidate answer matches multiple custom radio options.",
      {
        errorCode:
          CUSTOM_CONTROL_ERROR_CODES
            .OPTION_AMBIGUOUS,
      }
    );
  }


  if (
    !optionMatch.matched
  ) {
    return buildNeedsReviewResult(
      field,
      "Candidate answer does not exactly match an available custom radio option.",
      {
        errorCode:
          CUSTOM_CONTROL_ERROR_CODES
            .OPTION_NOT_FOUND,
      }
    );
  }


  const option =
    page.getByRole(
      "radio",
      {
        name:
          optionMatch.value,

        exact:
          true,
      }
    );


  const count =
    await option.count();


  if (
    count !==
    1
  ) {
    return buildNeedsReviewResult(
      field,
      count >
      1
        ? "Multiple custom radio options match the approved answer."
        : "Custom radio option could not be found.",
      {
        errorCode:
          count >
          1
            ? CUSTOM_CONTROL_ERROR_CODES
                .OPTION_AMBIGUOUS
            : CUSTOM_CONTROL_ERROR_CODES
                .OPTION_NOT_FOUND,
      }
    );
  }


  try {
    if (
      !await option.isVisible()
    ) {
      return buildNeedsReviewResult(
        field,
        "Custom radio option is not visible.",
        {
          errorCode:
            CUSTOM_CONTROL_ERROR_CODES
              .NOT_VISIBLE,
        }
      );
    }


    if (
      !await option.isEnabled()
    ) {
      return buildBlockedResult(
        field,
        "Custom radio option is disabled.",
        {
          errorCode:
            CUSTOM_CONTROL_ERROR_CODES
              .DISABLED,
        }
      );
    }


    const alreadyChecked =
      await option.getAttribute(
        "aria-checked"
      );


    if (
      alreadyChecked !==
      "true"
    ) {
      await option.click();
    }


    const finalChecked =
      await option.getAttribute(
        "aria-checked"
      );


    if (
      finalChecked !==
      "true"
    ) {
      return buildFailedResult(
        field,
        "Custom radio option did not report an active checked state after interaction.",
        {
          errorCode:
            CUSTOM_CONTROL_ERROR_CODES
              .VALUE_MISMATCH,
        }
      );
    }
  } catch (
    error
  ) {
    return buildFailedResult(
      field,
      "Playwright could not interact with the custom radio option.",
      {
        errorCode:
          CUSTOM_CONTROL_ERROR_CODES
            .INTERACTION_FAILED,

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


  return buildFilledResult(
    field,
    {
      interaction:
        "aria_radio",

      verified:
        true,

      matchType:
        optionMatch.matchType,
    }
  );
}


/*
 * ============================================================
 * CUSTOM CHECKBOX
 * ============================================================
 *
 * Initial Stage 6 support is deliberately boolean-only.
 *
 * Complex ARIA checkbox groups should not be manipulated until
 * each option can be identified independently and reliably.
 */

async function fillCustomCheckbox({
  page,
  field,
  resolution,
}) {
  if (
    typeof resolution.value !==
    "boolean"
  ) {
    return buildNeedsReviewResult(
      field,
      "Custom checkbox requires an explicit boolean answer.",
      {
        errorCode:
          CUSTOM_CONTROL_ERROR_CODES
            .OPTION_NOT_FOUND,
      }
    );
  }


  const resolved =
    await resolveCustomControlLocator({
      page,
      field,
    });


  if (
    !resolved.found
  ) {
    return buildNeedsReviewResult(
      field,
      resolved.reason,
      {
        errorCode:
          resolved.ambiguous
            ? CUSTOM_CONTROL_ERROR_CODES
                .CONTROL_AMBIGUOUS
            : CUSTOM_CONTROL_ERROR_CODES
                .CONTROL_NOT_FOUND,
      }
    );
  }


  const control =
    resolved.locator;


  try {
    if (
      !await control.isVisible()
    ) {
      return buildNeedsReviewResult(
        field,
        "Custom checkbox is not visible.",
        {
          errorCode:
            CUSTOM_CONTROL_ERROR_CODES
              .NOT_VISIBLE,
        }
      );
    }


    if (
      !await control.isEnabled()
    ) {
      return buildBlockedResult(
        field,
        "Custom checkbox is disabled.",
        {
          errorCode:
            CUSTOM_CONTROL_ERROR_CODES
              .DISABLED,
        }
      );
    }


    const current =
      await control.getAttribute(
        "aria-checked"
      );


    const currentlyChecked =
      current ===
      "true";


    if (
      currentlyChecked !==
      resolution.value
    ) {
      await control.click();
    }


    const finalValue =
      await control.getAttribute(
        "aria-checked"
      );


    const finalChecked =
      finalValue ===
      "true";


    if (
      finalChecked !==
      resolution.value
    ) {
      return buildFailedResult(
        field,
        "Custom checkbox did not retain the expected state.",
        {
          errorCode:
            CUSTOM_CONTROL_ERROR_CODES
              .VALUE_MISMATCH,
        }
      );
    }
  } catch (
    error
  ) {
    return buildFailedResult(
      field,
      "Playwright could not interact with the custom checkbox.",
      {
        errorCode:
          CUSTOM_CONTROL_ERROR_CODES
            .INTERACTION_FAILED,

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


  return buildFilledResult(
    field,
    {
      interaction:
        "aria_checkbox",

      verified:
        true,
    }
  );
}


/*
 * ============================================================
 * MAIN CUSTOM CONTROL INTERACTION
 * ============================================================
 */

async function fillCustomControl({
  page,
  field,
  resolution,
}) {
  if (
    !page
  ) {
    return buildBlockedResult(
      field || {},
      "Playwright page is required for custom-control interaction.",
      {
        errorCode:
          CUSTOM_CONTROL_ERROR_CODES
            .PAGE_REQUIRED,
      }
    );
  }


  if (
    !field ||
    typeof field !==
      "object"
  ) {
    return buildBlockedResult(
      {},
      "Normalized form field is required.",
      {
        errorCode:
          CUSTOM_CONTROL_ERROR_CODES
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
      "Approved candidate answer is required before custom-control interaction.",
      {
        errorCode:
          CUSTOM_CONTROL_ERROR_CODES
            .RESOLUTION_REQUIRED,
      }
    );
  }


  if (
    isCustomComboboxField(
      field
    )
  ) {
    return fillCustomCombobox({
      page,
      field,
      resolution,
    });
  }


  if (
    isCustomRadioField(
      field
    )
  ) {
    return fillCustomRadio({
      page,
      field,
      resolution,
    });
  }


  if (
    isCustomCheckboxField(
      field
    )
  ) {
    return fillCustomCheckbox({
      page,
      field,
      resolution,
    });
  }


  return buildNeedsReviewResult(
    field,
    "Custom control role is not supported for automatic interaction.",
    {
      errorCode:
        CUSTOM_CONTROL_ERROR_CODES
          .UNSUPPORTED_ROLE,
    }
  );
}


/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  CUSTOM_CONTROL_ERROR_CODES,

  getCustomRole,

  isCustomComboboxField,

  isCustomRadioField,

  isCustomCheckboxField,

  isSupportedCustomControl,

  resolveCustomControlLocator,

  findExactCustomOption,

  fillCustomCombobox,

  fillCustomRadio,

  fillCustomCheckbox,

  fillCustomControl,
};