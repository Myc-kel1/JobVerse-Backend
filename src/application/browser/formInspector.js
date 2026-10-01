const {
  buildFormInspection,
  FIELD_TYPES,
  INSPECTION_STATUSES,
  FORM_ACTION_TYPES,
} = require(
  "../formInspectionService"
);

/*
 * ============================================================
 * LIVE FORM INSPECTOR
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * Inspect a page that has already been rendered by Playwright
 * and convert visible application fields into the standard
 * JobVerse form representation.
 *
 * ------------------------------------------------------------
 * THIS FILE IS RESPONSIBLE FOR
 * ------------------------------------------------------------
 *
 * - discovering rendered form fields
 * - reading field labels
 * - reading required/optional state
 * - reading available choices
 * - grouping radio/checkbox controls
 * - identifying custom ARIA controls
 * - detecting file uploads
 * - detecting multi-step applications
 * - detecting login requirements
 * - detecting CAPTCHA
 *
 * ------------------------------------------------------------
 * THIS FILE DOES NOT
 * ------------------------------------------------------------
 *
 * - answer questions
 * - generate candidate answers
 * - submit forms
 * - bypass CAPTCHA
 * - log into external accounts
 * - handle OTP
 * - click submit buttons
 *
 * Answer resolution belongs to:
 *
 *     formAnswerResolver.js
 *
 * Form interaction belongs to:
 *
 *     formInteractor.js
 *
 * ============================================================
 */


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
 * INSPECTION OPTIONS
 * ============================================================
 */

const DEFAULT_INSPECTION_OPTIONS =
  Object.freeze({
    includeOptionalFields:
      true,

    includeUnknownFields:
      true,

    detectCustomControls:
      true,
  });

/*
 * ============================================================
 * PAGE-LEVEL CAPTCHA DETECTION
 * ============================================================
 */

async function detectCaptcha(
  page
) {
  return page.evaluate(
    () => {
      const selectors = [
        ".g-recaptcha",

        '[data-sitekey]',

        'iframe[src*="recaptcha"]',

        'iframe[src*="hcaptcha"]',

        '[class*="captcha" i]',

        '[id*="captcha" i]',
      ];


      for (
        const selector of
        selectors
      ) {
        if (
          document.querySelector(
            selector
          )
        ) {
          return true;
        }
      }


      const bodyText =
        (
          document.body
            ?.innerText ||
          ""
        )
          .toLowerCase();


      return (
        bodyText.includes(
          "i'm not a robot"
        ) ||
        bodyText.includes(
          "verify you are human"
        ) ||
        bodyText.includes(
          "security challenge"
        )
      );
    }
  );
}


/*
 * ============================================================
 * LOGIN REQUIREMENT DETECTION
 * ============================================================
 *
 * This does NOT try to log in.
 *
 * It only tells the execution layer that authentication may
 * need candidate intervention.
 */

async function detectLoginRequirement(
  page
) {
  return page.evaluate(
    () => {
      const lower =
        (
          value
        ) =>
          String(
            value || ""
          )
            .trim()
            .toLowerCase();


      /*
       * Password field is a strong signal that the current page
       * expects authentication.
       *
       * IMPORTANT:
       *
       * We detect it but never read its value.
       */

      const passwordField =
        document.querySelector(
          'input[type="password"]'
        );


      if (
        passwordField
      ) {
        return true;
      }


      const body =
        lower(
          document.body
            ?.innerText
        );


      const loginSignals = [
        "sign in to continue",

        "log in to continue",

        "login to continue",

        "please sign in",

        "please log in",

        "create an account to continue",

        "account required",
      ];


      return loginSignals.some(
        (
          signal
        ) =>
          body.includes(
            signal
          )
      );
    }
  );
}


/*
 * ============================================================
 * PAGE TITLE
 * ============================================================
 */

async function getPageTitle(
  page
) {
  try {
    return normalizeString(
      await page.title()
    );
  } catch (_) {
    return "";
  }
}


/*
 * ============================================================
 * PAGE DESCRIPTION
 * ============================================================
 */

