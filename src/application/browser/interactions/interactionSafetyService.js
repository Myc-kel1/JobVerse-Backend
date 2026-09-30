/*
 * ============================================================
 * INTERACTION SAFETY SERVICE
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * Centralize hard-stop detection for Phase 4 browser interaction.
 *
 * JobVerse must stop automation when the page requires:
 *
 * - login / authentication
 * - CAPTCHA
 * - password entry
 * - OTP / verification code
 * - identity verification
 * - unsupported required controls
 * - ambiguous field mappings
 *
 *
 * ============================================================
 * IMPORTANT SAFETY RULE
 * ============================================================
 *
 * This service DOES NOT attempt to bypass or complete any of
 * those controls.
 *
 * It only:
 *
 * detect
 *     ↓
 * classify
 *     ↓
 * stop
 *     ↓
 * return handoff information
 * ============================================================
 */


/*
 * ============================================================
 * SAFETY STOP TYPES
 * ============================================================
 */

const SAFETY_STOP_TYPES =
  Object.freeze({
    LOGIN_REQUIRED:
      "login_required",

    CAPTCHA:
      "captcha",

    PASSWORD:
      "password",

    OTP:
      "otp",

    IDENTITY_VERIFICATION:
      "identity_verification",

    UNSUPPORTED_REQUIRED_CONTROL:
      "unsupported_required_control",

    AMBIGUOUS_MAPPING:
      "ambiguous_mapping",

    VERIFICATION_REQUIRED:
      "verification_required",
  });


/*
 * ============================================================
 * HANDOFF ACTIONS
 * ============================================================
 */

