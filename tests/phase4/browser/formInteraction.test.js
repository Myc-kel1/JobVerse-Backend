const test =
  require("node:test");

const assert =
  require("node:assert/strict");

const fs =
  require("fs");

const os =
  require("os");

const path =
  require("path");


const {
  createBrowserSession,
  closeBrowser,
} = require(
  "../../../src/application/browser/browserService"
);


const {
  interactWithForm,
} = require(
  "../../../src/application/browser/formInteractor"
);


/*
 * ============================================================
 * TEST FIXTURE
 * ============================================================
 *
 * No remote site is involved.
 *
 * We deliberately include a Submit button and track whether it is
 * clicked. Phase 4 must leave that count at zero.
 */

const FORM_HTML = `
<!doctype html>

<html>
<head>
  <title>JobVerse Phase 4 Test Form</title>
</head>

<body>

  <form id="application-form">

    <label for="fullName">
      Full name
    </label>

    <input
      id="fullName"
      name="fullName"
      type="text"
    />


    <label for="email">
      Email address
    </label>

    <input
      id="email"
      name="email"
      type="email"
    />


    <label for="portfolio">
      Portfolio URL
    </label>

    <input
      id="portfolio"
      name="portfolio"
      type="url"
    />


    <label for="experience">
      Years of experience
    </label>

    <input
      id="experience"
      name="experience"
      type="number"
    />


    <label for="startDate">
      Available start date
    </label>

    <input
      id="startDate"
      name="startDate"
      type="date"
    />


    <label for="workModel">
      Preferred work model
    </label>

    <select
      id="workModel"
      name="workModel"
    >
      <option value="">
        Select one
      </option>

      <option value="Remote">
        Remote
      </option>

      <option value="Hybrid">
        Hybrid
      </option>

      <option value="On-site">
        On-site
      </option>
    </select>


    <fieldset>
      <legend>
        Work authorization
      </legend>

      <label>
        <input
          type="radio"
          name="authorization"
          value="Yes"
        />
        Yes
      </label>

      <label>
        <input
          type="radio"
          name="authorization"
          value="No"
        />
        No
      </label>
    </fieldset>


    <fieldset>
      <legend>
        Skills
      </legend>

      <label>
        <input
          type="checkbox"
          name="skills"
          value="Python"
        />
        Python
      </label>

      <label>
        <input
          type="checkbox"
          name="skills"
          value="FastAPI"
        />
        FastAPI
      </label>

      <label>
        <input
          type="checkbox"
          name="skills"
          value="Java"
        />
        Java
      </label>
    </fieldset>


    <label for="cv">
      Upload CV
    </label>

    <input
      id="cv"
      name="cv"
      type="file"
      accept=".pdf"
    />


    <button
      id="submitButton"
      type="submit"
    >
      Submit application
    </button>

  </form>


  <script>
    window.__submitCount = 0;

    document
      .getElementById("application-form")
      .addEventListener(
        "submit",
        function (event) {
          event.preventDefault();

          window.__submitCount += 1;
        }
      );
  </script>

</body>
</html>
`;


/*
 * ============================================================
 * FIELD FIXTURES
 * ============================================================
 */