async function getPageDescription(
  page
) {
  return page.evaluate(
    () => {
      const candidates = [
        document.querySelector(
          'meta[name="description"]'
        )
          ?.getAttribute(
            "content"
          ),

        document.querySelector(
          'meta[property="og:description"]'
        )
          ?.getAttribute(
            "content"
          ),
      ];


      return (
        candidates.find(
          (
            value
          ) =>
            typeof value ===
              "string" &&
            value.trim()
        ) ||
        ""
      );
    }
  );
}


/*
 * ============================================================
 * MULTI-STEP FORM DETECTION
 * ============================================================
 */

async function detectMultiStepForm(
  page
) {
  return page.evaluate(
    () => {
      const normalize =
        (
          value
        ) =>
          String(
            value || ""
          )
            .trim()
            .toLowerCase();


      const elements =
        Array.from(
          document.querySelectorAll(
            [
              "button",

              'input[type="button"]',

              'input[type="submit"]',

              '[role="button"]',
            ].join(
              ","
            )
          )
        );


      const labels =
        elements.map(
          (
            element
          ) =>
            normalize(
              element.innerText ||
              element.value ||
              element.getAttribute(
                "aria-label"
              )
            )
        );


      return labels.some(
        (
          label
        ) =>
          label ===
            "next" ||
          label ===
            "continue" ||
          label.includes(
            "next step"
          ) ||
          label.includes(
            "continue application"
          )
      );
    }
  );
}


/*
 * ============================================================
 * ACTION TYPE DETECTION
 * ============================================================
 */

async function detectActionType(
  page,
  {
    requiresLogin =
      false,
  } = {}
) {
  if (
    requiresLogin
  ) {
    return FORM_ACTION_TYPES
      .LOGIN;
  }


  return page.evaluate(
    (
      actionTypes
    ) => {
      const normalize =
        (
          value
        ) =>
          String(
            value || ""
          )
            .trim()
            .toLowerCase();


      const elements =
        Array.from(
          document.querySelectorAll(
            [
              "button",

              'input[type="submit"]',

              'input[type="button"]',

              '[role="button"]',
            ].join(
              ","
            )
          )
        );


      const labels =
        elements.map(
          (
            element
          ) =>
            normalize(
              element.innerText ||
              element.value ||
              element.getAttribute(
                "aria-label"
              )
            )
        );


      if (
        labels.some(
          (
            label
          ) =>
            label ===
              "next" ||
            label ===
              "continue"
        )
      ) {
        return actionTypes.NEXT;
      }


      if (
        labels.some(
          (
            label
          ) =>
            label.includes(
              "review"
            )
        )
      ) {
        return actionTypes.REVIEW;
      }


      if (
        labels.some(
          (
            label
          ) =>
            label ===
              "submit" ||
            label.includes(
              "submit application"
            ) ||
            label.includes(
              "apply now"
            )
        )
      ) {
        return actionTypes.SUBMIT;
      }


      return actionTypes.UNKNOWN;
    },

    FORM_ACTION_TYPES
  );
}


/*
 * ============================================================
 * EXTRACT RENDERED FORM CONTROLS
 * ============================================================
 *
 * This function executes inside the browser page.
 *
 * IMPORTANT:
 *
 * The returned data must contain only serializable values.
 */

