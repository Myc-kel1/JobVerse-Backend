const fs =
  require(
    "fs/promises"
  );


const os =
  require(
    "os"
  );


const path =
  require(
    "path"
  );


const {
  randomUUID,
} = require(
  "crypto"
);


const {
  downloadDriveFile,
} = require(
  "../../fileExtraction"
);


/*
 * ============================================================
 * APPLICATION DOCUMENT MATERIALIZATION SERVICE
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * Convert approved Generated Application document references
 * into temporary LOCAL files that Playwright can safely attach.
 *
 * Stored application:
 *
 * {
 *   cvFile:
 *     "https://docs.google.com/document/d/.../edit",
 *
 *   coverLetterFile:
 *     "https://docs.google.com/document/d/.../edit"
 * }
 *
 * becomes:
 *
 * {
 *   cv: {
 *     path:
 *       "C:\\...\\jobverse-execution\\...\\candidate_cv.docx",
 *
 *     originalName:
 *       "candidate_cv.docx"
 *   },
 *
 *   coverLetter: {
 *     path:
 *       "...",
 *
 *     originalName:
 *       "candidate_cover_letter.docx"
 *   }
 * }
 *
 *
 * ============================================================
 * IMPORTANT ARCHITECTURE RULE
 * ============================================================
 *
 * This service DOES NOT:
 *
 * - generate CVs
 * - generate cover letters
 * - upload files to Drive
 * - choose arbitrary candidate documents
 * - inspect browser forms
 * - attach browser files
 * - create application attempts
 * - submit applications
 *
 * It only materializes documents already associated with the
 * approved Generated Application.
 * ============================================================
 */


/*
 * ============================================================
 * DOCUMENT PURPOSES
 * ============================================================
 */

const APPLICATION_DOCUMENT_PURPOSES =
  Object.freeze({
    CV:
      "cv",

    COVER_LETTER:
      "coverLetter",
  });


/*
 * ============================================================
 * NORMALIZATION
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
 * SAFE TEMPORARY FILE NAME
 * ============================================================
 *
 * Never trust a remote Drive filename as a filesystem path.
 *
 * basename() removes directory components and the replacement
 * strips unsafe filename characters.
 */

function sanitizeFileName(
  value,
  fallback
) {
  const base =
    path.basename(
      normalizeString(
        value
      ) ||
      fallback
    );


  const sanitized =
    base
      .replace(
        /[^a-zA-Z0-9._-]+/g,
        "_"
      )
      .replace(
        /^_+|_+$/g,
        ""
      );


  return (
    sanitized ||
    fallback
  );
}


/*
 * ============================================================
 * MATERIALIZE ONE DRIVE DOCUMENT
 * ============================================================
 */

async function materializeDriveDocument({
  fileUrl,
  tempDirectory,
  fallbackName,
}) {
  const normalizedUrl =
    normalizeString(
      fileUrl
    );


  if (
    !normalizedUrl
  ) {
    return null;
  }


  /*
   * Existing JobVerse Drive retrieval.
   *
   * Returns:
   *
   * {
   *   buffer,
   *   mimeType,
   *   fileName
   * }
   */
  const downloaded =
    await downloadDriveFile(
      normalizedUrl
    );


  if (
    !downloaded ||
    !Buffer.isBuffer(
      downloaded.buffer
    )
  ) {
    throw new Error(
      "Generated application document could not be downloaded from Google Drive."
    );
  }


  const safeName =
    sanitizeFileName(
      downloaded.fileName,
      fallbackName
    );


  const localPath =
    path.join(
      tempDirectory,
      safeName
    );


  await fs.writeFile(
    localPath,
    downloaded.buffer
  );


  return {
    path:
      localPath,

    originalName:
      safeName,

    mimeType:
      normalizeString(
        downloaded.mimeType
      ) ||
      null,
  };
}


/*
 * ============================================================
 * MATERIALIZE APPLICATION DOCUMENTS
 * ============================================================
 *
 * Returns the exact shape expected by fileInputInteractor.js:
 *
 * files.cv
 * files.coverLetter
 */

async function materializeApplicationDocuments(
  application
) {
  if (
    !application ||
    typeof application !==
      "object"
  ) {
    throw new Error(
      "Generated application is required for document materialization."
    );
  }


  const cvUrl =
    normalizeString(
      application.cvFile
    );


  const coverLetterUrl =
    normalizeString(
      application.coverLetterFile
    );


  /*
   * Application eligibility should already guarantee these for an
   * Approved application.
   *
   * Still validate defensively because browser execution should
   * never silently proceed with unrelated/missing documents.
   */
  if (
    !cvUrl
  ) {
    throw new Error(
      "Approved application does not contain a generated CV document."
    );
  }


  if (
    !coverLetterUrl
  ) {
    throw new Error(
      "Approved application does not contain a generated cover letter document."
    );
  }


  const tempDirectory =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        `jobverse-execution-${randomUUID()}-`
      )
    );


  try {
    const [
      cv,
      coverLetter,
    ] =
      await Promise.all([
        materializeDriveDocument({
          fileUrl:
            cvUrl,

          tempDirectory,

          fallbackName:
            "JobVerse_CV.docx",
        }),

        materializeDriveDocument({
          fileUrl:
            coverLetterUrl,

          tempDirectory,

          fallbackName:
            "JobVerse_Cover_Letter.docx",
        }),
      ]);


    return {
      files: {
        cv,

        coverLetter,
      },

      tempDirectory,
    };
  } catch (
    error
  ) {
    /*
     * Prevent abandoned temp files when materialization only
     * partially succeeds.
     */
    await fs.rm(
      tempDirectory,
      {
        recursive:
          true,

        force:
          true,
      }
    );


    throw error;
  }
}


/*
 * ============================================================
 * CLEAN UP MATERIALIZED DOCUMENTS
 * ============================================================
 */

async function cleanupMaterializedApplicationDocuments(
  materialized
) {
  const tempDirectory =
    normalizeString(
      materialized
        ?.tempDirectory
    );


  if (
    !tempDirectory
  ) {
    return;
  }


  await fs.rm(
    tempDirectory,
    {
      recursive:
        true,

      force:
        true,
    }
  );
}


/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  APPLICATION_DOCUMENT_PURPOSES,

  sanitizeFileName,

  materializeDriveDocument,

  materializeApplicationDocuments,

  cleanupMaterializedApplicationDocuments,
};