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
 * Safely interact with native HTML checkbox controls using an
 * already-approved JobVerse answer.
 *
 * This module supports:
 *
 * - one boolean checkbox
 * - one checkbox option
 * - grouped checkbox options
 * - safely checking desired options
 * - safely clearing undesired options
 * - exact value / label matching
 * - post-interaction verification
 *
 * ------------------------------------------------------------
 * IMPORTANT ARCHITECTURE RULE
 * ------------------------------------------------------------
 *
 * This module DOES NOT:
 *
 * - resolve candidate answers
 * - infer candidate facts
 * - split arbitrary comma-separated answers
 * - fuzzy-match employer options
 * - operate custom ARIA checkboxes
 * - force-click hidden controls
 * - click Next
 * - click Submit
 * - change application lifecycle state
 *
 * Candidate answer resolution belongs to the Phase 3 answer
 * workflow.
 *
 * Custom/non-native checkbox widgets belong to:
 *
 *   customControlInteractor.js
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

    GROUP_IDENTITY_MISSING:
      "CHECKBOX_GROUP_IDENTITY_MISSING",

    GROUP_NOT_FOUND:
      "CHECKBOX_GROUP_NOT_FOUND",

    ANSWER_UNSUPPORTED:
      "CHECKBOX_ANSWER_UNSUPPORTED",

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
 * The inspector normally maps:
 *
 * input[type="checkbox"]
 *
 * to:
 *
 * FIELD_TYPES.MULTI_CHOICE
 *
 * Some integrations may normalize a single native checkbox as
 * BOOLEAN or CONSENT. We accept those canonical meanings too,
 * but still require metadata.inputType === "checkbox".
 */

function isNativeCheckboxField(
  field
) {
  const inputType =
    normalizeComparable(
      field?.metadata
        ?.inputType
    );


  if (
    inputType !==
    "checkbox"
  ) {
    return false;
  }


  return [
    FIELD_TYPES
      .MULTI_CHOICE,

    FIELD_TYPES
      .BOOLEAN,

    FIELD_TYPES
      .CONSENT,
  ].includes(
    field?.fieldType
  );
}


/*
 * ============================================================
 * GROUP IDENTITY
 * ============================================================
 *
 * Native checkbox groups usually share one name.
 *
 * Example:
 *
 * <input
 *   type="checkbox"
 *   name="skills"
 *   value="JavaScript"
 * >
 *
 * <input
 *   type="checkbox"
 *   name="skills"
 *   value="Python"
 * >
 */

function getCheckboxGroupName(
  field
) {
  return (
    normalizeString(
      field?.platformFieldName
    ) ||
    null
  );
}


/*
 * ============================================================
 * BUILD GROUP LOCATOR
 * ============================================================
 */

function buildCheckboxGroupLocator({
  page,
  field,
}) {
  const name =
    getCheckboxGroupName(
      field
    );


  if (
    !name
  ) {
    return null;
  }


  const escapedName =
    escapeCssAttributeValue(
      name
    );


  return page.locator(
    `input[type="checkbox"][name="${escapedName}"]`
  );
}


/*
 * ============================================================
 * INSPECT LIVE CHECKBOX OPTIONS
 * ============================================================
 *
 * We retain the locator internally, but never expose candidate
 * answer values in interaction result metadata.
 */