const SAFETY_HANDOFF_ACTIONS =
  Object.freeze({
    LOGIN_REQUIRED:
      "complete_login",

    CAPTCHA:
      "complete_captcha",

    PASSWORD:
      "complete_authentication",

    OTP:
      "complete_verification_code",

    IDENTITY_VERIFICATION:
      "complete_identity_verification",

    UNSUPPORTED_REQUIRED_CONTROL:
      "review_required_field",

    AMBIGUOUS_MAPPING:
      "review_field_mapping",

    VERIFICATION_REQUIRED:
      "complete_verification",
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
 * SAFETY STOP BUILDER
 * ============================================================
 */

function buildSafetyStop({
  type,
  reason,
  nextAction,
  metadata = {},
}) {
  return {
    blocked:
      true,

    type,

    reason:
      normalizeString(
        reason
      ) ||
      "Browser interaction requires human intervention.",

    nextAction,

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
 * SAFE RESULT
 * ============================================================
 */

function buildSafeResult() {
  return {
    blocked:
      false,

    type:
      null,

    reason:
      null,

    nextAction:
      null,

    metadata: {},
  };
}


/*
 * ============================================================
 * LIVE PAGE SAFETY SCAN
 * ============================================================
 *
 * This inspects PAGE STATE only.
 *
 * It does not rely solely on the earlier form inspection because
 * the page may change dynamically after JobVerse fills a field.
 */

async function scanLivePageSafety(
  page
) {
  if (
    !page
  ) {
    throw new Error(
      "Playwright page is required for safety inspection"
    );
  }


  return page.evaluate(
    () => {
      const normalize =
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
            .trim()
            .toLowerCase();


      const visible =
        (
          element
        ) => {
          if (
            !element
          ) {
            return false;
          }


          const style =
            window.getComputedStyle(
              element
            );


          if (
            style.display ===
              "none" ||
            style.visibility ===
              "hidden" ||
            Number(
              style.opacity
            ) ===
              0
          ) {
            return false;
          }


          const rect =
            element
              .getBoundingClientRect();


          return (
            rect.width >
              0 &&
            rect.height >
              0
          );
        };


      /*
       * --------------------------------------------------------
       * CAPTCHA
       * --------------------------------------------------------
       */

      const captchaSelectors =
        [
          ".g-recaptcha",
          "[data-sitekey]",
          'iframe[src*="recaptcha"]',
          'iframe[src*="hcaptcha"]',
          '[class*="captcha" i]',
          '[id*="captcha" i]',
        ];


      const hasCaptchaElement =
        captchaSelectors
          .some(
            (
              selector
            ) => {
              try {
                return Boolean(
                  document
                    .querySelector(
                      selector
                    )
                );
              } catch (_) {
                return false;
              }
            }
          );


      /*
       * --------------------------------------------------------
       * PASSWORD
       * --------------------------------------------------------
       */

      const visiblePassword =
        Array.from(
          document.querySelectorAll(
            'input[type="password"]'
          )
        ).some(
          visible
        );


      /*
       * --------------------------------------------------------
       * TEXT SIGNALS
       * --------------------------------------------------------
       */

      const bodyText =
        normalize(
          document.body
            ?.innerText
        );


      /*
       * OTP / verification-code signals.
       *
       * These are intentionally conservative and require explicit
       * verification wording.
       */
      const otpSignals =
        [
          "verification code",
          "security code",
          "one-time password",
          "one time password",
          "one-time code",
          "one time code",
          "enter otp",
          "enter the code sent",
          "code sent to your email",
          "code sent to your phone",
        ];


      const hasOtpSignal =
        otpSignals.some(
          (
            signal
          ) =>
            bodyText.includes(
              signal
            )
        );


      /*
       * Identity verification signals.
       */
      const identitySignals =
        [
          "verify your identity",
          "identity verification",
          "confirm your identity",
          "proof of identity",
          "government-issued id",
          "government issued id",
          "identity document",
        ];


      const hasIdentitySignal =
        identitySignals.some(
          (
            signal
          ) =>
            bodyText.includes(
              signal
            )
        );


      /*
       * Authentication/login signals.
       *
       * Password presence is already a strong signal, but some
       * sign-in pages use passwordless login flows.
       */
      const loginSignals =
        [
          "sign in to continue",
          "log in to continue",
          "login to continue",
          "sign in to apply",
          "log in to apply",
          "create an account to continue",
          "create account to continue",
        ];


      const hasLoginSignal =
        loginSignals.some(
          (
            signal
          ) =>
            bodyText.includes(
              signal
            )
        );


      /*
       * Generic verification signal.
       *
       * Lower priority than explicit OTP/identity checks.
       */
      const verificationSignals =
        [
          "additional verification required",
          "verification required",
          "complete verification",
          "verify before continuing",
        ];


      const hasVerificationSignal =
        verificationSignals.some(
          (
            signal
          ) =>
            bodyText.includes(
              signal
            )
        );


      return {
        hasCaptcha:
          hasCaptchaElement,

        hasPassword:
          visiblePassword,

        hasOtp:
          hasOtpSignal,

        hasIdentityVerification:
          hasIdentitySignal,

        hasLoginRequirement:
          hasLoginSignal,

        hasGenericVerification:
          hasVerificationSignal,
      };
    }
  );
}


/*
 * ============================================================
 * CLASSIFY LIVE PAGE SAFETY
 * ============================================================
 *
 * Priority matters.
 *
 * More specific handoffs are returned before generic ones.
 */

function classifyLivePageSafety(
  signals
) {
  const safeSignals =
    signals &&
    typeof signals ===
      "object"
      ? signals
      : {};


  /*
   * CAPTCHA
   */
  if (
    safeSignals.hasCaptcha
  ) {
    return buildSafetyStop({
      type:
        SAFETY_STOP_TYPES
          .CAPTCHA,

      reason:
        "CAPTCHA or human-verification challenge is present on the application page.",

      nextAction:
        SAFETY_HANDOFF_ACTIONS
          .CAPTCHA,
    });
  }


  /*
   * OTP
   */
  if (
    safeSignals.hasOtp
  ) {
    return buildSafetyStop({
      type:
        SAFETY_STOP_TYPES
          .OTP,

      reason:
        "Application flow requires a verification or one-time code.",

      nextAction:
        SAFETY_HANDOFF_ACTIONS
          .OTP,
    });
  }


  /*
   * Identity verification
   */
  if (
    safeSignals
      .hasIdentityVerification
  ) {
    return buildSafetyStop({
      type:
        SAFETY_STOP_TYPES
          .IDENTITY_VERIFICATION,

      reason:
        "Application flow requires identity verification.",

      nextAction:
        SAFETY_HANDOFF_ACTIONS
          .IDENTITY_VERIFICATION,
    });
  }


  /*
   * Password
   */
  if (
    safeSignals.hasPassword
  ) {
    return buildSafetyStop({
      type:
        SAFETY_STOP_TYPES
          .PASSWORD,

      reason:
        "Visible password input requires candidate-controlled authentication.",

      nextAction:
        SAFETY_HANDOFF_ACTIONS
          .PASSWORD,
    });
  }


  /*
   * Passwordless login/auth.
   */
  if (
    safeSignals
      .hasLoginRequirement
  ) {
    return buildSafetyStop({
      type:
        SAFETY_STOP_TYPES
          .LOGIN_REQUIRED,

      reason:
        "Application flow requires the candidate to authenticate before automation can continue.",

      nextAction:
        SAFETY_HANDOFF_ACTIONS
          .LOGIN_REQUIRED,
    });
  }


  /*
   * Generic verification.
   */
  if (
    safeSignals
      .hasGenericVerification
  ) {
    return buildSafetyStop({
      type:
        SAFETY_STOP_TYPES
          .VERIFICATION_REQUIRED,

      reason:
        "Application flow requires additional human verification.",

      nextAction:
        SAFETY_HANDOFF_ACTIONS
          .VERIFICATION_REQUIRED,
    });
  }


  return buildSafeResult();
}


/*
 * ============================================================
 * INTERACTION-RESULT SAFETY SCAN
 * ============================================================
 *
 * Safety stops are not only page-level.
 *
 * A field may reveal:
 *
 * - unsupported required control
 * - ambiguous mapping
 *
 * even when the page itself has no CAPTCHA/login/etc.
 */

function scanInteractionResultsSafety({
  results,
  fields,
}) {
  const safeResults =
    Array.isArray(
      results
    )
      ? results
      : [];


  const safeFields =
    Array.isArray(
      fields
    )
      ? fields
      : [];


  const fieldById =
    new Map();


  for (
    const field of
    safeFields
  ) {
    const fieldId =
      normalizeString(
        field?.fieldId
      );


    if (
      fieldId
    ) {
      fieldById.set(
        fieldId,
        field
      );
    }
  }


  /*
   * ----------------------------------------------------------
   * AMBIGUOUS MAPPING
   * ----------------------------------------------------------
   */

  const ambiguousResult =
    safeResults.find(
      (
        result
      ) => {
        const code =
          normalizeLower(
            result?.errorCode
          );


        const metadataCode =
          normalizeLower(
            result?.metadata
              ?.locatorErrorCode ||
            result?.metadata
              ?.errorCode
          );


        return (
          code.includes(
            "ambiguous"
          ) ||
          metadataCode.includes(
            "ambiguous"
          )
        );
      }
    );


  if (
    ambiguousResult
  ) {
    return buildSafetyStop({
      type:
        SAFETY_STOP_TYPES
          .AMBIGUOUS_MAPPING,

      reason:
        "One or more application fields cannot be mapped to exactly one browser control.",

      nextAction:
        SAFETY_HANDOFF_ACTIONS
          .AMBIGUOUS_MAPPING,

      metadata: {
        fieldId:
          normalizeString(
            ambiguousResult
              ?.fieldId
          ) ||
          null,
      },
    });
  }


  /*
   * ----------------------------------------------------------
   * UNSUPPORTED REQUIRED CONTROL
   * ----------------------------------------------------------
   */

  for (
    const result of
    safeResults
  ) {
    if (
      result?.status !==
      "unsupported"
    ) {
      continue;
    }


    const fieldId =
      normalizeString(
        result?.fieldId
      );


    const field =
      fieldById.get(
        fieldId
      );


    if (
      field?.required ===
      true
    ) {
      return buildSafetyStop({
        type:
          SAFETY_STOP_TYPES
            .UNSUPPORTED_REQUIRED_CONTROL,

        reason:
          "A required application field is not supported by the current browser interaction engine.",

        nextAction:
          SAFETY_HANDOFF_ACTIONS
            .UNSUPPORTED_REQUIRED_CONTROL,

        metadata: {
          fieldId:
            fieldId ||
            null,

          fieldType:
            normalizeString(
              field?.fieldType
            ) ||
            null,
        },
      });
    }
  }


  return buildSafeResult();
}


/*
 * ============================================================
 * COMPLETE SAFETY EVALUATION
 * ============================================================
 */

async function evaluateInteractionSafety({
  page,
  interactionResults = [],
  fields = [],
}) {
  /*
   * Page-level barriers take priority.
   */
  const liveSignals =
    await scanLivePageSafety(
      page
    );


  const liveStop =
    classifyLivePageSafety(
      liveSignals
    );


  if (
    liveStop.blocked
  ) {
    return liveStop;
  }


  /*
   * Then inspect interaction-level safety conditions.
   */
  const resultStop =
    scanInteractionResultsSafety({
      results:
        interactionResults,

      fields,
    });


  if (
    resultStop.blocked
  ) {
    return resultStop;
  }


  return buildSafeResult();
}


/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  SAFETY_STOP_TYPES,

  SAFETY_HANDOFF_ACTIONS,

  buildSafetyStop,

  buildSafeResult,

  scanLivePageSafety,

  classifyLivePageSafety,

  scanInteractionResultsSafety,

  evaluateInteractionSafety,
};