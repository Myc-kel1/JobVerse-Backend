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
  evaluateInteractionSafety,
} = require(
  "../../../src/application/browser/interactions/interactionSafetyService"
);


test.after(
  async () => {
    await closeBrowser();
  }
);


/*
 * ============================================================
 * CAPTCHA
 * ============================================================
 */

test(
  "stops for CAPTCHA",
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
        <!doctype html>
        <html>
          <body>
            <form>
              <input
                type="text"
                name="name"
              />

              <div
                class="g-recaptcha"
                data-sitekey="test"
              ></div>
            </form>
          </body>
        </html>
      `);


    const result =
      await evaluateInteractionSafety({
        page:
          session.page,

        interactionResults:
          [],

        fields:
          [],
      });


    assert.equal(
      result.blocked,
      true
    );


    assert.equal(
      result.type,
      "captcha"
    );


    assert.equal(
      result.nextAction,
      "complete_captcha"
    );
  }
);


/*
 * ============================================================
 * PASSWORD
 * ============================================================
 */

test(
  "stops when visible password authentication appears",
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
        <!doctype html>
        <html>
          <body>
            <label for="password">
              Password
            </label>

            <input
              id="password"
              type="password"
            />
          </body>
        </html>
      `);


    const result =
      await evaluateInteractionSafety({
        page:
          session.page,

        interactionResults:
          [],

        fields:
          [],
      });


    assert.equal(
      result.blocked,
      true
    );


    assert.equal(
      result.type,
      "password"
    );
  }
);


/*
 * ============================================================
 * OTP
 * ============================================================
 */

test(
  "stops for verification-code flow",
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
        <!doctype html>
        <html>
          <body>
            <p>
              Enter the verification code sent to your email.
            </p>

            <input type="text" />
          </body>
        </html>
      `);


    const result =
      await evaluateInteractionSafety({
        page:
          session.page,

        interactionResults:
          [],

        fields:
          [],
      });


    assert.equal(
      result.blocked,
      true
    );


    assert.equal(
      result.type,
      "otp"
    );


    assert.equal(
      result.nextAction,
      "complete_verification_code"
    );
  }
);


/*
 * ============================================================
 * IDENTITY VERIFICATION
 * ============================================================
 */

test(
  "stops for identity verification",
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
        <!doctype html>
        <html>
          <body>
            <h1>
              Verify your identity
            </h1>

            <p>
              Identity verification is required before continuing.
            </p>
          </body>
        </html>
      `);


    const result =
      await evaluateInteractionSafety({
        page:
          session.page,

        interactionResults:
          [],

        fields:
          [],
      });


    assert.equal(
      result.blocked,
      true
    );


    assert.equal(
      result.type,
      "identity_verification"
    );
  }
);


/*
 * ============================================================
 * NORMAL PAGE
 * ============================================================
 */

test(
  "allows ordinary application page",
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
        <!doctype html>
        <html>
          <body>
            <label for="name">
              Name
            </label>

            <input
              id="name"
              type="text"
            />
          </body>
        </html>
      `);


    const result =
      await evaluateInteractionSafety({
        page:
          session.page,

        interactionResults:
          [],

        fields:
          [],
      });


    assert.equal(
      result.blocked,
      false
    );
  }
);