async function extractRenderedFields(
  page
) {
  return page.evaluate(
    () => {
      /*
       * --------------------------------------------------------
       * DOM-SIDE HELPERS
       * --------------------------------------------------------
       */

      function clean(
        value
      ) {
        return String(
          value ?? ""
        )
          .replace(
            /\s+/g,
            " "
          )
          .trim();
      }


      /*
       * --------------------------------------------------------
       * VISIBILITY CHECK
       * --------------------------------------------------------
       *
       * We do not want hidden technical fields appearing as
       * candidate questions.
       */

      function isVisible(
        element
      ) {
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
            "hidden"
        ) {
          return false;
        }


        const rect =
          element
            .getBoundingClientRect();


        /*
         * Some custom controls can have zero dimensions on the
         * input itself while their parent remains visible.
         */

        if (
          rect.width ===
            0 &&
          rect.height ===
            0
        ) {
          const parent =
            element.parentElement;


          if (
            !parent
          ) {
            return false;
          }


          const parentRect =
            parent
              .getBoundingClientRect();


          if (
            parentRect.width ===
              0 &&
            parentRect.height ===
              0
          ) {
            return false;
          }
        }


        return true;
      }


      /*
       * --------------------------------------------------------
       * NON-APPLICATION PAGE UI CHECK
       * --------------------------------------------------------
       *
       * Some job/listing pages contain interactive controls that
       * are unrelated to the employer application itself.
       *
       * Common examples:
       *
       * - cookie preference panels
       * - privacy preference dialogs
       * - consent-management widgets
       *
       * These controls often use normal inputs, checkboxes, radio
       * buttons, and ARIA groups, so without an exclusion guard
       * they can look like legitimate application questions.
       *
       * IMPORTANT:
       *
       * This function only excludes non-application UI from form
       * inspection.
       *
       * It does NOT:
       *
       * - click cookie buttons
       * - accept consent
       * - reject consent
       * - dismiss overlays
       * - modify the current page
       * - alter application navigation
       *
       * The existing application field flow continues unchanged
       * for controls that do not match these exclusions.
       */

      function isExcludedPageUiElement(
        element
      ) {
        if (
          !element ||
          typeof element.closest !==
            "function"
        ) {
          return false;
        }


        /*
         * ------------------------------------------------------
         * STRUCTURAL CONSENT CONTAINERS
         * ------------------------------------------------------
         *
         * Prefer structural signals before textual signals.
         *
         * This prevents us from excluding a legitimate employer
         * field merely because its label happens to contain a word
         * such as "privacy".
         */

        const excludedContainerSelector =
          [
            /*
             * Generic cookie / consent / privacy containers.
             */

            '[id*="cookie" i]',

            '[class*="cookie" i]',

            '[id*="consent" i]',

            '[class*="consent" i]',

            '[id*="privacy" i]',

            '[class*="privacy" i]',

            '[id*="cmp" i]',

            '[class*="cmp" i]',

            '[aria-label*="cookie" i]',

            '[aria-label*="consent" i]',

            '[aria-label*="privacy" i]',

            '[data-testid*="cookie" i]',

            '[data-testid*="consent" i]',

            '[data-testid*="privacy" i]',


            /*
             * OneTrust.
             */

            "#onetrust-consent-sdk",

            "#onetrust-banner-sdk",

            "#onetrust-pc-sdk",

            ".ot-sdk-container",


            /*
             * Cookiebot.
             */

            "#CybotCookiebotDialog",

            "#CybotCookiebotDialogBody",

            '[id^="CybotCookiebot"]',


            /*
             * Didomi.
             */

            "#didomi-host",

            ".didomi-popup-container",

            ".didomi-consent-popup",


            /*
             * Quantcast CMP.
             */

            "#qc-cmp2-container",

            ".qc-cmp2-container",


            /*
             * TrustArc.
             */

            "#truste-consent-track",

            ".truste_overlay",

            ".trustarc-banner-container",
          ].join(
            ","
          );


        if (
          element.closest(
            excludedContainerSelector
          )
        ) {
          return true;
        }


        /*
         * ------------------------------------------------------
         * SEMANTIC PANEL FALLBACK
         * ------------------------------------------------------
         *
         * Some consent-management platforms use generated IDs and
         * class names, so structural selectors may not identify
         * them.
         *
         * In that case we only inspect a nearby semantic panel:
         *
         * - dialog
         * - role=dialog
         * - aside
         * - role=region
         *
         * We intentionally do not inspect arbitrary parent <div>
         * elements. A large page-level wrapper could contain both
         * the genuine job application and unrelated privacy text.
         */

        const nearbyPanel =
          element.closest(
            [
              "dialog",

              '[role="dialog"]',

              "aside",

              '[role="region"]',
            ].join(
              ","
            )
          );


        if (
          !nearbyPanel
        ) {
          return false;
        }


        const nearbyText =
          clean(
            nearbyPanel.innerText
          )
            .toLowerCase();


        if (
          !nearbyText
        ) {
          return false;
        }


        /*
         * Strong consent-management phrases.
         *
         * These include the categories observed during the real
         * JobVerse E2E application test without hard-coding those
         * labels as field-level exclusions.
         */

        const consentContextSignals =
          [
            "cookie preferences",

            "cookie preference",

            "cookie settings",

            "manage cookies",

            "manage consent",

            "consent preferences",

            "privacy preferences",

            "privacy settings",

            "accept all cookies",

            "reject all cookies",

            "necessary cookies",

            "strictly necessary",

            "performance cookies",

            "targeting cookies",

            "functional cookies",
          ];


        return consentContextSignals.some(
          (
            signal
          ) =>
            nearbyText.includes(
              signal
            )
        );
      }


      /*
       * --------------------------------------------------------
       * LABEL LOOKUP
       * --------------------------------------------------------
       *
       * Priority:
       *
       * 1. explicit <label for="">
       * 2. aria-labelledby
       * 3. aria-label
       * 4. wrapping <label>
       * 5. fieldset legend
       * 6. nearby question container
       * 7. placeholder
       */

      function getLabel(
        element
      ) {
        const id =
          clean(
            element.id
          );


        if (
          id
        ) {
          /*
           * CSS.escape protects IDs containing special
           * characters.
           */

          const explicit =
            document.querySelector(
              `label[for="${CSS.escape(
                id
              )}"]`
            );


          const explicitText =
            clean(
              explicit
                ?.innerText
            );


          if (
            explicitText
          ) {
            return explicitText;
          }
        }


        /*
         * aria-labelledby may reference multiple nodes.
         */

        const labelledBy =
          clean(
            element.getAttribute(
              "aria-labelledby"
            )
          );


        if (
          labelledBy
        ) {
          const text =
            labelledBy
              .split(
                /\s+/
              )
              .map(
                (
                  labelId
                ) =>
                  clean(
                    document
                      .getElementById(
                        labelId
                      )
                      ?.innerText
                  )
              )
              .filter(
                Boolean
              )
              .join(
                " "
              );


          if (
            text
          ) {
            return text;
          }
        }


        const ariaLabel =
          clean(
            element.getAttribute(
              "aria-label"
            )
          );


        if (
          ariaLabel
        ) {
          return ariaLabel;
        }


        /*
         * Wrapping label:
         *
         * <label>
         *   Phone
         *   <input />
         * </label>
         */

        const wrappingLabel =
          element.closest(
            "label"
          );


        const wrappingText =
          clean(
            wrappingLabel
              ?.innerText
          );


        if (
          wrappingText
        ) {
          return wrappingText;
        }


        /*
         * fieldset + legend is common for groups.
         */

        const fieldset =
          element.closest(
            "fieldset"
          );


        if (
          fieldset
        ) {
          const legend =
            fieldset.querySelector(
              "legend"
            );


          const legendText =
            clean(
              legend
                ?.innerText
            );


          if (
            legendText
          ) {
            return legendText;
          }
        }


        /*
         * Generic form/question containers used by many ATS
         * implementations.
         */

        const container =
          element.closest(
            [
              '[role="group"]',

              '[role="radiogroup"]',

              ".form-field",

              ".field",

              ".question",

              ".application-question",

              '[data-field]',
            ].join(
              ","
            )
          );


        if (
          container
        ) {
          const possibleLabel =
            container.querySelector(
              [
                "label",

                "legend",

                '[role="heading"]',

                ".label",

                ".question-label",
              ].join(
                ","
              )
            );


          const containerText =
            clean(
              possibleLabel
                ?.innerText
            );


          if (
            containerText
          ) {
            return containerText;
          }
        }


        const placeholder =
          clean(
            element.getAttribute(
              "placeholder"
            )
          );


        if (
          placeholder
        ) {
          return placeholder;
        }


        return "";
      }


      /*
       * --------------------------------------------------------
       * REQUIRED DETECTION
       * --------------------------------------------------------
       */

      function isRequired(
        element
      ) {
        if (
          element.required ===
          true
        ) {
          return true;
        }


        if (
          clean(
            element.getAttribute(
              "aria-required"
            )
          ).toLowerCase() ===
          "true"
        ) {
          return true;
        }


        const container =
          element.closest(
            [
              "fieldset",

              '[role="group"]',

              '[role="radiogroup"]',

              ".form-field",

              ".question",

              ".application-question",
            ].join(
              ","
            )
          );


        if (
          !container
        ) {
          return false;
        }


        /*
         * Avoid treating every asterisk anywhere on the page as
         * required. Only inspect likely label nodes.
         */

        const labelNode =
          container.querySelector(
            [
              "label",

              "legend",

              '[role="heading"]',

              ".label",

              ".question-label",
            ].join(
              ","
            )
          );


        const text =
          clean(
            labelNode
              ?.innerText
          );


        return text.endsWith(
          "*"
        );
      }


      /*
       * --------------------------------------------------------
       * TYPE DETECTION
       * --------------------------------------------------------
       */

      function detectType(
        element
      ) {
        const tag =
          element.tagName
            .toLowerCase();


        const role =
          clean(
            element.getAttribute(
              "role"
            )
          )
            .toLowerCase();


        if (
          tag ===
          "textarea"
        ) {
          return "textarea";
        }


        if (
          tag ===
          "select"
        ) {
          return element.multiple
            ? "multi_choice"
            : "choice";
        }


        if (
          role ===
          "combobox"
        ) {
          return "choice";
        }


        if (
          role ===
          "radiogroup"
        ) {
          return "choice";
        }


        if (
          role ===
          "checkbox"
        ) {
          return "boolean";
        }


        if (
          element.isContentEditable
        ) {
          return "textarea";
        }


        if (
          tag !==
          "input"
        ) {
          return "unknown";
        }


        const type =
          clean(
            element.getAttribute(
              "type"
            ) ||
            "text"
          )
            .toLowerCase();


        switch (
          type
        ) {
          case "email":
            return "email";

          case "tel":
            return "phone";

          case "number":
            return "number";

          case "date":

          case "datetime-local":
            return "date";

          case "url":
            return "url";

          case "radio":
            return "choice";

          case "checkbox":
            return "multi_choice";

          case "file":
            return "file";

          default:
            return "text";
        }
      }


      /*
       * --------------------------------------------------------
       * OPTION EXTRACTION
       * --------------------------------------------------------
       */

      function getOptions(
        element
      ) {
        const tag =
          element.tagName
            .toLowerCase();


        /*
         * Native select.
         */

        if (
          tag ===
          "select"
        ) {
          return Array.from(
            element.options
          )
            .map(
              (
                option
              ) =>
                clean(
                  option.text ||
                  option.value
                )
            )
            .filter(
              Boolean
            );
        }


        /*
         * Radio group / checkbox group.
         */

        const name =
          clean(
            element.getAttribute(
              "name"
            )
          );


        const type =
          clean(
            element.getAttribute(
              "type"
            )
          )
            .toLowerCase();


        if (
          name &&
          (
            type ===
              "radio" ||
            type ===
              "checkbox"
          )
        ) {
          const selector =
            `input[name="${CSS.escape(
              name
            )}"]`;


          return Array.from(
            document.querySelectorAll(
              selector
            )
          )
            /*
             * Keep the original visibility requirement and add
             * only the non-application-UI exclusion.
             */
            .filter(
              (
                option
              ) =>
                isVisible(
                  option
                ) &&
                !isExcludedPageUiElement(
                  option
                )
            )
            .map(
              (
                option
              ) => {
                const optionLabel =
                  getLabel(
                    option
                  );


                return (
                  optionLabel ||
                  clean(
                    option.value
                  )
                );
              }
            )
            .filter(
              Boolean
            );
        }


        /*
         * ARIA custom widgets.
         */

        const container =
          element.closest(
            '[role="radiogroup"], [role="group"]'
          ) ||
          element;


        const ariaOptions =
          Array.from(
            container.querySelectorAll(
              [
                '[role="radio"]',

                '[role="option"]',

                '[role="checkbox"]',
              ].join(
                ","
              )
            )
          )
            /*
             * Same safety rule as native grouped options.
             */
            .filter(
              (
                option
              ) =>
                isVisible(
                  option
                ) &&
                !isExcludedPageUiElement(
                  option
                )
            )
            .map(
              (
                option
              ) =>
                clean(
                  option.innerText ||
                  option.getAttribute(
                    "aria-label"
                  )
                )
            )
            .filter(
              Boolean
            );


        return ariaOptions;
      }


      /*
       * --------------------------------------------------------
       * ELEMENT IDENTITY
       * --------------------------------------------------------
       */

      function getIdentity(
        element
      ) {
        return {
          platformFieldId:
            clean(
              element.id ||
              element.getAttribute(
                "data-field-id"
              ) ||
              element.getAttribute(
                "data-testid"
              )
            ),

          platformFieldName:
            clean(
              element.getAttribute(
                "name"
              )
            ),
        };
      }


      /*
       * --------------------------------------------------------
       * CONTROLS TO INSPECT
       * --------------------------------------------------------
       */

      const selector =
        [
          "input",

          "textarea",

          "select",

          '[role="combobox"]',

          '[role="radiogroup"]',

          '[role="checkbox"]',

          '[contenteditable="true"]',
        ].join(
          ","
        );


      const elements =
        Array.from(
          document.querySelectorAll(
            selector
          )
        );


      const fields =
        [];


      /*
       * Used to prevent radio/checkbox groups appearing once per
       * individual option.
       */

      const processedGroups =
        new Set();


      for (
        const element of
        elements
      ) {
        /*
         * ------------------------------------------------------
         * EXISTING VISIBILITY GATE
         * ------------------------------------------------------
         */

        if (
          !isVisible(
            element
          )
        ) {
          continue;
        }


        /*
         * ------------------------------------------------------
         * EXCLUDE NON-APPLICATION PAGE UI
         * ------------------------------------------------------
         *
         * Cookie/privacy/consent controls must be removed before
         * grouping, label extraction, option extraction, question
         * matching, or normalization.
         *
         * Everything after this guard remains the original field
         * inspection flow.
         */

        if (
          isExcludedPageUiElement(
            element
          )
        ) {
          continue;
        }


        const tag =
          element.tagName
            .toLowerCase();


        const inputType =
          tag ===
          "input"
            ? clean(
                element.getAttribute(
                  "type"
                ) ||
                "text"
              )
                .toLowerCase()
            : "";


        /*
         * ------------------------------------------------------
         * IGNORE NON-QUESTION CONTROLS
         * ------------------------------------------------------
         */

        if (
          [
            "hidden",

            "submit",

            "reset",

            "button",

            "image",
          ].includes(
            inputType
          )
        ) {
          continue;
        }


        /*
         * ------------------------------------------------------
         * PASSWORDS ARE NEVER INSPECTED
         * ------------------------------------------------------
         *
         * Authentication fields belong to the human handoff
         * path, not application-answer automation.
         */

        if (
          inputType ===
          "password"
        ) {
          continue;
        }


        const name =
          clean(
            element.getAttribute(
              "name"
            )
          );


        /*
         * ------------------------------------------------------
         * GROUP RADIO / CHECKBOX CONTROLS
         * ------------------------------------------------------
         */

        if (
          (
            inputType ===
              "radio" ||
            inputType ===
              "checkbox"
          ) &&
          name
        ) {
          const groupKey =
            `${inputType}:${name}`;


          if (
            processedGroups.has(
              groupKey
            )
          ) {
            continue;
          }


          processedGroups.add(
            groupKey
          );
        }


        const {
          platformFieldId,
          platformFieldName,
        } =
          getIdentity(
            element
          );


        const label =
          getLabel(
            element
          );


        const fieldType =
          detectType(
            element
          );


        const options =
          getOptions(
            element
          );


        const required =
          isRequired(
            element
          );


        fields.push({
          platformFieldId,

          platformFieldName,

          label,

          fieldType,

          required,

          options,

          placeholder:
            clean(
              element.getAttribute(
                "placeholder"
              )
            ),

          metadata: {
            tagName:
              tag,

            inputType:
              inputType ||
              null,

            role:
              clean(
                element.getAttribute(
                  "role"
                )
              ) ||
              null,

            autocomplete:
              clean(
                element.getAttribute(
                  "autocomplete"
                )
              ) ||
              null,

            /*
             * Phase 4 Stage 7:
             *
             * Preserve file-upload restrictions so the interaction
             * layer can validate an approved document before
             * attaching it.
             */

            accept:
              clean(
                element.getAttribute(
                  "accept"
                )
              ) ||
              null,

            multiple:
              Boolean(
                element.multiple
              ),
          },
        });
      }


      return fields;
    }
  );
}


