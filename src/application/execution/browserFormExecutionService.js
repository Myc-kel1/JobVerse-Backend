const {
  withBrowserSession,
} = require(
  "../browser/browserService"
);


const {
  inspectUrl,
  getMandatoryReviewReasons,
} = require(
  "../browser/formInspector"
);


const {
  FIELD_TYPES,
} = require(
  "../formInspectionService"
);


const {
  resolveFormQuestions,
  summarizeResolvedQuestions,
} = require(
  "../formAnswerResolver"
);


const {
  interactWithForm,
} = require(
  "../browser/formInteractor"
);


/*
 * ============================================================
 * BROWSER FORM EXECUTION SERVICE
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * Bridge execution/resume orchestration to the Phase 4 browser
 * interaction engine.
 *
 * This service:
 *
 * 1. opens one isolated browser session
 * 2. safely navigates to the application URL
 * 3. inspects the rendered form
 * 4. resolves candidate answers
 * 5. stops if candidate input/review is still required
 * 6. fills eligible fields
 * 7. returns the structured Phase 4 interaction result
 *
 *
 * ============================================================
 * THIS MODULE DOES NOT
 * ============================================================
 *
 * - create application attempts
 * - create duplicate attempts
 * - mutate attempt status
 * - mark applications Applied
 * - click final Submit
 * - click multi-step Next/Continue
 * - bypass login/CAPTCHA/OTP/identity verification
 *
 * Attempt-state decisions stay in executionResumeService.js.
 *
 * Multi-step navigation belongs to Phase 5.
 * ============================================================
 */


/*
 * ============================================================
 * RESULT STATES
 * ============================================================
 */

