const {
  FIELD_TYPES,
  INSPECTION_STATUSES,
} = require(
  "../formInspectionService"
);


const {
  RESOLUTION_STATUSES,
} = require(
  "../formAnswerResolver"
);


const {
  buildSkippedResult,
  buildUnsupportedResult,
  buildNeedsReviewResult,
  buildBlockedResult,
  buildFormInteractionResult,
} = require(
  "./interactions/interactionResult"
);


const {
  resolveFieldLocator,
  FieldLocatorError,
  FIELD_LOCATOR_ERROR_CODES,
} = require(
  "./interactions/fieldLocator"
);

const {
  isTextFieldType,
  fillTextField,
} = require(
  "./interactions/textFieldInteractor"
);

const {
  isNativeSelectField,
  fillNativeSelect,
} = require(
  "./interactions/selectInteractor"
);

const {
  isNativeRadioField,
  fillNativeRadio,
} = require(
  "./interactions/radioInteractor"
);

const {
  isNativeCheckboxField,
  fillNativeCheckbox,
} = require(
  "./interactions/checkboxInteractor"
);

const {
  isSupportedCustomControl,
  fillCustomControl,
} = require(
  "./interactions/customControlInteractor"
);

const {
  isNativeFileField,
  fillFileInput,
} = require(
  "./interactions/fileInputInteractor"
);

const {
  validateCurrentForm,
} = require(
  "./interactions/formValidationService"
);

const {
  evaluateInteractionSafety,
} = require(
  "./interactions/interactionSafetyService"
);

/*
 * ============================================================
 * FORM INTERACTOR
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * Coordinate safe browser interaction with one already-inspected
 * application form.
 *
 * This module sits between:
 *
 * form inspection
 *      ↓
 * answer resolution
 *      ↓
 * browser field handlers
 *
 *
 * ============================================================
 * PHASE 4 RESPONSIBILITY
 * ============================================================
 *
 * This coordinator will eventually:
 *
 * - receive a Playwright page
 * - receive a normalized form inspection
 * - receive resolved answers
 * - match each answer to its inspected field
 * - locate the live browser control
 * - route the control to the correct interaction handler
 * - collect field-level results
 *
 *
 * ============================================================
 * IMPORTANT SAFETY RULE
 * ============================================================
 *
 * This module NEVER:
 *
 * - invents candidate answers
 * - fills unresolved answers
 * - fills answers requiring review
 * - reads/fills passwords
 * - bypasses login
 * - bypasses CAPTCHA
 * - bypasses OTP
 * - bypasses identity verification
 * - clicks final Submit
 * - marks an application Applied
 * - creates application attempts
 *
 *
 * ============================================================
 * STAGE 1 NOTE
 * ============================================================
 *
 * Stage 1 establishes the contract and orchestration layer only.
 *
 * Actual text/select/radio/etc interaction handlers are added in
 * later Phase 4 stages.
 * ============================================================
 */


/*
 * ============================================================
 * INTERACTION MODES
 * ============================================================
 *
 * FILL:
 *   Normal Phase 4 behavior.
 *
 * VALIDATE_ONLY:
 *   Useful later for tests and diagnostics where we want to
 *   verify field mapping without changing the live page.
 */

const FORM_INTERACTION_MODES =
  Object.freeze({
    FILL:
      "fill",

    VALIDATE_ONLY:
      "validate_only",
  });


const VALID_FORM_INTERACTION_MODES =
  new Set(
    Object.values(
      FORM_INTERACTION_MODES
    )
  );


/*
 * ============================================================
 * ERROR CODES
 * ============================================================
 */

const FORM_INTERACTION_ERROR_CODES =
  Object.freeze({
    PAGE_REQUIRED:
      "FORM_INTERACTION_PAGE_REQUIRED",

    INSPECTION_REQUIRED:
      "FORM_INTERACTION_INSPECTION_REQUIRED",

    RESOLUTIONS_REQUIRED:
      "FORM_INTERACTION_RESOLUTIONS_REQUIRED",

    INVALID_MODE:
      "FORM_INTERACTION_INVALID_MODE",

    LOGIN_REQUIRED:
      "FORM_INTERACTION_LOGIN_REQUIRED",

    CAPTCHA_DETECTED:
      "FORM_INTERACTION_CAPTCHA_DETECTED",

    INSPECTION_BLOCKED:
      "FORM_INTERACTION_INSPECTION_BLOCKED",
  });


