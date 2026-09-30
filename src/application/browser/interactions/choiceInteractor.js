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
 * NATIVE CHECKBOX INTERACTOR
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * Safely synchronize native HTML checkbox controls with an
 * already-approved JobVerse answer.
 *
 * Supported cases:
 *
 * 1. single checkbox
 *
 *    [x] I agree
 *
 * 2. checkbox group
 *
 *    [x] Python
 *    [ ] Java
 *    [x] PostgreSQL
 *
 *
 * ============================================================
 * IMPORTANT ARCHITECTURE RULE
 * ============================================================
 *
 * This module DOES NOT:
 *
 * - resolve candidate answers
 * - infer legal/consent answers
 * - guess option meanings
 * - operate custom ARIA checkboxes
 * - click Next
 * - click Submit
 * - change application lifecycle state
 *
 * ============================================================
 */


/*
 * ============================================================
 * ERROR CODES
 * ============================================================
 */

const CHECKBOX_ERROR_CODES =
  Object.freeze({
    PAGE_REQUIRED:
      "CHECKBOX_PAGE_REQUIRED",

    FIELD_REQUIRED:
      "CHECKBOX_FIELD_REQUIRED",

    RESOLUTION_REQUIRED:
      "CHECKBOX_RESOLUTION_REQUIRED",

    UNSUPPORTED_FIELD:
      "CHECKBOX_UNSUPPORTED_FIELD",

    IDENTITY_MISSING:
      "CHECKBOX_IDENTITY_MISSING",

    GROUP_NOT_FOUND:
      "CHECKBOX_GROUP_NOT_FOUND",

    INVALID_ANSWER:
      "CHECKBOX_INVALID_ANSWER",

    OPTION_NOT_FOUND:
      "CHECKBOX_OPTION_NOT_FOUND",

    OPTION_AMBIGUOUS:
      "CHECKBOX_OPTION_AMBIGUOUS",

    OPTION_DISABLED:
      "CHECKBOX_OPTION_DISABLED",

    OPTION_NOT_VISIBLE:
      "CHECKBOX_OPTION_NOT_VISIBLE",

    CHECK_FAILED:
      "CHECKBOX_CHECK_FAILED",

    UNCHECK_FAILED:
      "CHECKBOX_UNCHECK_FAILED",

    VALUE_MISMATCH:
      "CHECKBOX_VALUE_MISMATCH",
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
 * NATIVE CHECKBOX FIELD CHECK
 * ============================================================
 *
 * Your current live inspector maps:
 *
 * input[type="checkbox"]
 *
 * to:
 *
 * FIELD_TYPES.MULTI_CHOICE
 *
 * We also permit BOOLEAN / CONSENT defensively in case a future
 * platform adapter classifies a native checkbox more precisely.
 */

function isNativeCheckboxField(
  field
) {
  const inputType =
    normalizeComparable(
      field?.metadata
        ?.inputType
    );


  const tagName =
    normalizeComparable(
      field?.metadata
        ?.tagName
    );


  const supportedType =
    [
      FIELD_TYPES.MULTI_CHOICE,
      FIELD_TYPES.BOOLEAN,
      FIELD_TYPES.CONSENT,
    ].includes(
      field?.fieldType
    );


  return (
    tagName ===
      "input" &&
    inputType ===
      "checkbox" &&
    supportedType
  );
}


/*
 * ============================================================
 * CHECKBOX IDENTITY
 * ============================================================
 */

function getCheckboxIdentity(
  field
) {
  const name =
    normalizeString(
      field?.platformFieldName
    );


  const id =
    normalizeString(
      field?.platformFieldId
    );


  return {
    name:
      name ||
      null,

    id:
      id ||
      null,
  };
}


/*
 * ============================================================
 * BUILD CHECKBOX LOCATOR
 * ============================================================
 *
 * If a name exists, the field can represent a checkbox group.
 *
 * If no name exists but an ID exists, it can still represent one
 * individual checkbox.
 */

function buildCheckboxLocator({
  page,
  field,
}) {
  const {
    name,
    id,
  } =
    getCheckboxIdentity(
      field
    );


  if (
    name
  ) {
    const escaped =
      escapeCssAttributeValue(
        name
      );


    return page.locator(
      `input[type="checkbox"][name="${escaped}"]`
    );
  }


  if (
    id
  ) {
    const escaped =
      escapeCssAttributeValue(
        id
      );


    return page.locator(
      `input[type="checkbox"][id="${escaped}"]`
    );
  }


  return null;
}


/*
 * ============================================================
 * INSPECT LIVE CHECKBOX OPTIONS
 * ============================================================
 */

async function inspectCheckboxOptions(
  groupLocator
) {
  const count =
    await groupLocator.count();


  const options =
    [];


  for (
    let index = 0;
    index < count;
    index += 1
  ) {
    const locator =
      groupLocator.nth(
        index
      );


    const details =
      await locator.evaluate(
        (element) => {
          const clean =
            (
              value
            ) =>
              String(
                value ?? ""
              )
                .replace(
                  /\s+/g,
                  " "
                )
                .trim();


          let label =
            "";


          /*
           * Explicit:
           *
           * <label for="some-id">
           */
          if (
            element.id
          ) {
            const explicit =
              document.querySelector(
                `label[for="${CSS.escape(
                  element.id
                )}"]`
              );


            if (
              explicit
            ) {
              label =
                clean(
                  explicit.innerText ||
                  explicit.textContent
                );
            }
          }


          /*
           * Wrapping label.
           */
          if (
            !label
          ) {
            const wrapping =
              element.closest(
                "label"
              );


            if (
              wrapping
            ) {
              label =
                clean(
                  wrapping.innerText ||
                  wrapping.textContent
                );
            }
          }


          /*
           * aria-label fallback.
           */
          if (
            !label
          ) {
            label =
              clean(
                element.getAttribute(
                  "aria-label"
                )
              );
          }


          return {
            value:
              clean(
                element.value
              ),

            label,

            checked:
              Boolean(
                element.checked
              ),

            disabled:
              Boolean(
                element.disabled
              ),
          };
        }
      );


    options.push({
      index,

      locator,

      ...details,
    });
  }


  return options;
}


/*
 * ============================================================
 * NORMALIZE MULTI-CHOICE ANSWER
 * ============================================================
 *
 * We accept:
 *
 * ["Python", "PostgreSQL"]
 *
 * or a scalar:
 *
 * "Python"
 *
 * which means the candidate selected exactly one member of a
 * multi-choice checkbox group.
 *
 * We deliberately do NOT split arbitrary comma-separated strings
 * because a legitimate option may itself contain a comma.
 */

function normalizeCheckboxChoices(
  value
) {
  if (
    Array.isArray(
      value
    )
  ) {
    return value
      .map(
        normalizeString
      )
      .filter(
        Boolean
      );
  }


  if (
    value === null ||
    value === undefined
  ) {
    return [];
  }


  const scalar =
    normalizeString(
      value
    );


  return scalar
    ? [
        scalar,
      ]
    : [];
}


/*
 * ============================================================
 * OPTION MATCHING
 * ============================================================
 *
 * Same safety policy as native selects/radios:
 *
 * 1. exact value
 * 2. exact label
 * 3. normalized exact value
 * 4. normalized exact label
 *
 * NO fuzzy matching.
 */

function findMatchingCheckboxOption({
  options,
  answer,
}) {
  const safeOptions =
    Array.isArray(
      options
    )
      ? options
      : [];


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


  let matches =
    safeOptions.filter(
      (option) =>
        normalizeString(
          option?.value
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

      matchType:
        "exact_value",

      option:
        matches[0],
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

      matches,
    };
  }


  matches =
    safeOptions.filter(
      (option) =>
        normalizeString(
          option?.label
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

      matchType:
        "exact_label",

      option:
        matches[0],
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

      matches,
    };
  }


  const comparable =
    normalizeComparable(
      target
    );


  matches =
    safeOptions.filter(
      (option) =>
        normalizeComparable(
          option?.value
        ) ===
        comparable
    );


  if (
    matches.length ===
    1
  ) {
    return {
      matched:
        true,

      matchType:
        "normalized_value",

      option:
        matches[0],
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

      matches,
    };
  }


  matches =
    safeOptions.filter(
      (option) =>
        normalizeComparable(
          option?.label
        ) ===
        comparable
    );


  if (
    matches.length ===
    1
  ) {
    return {
      matched:
        true,

      matchType:
        "normalized_label",

      option:
        matches[0],
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

      matches,
    };
  }


  return {
    matched:
      false,
  };
}


/*
 * ============================================================
 * APPLY DESIRED CHECKED STATE
 * ============================================================
 */

async function applyCheckboxState({
  option,
  shouldBeChecked,
}) {
  const currentlyChecked =
    await option
      .locator
      .isChecked();


  /*
   * No page mutation is necessary.
   */
  if (
    currentlyChecked ===
    shouldBeChecked
  ) {
    return {
      changed:
        false,

      verified:
        true,
    };
  }


  const visible =
    await option
      .locator
      .isVisible();


  const enabled =
    await option
      .locator
      .isEnabled();


  if (
    !visible
  ) {
    return {
      changed:
        false,

      verified:
        false,

      blocked:
        true,

      errorCode:
        CHECKBOX_ERROR_CODES
          .OPTION_NOT_VISIBLE,

      reason:
        "Checkbox input is not directly visible.",
    };
  }


  if (
    !enabled ||
    option.disabled
  ) {
    return {
      changed:
        false,

      verified:
        false,

      blocked:
        true,

      errorCode:
        CHECKBOX_ERROR_CODES
          .OPTION_DISABLED,

      reason:
        "Checkbox input is disabled.",
    };
  }


  try {
    if (
      shouldBeChecked
    ) {
      await option
        .locator
        .check();
    } else {
      await option
        .locator
        .uncheck();
    }
  } catch (
    error
  ) {
    return {
      changed:
        false,

      verified:
        false,

      failed:
        true,

      errorCode:
        shouldBeChecked
          ? CHECKBOX_ERROR_CODES
              .CHECK_FAILED
          : CHECKBOX_ERROR_CODES
              .UNCHECK_FAILED,

      reason:
        normalizeString(
          error?.message
        ) ||
        "Checkbox interaction failed.",
    };
  }


  const finalState =
    await option
      .locator
      .isChecked();


  return {
    changed:
      true,

    verified:
      finalState ===
      shouldBeChecked,

    finalState,
  };
}


/*
 * ============================================================
 * SINGLE BOOLEAN CHECKBOX
 * ============================================================
 *
 * Boolean values have explicit semantics:
 *
 * true  -> checked
 * false -> unchecked
 *
 * We only use this behavior when the stored answer itself is an
 * actual boolean.
 */

async function fillBooleanCheckbox({
  field,
  option,
  desiredValue,
}) {
  if (
    typeof desiredValue !==
    "boolean"
  ) {
    return buildNeedsReviewResult(
      field,
      "Single checkbox requires an explicit boolean answer before JobVerse can safely check or clear it.",
      {
        errorCode:
          CHECKBOX_ERROR_CODES
            .INVALID_ANSWER,
      }
    );
  }


  const result =
    await applyCheckboxState({
      option,

      shouldBeChecked:
        desiredValue,
    });


  if (
    result.blocked
  ) {
    return buildNeedsReviewResult(
      field,
      result.reason,
      {
        errorCode:
          result.errorCode,
      }
    );
  }


  if (
    result.failed
  ) {
    return buildFailedResult(
      field,
      "Playwright could not update the checkbox.",
      {
        errorCode:
          result.errorCode,

        metadata: {
          browserError:
            result.reason ||
            null,
        },
      }
    );
  }


  if (
    !result.verified
  ) {
    return buildFailedResult(
      field,
      "Checkbox did not retain the expected checked state.",
      {
        errorCode:
          CHECKBOX_ERROR_CODES
            .VALUE_MISMATCH,
      }
    );
  }


  return buildFilledResult(
    field,
    {
      interaction:
        "checkbox_boolean",

      verified:
        true,

      changed:
        Boolean(
          result.changed
        ),
    }
  );
}


/*
 * ============================================================
 * MULTI-CHOICE CHECKBOX GROUP
 * ============================================================
 */

async function fillCheckboxGroup({
  field,
  options,
  value,
}) {
  const requestedChoices =
    normalizeCheckboxChoices(
      value
    );


  /*
   * An empty array is a legitimate answer only when the resolver
   * explicitly provided an array.
   *
   * That means:
   *
   * []
   *
   * = candidate selected no options.
   *
   * An empty string/null is different and must not silently clear
   * the whole group.
   */
  if (
    requestedChoices.length ===
      0 &&
    !Array.isArray(
      value
    )
  ) {
    return buildNeedsReviewResult(
      field,
      "Checkbox-group answer is empty or not explicit enough to safely modify the group.",
      {
        errorCode:
          CHECKBOX_ERROR_CODES
            .INVALID_ANSWER,
      }
    );
  }


  const desiredOptions =
    new Map();


  /*
   * ----------------------------------------------------------
   * RESOLVE EVERY REQUESTED OPTION FIRST
   * ----------------------------------------------------------
   *
   * We do this BEFORE changing the browser.
   *
   * If even one answer cannot be mapped safely, the whole group
   * remains unchanged.
   */

  for (
    const requestedChoice of
    requestedChoices
  ) {
    const match =
      findMatchingCheckboxOption({
        options,

        answer:
          requestedChoice,
      });


    if (
      match.ambiguous
    ) {
      return buildNeedsReviewResult(
        field,
        "One requested checkbox choice matches multiple live options.",
        {
          errorCode:
            CHECKBOX_ERROR_CODES
              .OPTION_AMBIGUOUS,
        }
      );
    }


    if (
      !match.matched ||
      !match.option
    ) {
      return buildNeedsReviewResult(
        field,
        "One or more candidate checkbox choices do not exactly match the available options.",
        {
          errorCode:
            CHECKBOX_ERROR_CODES
              .OPTION_NOT_FOUND,

          optionCount:
            options.length,
        }
      );
    }


    desiredOptions.set(
      match.option.index,
      match.option
    );
  }


  /*
   * ----------------------------------------------------------
   * PRE-FLIGHT MUTABILITY CHECK
   * ----------------------------------------------------------
   *
   * Determine every checkbox that would need to change BEFORE
   * changing any of them.
   *
   * This avoids partially updating a group and then discovering
   * halfway through that another required control cannot be
   * interacted with.
   */

  const operations =
    [];


  for (
    const option of
    options
  ) {
    const desiredChecked =
      desiredOptions.has(
        option.index
      );


    const currentlyChecked =
      await option
        .locator
        .isChecked();


    if (
      currentlyChecked ===
      desiredChecked
    ) {
      continue;
    }


    const visible =
      await option
        .locator
        .isVisible();


    const enabled =
      await option
        .locator
        .isEnabled();


    if (
      !visible
    ) {
      return buildNeedsReviewResult(
        field,
        "A checkbox that must be changed is not directly visible. It may be a styled/custom control requiring Stage 6.",
        {
          errorCode:
            CHECKBOX_ERROR_CODES
              .OPTION_NOT_VISIBLE,
        }
      );
    }


    if (
      !enabled ||
      option.disabled
    ) {
      return buildBlockedResult(
        field,
        "A checkbox that must be changed is disabled.",
        {
          errorCode:
            CHECKBOX_ERROR_CODES
              .OPTION_DISABLED,
        }
      );
    }


    operations.push({
      option,

      desiredChecked,
    });
  }


  /*
   * ----------------------------------------------------------
   * APPLY CHANGES
   * ----------------------------------------------------------
   */

  let changedCount =
    0;


  for (
    const operation of
    operations
  ) {
    const result =
      await applyCheckboxState({
        option:
          operation.option,

        shouldBeChecked:
          operation
            .desiredChecked,
      });


    if (
      result.failed
    ) {
      return buildFailedResult(
        field,
        "Playwright could not update all checkbox options.",
        {
          errorCode:
            result.errorCode,

          metadata: {
            changedBeforeFailure:
              changedCount,

            browserError:
              result.reason ||
              null,
          },
        }
      );
    }


    if (
      !result.verified
    ) {
      return buildFailedResult(
        field,
        "Checkbox group did not retain the requested state.",
        {
          errorCode:
            CHECKBOX_ERROR_CODES
              .VALUE_MISMATCH,

          metadata: {
            changedBeforeFailure:
              changedCount,
          },
        }
      );
    }


    if (
      result.changed
    ) {
      changedCount +=
        1;
    }
  }


  /*
   * ----------------------------------------------------------
   * FINAL GROUP VERIFICATION
   * ----------------------------------------------------------
   */

  for (
    const option of
    options
  ) {
    const expected =
      desiredOptions.has(
        option.index
      );


    const actual =
      await option
        .locator
        .isChecked();


    if (
      actual !==
      expected
    ) {
      return buildFailedResult(
        field,
        "Checkbox group state does not match the approved candidate answer after interaction.",
        {
          errorCode:
            CHECKBOX_ERROR_CODES
              .VALUE_MISMATCH,
        }
      );
    }
  }


  return buildFilledResult(
    field,
    {
      interaction:
        "checkbox_group",

      verified:
        true,

      optionCount:
        options.length,

      selectedCount:
        desiredOptions.size,

      changedCount,
    }
  );
}


/*
 * ============================================================
 * MAIN CHECKBOX INTERACTION
 * ============================================================
 */

async function fillNativeCheckbox({
  page,
  field,
  resolution,
}) {
  if (
    !page
  ) {
    return buildBlockedResult(
      field || {},
      "Playwright page is required for checkbox interaction.",
      {
        errorCode:
          CHECKBOX_ERROR_CODES
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
      "Normalized checkbox field is required.",
      {
        errorCode:
          CHECKBOX_ERROR_CODES
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
      "Approved candidate answer is required before checkbox interaction.",
      {
        errorCode:
          CHECKBOX_ERROR_CODES
            .RESOLUTION_REQUIRED,
      }
    );
  }


  if (
    !isNativeCheckboxField(
      field
    )
  ) {
    return buildFailedResult(
      field,
      "Field is not a supported native checkbox control.",
      {
        errorCode:
          CHECKBOX_ERROR_CODES
            .UNSUPPORTED_FIELD,
      }
    );
  }


  const checkboxLocator =
    buildCheckboxLocator({
      page,
      field,
    });


  if (
    !checkboxLocator
  ) {
    return buildNeedsReviewResult(
      field,
      "Checkbox does not expose a stable name or ID.",
      {
        errorCode:
          CHECKBOX_ERROR_CODES
            .IDENTITY_MISSING,
      }
    );
  }


  let count;


  try {
    count =
      await checkboxLocator
        .count();
  } catch (
    error
  ) {
    return buildBlockedResult(
      field,
      "Unable to inspect the checkbox control.",
      {
        errorCode:
          CHECKBOX_ERROR_CODES
            .GROUP_NOT_FOUND,

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
    count ===
    0
  ) {
    return buildBlockedResult(
      field,
      "Checkbox control could not be found on the current page.",
      {
        errorCode:
          CHECKBOX_ERROR_CODES
            .GROUP_NOT_FOUND,
      }
    );
  }


  let options;


  try {
    options =
      await inspectCheckboxOptions(
        checkboxLocator
      );
  } catch (
    error
  ) {
    return buildBlockedResult(
      field,
      "Unable to inspect live checkbox options.",
      {
        errorCode:
          CHECKBOX_ERROR_CODES
            .GROUP_NOT_FOUND,

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
   * ==========================================================
   * SINGLE CHECKBOX
   * ==========================================================
   *
   * An actual boolean answer has explicit check/uncheck
   * semantics.
   */

  if (
    options.length ===
      1 &&
    typeof resolution.value ===
      "boolean"
  ) {
    return fillBooleanCheckbox({
      field,

      option:
        options[0],

      desiredValue:
        resolution.value,
    });
  }


  /*
   * ==========================================================
   * CHECKBOX GROUP / SINGLE OPTION CHOICE
   * ==========================================================
   *
   * If the answer is an array or a textual choice, treat the
   * control as multi-choice rather than inventing boolean
   * semantics.
   */

  return fillCheckboxGroup({
    field,

    options,

    value:
      resolution.value,
  });
}


/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  CHECKBOX_ERROR_CODES,

  isNativeCheckboxField,

  getCheckboxIdentity,

  buildCheckboxLocator,

  inspectCheckboxOptions,

  normalizeCheckboxChoices,

  findMatchingCheckboxOption,

  applyCheckboxState,

  fillBooleanCheckbox,

  fillCheckboxGroup,

  fillNativeCheckbox,
};