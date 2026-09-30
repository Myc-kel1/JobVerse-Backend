const fs =
  require("fs");

const path =
  require("path");


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
 * FILE INPUT INTERACTOR
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * Safely attach an explicitly approved JobVerse document to a
 * native HTML file input.
 *
 * Supported initial document purposes:
 *
 * - CV / resume
 * - cover letter
 *
 *
 * ============================================================
 * IMPORTANT ARCHITECTURE RULE
 * ============================================================
 *
 * This module DOES NOT:
 *
 * - download documents
 * - search the local filesystem for candidate files
 * - choose arbitrary attachments
 * - generate documents
 * - upload to an unidentified file field
 * - bypass authentication
 * - submit applications
 *
 * The execution/channel layer must provide the approved local
 * file descriptors.
 * ============================================================
 */


/*
 * ============================================================
 * FILE PURPOSES
 * ============================================================
 */

const FILE_PURPOSES =
  Object.freeze({
    CV:
      "cv",

    COVER_LETTER:
      "cover_letter",

    UNKNOWN:
      "unknown",
  });


/*
 * ============================================================
 * ERROR CODES
 * ============================================================
 */

const FILE_INPUT_ERROR_CODES =
  Object.freeze({
    LOCATOR_REQUIRED:
      "FILE_INPUT_LOCATOR_REQUIRED",

    FIELD_REQUIRED:
      "FILE_INPUT_FIELD_REQUIRED",

    UNSUPPORTED_FIELD:
      "FILE_INPUT_UNSUPPORTED_FIELD",

    PURPOSE_UNKNOWN:
      "FILE_INPUT_PURPOSE_UNKNOWN",

    APPROVED_FILE_MISSING:
      "FILE_INPUT_APPROVED_FILE_MISSING",

    PATH_MISSING:
      "FILE_INPUT_PATH_MISSING",

    FILE_NOT_FOUND:
      "FILE_INPUT_FILE_NOT_FOUND",

    NOT_A_FILE:
      "FILE_INPUT_NOT_A_FILE",

    TYPE_NOT_ACCEPTED:
      "FILE_INPUT_TYPE_NOT_ACCEPTED",

    MULTIPLE_UNSUPPORTED:
      "FILE_INPUT_MULTIPLE_UNSUPPORTED",

    ATTACH_FAILED:
      "FILE_INPUT_ATTACH_FAILED",

    VALUE_MISMATCH:
      "FILE_INPUT_VALUE_MISMATCH",
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
 * NATIVE FILE FIELD CHECK
 * ============================================================
 */

function isNativeFileField(
  field
) {
  return (
    field?.fieldType ===
      FIELD_TYPES.FILE &&
    normalizeLower(
      field?.metadata
        ?.tagName
    ) ===
      "input" &&
    normalizeLower(
      field?.metadata
        ?.inputType
    ) ===
      "file"
  );
}


/*
 * ============================================================
 * DETERMINE FILE PURPOSE
 * ============================================================
 *
 * Conservative keyword classification.
 *
 * We do NOT treat a generic field like:
 *
 * "Upload supporting document"
 *
 * as a CV or cover letter.
 */

function detectFilePurpose(
  field
) {
  const text =
    [
      field?.label,
      field?.description,
      field?.platformFieldName,
    ]
      .map(
        normalizeLower
      )
      .filter(
        Boolean
      )
      .join(
        " "
      );


  const cvSignals =
    [
      "resume",
      "résumé",
      "curriculum vitae",
      " cv ",
      "upload cv",
      "attach cv",
    ];


  const coverLetterSignals =
    [
      "cover letter",
      "covering letter",
      "motivation letter",
      "application letter",
    ];


  if (
    coverLetterSignals.some(
      (signal) =>
        text.includes(
          signal
        )
    )
  ) {
    return FILE_PURPOSES
      .COVER_LETTER;
  }


  if (
    cvSignals.some(
      (signal) =>
        text.includes(
          signal
        )
    )
  ) {
    return FILE_PURPOSES
      .CV;
  }


  /*
   * Handle exact/simple CV labels that the " cv " pattern would
   * not catch at string boundaries.
   */
  if (
    [
      "cv",
      "resume",
      "résumé",
    ].includes(
      normalizeLower(
        field?.label
      )
    )
  ) {
    return FILE_PURPOSES
      .CV;
  }


  return FILE_PURPOSES
    .UNKNOWN;
}


/*
 * ============================================================
 * GET APPROVED FILE
 * ============================================================
 */

function getApprovedFile({
  purpose,
  files,
}) {
  const safeFiles =
    files &&
    typeof files ===
      "object"
      ? files
      : {};


  if (
    purpose ===
    FILE_PURPOSES.CV
  ) {
    return (
      safeFiles.cv ||
      null
    );
  }


  if (
    purpose ===
    FILE_PURPOSES
      .COVER_LETTER
  ) {
    return (
      safeFiles.coverLetter ||
      null
    );
  }


  return null;
}


/*
 * ============================================================
 * FILE EXISTENCE VALIDATION
 * ============================================================
 */

function inspectLocalFile(
  fileDescriptor
) {
  if (
    !fileDescriptor ||
    typeof fileDescriptor !==
      "object"
  ) {
    return {
      valid:
        false,

      code:
        FILE_INPUT_ERROR_CODES
          .APPROVED_FILE_MISSING,

      reason:
        "Approved JobVerse document was not provided.",
    };
  }


  const filePath =
    normalizeString(
      fileDescriptor.path
    );


  if (
    !filePath
  ) {
    return {
      valid:
        false,

      code:
        FILE_INPUT_ERROR_CODES
          .PATH_MISSING,

      reason:
        "Approved document does not contain a local file path.",
    };
  }


  let stats;


  try {
    stats =
      fs.statSync(
        filePath
      );
  } catch (_) {
    return {
      valid:
        false,

      code:
        FILE_INPUT_ERROR_CODES
          .FILE_NOT_FOUND,

      reason:
        "Approved document could not be found at its temporary local path.",
    };
  }


  if (
    !stats.isFile()
  ) {
    return {
      valid:
        false,

      code:
        FILE_INPUT_ERROR_CODES
          .NOT_A_FILE,

      reason:
        "Approved document path does not point to a regular file.",
    };
  }


  return {
    valid:
      true,

    path:
      filePath,

    extension:
      path.extname(
        filePath
      ).toLowerCase(),

    size:
      stats.size,
  };
}


/*
 * ============================================================
 * ACCEPT ATTRIBUTE PARSING
 * ============================================================
 *
 * Examples:
 *
 * .pdf,.doc,.docx
 *
 * application/pdf
 *
 * application/msword
 */

function parseAcceptRules(
  accept
) {
  return normalizeString(
    accept
  )
    .split(",")
    .map(
      (item) =>
        item
          .trim()
          .toLowerCase()
    )
    .filter(
      Boolean
    );
}


/*
 * ============================================================
 * EXTENSION ACCEPTANCE
 * ============================================================
 *
 * Stage 7 supports deterministic extension rules.
 *
 * MIME-only constraints are not guessed from extensions here.
 * They remain permissive unless an extension restriction is
 * explicitly present.
 */

function validateAcceptedExtension({
  fileExtension,
  accept,
}) {
  const rules =
    parseAcceptRules(
      accept
    );


  if (
    rules.length ===
    0
  ) {
    return {
      accepted:
        true,
    };
  }


  const extensionRules =
    rules.filter(
      (rule) =>
        rule.startsWith(
          "."
        )
    );


  /*
   * If the employer supplied explicit extension restrictions,
   * enforce them.
   */
  if (
    extensionRules.length >
    0
  ) {
    return {
      accepted:
        extensionRules.includes(
          normalizeLower(
            fileExtension
          )
        ),

      supportedExtensions:
        extensionRules,
    };
  }


  /*
   * MIME-only accept rules are left to the browser in this
   * first implementation rather than guessing MIME types.
   */
  return {
    accepted:
      true,

    browserValidationOnly:
      true,
  };
}


/*
 * ============================================================
 * VERIFY ATTACHED FILE COUNT
 * ============================================================
 */

async function getAttachedFileCount(
  locator
) {
  try {
    return await locator.evaluate(
      (element) =>
        element?.files
          ?.length ||
        0
    );
  } catch (_) {
    return 0;
  }
}


/*
 * ============================================================
 * FILL FILE INPUT
 * ============================================================
 */

async function fillFileInput({
  locator,
  field,
  files,
}) {
  /*
   * ----------------------------------------------------------
   * INPUT VALIDATION
   * ----------------------------------------------------------
   */

  if (
    !locator
  ) {
    return buildBlockedResult(
      field || {},
      "Playwright locator is required for file-upload interaction.",
      {
        errorCode:
          FILE_INPUT_ERROR_CODES
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
      "Normalized file field is required.",
      {
        errorCode:
          FILE_INPUT_ERROR_CODES
            .FIELD_REQUIRED,
      }
    );
  }


  if (
    !isNativeFileField(
      field
    )
  ) {
    return buildFailedResult(
      field,
      "Field is not a supported native file input.",
      {
        errorCode:
          FILE_INPUT_ERROR_CODES
            .UNSUPPORTED_FIELD,
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * FILE PURPOSE
   * ----------------------------------------------------------
   */

  const purpose =
    detectFilePurpose(
      field
    );


  if (
    purpose ===
    FILE_PURPOSES.UNKNOWN
  ) {
    return buildNeedsReviewResult(
      field,
      "JobVerse cannot confidently determine which approved document this file field requests.",
      {
        errorCode:
          FILE_INPUT_ERROR_CODES
            .PURPOSE_UNKNOWN,
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * APPROVED DOCUMENT
   * ----------------------------------------------------------
   */

  const approvedFile =
    getApprovedFile({
      purpose,
      files,
    });


  const localFile =
    inspectLocalFile(
      approvedFile
    );


  if (
    !localFile.valid
  ) {
    return buildNeedsReviewResult(
      field,
      localFile.reason,
      {
        errorCode:
          localFile.code,
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * MULTIPLE FILE INPUT
   * ----------------------------------------------------------
   *
   * A field allowing multiple files may represent:
   *
   * "upload supporting documents"
   *
   * We don't infer that both CV + cover letter should be attached.
   *
   * If we identified this field specifically as CV or cover
   * letter, attaching one file is still safe.
   */

  const multiple =
    Boolean(
      field?.metadata
        ?.multiple
    );


  /*
   * Multiple=true does not REQUIRE multiple files, so one approved
   * document can still be safely supplied.
   */
  void multiple;


  /*
   * ----------------------------------------------------------
   * ACCEPT ATTRIBUTE
   * ----------------------------------------------------------
   */

  const acceptance =
    validateAcceptedExtension({
      fileExtension:
        localFile.extension,

      accept:
        field?.metadata
          ?.accept,
    });


  if (
    !acceptance.accepted
  ) {
    return buildNeedsReviewResult(
      field,
      "Approved document format is not accepted by the employer's file input.",
      {
        errorCode:
          FILE_INPUT_ERROR_CODES
            .TYPE_NOT_ACCEPTED,

        supportedExtensions:
          acceptance
            .supportedExtensions ||
          [],
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * PLAYWRIGHT FILE ATTACHMENT
   * ----------------------------------------------------------
   */

  try {
    await locator
      .setInputFiles(
        localFile.path
      );
  } catch (
    error
  ) {
    return buildFailedResult(
      field,
      "Playwright could not attach the approved document.",
      {
        errorCode:
          FILE_INPUT_ERROR_CODES
            .ATTACH_FAILED,

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

  const attachedCount =
    await getAttachedFileCount(
      locator
    );


  if (
    attachedCount !==
    1
  ) {
    return buildFailedResult(
      field,
      "File input did not retain exactly one approved document after attachment.",
      {
        errorCode:
          FILE_INPUT_ERROR_CODES
            .VALUE_MISMATCH,

        metadata: {
          attachedCount,
        },
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * SUCCESS
   * ----------------------------------------------------------
   *
   * Do not return the absolute filesystem path.
   *
   * That is an implementation detail and may reveal local system
   * information in logs/API responses.
   */

  return buildFilledResult(
    field,
    {
      interaction:
        "file_upload",

      purpose,

      verified:
        true,

      attachedCount,

      extension:
        localFile.extension,

      fileSize:
        localFile.size,
    }
  );
}


/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  FILE_PURPOSES,

  FILE_INPUT_ERROR_CODES,

  isNativeFileField,

  detectFilePurpose,

  getApprovedFile,

  inspectLocalFile,

  parseAcceptRules,

  validateAcceptedExtension,

  getAttachedFileCount,

  fillFileInput,
};