/*
 * ============================================================
 * ERROR TYPE
 * ============================================================
 */

class FormInteractionError extends Error {
  constructor(
    message,
    {
      code =
        "FORM_INTERACTION_ERROR",

      details = null,
    } = {}
  ) {
    super(message);

    this.name =
      "FormInteractionError";

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


/*
 * ============================================================
 * NORMALIZE INTERACTION MODE
 * ============================================================
 */

function normalizeInteractionMode(
  value
) {
  const normalized =
    normalizeString(
      value ||
      FORM_INTERACTION_MODES.FILL
    ).toLowerCase();


  if (
    !VALID_FORM_INTERACTION_MODES
      .has(
        normalized
      )
  ) {
    throw new FormInteractionError(
      `Unsupported form interaction mode: ${normalized}`,
      {
        code:
          FORM_INTERACTION_ERROR_CODES
            .INVALID_MODE,
      }
    );
  }


  return normalized;
}


/*
 * ============================================================
 * INPUT VALIDATION
 * ============================================================
 */

function validateInteractionInput({
  page,
  inspection,
  resolutions,
  mode,
}) {
  if (
    !page
  ) {
    throw new FormInteractionError(
      "Playwright page is required.",
      {
        code:
          FORM_INTERACTION_ERROR_CODES
            .PAGE_REQUIRED,
      }
    );
  }


  if (
    !inspection ||
    typeof inspection !==
      "object"
  ) {
    throw new FormInteractionError(
      "Normalized form inspection is required.",
      {
        code:
          FORM_INTERACTION_ERROR_CODES
            .INSPECTION_REQUIRED,
      }
    );
  }


  if (
    !Array.isArray(
      resolutions
    )
  ) {
    throw new FormInteractionError(
      "Resolved form questions must be an array.",
      {
        code:
          FORM_INTERACTION_ERROR_CODES
            .RESOLUTIONS_REQUIRED,
      }
    );
  }


  normalizeInteractionMode(
    mode
  );
}


/*
 * ============================================================
 * PAGE-LEVEL SAFETY CHECK
 * ============================================================
 *
 * The inspector already reports login/CAPTCHA state.
 *
 * We refuse to begin interaction when either is present.
 */

function assertInspectionSafeForInteraction(
  inspection
) {
  if (
    inspection
      ?.requiresLogin
  ) {
    throw new FormInteractionError(
      "Application form requires authentication before interaction can continue.",
      {
        code:
          FORM_INTERACTION_ERROR_CODES
            .LOGIN_REQUIRED,
      }
    );
  }


  if (
    inspection
      ?.hasCaptcha
  ) {
    throw new FormInteractionError(
      "CAPTCHA or human verification was detected.",
      {
        code:
          FORM_INTERACTION_ERROR_CODES
            .CAPTCHA_DETECTED,
      }
    );
  }


  if (
    [
      INSPECTION_STATUSES
        .BLOCKED,

      INSPECTION_STATUSES
        .NEEDS_AUTH,
    ].includes(
      inspection?.status
    )
  ) {
    throw new FormInteractionError(
      "Form inspection is not eligible for automated interaction.",
      {
        code:
          FORM_INTERACTION_ERROR_CODES
            .INSPECTION_BLOCKED,

        details: {
          inspectionStatus:
            inspection
              ?.status ||
            null,
        },
      }
    );
  }
}


/*
 * ============================================================
 * FIELD IDENTITY
 * ============================================================
 *
 * Resolutions preserve the original inspection metadata.
 *
 * We prefer:
 *
 * 1. fieldId
 * 2. platformFieldId
 * 3. platformFieldName
 *
 * Labels are intentionally NOT the primary identity because two
 * fields can legitimately have the same human-readable label.
 */

function getFieldIdentity(
  field
) {
  if (
    !field ||
    typeof field !==
      "object"
  ) {
    return null;
  }


  return (
    normalizeString(
      field.fieldId
    ) ||

    normalizeString(
      field.platformFieldId
    ) ||

    normalizeString(
      field.platformFieldName
    ) ||

    null
  );
}


/*
 * ============================================================
 * INDEX INSPECTED FIELDS
 * ============================================================
 */

function buildInspectionFieldIndex(
  inspection
) {
  const fields =
    Array.isArray(
      inspection?.fields
    )
      ? inspection.fields
      : [];


  const index =
    new Map();


  for (
    const field of
    fields
  ) {
    const identities =
      [
        field?.fieldId,
        field?.platformFieldId,
        field?.platformFieldName,
      ]
        .map(
          normalizeString
        )
        .filter(
          Boolean
        );


    for (
      const identity of
      identities
    ) {
      /*
       * First value wins.
       *
       * We deliberately do not overwrite an existing identity
       * because duplicate external identifiers should not silently
       * change which field is selected.
       */
      if (
        !index.has(
          identity
        )
      ) {
        index.set(
          identity,
          field
        );
      }
    }
  }


  return index;
}


/*
 * ============================================================
 * FIND INSPECTED FIELD FOR RESOLUTION
 * ============================================================
 */

function findInspectionFieldForResolution({
  resolution,
  fieldIndex,
}) {
  const identities =
    [
      resolution?.fieldId,
      resolution?.formQuestionId,
      resolution?.platformFieldId,
      resolution?.platformFieldName,
    ]
      .map(
        normalizeString
      )
      .filter(
        Boolean
      );


  for (
    const identity of
    identities
  ) {
    const field =
      fieldIndex.get(
        identity
      );


    if (
      field
    ) {
      return field;
    }
  }


  return null;
}


/*
 * ============================================================
 * RESOLUTION ELIGIBILITY
 * ============================================================
 *
 * Only fully resolved answers are eligible to reach the DOM
 * interaction layer.
 *
 * Missing / needs_review values are NEVER passed to a handler.
 */

function isResolutionEligibleForInteraction(
  resolution
) {
  return Boolean(
    resolution &&
    resolution.status ===
      RESOLUTION_STATUSES
        .RESOLVED &&
    resolution.resolved ===
      true &&
    resolution.requiresHumanReview !==
      true
  );
}


/*
 * ============================================================
 * BUILD RESULT FOR UNRESOLVED ANSWER
 * ============================================================
 */

function buildResolutionSkipResult({
  field,
  resolution,
}) {
  if (
    resolution?.status ===
    RESOLUTION_STATUSES
      .NEEDS_REVIEW
  ) {
    return buildNeedsReviewResult(
      field,
      resolution.reason ||
      "Candidate answer requires human review."
    );
  }


  return buildSkippedResult(
    field,
    resolution?.reason ||
    "No approved candidate answer is available for this field."
  );
}


/*
 * ============================================================
 * SUPPORTED HANDLER CHECK
 * ============================================================
 *
 * Stage 1 intentionally does not perform actual browser filling.
 *
 * As each Phase 4 stage is completed, its field type is routed to
 * its dedicated interaction module.
 */

function isHandlerImplemented(
  fieldType,
  field = null
) {
  /*
   * Stage 2 — text.
   */

  if (
    isTextFieldType(
      fieldType
    )
  ) {
    return true;
  }


  /*
    * Stage 3 — native select.
   */

  if (
    field &&
    isNativeSelectField(
      field
    )
  ) {
    return true;
  }

  /*
   * Stage 4 — native radio.
   */
  if (
    field &&
    isNativeRadioField(
      field
    )
  ) {
    return true;
  }


  /*
   * Stage 5 — native checkbox.
   */
  if (
    field &&
    isNativeCheckboxField(
      field
    )
  ) {
    return true;
  }

  /*
   * Stage 6 — custom/ARIA controls.
   */
  if (
    field &&
    isSupportedCustomControl(
      field
    )
  ) {
    return true;
  }

  if (
  field &&
  isNativeFileField(
    field
  )
) {
  return true;
}


  return false;
}

/*
 * ============================================================
 * GROUP CONTROL CHECK
 * ============================================================
 *
 * Some JobVerse fields represent multiple DOM elements.
 *
 * Example:
 *
 * radio:
 *
 * <input name="answer" value="Yes">
 * <input name="answer" value="No">
 *
 * Those must not pass through the generic fieldLocator, which is
 * intentionally designed to resolve one unique browser control.
 */

function isDirectInteractionField(
  field
) {
  return Boolean(
    field &&
    (
      isNativeRadioField(
        field
      ) ||
      isNativeCheckboxField(
        field
      ) ||
      isSupportedCustomControl(
        field
      )
    )
  );
}
/*
 * ============================================================
 * DISPATCH FIELD INTERACTION
 * ============================================================
 *
 * The coordinator chooses the correct specialized interactor.
 *
 * It does NOT contain the actual Playwright implementation for
 * each control type.
 */

async function dispatchFieldInteraction({
  page,
  locator = null,
  field,
  resolution,
  files = {},
}) {
  /*
   * ----------------------------------------------------------
   * STAGE 2 — TEXT-LIKE FIELDS
   * ----------------------------------------------------------
   */

  if (
    isTextFieldType(
      field?.fieldType
    )
  ) {
    return fillTextField({
      locator,
      field,
      resolution,
    });
  }


  /*
   * ----------------------------------------------------------
   * STAGE 3 — NATIVE SELECT
   * ----------------------------------------------------------
   */

  if (
    isNativeSelectField(
      field
    )
  ) {
    return fillNativeSelect({
      locator,
      field,
      resolution,
    });
  }


  /*
   * ----------------------------------------------------------
   * STAGE 4 — NATIVE RADIO GROUP
   * ----------------------------------------------------------
   *
   * Radio interaction receives the page because one normalized
   * JobVerse field represents multiple browser controls.
   */

  if (
    isNativeRadioField(
      field
    )
  ) {
    return fillNativeRadio({
      page,
      field,
      resolution,
    });
  }

  /*
   * ----------------------------------------------------------
   * STAGE 5 — CHECKBOX
   * ----------------------------------------------------------
   */

  if (
    isNativeCheckboxField(
      field
    )
  ) {
    return fillNativeCheckbox({
      page,
      field,
      resolution,
    });
  }


  /*
   * ----------------------------------------------------------
   * STAGE 6 — CUSTOM / ARIA CONTROLS
   * ----------------------------------------------------------
   */

  if (
    isSupportedCustomControl(
      field
    )
  ) {
    return fillCustomControl({
      page,
      field,
      resolution,
    });
  }

  /*
   * ----------------------------------------------------------
   * STAGE 7 — FILE INPUT
   * ----------------------------------------------------------
   */

  if (
    isNativeFileField(
      field
    )
  ) {
    return fillFileInput({
      locator,
      field,
      files,
    });
  }


  /*
   * ----------------------------------------------------------
   * UNSUPPORTED FALLBACK
   * ----------------------------------------------------------
   */

  return buildUnsupportedResult(
    field,
    `No interaction handler exists for field type "${normalizeString(
      field?.fieldType
    )}".`
  );
}


/*
 * ============================================================
 * VALIDATE LIVE LOCATOR
 * ============================================================
 *
 * Even before interaction handlers exist, Stage 1 can verify that
 * the normalized field can still be found on the rendered page.
 *
 * This catches stale inspection data early.
 */

async function validateFieldLocator({
  page,
  field,
}) {
  try {
    const located =
      await resolveFieldLocator({
        page,
        field,
      });


    return {
      found:
        true,

      strategy:
        located.strategy,

      description:
        located.description,

      locator:
        located.locator,
    };
  } catch (
    error
  ) {
    if (
      error instanceof
      FieldLocatorError
    ) {
      return {
        found:
          false,

        code:
          error.code,

        reason:
          error.message,

        details:
          error.details ||
          null,
      };
    }


    throw error;
  }
}


/*
 * ============================================================
 * INTERACT WITH SINGLE FIELD
 * ============================================================
 *
 * Stage 1 behavior:
 *
 * - verify answer safety
 * - verify field mapping
 * - verify live locator
 * - report unsupported because concrete handlers start Stage 2
 */

async function interactWithResolvedField({
  page,
  field,
  resolution,
  mode,
  files = {},
}) {
  /*
   * ----------------------------------------------------------
   * RESOLUTION SAFETY
   * ----------------------------------------------------------
   */

  /*
 * File fields obtain their value from approved JobVerse document
 * descriptors, not Candidate Application Answers.
 */

const fileField =
  isNativeFileField(
    field
  );


if (
  !fileField &&
  !isResolutionEligibleForInteraction(
    resolution
  )
) {
  return buildResolutionSkipResult({
    field,
    resolution,
  });
}

  /*
   * ----------------------------------------------------------
   * UNKNOWN / REVIEW-REQUIRED FIELDS
   * ----------------------------------------------------------
   */

  if (
    field?.requiresHumanReview ===
      true ||
    field?.fieldType ===
      FIELD_TYPES.UNKNOWN
  ) {
    return buildNeedsReviewResult(
      field,
      "Field classification requires human review."
    );
  }

  /*
 * ============================================================
 * GROUPED CONTROLS
 * ============================================================
 *
 * Radio groups intentionally contain multiple DOM controls.
 *
 * They therefore bypass the generic single-control locator.
 */

if (
  isDirectInteractionField(
    field
  )
) {
  if (
    mode ===
    FORM_INTERACTION_MODES
      .VALIDATE_ONLY
  ) {
    let controlType =
      "custom";


    if (
      isNativeRadioField(
        field
      )
    ) {
      controlType =
        "radio";
    } else if (
      isNativeCheckboxField(
        field
      )
    ) {
      controlType =
        "checkbox";
    } else if (
      isSupportedCustomControl(
        field
      )
    ) {
      controlType =
        "aria_custom";
    }


    return buildSkippedResult(
      field,
      "Supported direct-interaction control was not changed because validation-only mode is active.",
      {
        directInteraction:
          true,

        controlType,
      }
    );
  }


  return dispatchFieldInteraction({
    page,
    files,
    field,
    resolution,
  });
}
  /*
   * ----------------------------------------------------------
   * LIVE LOCATOR VALIDATION
   * ----------------------------------------------------------
   */

  const located =
    await validateFieldLocator({
      page,
      field,
    });


  if (
    !located.found
  ) {
    const isAmbiguous =
      located.code ===
      FIELD_LOCATOR_ERROR_CODES
        .AMBIGUOUS;


    if (
      isAmbiguous
    ) {
      return buildNeedsReviewResult(
        field,
        located.reason,
        {
          locatorErrorCode:
            located.code,
        }
      );
    }


    return buildBlockedResult(
      field,
      located.reason,
      {
        errorCode:
          located.code,

        metadata: {
          locatorDetails:
            located.details ||
            null,
        },
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * VALIDATION-ONLY MODE
   * ----------------------------------------------------------
   *
   * This mode proves:
   *
   * inspected field
   *      ↓
   * resolution
   *      ↓
   * live DOM control
   *
   * without changing the page.
   */

  if (
    mode ===
    FORM_INTERACTION_MODES
      .VALIDATE_ONLY
  ) {
    return buildSkippedResult(
      field,
      "Field mapping validated without changing the page.",
      {
        locatorStrategy:
          located.strategy,

        locatorDescription:
          located.description,

        validationOnly:
          true,
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * HANDLER DISPATCH
   * ----------------------------------------------------------
   *
   * Concrete handlers begin in Stage 2.
   */

  if (
  !isHandlerImplemented(
    field.fieldType,
    field
  )
) {
  return buildUnsupportedResult(
    field,
    `Interaction handler for field type "${field.fieldType}" has not been implemented yet.`,
    {
      locatorStrategy:
        located.strategy,

      locatorDescription:
        located.description,
    }
  );
}


/*
 * ----------------------------------------------------------
 * EXECUTE SPECIALIZED HANDLER
 * ----------------------------------------------------------
 */

const interactionResult =
  await dispatchFieldInteraction({
    page,

    locator:
      located.locator,

    field,

    resolution,

    files,
  });


/*
 * Preserve locator diagnostics without exposing candidate
 * answer values.
 */

return {
  ...interactionResult,

  metadata: {
    ...(
      interactionResult
        ?.metadata ||
      {}
    ),

    locatorStrategy:
      located.strategy,

    locatorDescription:
      located.description,
  },
};


  /*
   * Defensive Stage 1 fallback.
   *
   * Once handlers are introduced, this branch will be replaced
   * by the handler dispatcher.
   */
  return buildUnsupportedResult(
    field,
    "Field interaction handler is unavailable."
  );
}


/*
 * ============================================================
 * GET FIELDS ELIGIBLE FOR POST-FILL VALIDATION
 * ============================================================
 */

function getFieldsForPostFillValidation({
  inspection,
  interactionResults,
}) {
  const fields =
    Array.isArray(
      inspection?.fields
    )
      ? inspection.fields
      : [];


  const successfulFieldIds =
    new Set(
      (
        interactionResults ||
        []
      )
        .filter(
          (result) =>
            result?.status ===
            "filled"
        )
        .map(
          (result) =>
            normalizeString(
              result?.fieldId
            )
        )
        .filter(
          Boolean
        )
    );


  return fields.filter(
    (field) =>
      successfulFieldIds.has(
        normalizeString(
          field?.fieldId
        )
      )
  );
}


/*
 * ============================================================
 * BUILD INTERACTION WORK ITEMS
 * ============================================================
 *
 * Phase 4 originally iterated only over answer resolutions.
 *
 * That is insufficient for file inputs because approved CV /
 * cover-letter files do not come from Candidate Application
 * Answers.
 *
 * We therefore iterate over INSPECTED FIELDS and attach the
 * matching resolution where one exists.
 */

function buildInteractionWorkItems({
  inspection,
  resolutions,
}) {
  const fields =
    Array.isArray(
      inspection?.fields
    )
      ? inspection.fields
      : [];


  const safeResolutions =
    Array.isArray(
      resolutions
    )
      ? resolutions
      : [];


  const resolutionIndex =
    new Map();


  /*
   * Index every resolution by all stable external identities.
   */
  for (
    const resolution of
    safeResolutions
  ) {
    const identities =
      [
        resolution?.fieldId,
        resolution?.formQuestionId,
        resolution?.platformFieldId,
        resolution?.platformFieldName,
      ]
        .map(
          normalizeString
        )
        .filter(
          Boolean
        );


    for (
      const identity of
      identities
    ) {
      if (
        !resolutionIndex.has(
          identity
        )
      ) {
        resolutionIndex.set(
          identity,
          resolution
        );
      }
    }
  }


  return fields.map(
    (field) => {
      const identities =
        [
          field?.fieldId,
          field?.platformFieldId,
          field?.platformFieldName,
        ]
          .map(
            normalizeString
          )
          .filter(
            Boolean
          );


      let resolution =
        null;


      for (
        const identity of
        identities
      ) {
        const match =
          resolutionIndex.get(
            identity
          );


        if (
          match
        ) {
          resolution =
            match;

          break;
        }
      }


      return {
        field,
        resolution,
      };
    }
  );
}

/*
 * ============================================================
 * INTERACT WITH FORM
 * ============================================================
 *
 * MAIN PUBLIC FUNCTION.
 *
 * This performs one interaction pass over the CURRENT rendered
 * form page.
 *
 * It deliberately does not navigate to Next/Continue/Submit.
 *
 * Multi-step orchestration belongs to Phase 5.
 */

async function interactWithForm({
  page,
  inspection,
  resolutions,
  files = {},
  mode =
    FORM_INTERACTION_MODES
      .FILL,
}) {
  const normalizedMode =
    normalizeInteractionMode(
      mode
    );


  validateInteractionInput({
    page,
    inspection,
    resolutions,
    mode:
      normalizedMode,
  });


  assertInspectionSafeForInteraction(
    inspection
  );

  /*
 * ============================================================
 * PRE-INTERACTION LIVE SAFETY CHECK
 * ============================================================
 *
 * The page may have changed since inspection.
 */

const initialSafety =
  await evaluateInteractionSafety({
    page,

    interactionResults:
      [],

    fields:
      inspection?.fields ||
      [],
  });


if (
  initialSafety.blocked
) {
  const startedAt =
    new Date()
      .toISOString();


  return buildFormInteractionResult({
    results:
      [],

    validation:
      null,

    startedAt,

    completedAt:
      startedAt,

    handoffReason:
      initialSafety.type,

    handoff:
      initialSafety,
  });
}


  const startedAt =
    new Date()
      .toISOString();


  const results =
    [];


  /*
   * ============================================================
   * BUILD INTERACTION WORK ITEMS
   * ============================================================
   *
   * Iterate over inspected fields rather than only resolutions.
   *
   * This allows:
   *
   * ordinary fields
   *   -> candidate-answer resolution
   *
   * file fields
   *   -> approved document descriptors
   */

  const workItems =
    buildInteractionWorkItems({
      inspection,
      resolutions,
    });


  /*
   * ============================================================
   * INTERACT WITH EACH FIELD
   * ============================================================
   *
   * Sequential execution is intentional.
   *
   * Form controls can reveal dynamic fields and validation state,
   * so browser mutation should remain deterministic.
   */

  for (
    const workItem of
    workItems
  ) {
    const {
      field,
      resolution,
    } =
      workItem;


    const result =
      await interactWithResolvedField({
        page,

        field,

        resolution,

        files,

        mode:
          normalizedMode,
      });


    results.push(
      result
    );


    /*
     * ==========================================================
     * MID-INTERACTION SAFETY CHECK
     * ==========================================================
     *
     * A field mutation may reveal:
     *
     * - CAPTCHA
     * - login
     * - OTP
     * - identity verification
     * - ambiguous/unsupported required controls
     */

    const midSafety =
      await evaluateInteractionSafety({
        page,

        interactionResults:
          results,

        fields:
          inspection?.fields ||
          [],
      });


    if (
      midSafety.blocked
    ) {
      const completedAt =
        new Date()
          .toISOString();


      return buildFormInteractionResult({
        results,

        validation:
          null,

        startedAt,

        completedAt,

        handoffReason:
          midSafety.type,

        handoff:
          midSafety,
      });
    }
  }


  /*
   * ============================================================
   * FINAL PRE-VALIDATION SAFETY CHECK
   * ============================================================
   */

  const finalSafety =
    await evaluateInteractionSafety({
      page,

      interactionResults:
        results,

      fields:
        inspection?.fields ||
        [],
    });


  if (
    finalSafety.blocked
  ) {
    const completedAt =
      new Date()
        .toISOString();


    return buildFormInteractionResult({
      results,

      validation:
        null,

      startedAt,

      completedAt,

      handoffReason:
        finalSafety.type,

      handoff:
        finalSafety,
    });
  }


  const validationFields =
    getFieldsForPostFillValidation({
      inspection,

      interactionResults:
        results,
    });


  const validation =
    await validateCurrentForm({
      page,

      fields:
        validationFields,
    });


  const completedAt =
    new Date()
      .toISOString();


  return buildFormInteractionResult({
    results,

    validation,

    startedAt,

    completedAt,
  });
}


/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  FORM_INTERACTION_MODES,

  VALID_FORM_INTERACTION_MODES,

  FORM_INTERACTION_ERROR_CODES,

  FormInteractionError,

  normalizeInteractionMode,

  validateInteractionInput,

  assertInspectionSafeForInteraction,

  getFieldIdentity,

  buildInspectionFieldIndex,

  findInspectionFieldForResolution,

  isResolutionEligibleForInteraction,

  isHandlerImplemented,

  isDirectInteractionField,

  getFieldsForPostFillValidation,

  buildInteractionWorkItems,

  validateFieldLocator,

  dispatchFieldInteraction,

  interactWithResolvedField,

  interactWithForm,
};