async function inspectCheckboxOptions(
  groupLocator
) {
  const count =
    await groupLocator
      .count();


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
           * <label for="checkbox-id">
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
           * Wrapping:
           *
           * <label>
           *   <input ...>
           *   JavaScript
           * </label>
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
           * Accessible-name fallback.
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
 * NORMALIZE CHECKBOX ANSWER
 * ============================================================
 *
 * IMPORTANT:
 *
 * We deliberately do NOT convert:
 *
 * "Python, JavaScript"
 *
 * into:
 *
 * ["Python", "JavaScript"]
 *
 * because comma splitting can change candidate intent.
 *
 * The answer-resolution layer should provide an actual array for
 * a multi-choice candidate answer.
 */

function normalizeCheckboxAnswer(
  value
) {
  /*
   * Boolean answers are valid for one checkbox.
   */
  if (
    typeof value ===
    "boolean"
  ) {
    return {
      type:
        "boolean",

      booleanValue:
        value,

      values:
        [],
    };
  }


  /*
   * Multi-choice answer.
   */
  if (
    Array.isArray(
      value
    )
  ) {
    const seen =
      new Set();


    const values =
      [];


    for (
      const item of
      value
    ) {
      const normalized =
        normalizeString(
          item
        );


      if (
        !normalized
      ) {
        continue;
      }


      const key =
        normalizeComparable(
          normalized
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


      values.push(
        normalized
      );
    }


    return {
      type:
        "multiple",

      booleanValue:
        null,

      values,
    };
  }


  /*
   * A single explicit option is safe.
   *
   * We do NOT split it.
   */
  if (
    typeof value ===
      "string" ||
    typeof value ===
      "number"
  ) {
    const normalized =
      normalizeString(
        value
      );


    return {
      type:
        "single",

      booleanValue:
        null,

      values:
        normalized
          ? [
              normalized,
            ]
          : [],
    };
  }


  return {
    type:
      "unsupported",

    booleanValue:
      null,

    values:
      [],
  };
}


/*
 * ============================================================
 * FIND EXACT CHECKBOX OPTION
 * ============================================================
 *
 * Safe match order:
 *
 * 1. exact DOM value
 * 2. exact label
 * 3. case-normalized exact DOM value
 * 4. case-normalized exact label
 *
 * NO:
 *
 * - substring matching
 * - fuzzy matching
 * - semantic matching
 * - AI interpretation
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


  const normalizedAnswer =
    normalizeString(
      answer
    );


  if (
    !normalizedAnswer
  ) {
    return {
      matched:
        false,

      empty:
        true,

      ambiguous:
        false,

      matches:
        [],
    };
  }


  /*
   * Exact value.
   */

  let matches =
    safeOptions.filter(
      (option) =>
        normalizeString(
          option?.value
        ) ===
        normalizedAnswer
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

      matchType:
        "exact_value",

      matches,
    };
  }


  /*
   * Exact label.
   */

  matches =
    safeOptions.filter(
      (option) =>
        normalizeString(
          option?.label
        ) ===
        normalizedAnswer
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

      matchType:
        "exact_label",

      matches,
    };
  }


  const comparableAnswer =
    normalizeComparable(
      normalizedAnswer
    );


  /*
   * Normalized exact value.
   */

  matches =
    safeOptions.filter(
      (option) =>
        normalizeComparable(
          option?.value
        ) ===
        comparableAnswer
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

      matchType:
        "normalized_value",

      matches,
    };
  }


  /*
   * Normalized exact label.
   */

  matches =
    safeOptions.filter(
      (option) =>
        normalizeComparable(
          option?.label
        ) ===
        comparableAnswer
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

      matchType:
        "normalized_label",

      matches,
    };
  }


  return {
    matched:
      false,

    ambiguous:
      false,

    matches:
      [],
  };
}


/*
 * ============================================================
 * BUILD DESIRED CHECKBOX STATE
 * ============================================================
 *
 * This is a PRE-FLIGHT operation.
 *
 * Nothing on the page is changed until every requested option
 * has been matched safely.
 *
 * That prevents partial mutation such as:
 *
 * - selecting option A
 * - failing to find option B
 * - leaving the form half-modified
 */