/*
 * ============================================================
 * FILTER INSPECTED FIELDS
 * ============================================================
 */

function filterInspectedFields(
  fields,
  options
) {
  const {
    includeOptionalFields,
    includeUnknownFields,
  } = {
    ...DEFAULT_INSPECTION_OPTIONS,

    ...options,
  };


  return (
    fields || []
  ).filter(
    (
      field
    ) => {
      if (
        !includeOptionalFields &&
        !field.required
      ) {
        return false;
      }


      if (
        !includeUnknownFields &&
        field.fieldType ===
          FIELD_TYPES.UNKNOWN
      ) {
        return false;
      }


      return true;
    }
  );
}


/*
 * ============================================================
 * FIELD QUALITY WARNINGS
 * ============================================================
 */

function buildFieldWarnings(
  fields
) {
  const warnings =
    [];


  const unlabeledFields =
    fields.filter(
      (
        field
      ) =>
        !normalizeString(
          field.label
        )
    );


  if (
    unlabeledFields.length >
    0
  ) {
    warnings.push(
      `${unlabeledFields.length} visible form field(s) could not be assigned a readable label.`
    );
  }


  const unknownFields =
    fields.filter(
      (
        field
      ) =>
        field.fieldType ===
        FIELD_TYPES.UNKNOWN
    );


  if (
    unknownFields.length >
    0
  ) {
    warnings.push(
      `${unknownFields.length} visible form field(s) use an unsupported or unknown control type.`
    );
  }


  const fileFields =
    fields.filter(
      (
        field
      ) =>
        field.fieldType ===
        FIELD_TYPES.FILE
    );


  if (
    fileFields.length >
    0
  ) {
    warnings.push(
      `${fileFields.length} file-upload field(s) detected. File selection should be handled by the application interaction layer.`
    );
  }


  return warnings;
}


