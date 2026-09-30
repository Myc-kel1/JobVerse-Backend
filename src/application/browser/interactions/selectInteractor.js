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
 * NATIVE SELECT INTERACTOR
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * Safely select an option from a native HTML <select> control
 * using an already-approved candidate answer.
 *
 *
 * ============================================================
 * IMPORTANT ARCHITECTURE RULE
 * ============================================================
 *
 * This module handles ONLY native HTML <select> controls.
 *
 * It DOES NOT handle:
 *
 * - custom React dropdowns
 * - ARIA comboboxes
 * - listboxes implemented with div/button elements
 * - radio buttons
 * - checkboxes
 * - candidate answer resolution
 * - navigation
 * - final submission
 *
 * Custom/ARIA controls belong to Phase 4 Stage 6.
 * ============================================================
 */


/*
 * ============================================================
 * ERROR CODES
 * ============================================================
 */

const SELECT_ERROR_CODES =
  Object.freeze({
    LOCATOR_REQUIRED:
      "SELECT_LOCATOR_REQUIRED",

    FIELD_REQUIRED:
      "SELECT_FIELD_REQUIRED",

    RESOLUTION_REQUIRED:
      "SELECT_RESOLUTION_REQUIRED",

    UNSUPPORTED_FIELD_TYPE:
      "SELECT_UNSUPPORTED_FIELD_TYPE",

    NOT_NATIVE_SELECT:
      "SELECT_NOT_NATIVE_SELECT",

    NOT_VISIBLE:
      "SELECT_NOT_VISIBLE",

    DISABLED:
      "SELECT_DISABLED",

    EMPTY_VALUE:
      "SELECT_EMPTY_VALUE",

    NO_OPTIONS:
      "SELECT_NO_OPTIONS",

    OPTION_NOT_FOUND:
      "SELECT_OPTION_NOT_FOUND",

    OPTION_AMBIGUOUS:
      "SELECT_OPTION_AMBIGUOUS",

    OPTION_DISABLED:
      "SELECT_OPTION_DISABLED",

    SELECT_FAILED:
      "SELECT_FAILED",

    VALUE_MISMATCH:
      "SELECT_VALUE_MISMATCH",

    MULTIPLE_SELECT_UNSUPPORTED:
      "SELECT_MULTIPLE_UNSUPPORTED",
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
 * FIELD COMPATIBILITY
 * ============================================================
 *
 * Native dropdowns are normalized as JobVerse "choice".
 *
 * That does not mean every "choice" field is a native select.
 * Radio controls are also choice fields.
 *
 * Therefore we check both:
 *
 * fieldType === choice
 *
 * AND
 *
 * metadata.tagName === select
 */

function isNativeSelectField(
  field
) {
  return (
    field?.fieldType ===
      FIELD_TYPES.CHOICE &&
    normalizeComparable(
      field?.metadata
        ?.tagName
    ) ===
      "select"
  );
}


/*
 * ============================================================
 * READ LIVE SELECT METADATA
 * ============================================================
 */

async function inspectLiveSelect(
  locator
) {
  return locator.evaluate(
    (element) => {
      const tagName =
        String(
          element?.tagName ||
          ""
        ).toLowerCase();


      if (
        tagName !==
        "select"
      ) {
        return {
          isSelect:
            false,

          multiple:
            false,

          options:
            [],
        };
      }


      const options =
        Array.from(
          element.options ||
          []
        ).map(
          (
            option,
            index
          ) => ({
            index,

            value:
              String(
                option.value ??
                ""
              ),

            label:
              String(
                option.label ||
                option.textContent ||
                ""
              ).trim(),

            disabled:
              Boolean(
                option.disabled
              ),

            selected:
              Boolean(
                option.selected
              ),
          })
        );


      return {
        isSelect:
          true,

        multiple:
          Boolean(
            element.multiple
          ),

        options,
      };
    }
  );
}


/*
 * ============================================================
 * NORMALIZE ANSWER
 * ============================================================
 *
 * We do not perform fuzzy interpretation here.
 *
 * Examples that are allowed:
 *
 * "Nigeria" → "Nigeria"
 * "remote"  → "Remote"
 *
 * because those are normalized exact matches.
 *
 * Examples that are NOT automatically inferred:
 *
 * "UK"      → "United Kingdom"
 * "3 yrs"   → "3-5 years"
 * true      → "Yes"
 *
 * Those require an explicit resolver/mapping layer rather than
 * browser interaction guessing.
 */

function normalizeSelectAnswer(
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
 * OPTION MATCHING
 * ============================================================
 *
 * Safe matching order:
 *
 * 1. exact option value
 * 2. exact visible label
 * 3. normalized case-insensitive value
 * 4. normalized case-insensitive label
 *
 * There is deliberately NO:
 *
 * - substring matching
 * - fuzzy matching
 * - semantic guessing
 * - AI selection
 */

function findMatchingOption({
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
    normalizeSelectAnswer(
      answer
    );


  if (
    !normalizedAnswer
  ) {
    return {
      matched:
        false,

      reason:
        "empty",
    };
  }


  /*
   * ----------------------------------------------------------
   * 1. EXACT VALUE
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
   * 2. EXACT LABEL
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
   * 3. CASE-NORMALIZED VALUE
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
   * 4. CASE-NORMALIZED LABEL
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

    matchType:
      null,

    matches:
      [],
  };
}


/*
 * ============================================================
 * VERIFY SELECTED OPTION
 * ============================================================
 */

async function verifySelectedOption({
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

      actualValue:
        actualValue ||
        null,
    };
  } catch (_) {
    return {
      matches:
        false,

      actualValue:
        null,
    };
  }
}


/*
 * ============================================================
 * FILL NATIVE SELECT
 * ============================================================
 *
 * MAIN PUBLIC FUNCTION.
 */

async function fillNativeSelect({
  locator,
  field,
  resolution,
}) {
  /*
   * ----------------------------------------------------------
   * REQUIRED INPUTS
   * ----------------------------------------------------------
   */

  if (
    !locator
  ) {
    return buildBlockedResult(
      field || {},
      "Playwright locator is required for native select interaction.",
      {
        errorCode:
          SELECT_ERROR_CODES
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
      {},
      "Normalized form field is required.",
      {
        errorCode:
          SELECT_ERROR_CODES
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
      "Approved candidate answer is required before selecting an option.",
      {
        errorCode:
          SELECT_ERROR_CODES
            .RESOLUTION_REQUIRED,
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * EXPECTED FIELD TYPE
   * ----------------------------------------------------------
   */

  if (
    !isNativeSelectField(
      field
    )
  ) {
    return buildFailedResult(
      field,
      "Field is not a supported native select control.",
      {
        errorCode:
          SELECT_ERROR_CODES
            .UNSUPPORTED_FIELD_TYPE,
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * ANSWER
   * ----------------------------------------------------------
   */

  const answer =
    normalizeSelectAnswer(
      resolution.value
    );


  if (
    !answer
  ) {
    return buildNeedsReviewResult(
      field,
      "Candidate answer for the dropdown is empty.",
      {
        errorCode:
          SELECT_ERROR_CODES
            .EMPTY_VALUE,
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * LIVE STATE
   * ----------------------------------------------------------
   */

  let visible;
  let enabled;


  try {
    [
      visible,
      enabled,
    ] =
      await Promise.all([
        locator.isVisible(),
        locator.isEnabled(),
      ]);
  } catch (
    error
  ) {
    return buildBlockedResult(
      field,
      "Unable to inspect the live dropdown control.",
      {
        errorCode:
          SELECT_ERROR_CODES
            .SELECT_FAILED,

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
    !visible
  ) {
    return buildBlockedResult(
      field,
      "The dropdown is not currently visible.",
      {
        errorCode:
          SELECT_ERROR_CODES
            .NOT_VISIBLE,
      }
    );
  }


  if (
    !enabled
  ) {
    return buildBlockedResult(
      field,
      "The dropdown is disabled.",
      {
        errorCode:
          SELECT_ERROR_CODES
            .DISABLED,
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * LIVE SELECT INSPECTION
   * ----------------------------------------------------------
   */

  let liveSelect;


  try {
    liveSelect =
      await inspectLiveSelect(
        locator
      );
  } catch (
    error
  ) {
    return buildBlockedResult(
      field,
      "Unable to inspect native dropdown options.",
      {
        errorCode:
          SELECT_ERROR_CODES
            .SELECT_FAILED,

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
    !liveSelect.isSelect
  ) {
    return buildBlockedResult(
      field,
      "The live browser control is not a native HTML select.",
      {
        errorCode:
          SELECT_ERROR_CODES
            .NOT_NATIVE_SELECT,
      }
    );
  }


  /*
   * Multi-select dropdowns require array-valued answer semantics.
   *
   * They will be handled with multi-choice behavior later rather
   * than pretending they are ordinary single-choice controls.
   */
  if (
    liveSelect.multiple
  ) {
    return buildNeedsReviewResult(
      field,
      "Multiple-selection native dropdowns are not handled by the single-choice select interactor.",
      {
        errorCode:
          SELECT_ERROR_CODES
            .MULTIPLE_SELECT_UNSUPPORTED,
      }
    );
  }


  if (
    liveSelect.options.length ===
    0
  ) {
    return buildBlockedResult(
      field,
      "The dropdown contains no available options.",
      {
        errorCode:
          SELECT_ERROR_CODES
            .NO_OPTIONS,
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * OPTION MATCH
   * ----------------------------------------------------------
   */

  const match =
    findMatchingOption({
      options:
        liveSelect.options,

      answer,
    });


  if (
    match.ambiguous
  ) {
    return buildNeedsReviewResult(
      field,
      "Candidate answer matches multiple dropdown options. JobVerse will not guess which option is intended.",
      {
        errorCode:
          SELECT_ERROR_CODES
            .OPTION_AMBIGUOUS,

        candidateCount:
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
      "Candidate answer does not exactly match any available dropdown option.",
      {
        errorCode:
          SELECT_ERROR_CODES
            .OPTION_NOT_FOUND,

        /*
         * Do not include the actual candidate answer here.
         *
         * Option count is enough for operational diagnostics.
         */
        optionCount:
          liveSelect.options
            .length,
      }
    );
  }


  if (
    match.option.disabled
  ) {
    return buildBlockedResult(
      field,
      "The matching dropdown option is disabled.",
      {
        errorCode:
          SELECT_ERROR_CODES
            .OPTION_DISABLED,
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * PLAYWRIGHT SELECTION
   * ----------------------------------------------------------
   *
   * Use the exact underlying option value after matching.
   *
   * This avoids Playwright independently performing another
   * label/value interpretation.
   */

  try {
    await locator
      .selectOption({
        value:
          match.option.value,
      });
  } catch (
    error
  ) {
    return buildFailedResult(
      field,
      "Playwright could not select the requested dropdown option.",
      {
        errorCode:
          SELECT_ERROR_CODES
            .SELECT_FAILED,

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
    await verifySelectedOption({
      locator,

      expectedValue:
        match.option.value,
    });


  if (
    !verification.matches
  ) {
    return buildFailedResult(
      field,
      "The dropdown did not retain the expected selected option.",
      {
        errorCode:
          SELECT_ERROR_CODES
            .VALUE_MISMATCH,
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * SUCCESS
   * ----------------------------------------------------------
   *
   * Do not include the actual answer/option value in the result.
   */

  return buildFilledResult(
    field,
    {
      interaction:
        "select_option",

      matchType:
        match.matchType,

      verified:
        true,

      optionCount:
        liveSelect.options
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
  SELECT_ERROR_CODES,

  isNativeSelectField,

  normalizeSelectAnswer,

  inspectLiveSelect,

  findMatchingOption,

  verifySelectedOption,

  fillNativeSelect,
};