/*
 * ============================================================
 * JOBVERSE — PHASE 2 APPLICATION ELIGIBILITY TESTS
 * ============================================================
 *
 * Purpose:
 *
 * Verify the lifecycle gate introduced during Phase 2.
 *
 * These tests deliberately avoid:
 *
 * - Google Sheets
 * - Google Drive
 * - OAuth
 * - real candidate data
 * - browser execution
 *
 * We are testing pure application lifecycle rules.
 */

const test =
  require("node:test");

const assert =
  require("node:assert/strict");


const {
  APPLICATION_STATUSES,
  EXECUTION_STATUSES,
  canEnterReview,
  isApplicationWorkspaceEligible,
  canApproveApplication,
  canExecuteApplication,
  assertApplicationStatusTransition
} = require(
  "../../src/application/applicationEligibilityService"
);


/*
 * ============================================================
 * TEST FIXTURE
 * ============================================================
 *
 * Start from one known-good generated application and override
 * fields per test.
 */

function createApplication(
  overrides = {}
) {
  return {
    applicationId:
      "phase2-test-application",

    candidateEmail:
      "phase2-test@example.com",

    jobId:
      "phase2-test-job",

    status:
      APPLICATION_STATUSES.GENERATED ??
      "Generated",

    executionStatus:
      EXECUTION_STATUSES.NOT_READY ??
      "not_ready",

    cvFile:
      "generated-cv.docx",

    coverLetterFile:
      "generated-cover-letter.docx",

    ...overrides
  };
}


/*
 * ============================================================
 * NORMALIZE ELIGIBILITY RESULT
 * ============================================================
 *
 * JobVerse eligibility helpers return structured decisions.
 *
 * This helper keeps assertions focused on whether the operation
 * is permitted without coupling every test to extra metadata.
 */

function isAllowed(
  result
) {
  if (
    typeof result ===
    "boolean"
  ) {
    return result;
  }

  if (
    result &&
    typeof result ===
    "object"
  ) {
    if (
      typeof result.eligible ===
      "boolean"
    ) {
      return result.eligible;
    }

    if (
      typeof result.allowed ===
      "boolean"
    ) {
      return result.allowed;
    }

    if (
      typeof result.canProceed ===
      "boolean"
    ) {
      return result.canProceed;
    }
  }

  throw new Error(
    `Unexpected eligibility result: ${JSON.stringify(result)}`
  );
}


/*
 * ============================================================
 * GENERATED + DOCUMENTS MAY ENTER REVIEW
 * ============================================================
 */

test(
  "Generated application with CV and cover letter can enter review",
  () => {
    const application =
      createApplication();

    const result =
      canEnterReview(
        application
      );

    assert.equal(
      isAllowed(result),
      true
    );
  }
);


/*
 * ============================================================
 * MISSING CV BLOCKS REVIEW
 * ============================================================
 */

test(
  "Generated application without CV cannot enter review",
  () => {
    const application =
      createApplication({
        cvFile:
          ""
      });

    const result =
      canEnterReview(
        application
      );

    assert.equal(
      isAllowed(result),
      false
    );
  }
);


/*
 * ============================================================
 * MISSING COVER LETTER BLOCKS REVIEW
 * ============================================================
 */

test(
  "Generated application without cover letter cannot enter review",
  () => {
    const application =
      createApplication({
        coverLetterFile:
          ""
      });

    const result =
      canEnterReview(
        application
      );

    assert.equal(
      isAllowed(result),
      false
    );
  }
);


/*
 * ============================================================
 * GENERATED MUST NOT APPEAR IN APPLICATIONS WORKSPACE
 * ============================================================
 */

test(
  "Generated application is excluded from Applications workspace",
  () => {
    const application =
      createApplication({
        status:
          APPLICATION_STATUSES.GENERATED ??
          "Generated"
      });

    const result =
      isApplicationWorkspaceEligible(
        application
      );

    assert.equal(
      isAllowed(result),
      false
    );
  }
);


/*
 * ============================================================
 * UNDER REVIEW + DOCUMENTS BELONGS IN WORKSPACE
 * ============================================================
 */

test(
  "Under Review application with required documents is workspace eligible",
  () => {
    const application =
      createApplication({
        status:
          APPLICATION_STATUSES.UNDER_REVIEW ??
          "Under Review"
      });

    const result =
      isApplicationWorkspaceEligible(
        application
      );

    assert.equal(
      isAllowed(result),
      true
    );
  }
);


/*
 * ============================================================
 * APPROVED BELONGS IN WORKSPACE
 * ============================================================
 */