function buildDesiredCheckboxState({
  options,
  normalizedAnswer,
}) {
  const safeOptions =
    Array.isArray(
      options
    )
      ? options
      : [];


  if (
    normalizedAnswer.type ===
    "boolean"
  ) {
    /*
     * A raw boolean only has unambiguous meaning when there is
     * exactly ONE native checkbox.
     */
    if (
      safeOptions.length !==
      1
    ) {
      return {
        valid:
          false,

        reason:
          "Boolean checkbox answer cannot be applied safely to a checkbox group containing multiple options.",

        errorCode:
          CHECKBOX_ERROR_CODES
            .ANSWER_UNSUPPORTED,
      };
    }


    return {
      valid:
        true,

      desired:
        safeOptions.map(
          (option) => ({
            option,

            shouldBeChecked:
              normalizedAnswer
                .booleanValue,
          })
        ),

      matchTypes:
        [],
    };
  }


  if (
    ![
      "single",
      "multiple",
    ].includes(
      normalizedAnswer.type
    )
  ) {
    return {
      valid:
        false,

      reason:
        "Candidate checkbox answer has an unsupported value type.",

      errorCode:
        CHECKBOX_ERROR_CODES
          .ANSWER_UNSUPPORTED,
    };
  }


  const desiredIndexes =
    new Set();


  const matchTypes =
    [];


  /*
   * Resolve ALL requested values first.
   */
  for (
    const requestedValue of
    normalizedAnswer.values
  ) {
    const match =
      findMatchingCheckboxOption({
        options:
          safeOptions,

        answer:
          requestedValue,
      });


    if (
      match.ambiguous
    ) {
      return {
        valid:
          false,

        needsReview:
          true,

        reason:
          "A candidate answer matches multiple checkbox options. JobVerse will not guess which option is intended.",

        errorCode:
          CHECKBOX_ERROR_CODES
            .OPTION_AMBIGUOUS,
      };
    }


    if (
      !match.matched ||
      !match.option
    ) {
      return {
        valid:
          false,

        needsReview:
          true,

        reason:
          "Candidate answer does not exactly match an available checkbox option.",

        errorCode:
          CHECKBOX_ERROR_CODES
            .OPTION_NOT_FOUND,
      };
    }


    desiredIndexes.add(
      match.option.index
    );


    matchTypes.push(
      match.matchType
    );
  }


  return {
    valid:
      true,

    desired:
      safeOptions.map(
        (option) => ({
          option,

          shouldBeChecked:
            desiredIndexes.has(
              option.index
            ),
        })
      ),

    matchTypes,
  };
}


/*
 * ============================================================
 * PREFLIGHT MUTATION SAFETY
 * ============================================================
 *
 * Before checking OR clearing anything, confirm every control
 * that needs mutation is:
 *
 * - enabled
 * - visible
 *
 * Existing controls already in their desired state do not require
 * mutation and therefore do not fail this check merely because
 * they are disabled.
 */

async function validateCheckboxMutationSafety(
  desired
) {
  for (
    const entry of
    desired
  ) {
    const {
      option,
      shouldBeChecked,
    } =
      entry;


    const needsMutation =
      Boolean(
        option.checked
      ) !==
      Boolean(
        shouldBeChecked
      );


    if (
      !needsMutation
    ) {
      continue;
    }


    if (
      option.disabled
    ) {
      return {
        safe:
          false,

        reason:
          "A checkbox that must change is disabled.",

        errorCode:
          CHECKBOX_ERROR_CODES
            .OPTION_DISABLED,
      };
    }


    let visible =
      false;


    try {
      visible =
        await option
          .locator
          .isVisible();
    } catch (_) {
      visible =
        false;
    }


    /*
     * We do not use force:true.
     *
     * Hidden native checkboxes often indicate a styled/custom
     * control. That belongs to Stage 6 rather than weakening the
     * native-checkbox safety contract.
     */
    if (
      !visible
    ) {
      return {
        safe:
          false,

        needsReview:
          true,

        reason:
          "A checkbox that must change is not directly visible. A styled/custom checkbox requires the custom-control interaction path.",

        errorCode:
          CHECKBOX_ERROR_CODES
            .OPTION_NOT_VISIBLE,
      };
    }
  }


  return {
    safe:
      true,
  };
}


/*
 * ============================================================
 * APPLY DESIRED CHECKBOX STATE
 * ============================================================
 */

