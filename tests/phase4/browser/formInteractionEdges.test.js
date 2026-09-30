const test =
  require("node:test");

const assert =
  require("node:assert/strict");


const {
  createBrowserSession,
  closeBrowser,
} = require(
  "../../../src/application/browser/browserService"
);


const {
  fillTextField,
} = require(
  "../../../src/application/browser/interactions/textFieldInteractor"
);


const {
  fillNativeSelect,
} = require(
  "../../../src/application/browser/interactions/selectInteractor"
);


test.after(
  async () => {
    await closeBrowser();
  }
);


/*
 * ============================================================
 * PASSWORD MUST NEVER BE FILLED
 * ============================================================
 */

test(
  "text interactor refuses password controls",
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
      .setContent(`
        <input
          id="secret"
          type="password"
        />
      `);


    const result =
      await fillTextField({
        locator:
          session.page
            .locator(
              "#secret"
            ),

        field: {
          fieldId:
            "password",

          label:
            "Password",

          fieldType:
            "text",

          metadata: {
            tagName:
              "input",

            inputType:
              "password",
          },
        },

        resolution: {
          value:
            "must-never-be-entered",
        },
      });


    assert.notEqual(
      result.status,
      "filled"
    );


    assert.equal(
      await session.page
        .locator(
          "#secret"
        )
        .inputValue(),

      ""
    );
  }
);


/*
 * ============================================================
 * HIDDEN TEXT INPUT
 * ============================================================
 */

test(
  "does not fill hidden text control",
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
      .setContent(`
        <input
          id="hiddenField"
          type="text"
          style="display:none"
        />
      `);


    const result =
      await fillTextField({
        locator:
          session.page
            .locator(
              "#hiddenField"
            ),

        field: {
          fieldId:
            "hidden",

          label:
            "Hidden",

          fieldType:
            "text",

          metadata: {
            tagName:
              "input",

            inputType:
              "text",
          },
        },

        resolution: {
          value:
            "should-not-be-filled",
        },
      });


    assert.notEqual(
      result.status,
      "filled"
    );


    assert.equal(
      await session.page
        .locator(
          "#hiddenField"
        )
        .inputValue(),

      ""
    );
  }
);


/*
 * ============================================================
 * DISABLED TEXT INPUT
 * ============================================================
 */

test(
  "does not fill disabled text control",
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
      .setContent(`
        <input
          id="disabledField"
          type="text"
          disabled
        />
      `);


    const result =
      await fillTextField({
        locator:
          session.page
            .locator(
              "#disabledField"
            ),

        field: {
          fieldId:
            "disabled",

          label:
            "Disabled",

          fieldType:
            "text",

          metadata: {
            tagName:
              "input",

            inputType:
              "text",
          },
        },

        resolution: {
          value:
            "should-not-be-filled",
        },
      });


    assert.notEqual(
      result.status,
      "filled"
    );


    assert.equal(
      await session.page
        .locator(
          "#disabledField"
        )
        .inputValue(),

      ""
    );
  }
);


/*
 * ============================================================
 * INVALID SELECT OPTION
 * ============================================================
 */

test(
  "native select refuses unavailable option instead of guessing",
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
      .setContent(`
        <select id="location">
          <option value="">
            Select
          </option>

          <option value="Lagos">
            Lagos
          </option>

          <option value="Abuja">
            Abuja
          </option>
        </select>
      `);


    const result =
      await fillNativeSelect({
        locator:
          session.page
            .locator(
              "#location"
            ),

        field: {
          fieldId:
            "location",

          label:
            "Location",

          fieldType:
            "choice",

          metadata: {
            tagName:
              "select",
          },
        },

        resolution: {
          value:
            "Lagos State",
        },
      });


    assert.notEqual(
      result.status,
      "filled"
    );


    assert.equal(
      await session.page
        .locator(
          "#location"
        )
        .inputValue(),

      ""
    );
  }
);