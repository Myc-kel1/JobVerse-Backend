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
 * RADIO BUTTON INTERACTOR
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * Safely interact with a native HTML radio-button group using an
 * already-approved JobVerse candidate answer.
 *
 * Example:
 *
 * Question:
 *   Are you legally authorized to work?
 *
 * Controls:
 *
 *   <input type="radio" name="authorization" value="Yes">
 *   <input type="radio" name="authorization" value="No">
 *
 * The form inspector represents that entire group as ONE
 * JobVerse field.
 *
 *
 * ============================================================
 * IMPORTANT ARCHITECTURE RULE
 * ============================================================
 *
 * This module DOES NOT:
 *
 * - resolve candidate answers
 * - infer Yes/No from booleans
 * - guess semantically similar options
 * - operate checkboxes
 * - operate custom ARIA radio widgets
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

const RADIO_ERROR_CODES =
  Object.freeze({
    PAGE_REQUIRED:
      "RADIO_PAGE_REQUIRED",

    FIELD_REQUIRED:
      "RADIO_FIELD_REQUIRED",

    RESOLUTION_REQUIRED:
      "RADIO_RESOLUTION_REQUIRED",

    UNSUPPORTED_FIELD:
      "RADIO_UNSUPPORTED_FIELD",

    GROUP_IDENTITY_MISSING:
      "RADIO_GROUP_IDENTITY_MISSING",

    EMPTY_VALUE:
      "RADIO_EMPTY_VALUE",

    GROUP_NOT_FOUND:
      "RADIO_GROUP_NOT_FOUND",

    OPTION_NOT_FOUND:
      "RADIO_OPTION_NOT_FOUND",

    OPTION_AMBIGUOUS:
      "RADIO_OPTION_AMBIGUOUS",

    OPTION_DISABLED:
      "RADIO_OPTION_DISABLED",

    OPTION_NOT_VISIBLE:
      "RADIO_OPTION_NOT_VISIBLE",

    CHECK_FAILED:
      "RADIO_CHECK_FAILED",

    VALUE_MISMATCH:
      "RADIO_VALUE_MISMATCH",
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
 * RADIO FIELD CHECK
 * ============================================================
 *
 * The normalized JobVerse field type for native radio controls
 * is "choice".
 *
 * We therefore also require inspection metadata showing that the
 * original browser control was an input[type="radio"].
 */

function isNativeRadioField(
  field
) {
  return (
    field?.fieldType ===
      FIELD_TYPES.CHOICE &&
    normalizeComparable(
      field?.metadata
        ?.inputType
    ) ===
      "radio"
  );
}


/*
 * ============================================================
 * GROUP IDENTITY
 * ============================================================
 *
 * Native radio buttons normally share the same name attribute.
 *
 * Example:
 *
 * name="visaSponsorship"
 *
 * That name is therefore the strongest group identity.
 */

function getRadioGroupName(
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
 * NORMALIZE ANSWER
 * ============================================================
 *
 * Important:
 *
 * This module does NOT convert:
 *
 * true  -> Yes
 * false -> No
 *
 * because browser interaction must not infer employer option
 * semantics.
 *
 * The answer-resolution layer must already have produced a value
 * matching the employer's choices.
 */

function normalizeRadioAnswer(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }


  const normalized =
    normalizeString(
      value
    );


  return normalized ||
    null;
}


/*
 * ============================================================
 * BUILD RADIO GROUP LOCATOR
 * ============================================================
 */

function buildRadioGroupLocator({
  page,
  field,
}) {
  const name =
    getRadioGroupName(
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
    `input[type="radio"][name="${escapedName}"]`
  );
}


/*
 * ============================================================
 * INSPECT LIVE RADIO OPTIONS
 * ============================================================
 *
 * We inspect:
 *
 * - DOM value
 * - associated label
 * - disabled state
 * - checked state
 *
 * Candidate answers are NOT exposed in this structure.
 */

async function inspectRadioOptions(
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
           * Explicit <label for="id">
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
           * Wrapping <label>
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
           * aria-label fallback
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

            disabled:
              Boolean(
                element.disabled
              ),

            checked:
              Boolean(
                element.checked
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
 * OPTION MATCHING
 * ============================================================
 *
 * Safe matching order:
 *
 * 1. exact value
 * 2. exact label
 * 3. normalized case-insensitive value
 * 4. normalized case-insensitive label
 *
 * Deliberately excluded:
 *
 * - substring matching
 * - fuzzy matching
 * - semantic matching
 * - AI interpretation
 */

function findMatchingRadioOption({
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
    normalizeRadioAnswer(
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
    };
  }


  /*
   * ----------------------------------------------------------
   * EXACT VALUE
   * ----------------------------------------------------------
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
   * ----------------------------------------------------------
   * EXACT LABEL
   * ----------------------------------------------------------
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


  /*
   * ----------------------------------------------------------
   * NORMALIZED VALUE
   * ----------------------------------------------------------
   */

  const comparableAnswer =
    normalizeComparable(
      normalizedAnswer
    );


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
   * ----------------------------------------------------------
   * NORMALIZED LABEL
   * ----------------------------------------------------------
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
 * FILL NATIVE RADIO GROUP
 * ============================================================
 *
 * MAIN PUBLIC FUNCTION.
 */

async function fillNativeRadio({
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
      "Playwright page is required for radio-button interaction.",
      {
        errorCode:
          RADIO_ERROR_CODES
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
      "Normalized radio field is required.",
      {
        errorCode:
          RADIO_ERROR_CODES
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
      "Approved candidate answer is required before selecting a radio option.",
      {
        errorCode:
          RADIO_ERROR_CODES
            .RESOLUTION_REQUIRED,
      }
    );
  }


  if (
    !isNativeRadioField(
      field
    )
  ) {
    return buildFailedResult(
      field,
      "Field is not a supported native radio-button group.",
      {
        errorCode:
          RADIO_ERROR_CODES
            .UNSUPPORTED_FIELD,
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * ANSWER
   * ----------------------------------------------------------
   */

  const answer =
    normalizeRadioAnswer(
      resolution.value
    );


  if (
    !answer
  ) {
    return buildNeedsReviewResult(
      field,
      "Candidate answer for the radio-button question is empty.",
      {
        errorCode:
          RADIO_ERROR_CODES
            .EMPTY_VALUE,
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * GROUP
   * ----------------------------------------------------------
   */

  const groupName =
    getRadioGroupName(
      field
    );


  if (
    !groupName
  ) {
    return buildNeedsReviewResult(
      field,
      "Radio-button group does not expose a stable name attribute.",
      {
        errorCode:
          RADIO_ERROR_CODES
            .GROUP_IDENTITY_MISSING,
      }
    );
  }


  const groupLocator =
    buildRadioGroupLocator({
      page,
      field,
    });


  if (
    !groupLocator
  ) {
    return buildBlockedResult(
      field,
      "Unable to build a safe locator for the radio-button group.",
      {
        errorCode:
          RADIO_ERROR_CODES
            .GROUP_NOT_FOUND,
      }
    );
  }


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
      "Unable to inspect the radio-button group.",
      {
        errorCode:
          RADIO_ERROR_CODES
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
      "Radio-button group could not be found on the current page.",
      {
        errorCode:
          RADIO_ERROR_CODES
            .GROUP_NOT_FOUND,
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * LIVE OPTIONS
   * ----------------------------------------------------------
   */

  let options;


  try {
    options =
      await inspectRadioOptions(
        groupLocator
      );
  } catch (
    error
  ) {
    return buildBlockedResult(
      field,
      "Unable to inspect radio-button options.",
      {
        errorCode:
          RADIO_ERROR_CODES
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
   * MATCH ANSWER
   * ----------------------------------------------------------
   */

  const match =
    findMatchingRadioOption({
      options,
      answer,
    });


  if (
    match.ambiguous
  ) {
    return buildNeedsReviewResult(
      field,
      "Candidate answer matches multiple radio options. JobVerse will not guess which one is intended.",
      {
        errorCode:
          RADIO_ERROR_CODES
            .OPTION_AMBIGUOUS,

        optionCount:
          Array.isArray(
            match.matches
          )
            ? match.matches.length
            : 0,
      }
    );
  }


  if (
    !match.matched ||
    !match.option
  ) {
    return buildNeedsReviewResult(
      field,
      "Candidate answer does not exactly match any available radio option.",
      {
        errorCode:
          RADIO_ERROR_CODES
            .OPTION_NOT_FOUND,

        optionCount:
          options.length,
      }
    );
  }


  const target =
    match.option;


  /*
   * ----------------------------------------------------------
   * OPTION STATE
   * ----------------------------------------------------------
   */

  if (
    target.disabled
  ) {
    return buildBlockedResult(
      field,
      "The matching radio option is disabled.",
      {
        errorCode:
          RADIO_ERROR_CODES
            .OPTION_DISABLED,
      }
    );
  }


  let visible;


  try {
    visible =
      await target
        .locator
        .isVisible();
  } catch (_) {
    visible =
      false;
  }


  /*
   * Some native radio inputs are visually hidden while their
   * labels are visible.
   *
   * Playwright's check() can often interact through the actual
   * control, but we do not force hidden controls.
   *
   * Force-clicking would weaken our safety guarantees.
   */
  if (
    !visible
  ) {
    return buildNeedsReviewResult(
      field,
      "The matching native radio input is not directly visible. A custom or styled control may require the Stage 6 interaction path.",
      {
        errorCode:
          RADIO_ERROR_CODES
            .OPTION_NOT_VISIBLE,
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * ALREADY CHECKED
   * ----------------------------------------------------------
   *
   * If the desired option is already checked, this is a valid
   * success state. There is no reason to mutate the page again.
   */

  let alreadyChecked =
    false;


  try {
    alreadyChecked =
      await target
        .locator
        .isChecked();
  } catch (_) {
    alreadyChecked =
      false;
  }


  if (
    alreadyChecked
  ) {
    return buildFilledResult(
      field,
      {
        interaction:
          "radio",

        matchType:
          match.matchType,

        verified:
          true,

        alreadySelected:
          true,

        optionCount:
          options.length,
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * PLAYWRIGHT CHECK
   * ----------------------------------------------------------
   */

  try {
    await target
      .locator
      .check();
  } catch (
    error
  ) {
    return buildFailedResult(
      field,
      "Playwright could not select the requested radio option.",
      {
        errorCode:
          RADIO_ERROR_CODES
            .CHECK_FAILED,

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
   * VERIFY
   * ----------------------------------------------------------
   */

  let checked =
    false;


  try {
    checked =
      await target
        .locator
        .isChecked();
  } catch (_) {
    checked =
      false;
  }


  if (
    !checked
  ) {
    return buildFailedResult(
      field,
      "Radio option did not remain selected after interaction.",
      {
        errorCode:
          RADIO_ERROR_CODES
            .VALUE_MISMATCH,
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * SUCCESS
   * ----------------------------------------------------------
   */

  return buildFilledResult(
    field,
    {
      interaction:
        "radio",

      matchType:
        match.matchType,

      verified:
        true,

      alreadySelected:
        false,

      optionCount:
        options.length,
    }
  );
}


/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  RADIO_ERROR_CODES,

  isNativeRadioField,

  getRadioGroupName,

  normalizeRadioAnswer,

  buildRadioGroupLocator,

  inspectRadioOptions,

  findMatchingRadioOption,

  fillNativeRadio,
};