/*
 * ============================================================
 * INSPECT CURRENT PAGE
 * ============================================================
 *
 * This is the main function used by channel handlers.
 */

async function inspectCurrentPage({
  page,

  applicationMethod =
    "unknown",

  source =
    "browser",

  options = {},
}) {
  if (
    !page
  ) {
    throw new Error(
      "Playwright page is required for form inspection"
    );
  }


  /*
   * ----------------------------------------------------------
   * PAGE STATE DETECTION
   * ----------------------------------------------------------
   */

  const [
    fields,
    requiresLogin,
    hasCaptcha,
    multiStep,
    title,
    description,
  ] =
    await Promise.all([
      extractRenderedFields(
        page
      ),

      detectLoginRequirement(
        page
      ),

      detectCaptcha(
        page
      ),

      detectMultiStepForm(
        page
      ),

      getPageTitle(
        page
      ),

      getPageDescription(
        page
      ),
    ]);


  /*
   * ----------------------------------------------------------
   * FILTER FIELDS
   * ----------------------------------------------------------
   */

  const filteredFields =
    filterInspectedFields(
      fields,
      options
    );


  /*
   * ----------------------------------------------------------
   * ACTION DETECTION
   * ----------------------------------------------------------
   */

  const actionType =
    await detectActionType(
      page,
      {
        requiresLogin,
      }
    );


  /*
   * ----------------------------------------------------------
   * WARNINGS
   * ----------------------------------------------------------
   */

  const warnings =
    buildFieldWarnings(
      filteredFields
    );


  if (
    requiresLogin
  ) {
    warnings.push(
      "Authentication appears to be required. Candidate interaction is required before continuing."
    );
  }


  if (
    hasCaptcha
  ) {
    warnings.push(
      "CAPTCHA or human-verification challenge detected. Automatic interaction must stop."
    );
  }


  if (
    multiStep
  ) {
    warnings.push(
      "Application appears to contain multiple steps. Additional questions may appear after continuing."
    );
  }


  if (
    filteredFields.length ===
      0 &&
    !requiresLogin
  ) {
    warnings.push(
      "No visible application fields were discovered on the current page."
    );
  }


  /*
   * ----------------------------------------------------------
   * DETERMINE INSPECTION STATUS
   * ----------------------------------------------------------
   */

  let status =
    INSPECTION_STATUSES
      .SUCCESS;


  if (
    requiresLogin
  ) {
    status =
      INSPECTION_STATUSES
        .NEEDS_AUTH;

  } else if (
    filteredFields.length ===
      0
  ) {
    status =
      INSPECTION_STATUSES
        .PARTIAL;

  } else if (
    filteredFields.some(
      (
        field
      ) =>
        field.fieldType ===
          FIELD_TYPES.UNKNOWN ||
        !normalizeString(
          field.label
        )
    )
  ) {
    status =
      INSPECTION_STATUSES
        .PARTIAL;
  }


  /*
   * ----------------------------------------------------------
   * NORMALIZE THROUGH SHARED SERVICE
   * ----------------------------------------------------------
   */

  return buildFormInspection({
    applicationMethod,

    url:
      page.url(),

    title,

    description,

    source,

    status,

    fields:
      filteredFields,

    actionType,

    requiresLogin,

    hasCaptcha,

    multiStep,

    warnings,

    metadata: {
      inspectedAt:
        new Date()
          .toISOString(),

      renderer:
        "playwright",

      currentUrl:
        page.url(),
    },
  });
}