test(
  "Approved application with required documents is workspace eligible",
  () => {
    const application =
      createApplication({
        status:
          APPLICATION_STATUSES.APPROVED ??
          "Approved",

        executionStatus:
          EXECUTION_STATUSES.READY ??
          "ready"
      });

    const result =
      isApplicationWorkspaceEligible(
        application
      );

    assert.equal(
      isAllowed(result),
      true
    );
  }
);


/*
 * ============================================================
 * APPLIED REMAINS VISIBLE
 * ============================================================
 */

test(
  "Applied application remains workspace eligible",
  () => {
    const application =
      createApplication({
        status:
          APPLICATION_STATUSES.APPLIED ??
          "Applied",

        executionStatus:
          EXECUTION_STATUSES.SUBMITTED ??
          "submitted"
      });

    const result =
      isApplicationWorkspaceEligible(
        application
      );

    assert.equal(
      isAllowed(result),
      true
    );
  }
);


/*
 * ============================================================
 * REJECTED DOES NOT BELONG IN ACTIVE WORKSPACE
 * ============================================================
 */

test(
  "Rejected application is excluded from Applications workspace",
  () => {
    const application =
      createApplication({
        status:
          APPLICATION_STATUSES.REJECTED ??
          "Rejected"
      });

    const result =
      isApplicationWorkspaceEligible(
        application
      );

    assert.equal(
      isAllowed(result),
      false
    );
  }
);


/*
 * ============================================================
 * UNDER REVIEW MAY BE APPROVED
 * ============================================================
 */

test(
  "Under Review application with required documents can be approved",
  () => {
    const application =
      createApplication({
        status:
          APPLICATION_STATUSES.UNDER_REVIEW ??
          "Under Review"
      });

    const result =
      canApproveApplication(
        application
      );

    assert.equal(
      isAllowed(result),
      true
    );
  }
);


/*
 * ============================================================
 * GENERATED CANNOT SKIP DIRECTLY TO APPROVED
 * ============================================================
 */

test(
  "Generated application cannot transition directly to Approved",
  () => {
    const application =
      createApplication({
        status:
          APPLICATION_STATUSES.GENERATED ??
          "Generated"
      });

    assert.throws(
      () =>
        assertApplicationStatusTransition(
          application,
          APPLICATION_STATUSES.APPROVED ??
            "Approved"
        )
    );
  }
);


/*
 * ============================================================
 * VALID GENERATED -> UNDER REVIEW TRANSITION
 * ============================================================
 */

test(
  "Generated may transition to Under Review",
  () => {
    const application =
      createApplication({
        status:
          APPLICATION_STATUSES.GENERATED ??
          "Generated"
      });

    assert.doesNotThrow(
      () =>
        assertApplicationStatusTransition(
          application,
          APPLICATION_STATUSES.UNDER_REVIEW ??
            "Under Review"
        )
    );
  }
);


/*
 * ============================================================
 * VALID UNDER REVIEW -> APPROVED TRANSITION
 * ============================================================
 */

test(
  "Under Review may transition to Approved",
  () => {
    const application =
      createApplication({
        status:
          APPLICATION_STATUSES.UNDER_REVIEW ??
          "Under Review"
      });

    assert.doesNotThrow(
      () =>
        assertApplicationStatusTransition(
          application,
          APPLICATION_STATUSES.APPROVED ??
            "Approved"
        )
    );
  }
);


/*
 * ============================================================
 * APPROVED + READY MAY EXECUTE
 * ============================================================
 */

test(
  "Approved ready application with documents can execute",
  () => {
    const application =
      createApplication({
        status:
          APPLICATION_STATUSES.APPROVED ??
          "Approved",

        executionStatus:
          EXECUTION_STATUSES.READY ??
          "ready"
      });

    const result =
      canExecuteApplication(
        application
      );

    assert.equal(
      isAllowed(result),
      true
    );
  }
);


/*
 * ============================================================
 * UNDER REVIEW MAY NOT EXECUTE
 * ============================================================
 */

test(
  "Under Review application cannot execute",
  () => {
    const application =
      createApplication({
        status:
          APPLICATION_STATUSES.UNDER_REVIEW ??
          "Under Review",

        executionStatus:
          EXECUTION_STATUSES.NOT_READY ??
          "not_ready"
      });

    const result =
      canExecuteApplication(
        application
      );

    assert.equal(
      isAllowed(result),
      false
    );
  }
);


/*
 * ============================================================
 * APPROVED BUT NOT READY MAY NOT EXECUTE
 * ============================================================
 */

test(
  "Approved application with executionStatus not_ready cannot execute",
  () => {
    const application =
      createApplication({
        status:
          APPLICATION_STATUSES.APPROVED ??
          "Approved",

        executionStatus:
          EXECUTION_STATUSES.NOT_READY ??
          "not_ready"
      });

    const result =
      canExecuteApplication(
        application
      );

    assert.equal(
      isAllowed(result),
      false
    );
  }
);