function buildInspection() {
  return {
    status:
      "success",

    requiresLogin:
      false,

    hasCaptcha:
      false,

    fields: [
      {
        fieldId:
          "full-name",

        platformFieldId:
          "fullName",

        platformFieldName:
          "fullName",

        label:
          "Full name",

        fieldType:
          "text",

        required:
          true,

        options:
          [],

        metadata: {
          tagName:
            "input",

          inputType:
            "text",
        },
      },

      {
        fieldId:
          "email",

        platformFieldId:
          "email",

        platformFieldName:
          "email",

        label:
          "Email address",

        fieldType:
          "email",

        required:
          true,

        options:
          [],

        metadata: {
          tagName:
            "input",

          inputType:
            "email",
        },
      },

      {
        fieldId:
          "portfolio",

        platformFieldId:
          "portfolio",

        platformFieldName:
          "portfolio",

        label:
          "Portfolio URL",

        fieldType:
          "url",

        required:
          false,

        options:
          [],

        metadata: {
          tagName:
            "input",

          inputType:
            "url",
        },
      },

      {
        fieldId:
          "experience",

        platformFieldId:
          "experience",

        platformFieldName:
          "experience",

        label:
          "Years of experience",

        fieldType:
          "number",

        required:
          true,

        options:
          [],

        metadata: {
          tagName:
            "input",

          inputType:
            "number",
        },
      },

      {
        fieldId:
          "start-date",

        platformFieldId:
          "startDate",

        platformFieldName:
          "startDate",

        label:
          "Available start date",

        fieldType:
          "date",

        required:
          true,

        options:
          [],

        metadata: {
          tagName:
            "input",

          inputType:
            "date",
        },
      },

      {
        fieldId:
          "work-model",

        platformFieldId:
          "workModel",

        platformFieldName:
          "workModel",

        label:
          "Preferred work model",

        fieldType:
          "choice",

        required:
          true,

        options: [
          "Remote",
          "Hybrid",
          "On-site",
        ],

        metadata: {
          tagName:
            "select",

          inputType:
            "",
        },
      },

      {
        fieldId:
          "authorization",

        platformFieldId:
          "",

        platformFieldName:
          "authorization",

        label:
          "Work authorization",

        fieldType:
          "choice",

        required:
          true,

        options: [
          "Yes",
          "No",
        ],

        metadata: {
          tagName:
            "input",

          inputType:
            "radio",
        },
      },

      {
        fieldId:
          "skills",

        platformFieldId:
          "",

        platformFieldName:
          "skills",

        label:
          "Skills",

        fieldType:
          "multi_choice",

        required:
          true,

        options: [
          "Python",
          "FastAPI",
          "Java",
        ],

        metadata: {
          tagName:
            "input",

          inputType:
            "checkbox",
        },
      },

      {
        fieldId:
          "cv",

        platformFieldId:
          "cv",

        platformFieldName:
          "cv",

        label:
          "Upload CV",

        fieldType:
          "file",

        required:
          true,

        options:
          [],

        metadata: {
          tagName:
            "input",

          inputType:
            "file",

          accept:
            ".pdf",

          multiple:
            false,
        },
      },
    ],
  };
}


/*
 * File fields do not require an ordinary Candidate Application
 * Answer resolution.
 */

function buildResolutions() {
  return [
    {
      fieldId:
        "full-name",

      status:
        "resolved",

      resolved:
        true,

      value:
        "Michael Ayanbajo",

      requiresHumanReview:
        false,
    },

    {
      fieldId:
        "email",

      status:
        "resolved",

      resolved:
        true,

      value:
        "candidate@example.com",

      requiresHumanReview:
        false,
    },

    {
      fieldId:
        "portfolio",

      status:
        "resolved",

      resolved:
        true,

      value:
        "https://example.com",

      requiresHumanReview:
        false,
    },

    {
      fieldId:
        "experience",

      status:
        "resolved",

      resolved:
        true,

      value:
        3,

      requiresHumanReview:
        false,
    },

    {
      fieldId:
        "start-date",

      status:
        "resolved",

      resolved:
        true,

      value:
        "2026-10-15",

      requiresHumanReview:
        false,
    },

    {
      fieldId:
        "work-model",

      status:
        "resolved",

      resolved:
        true,

      value:
        "Remote",

      requiresHumanReview:
        false,
    },

    {
      fieldId:
        "authorization",

      status:
        "resolved",

      resolved:
        true,

      value:
        "Yes",

      requiresHumanReview:
        false,
    },

    {
      fieldId:
        "skills",

      status:
        "resolved",

      resolved:
        true,

      value: [
        "Python",
        "FastAPI",
      ],

      requiresHumanReview:
        false,
    },
  ];
}


/*
 * ============================================================
 * CLEANUP
 * ============================================================
 */

test.after(
  async () => {
    await closeBrowser();
  }
);


/*
 * ============================================================
 * COMPLETE FORM INTERACTION
 * ============================================================
 */