/*
 * ============================================================
 * INSPECT URL
 * ============================================================
 *
 * Convenience function for callers that already have a browser
 * session abstraction.
 */

async function inspectUrl({
  session,

  url,

  applicationMethod =
    "unknown",

  source =
    "browser",

  options = {},
}) {
  if (
    !session
  ) {
    throw new Error(
      "Browser session is required"
    );
  }


  if (
    !url
  ) {
    throw new Error(
      "Application URL is required"
    );
  }


  /*
   * browserService.navigate() performs the SSRF/network safety
   * checks before navigation.
   */

  const navigation =
    await session.navigate(
      url
    );


  /*
   * Give client-side frameworks such as React/Vue/Angular time
   * to render their fields.
   */

  await session
    .waitForStability();


  const inspection =
    await inspectCurrentPage({
      page:
        session.page,

      applicationMethod,

      source,

      options,
    });


  return {
    navigation: {
      url:
        navigation.url,

      status:
        navigation.status,

      ok:
        navigation.ok,
    },

    inspection,
  };
}


/*
 * ============================================================
 * FIND MANDATORY REVIEW CONDITIONS
 * ============================================================
 *
 * Useful to applicationExecutionService.
 */

function getMandatoryReviewReasons(
  inspection
) {
  const reasons =
    [];


  if (
    !inspection
  ) {
    return [
      "Form inspection is unavailable.",
    ];
  }


  if (
    inspection.requiresLogin
  ) {
    reasons.push(
      "Authentication is required."
    );
  }


  if (
    inspection.hasCaptcha
  ) {
    reasons.push(
      "CAPTCHA or human verification is required."
    );
  }


  if (
    inspection.status ===
      INSPECTION_STATUSES
        .FAILED
  ) {
    reasons.push(
      "Form inspection failed."
    );
  }


  if (
    inspection.status ===
      INSPECTION_STATUSES
        .UNSUPPORTED
  ) {
    reasons.push(
      "The application form is not currently supported."
    );
  }


  const unknownRequiredFields =
    (
      inspection.fields ||
      []
    ).filter(
      (
        field
      ) =>
        field.required &&
        (
          field.fieldType ===
            FIELD_TYPES.UNKNOWN ||
          !normalizeString(
            field.label
          )
        )
    );


  if (
    unknownRequiredFields.length >
    0
  ) {
    reasons.push(
      `${unknownRequiredFields.length} required field(s) could not be interpreted safely.`
    );
  }


  return reasons;
}


/*
 * ============================================================
 * CAN APPLICATION PROCEED TO ANSWER RESOLUTION?
 * ============================================================
 */

function canResolveFormAnswers(
  inspection
) {
  return (
    getMandatoryReviewReasons(
      inspection
    ).length ===
    0
  );
}


/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  /*
   * Main inspection operations.
   */

  inspectCurrentPage,

  inspectUrl,


  /*
   * DOM extraction.
   */

  extractRenderedFields,


  /*
   * Detection helpers.
   */

  detectCaptcha,

  detectLoginRequirement,

  detectMultiStepForm,

  detectActionType,


  /*
   * Evaluation.
   */

  getMandatoryReviewReasons,

  canResolveFormAnswers,


  /*
   * Field utilities.
   */

  filterInspectedFields,

  buildFieldWarnings,


  /*
   * Configuration.
   */

  DEFAULT_INSPECTION_OPTIONS,
};