async function applyCheckboxState(
  desired
) {
  let changedCount =
    0;


  for (
    const entry of
    desired
  ) {
    const {
      option,
      shouldBeChecked,
    } =
      entry;


    let currentChecked;


    try {
      currentChecked =
        await option
          .locator
          .isChecked();
    } catch (
      error
    ) {
      return {
        success:
          false,

        errorCode:
          CHECKBOX_ERROR_CODES
            .VALUE_MISMATCH,

        reason:
          "Unable to read checkbox state before interaction.",

        browserError:
          normalizeString(
            error?.message
          ) ||
          null,
      };
    }


    if (
      currentChecked ===
      shouldBeChecked
    ) {
      continue;
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


      changedCount += 1;
    } catch (
      error
    ) {
      return {
        success:
          false,

        errorCode:
          shouldBeChecked
            ? CHECKBOX_ERROR_CODES
                .CHECK_FAILED
            : CHECKBOX_ERROR_CODES
                .UNCHECK_FAILED,

        reason:
          shouldBeChecked
            ? "Playwright could not select the requested checkbox option."
            : "Playwright could not clear the undesired checkbox option.",

        browserError:
          normalizeString(
            error?.message
          ) ||
          null,
      };
    }
  }


  return {
    success:
      true,

    changedCount,
  };
}


/*
 * ============================================================
 * VERIFY FINAL CHECKBOX STATE
 * ============================================================
 */

async function verifyCheckboxState(
  desired
) {
  for (
    const entry of
    desired
  ) {
    const {
      option,
      shouldBeChecked,
    } =
      entry;


    let actual;


    try {
      actual =
        await option
          .locator
          .isChecked();
    } catch (
      error
    ) {
      return {
        valid:
          false,

        reason:
          "Unable to verify checkbox state after interaction.",

        browserError:
          normalizeString(
            error?.message
          ) ||
          null,
      };
    }


    if (
      actual !==
      shouldBeChecked
    ) {
      return {
        valid:
          false,

        reason:
          "Checkbox state did not match the approved candidate answer after interaction.",
      };
    }
  }


  return {
    valid:
      true,
  };
}


/*
 * ============================================================
 * FILL NATIVE CHECKBOX
 * ============================================================
 *
 * MAIN PUBLIC FUNCTION.
 */