test(
  "fills supported controls, attaches approved CV, validates, and never submits",
  async (
    t
  ) => {
    const session =
      await createBrowserSession();


    t.after(
      async () => {
        await session.close();
      }
    );


    await session.page
      .setContent(
        FORM_HTML
      );


    /*
     * Create a harmless temporary fake PDF fixture.
     *
     * The file-input test only needs a regular file path.
     */
    const tempDir =
      fs.mkdtempSync(
        path.join(
          os.tmpdir(),
          "jobverse-phase4-"
        )
      );


    const cvPath =
      path.join(
        tempDir,
        "candidate-cv.pdf"
      );


    fs.writeFileSync(
      cvPath,
      "%PDF-1.4 JobVerse test fixture"
    );


    t.after(
      () => {
        fs.rmSync(
          tempDir,
          {
            recursive:
              true,

            force:
              true,
          }
        );
      }
    );


    const result =
      await interactWithForm({
        page:
          session.page,

        inspection:
          buildInspection(),

        resolutions:
          buildResolutions(),

        files: {
          cv: {
            path:
              cvPath,

            originalName:
              "candidate-cv.pdf",
          },
        },

        mode:
          "fill",
      });


    /*
     * --------------------------------------------------------
     * RESULT CONTRACT
     * --------------------------------------------------------
     */

    assert.equal(
      result.submitted,
      false
    );


    assert.equal(
      result.outcome,
      "ready_for_review"
    );


    assert.equal(
      result.nextAction,
      "review_filled_form"
    );


    assert.equal(
      result.success,
      true
    );


    /*
     * --------------------------------------------------------
     * TEXT
     * --------------------------------------------------------
     */

    assert.equal(
      await session.page
        .locator(
          "#fullName"
        )
        .inputValue(),

      "Michael Ayanbajo"
    );


    assert.equal(
      await session.page
        .locator(
          "#email"
        )
        .inputValue(),

      "candidate@example.com"
    );


    /*
     * --------------------------------------------------------
     * URL
     * --------------------------------------------------------
     */

    assert.match(
      await session.page
        .locator(
          "#portfolio"
        )
        .inputValue(),

      /^https:\/\/example\.com/
    );


    /*
     * --------------------------------------------------------
     * NUMBER
     * --------------------------------------------------------
     */

    assert.equal(
      await session.page
        .locator(
          "#experience"
        )
        .inputValue(),

      "3"
    );


    /*
     * --------------------------------------------------------
     * DATE
     * --------------------------------------------------------
     */

    assert.equal(
      await session.page
        .locator(
          "#startDate"
        )
        .inputValue(),

      "2026-10-15"
    );


    /*
     * --------------------------------------------------------
     * SELECT
     * --------------------------------------------------------
     */

    assert.equal(
      await session.page
        .locator(
          "#workModel"
        )
        .inputValue(),

      "Remote"
    );


    /*
     * --------------------------------------------------------
     * RADIO
     * --------------------------------------------------------
     */

    assert.equal(
      await session.page
        .locator(
          'input[name="authorization"][value="Yes"]'
        )
        .isChecked(),

      true
    );


    assert.equal(
      await session.page
        .locator(
          'input[name="authorization"][value="No"]'
        )
        .isChecked(),

      false
    );


    /*
     * --------------------------------------------------------
     * CHECKBOX GROUP
     * --------------------------------------------------------
     */

    assert.equal(
      await session.page
        .locator(
          'input[name="skills"][value="Python"]'
        )
        .isChecked(),

      true
    );


    assert.equal(
      await session.page
        .locator(
          'input[name="skills"][value="FastAPI"]'
        )
        .isChecked(),

      true
    );


    assert.equal(
      await session.page
        .locator(
          'input[name="skills"][value="Java"]'
        )
        .isChecked(),

      false
    );


    /*
     * --------------------------------------------------------
     * FILE
     * --------------------------------------------------------
     */

    const fileCount =
      await session.page
        .locator(
          "#cv"
        )
        .evaluate(
          (
            element
          ) =>
            element.files
              ?.length ||
            0
        );


    assert.equal(
      fileCount,
      1
    );


    /*
     * --------------------------------------------------------
     * FINAL SUBMIT MUST NEVER BE CLICKED
     * --------------------------------------------------------
     */

    const submitCount =
      await session.page
        .evaluate(
          () =>
            window
              .__submitCount
        );


    assert.equal(
      submitCount,
      0
    );
  }
);