const BROWSER_FORM_EXECUTION_STATUSES =
  Object.freeze({
    NEEDS_INPUT:
      "needs_input",

    NEEDS_REVIEW:
      "needs_review",

    READY_FOR_REVIEW:
      "ready_for_review",

    BLOCKED:
      "blocked",

    FAILED:
      "failed",
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


/*
 * ============================================================
 * BUILD RESOLVABLE QUESTIONS
 * ============================================================
 *
 * File inputs are deliberately excluded.
 *
 * Their values come from approved application documents rather
 * than Candidate Application Answers.
 */

function buildResolvableQuestions(
  inspection
) {
  const fields =
    Array.isArray(
      inspection?.fields
    )
      ? inspection.fields
      : [];


  return fields
    .filter(
      (field) =>
        field?.fieldType !==
        FIELD_TYPES.FILE
    )
    .map(
      (field) => ({
        fieldId:
          field.fieldId,

        platformFieldId:
          field.platformFieldId,

        platformFieldName:
          field.platformFieldName,

        questionText:
          field.label,

        fieldType:
          field.fieldType,

        required:
          field.required,

        options:
          field.options,

        metadata:
          field.metadata,
      })
    );
}


/*
 * ============================================================
 * DETERMINE ANSWER READINESS
 * ============================================================
 */

function getAnswerReadiness(
  resolutions
) {
  const summary =
    summarizeResolvedQuestions(
      resolutions
    );


  return {
    summary,

    ready:
      summary.missing ===
        0 &&
      summary.needsReview ===
        0,

    requiresCandidateInput:
      summary.missing >
      0,

    requiresHumanReview:
      summary.needsReview >
      0,
  };
}


/*
 * ============================================================
 * MAP PHASE 4 OUTCOME
 * ============================================================
 */

function mapInteractionOutcome(
  interaction
) {
  switch (
    interaction?.outcome
  ) {
    case "ready_for_review":
      return BROWSER_FORM_EXECUTION_STATUSES
        .READY_FOR_REVIEW;


    case "blocked":
      return BROWSER_FORM_EXECUTION_STATUSES
        .BLOCKED;


    case "needs_human_review":
    case "partial":
      return BROWSER_FORM_EXECUTION_STATUSES
        .NEEDS_REVIEW;


    case "failed":
      return BROWSER_FORM_EXECUTION_STATUSES
        .FAILED;


    default:
      return BROWSER_FORM_EXECUTION_STATUSES
        .NEEDS_REVIEW;
  }
}


/*
 * ============================================================
 * EXECUTE CURRENT FORM PAGE
 * ============================================================
 */

async function executeCurrentBrowserForm({
  url,
  candidateEmail,
  applicationMethod,
  source = "browser_execution",
  files = {},
}) {
  const normalizedUrl =
    normalizeString(
      url
    );


  const normalizedCandidateEmail =
    normalizeString(
      candidateEmail
    )
      .toLowerCase();


  if (
    !normalizedUrl
  ) {
    throw new Error(
      "Application URL is required for browser form execution"
    );
  }


  if (
    !normalizedCandidateEmail
  ) {
    throw new Error(
      "candidateEmail is required for browser form execution"
    );
  }


  return withBrowserSession(
    async (
      session
    ) => {
      /*
       * ========================================================
       * INSPECT LIVE PAGE
       * ========================================================
       */

      const {
        navigation,
        inspection,
      } =
        await inspectUrl({
          session,

          url:
            normalizedUrl,

          applicationMethod,

          source,
        });


      /*
       * ========================================================
       * INSPECTION SAFETY
       * ========================================================
       */

      const reviewReasons =
        getMandatoryReviewReasons(
          inspection
        );


      if (
        reviewReasons.length >
        0
      ) {
        return {
          status:
            BROWSER_FORM_EXECUTION_STATUSES
              .BLOCKED,

          nextAction:
            inspection?.requiresLogin
              ? "complete_login"
              : inspection?.hasCaptcha
                ? "complete_captcha"
                : "human_review",

          navigation,

          inspection,

          resolutions:
            [],

          resolutionSummary: {
            total:
              0,

            resolved:
              0,

            needsReview:
              0,

            missing:
              0,
          },

          interaction:
            null,

          reason:
            reviewReasons.join(
              " "
            ),
        };
      }


      /*
       * ========================================================
       * ANSWER RESOLUTION
       * ========================================================
       */

      const questions =
        buildResolvableQuestions(
          inspection
        );


      const resolutions =
        await resolveFormQuestions({
          candidateEmail:
            normalizedCandidateEmail,

          questions,
        });


      const answerReadiness =
        getAnswerReadiness(
          resolutions
        );


      /*
       * ========================================================
       * MISSING CANDIDATE ANSWERS
       * ========================================================
       *
       * Do not begin DOM mutation when required candidate data is
       * still missing.
       */

      if (
        answerReadiness
          .requiresCandidateInput
      ) {
        return {
          status:
            BROWSER_FORM_EXECUTION_STATUSES
              .NEEDS_INPUT,

          nextAction:
            "complete_form_answers",

          navigation,

          inspection,

          resolutions,

          resolutionSummary:
            answerReadiness
              .summary,

          interaction:
            null,

          reason:
            "One or more application questions still require candidate answers.",
        };
      }


      /*
       * ========================================================
       * ANSWERS REQUIRING HUMAN CONFIRMATION
       * ========================================================
       */

      if (
        answerReadiness
          .requiresHumanReview
      ) {
        return {
          status:
            BROWSER_FORM_EXECUTION_STATUSES
              .NEEDS_REVIEW,

          nextAction:
            "confirm_form_answers",

          navigation,

          inspection,

          resolutions,

          resolutionSummary:
            answerReadiness
              .summary,

          interaction:
            null,

          reason:
            "One or more resolved answers still require human confirmation.",
        };
      }


      /*
       * ========================================================
       * PHASE 4 INTERACTION
       * ========================================================
       *
       * NO final Submit occurs here.
       */

      const interaction =
        await interactWithForm({
          page:
            session.page,

          inspection,

          resolutions,

          files,

          mode:
            "fill",
        });


      return {
        status:
          mapInteractionOutcome(
            interaction
          ),

        nextAction:
          interaction
            ?.handoff
            ?.nextAction ||
          interaction
            ?.nextAction ||
          "human_review",

        navigation,

        inspection,

        resolutions,

        resolutionSummary:
          answerReadiness
            .summary,

        interaction,

        reason:
          interaction
            ?.handoff
            ?.reason ||
          null,
      };
    }
  );
}


/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  BROWSER_FORM_EXECUTION_STATUSES,

  buildResolvableQuestions,

  getAnswerReadiness,

  mapInteractionOutcome,

  executeCurrentBrowserForm,
};