async function fillNativeCheckbox({
  page,
  field,
  resolution,
}) {
  /*
   * ----------------------------------------------------------
   * BASIC VALIDATION
   * ----------------------------------------------------------
   */

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
      "Approved candidate answer is required before changing checkbox state.",
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


  /*
   * ----------------------------------------------------------
   * ANSWER NORMALIZATION
   * ----------------------------------------------------------
   */

  const normalizedAnswer =
    normalizeCheckboxAnswer(
      resolution.value
    );


  if (
    normalizedAnswer.type ===
    "unsupported"
  ) {
    return buildNeedsReviewResult(
      field,
      "Candidate checkbox answer has an unsupported value type.",
      {
        errorCode:
          CHECKBOX_ERROR_CODES
            .ANSWER_UNSUPPORTED,
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * GROUP IDENTITY
   * ----------------------------------------------------------
   */

  const groupName =
    getCheckboxGroupName(
      field
    );


  if (
    !groupName
  ) {
    return buildNeedsReviewResult(
      field,
      "Checkbox control does not expose a stable name attribute.",
      {
        errorCode:
          CHECKBOX_ERROR_CODES
            .GROUP_IDENTITY_MISSING,
      }
    );
  }


  const groupLocator =
    buildCheckboxGroupLocator({
      page,
      field,
    });


  if (
    !groupLocator
  ) {
    return buildBlockedResult(
      field,
      "Unable to build a safe locator for the checkbox group.",
      {
        errorCode:
          CHECKBOX_ERROR_CODES
            .GROUP_NOT_FOUND,
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * INSPECT LIVE OPTIONS
   * ----------------------------------------------------------
   */

  let optionCount;


  try {
    optionCount =
      await groupLocator
        .count();
  } catch (
    error
  ) {
    return buildBlockedResult(
      field,
      "Unable to inspect the checkbox group.",
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
    optionCount ===
    0
  ) {
    return buildBlockedResult(
      field,
      "Checkbox group could not be found on the current page.",
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
        groupLocator
      );
  } catch (
    error
  ) {
    return buildBlockedResult(
      field,
      "Unable to inspect checkbox options.",
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
   * ----------------------------------------------------------
   * PREFLIGHT ANSWER MATCHING
   * ----------------------------------------------------------
   *
   * IMPORTANT:
   *
   * No browser state has been mutated yet.
   */

  const desiredState =
    buildDesiredCheckboxState({
      options,

      normalizedAnswer,
    });


  if (
    !desiredState.valid
  ) {
    if (
      desiredState.needsReview
    ) {
      return buildNeedsReviewResult(
        field,
        desiredState.reason,
        {
          errorCode:
            desiredState
              .errorCode,

          optionCount:
            options.length,
        }
      );
    }


    return buildNeedsReviewResult(
      field,
      desiredState.reason,
      {
        errorCode:
          desiredState
            .errorCode,

        optionCount:
          options.length,
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * PREFLIGHT DOM SAFETY
   * ----------------------------------------------------------
   */

  const mutationSafety =
    await validateCheckboxMutationSafety(
      desiredState.desired
    );


  if (
    !mutationSafety.safe
  ) {
    if (
      mutationSafety.needsReview
    ) {
      return buildNeedsReviewResult(
        field,
        mutationSafety.reason,
        {
          errorCode:
            mutationSafety
              .errorCode,
        }
      );
    }


    return buildBlockedResult(
      field,
      mutationSafety.reason,
      {
        errorCode:
          mutationSafety
            .errorCode,
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * APPLY
   * ----------------------------------------------------------
   */

  const applyResult =
    await applyCheckboxState(
      desiredState.desired
    );


  if (
    !applyResult.success
  ) {
    return buildFailedResult(
      field,
      applyResult.reason,
      {
        errorCode:
          applyResult
            .errorCode,

        metadata: {
          browserError:
            applyResult
              .browserError ||
            null,
        },
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * VERIFY
   * ----------------------------------------------------------
   */

  const verification =
    await verifyCheckboxState(
      desiredState.desired
    );


  if (
    !verification.valid
  ) {
    return buildFailedResult(
      field,
      verification.reason,
      {
        errorCode:
          CHECKBOX_ERROR_CODES
            .VALUE_MISMATCH,

        metadata: {
          browserError:
            verification
              .browserError ||
            null,
        },
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * SUCCESS
   * ----------------------------------------------------------
   *
   * Do NOT include the selected option values in metadata.
   *
   * Candidate answers can contain sensitive information.
   */

  const checkedCount =
    desiredState
      .desired
      .filter(
        (entry) =>
          entry.shouldBeChecked
      )
      .length;


  return buildFilledResult(
    field,
    {
      interaction:
        "checkbox",

      verified:
        true,

      optionCount:
        options.length,

      checkedCount,

      changedCount:
        applyResult.changedCount,

      alreadyCorrect:
        applyResult.changedCount ===
        0,

      matchTypes:
        [
          ...new Set(
            desiredState
              .matchTypes ||
            []
          ),
        ],
    }
  );
}

/*
 * ============================================================
 * VALIDATION COMPATIBILITY ALIAS
 * ============================================================
 *
 * formValidationService.js historically refers to the native
 * checkbox-group locator as buildCheckboxLocator().
 *
 * The Stage 5 implementation uses the clearer internal name:
 *
 *   buildCheckboxGroupLocator()
 *
 * Both names intentionally resolve to the SAME implementation.
 *
 * This avoids:
 *
 * - duplicating locator logic
 * - changing the validation service unnecessarily
 * - creating inconsistent checkbox selectors
 */

const buildCheckboxLocator =
  buildCheckboxGroupLocator;


/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  CHECKBOX_ERROR_CODES,

  isNativeCheckboxField,

  getCheckboxGroupName,

  buildCheckboxGroupLocator,

  buildCheckboxLocator,

  inspectCheckboxOptions,

  normalizeCheckboxAnswer,

  findMatchingCheckboxOption,

  buildDesiredCheckboxState,

  validateCheckboxMutationSafety,

  applyCheckboxState,

  verifyCheckboxState,

  fillNativeCheckbox,
};