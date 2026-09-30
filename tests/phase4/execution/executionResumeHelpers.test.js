const test =
  require("node:test");

const assert =
  require("node:assert/strict");


const {
  mapBrowserResumeNextAction,
  buildBrowserResumeReason,
} = require(
  "../../../src/application/execution/executionResumeService"
);


test(
  "ready browser result maps to review_filled_form",
  () => {
    assert.equal(
      mapBrowserResumeNextAction({
        status:
          "ready_for_review",

        nextAction:
          "review_filled_form",
      }),

      "review_filled_form"
    );
  }
);


test(
  "missing answers retain existing Google Form workflow action",
  () => {
    assert.equal(
      mapBrowserResumeNextAction({
        status:
          "needs_input",

        nextAction:
          "complete_form_answers",
      }),

      "complete_google_form_answers"
    );
  }
);


test(
  "CAPTCHA maps to CAPTCHA handoff",
  () => {
    assert.equal(
      mapBrowserResumeNextAction({
        status:
          "blocked",

        nextAction:
          "complete_captcha",
      }),

      "captcha_handoff"
    );
  }
);


test(
  "login maps to Google login handoff",
  () => {
    assert.equal(
      mapBrowserResumeNextAction({
        status:
          "blocked",

        nextAction:
          "complete_login",
      }),

      "google_login_handoff"
    );
  }
);


test(
  "successful browser fill gets review reason, not submission wording",
  () => {
    const reason =
      buildBrowserResumeReason({
        status:
          "ready_for_review",
      });


    assert.match(
      reason,
      /ready for candidate review/i
    );


    assert.doesNotMatch(
      reason,
      /submitted successfully/i
    );
  }
);