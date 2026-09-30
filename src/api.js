const { randomUUID } = require("crypto");

/*
 * ============================================================
 * GOOGLE SHEETS
 * ============================================================
 *
 * readSheet:
 * existing read operations.
 *
 * upsertRows:
 * used for persistent updates.
 */
const {
  readSheet,
  upsertRows
} = require("./googleSheets");

const {
  runDiscoveryForCandidate:
    runDiscoveryPipeline
} = require("./runDiscovery");

const {
  syncFormResponsesToCandidates
} = require("./syncCandidateIntake");

const {
  generateApplicationForJob,
  listGeneratedApplications,
  getGeneratedApplication
} = require(
  "./application/applicationService"
);

const {
  createApplicationAttempt,
  getApplicationAttempt,
  listApplicationAttempts,
  startApplicationAttempt,
  markAttemptNeedsReview,
  failApplicationAttempt,
  submitApplicationAttempt
} = require(
  "./application/applicationAttemptService"
);

const {
  createApplicationReviewRouter
} = require(
  "./routes/applicationReviewRoutes"
);

const {
  createApplicationQueryRouter
} = require(
  "./routes/applicationQueryRoutes"
);

const {
  createApplicationQuestionRouter
} = require(
  "./routes/applicationQuestionRoutes"
);

/*
 * ============================================================
 * APPLICATION EXECUTION RESUME ROUTES
 * ============================================================
 */

const {
  createApplicationResumeRouter
} = require(
  "./routes/applicationResumeRoutes"
);

const {
  getExecutionReadiness
} = require(
  "./application/execution/executionGuard"
);

const {
  logApplicationGenerated,
  logJobQueued,
  logJobUnqueued,
  logSearchStarted,
  logSearchCompleted,
  logSearchFailed,
  listActivity
} = require(
  "./application/activityLogService"
);

const {
  previewApplicationExecution,
  startApplicationExecution
} = require(
  "./application/applicationExecutionService"
);

const {
  ensureApplicationSheets
} = require(
  "./application/applicationSheets"
);


const runs =
  new Map();

/*
 * ============================================================
 * APPLICATION STATUSES
 * ============================================================
 */

/*
 * Review-only statuses accepted by the normal application
 * status endpoint.
 *
 * Generated is controlled by document generation.
 * Applied is controlled by successful application submission.
 */

/*
 * ============================================================
 * JOB / PROSPECT STATUSES
 * ============================================================
 */

const JOB_STATUSES =
  new Set([
    "New",
    "Queued",
    "Applied",
    "Skipped"
  ]);

/*
 * ============================================================
 * SANITIZE CANDIDATE
 * ============================================================
 */

function sanitizeCandidate(
  candidate
) {
  if (!candidate) {
    return null;
  }

  const {
    masterCVText,
    masterCoverLetterText,
    cvExtractionError,
    coverLetterExtractionError,
    ...safe
  } = candidate;

  return safe;
}

/*
 * ============================================================
 * SANITIZE JOB
 * ============================================================
 */

function sanitizeJob(job) {
  return {
    ...job,

    matchedSkills:
      typeof job.matchedSkills ===
      "string"
        ? job.matchedSkills
            .split(",")
            .map((s) =>
              s.trim()
            )
            .filter(Boolean)
        : job.matchedSkills ||
          [],

    missingSkills:
      typeof job.missingSkills ===
      "string"
        ? job.missingSkills
            .split(",")
            .map((s) =>
              s.trim()
            )
            .filter(Boolean)
        : job.missingSkills ||
          []
  };
}

/*
 * ============================================================
 * SANITIZE APPLICATION
 * ============================================================
 */

function sanitizeApplication(
  application
) {
  if (!application) {
    return null;
  }

  const {
    cvText,
    coverLetterText,
    ...safe
  } = application;

  return {
    ...safe,

    factualWarnings:
      parseJsonArray(
        application
          .factualWarnings
      ),

    missingRequirements:
      parseJsonArray(
        application
          .missingRequirements
      ),

    keyAlignmentPoints:
      parseJsonArray(
        application
          .keyAlignmentPoints
      )
  };
}

/*
 * ============================================================
 * PARSE JSON ARRAY
 * ============================================================
 */

function parseJsonArray(
  value
) {
  if (
    Array.isArray(value)
  ) {
    return value;
  }

  if (!value) {
    return [];
  }

  try {
    const parsed =
      JSON.parse(value);

    return Array.isArray(
      parsed
    )
      ? parsed
      : [];
  } catch {
    return [];
  }
}

/*
 * ============================================================
 * GET CANDIDATE
 * ============================================================
 */

async function getCandidate(
  email
) {
  const candidates =
    await readSheet(
      "Candidates"
    );

  return (
    candidates.find(
      (c) =>
        (
          c.candidateEmail ||
          ""
        ).toLowerCase() ===
        email.toLowerCase()
    ) ||
    null
  );
}

/*
 * ============================================================
 * EXISTING GET JOBS HELPER
 * ============================================================
 */

async function getJobs(
  email,
  query = {}
) {
  const rows =
    await readSheet(
      "Shortlisted Jobs"
    );

  let jobs =
    rows.filter(
      (j) =>
        (
          j.candidateEmail ||
          ""
        ).toLowerCase() ===
        email.toLowerCase()
    );

  if (query.status) {
    jobs =
      jobs.filter(
        (j) =>
          (
            j.status ||
            ""
          ).toLowerCase() ===
          query.status.toLowerCase()
      );
  }

  if (query.source) {
    jobs =
      jobs.filter(
        (j) =>
          (
            j.sourceName ||
            ""
          ).toLowerCase() ===
          query.source.toLowerCase()
      );
  }

  if (query.minScore) {
    jobs =
      jobs.filter(
        (j) =>
          Number(
            j.overallScore
          ) >=
          Number(
            query.minScore
          )
      );
  }

  jobs.sort(
    (a, b) =>
      Number(
        b.overallScore ||
        0
      ) -
      Number(
        a.overallScore ||
        0
      )
  );

  const limit =
    Math.min(
      Math.max(
        Number(
          query.limit
        ) ||
          50,
        1
      ),
      100
    );

  return jobs
    .slice(
      0,
      limit
    )
    .map(
      sanitizeJob
    );
}

/*
 * ============================================================
 * PAGINATED JOB QUERY
 * ============================================================
 */

async function getJobsPage(
  query = {}
) {
  const rows =
    await readSheet(
      "Shortlisted Jobs"
    );

  let jobs =
    rows.slice();

  /*
   * Candidate filter.
   */
  if (
    query.candidateEmail
  ) {
    const candidateEmail =
      String(
        query.candidateEmail
      )
        .trim()
        .toLowerCase();

    jobs =
      jobs.filter(
        (job) =>
          String(
            job.candidateEmail ||
            ""
          )
            .trim()
            .toLowerCase() ===
          candidateEmail
      );
  }

  /*
   * Status filter.
   */
  if (query.status) {
    const status =
      String(
        query.status
      )
        .trim()
        .toLowerCase();

    jobs =
      jobs.filter(
        (job) =>
          String(
            job.status ||
            ""
          )
            .trim()
            .toLowerCase() ===
          status
      );
  }

  /*
   * Source filter.
   */
  if (query.source) {
    const source =
      String(
        query.source
      )
        .trim()
        .toLowerCase();

    jobs =
      jobs.filter(
        (job) =>
          String(
            job.sourceName ||
            ""
          )
            .trim()
            .toLowerCase() ===
          source
      );
  }

  /*
   * Minimum score filter.
   */
  if (
    query.minScore !==
      undefined &&
    query.minScore !==
      null &&
    query.minScore !==
      ""
  ) {
    const minScore =
      Number(
        query.minScore
      );

    if (
      Number.isFinite(
        minScore
      )
    ) {
      jobs =
        jobs.filter(
          (job) =>
            Number(
              job.overallScore ||
              0
            ) >=
            minScore
        );
    }
  }

  /*
   * Highest score first.
   */
  jobs.sort(
    (a, b) =>
      Number(
        b.overallScore ||
        0
      ) -
      Number(
        a.overallScore ||
        0
      )
  );

  const requestedPage =
    Number(
      query.page
    );

  const requestedPageSize =
    Number(
      query.pageSize ||
      query.limit
    );

  const page =
    Number.isFinite(
      requestedPage
    ) &&
    requestedPage > 0
      ? Math.floor(
          requestedPage
        )
      : 1;

  const pageSize =
    Number.isFinite(
      requestedPageSize
    ) &&
    requestedPageSize > 0
      ? Math.min(
          Math.floor(
            requestedPageSize
          ),
          100
        )
      : 10;

  const total =
    jobs.length;

  const totalPages =
    Math.max(
      1,
      Math.ceil(
        total /
        pageSize
      )
    );

  const startIndex =
    (page - 1) *
    pageSize;

  const endIndex =
    startIndex +
    pageSize;

  const data =
    jobs
      .slice(
        startIndex,
        endIndex
      )
      .map(
        sanitizeJob
      );

  return {
    data,

    pagination: {
      page,
      pageSize,
      total,
      totalPages
    }
  };
}

/*
 * ============================================================
 * SEARCH RUN PERSISTENCE
 * ============================================================
 */

async function persistSearchRun(
  state
) {
  await ensureApplicationSheets();

  const now =
    new Date()
      .toISOString();

  const summary =
    state.summary ||
    {};

  const row = {
    runId:
      state.runId,

    candidateEmail:
      state.candidateEmail,

    status:
      state.status,

    startedAt:
      state.startedAt ||
      "",

    completedAt:
      state.completedAt ||
      "",

    totalJobsFound:
      summary.totalJobsFound ??
      summary.totalJobs ??
      summary.totalFetchedJobs ??
      "",

    qualifiedJobs:
      summary.qualifiedJobs ??
      summary.shortlistedJobs ??
      summary.savedJobs ??
      "",

    sourceSummary:
      JSON.stringify(
        summary.jobsBySource ||
        summary.sourceSummary ||
        {}
      ),

    error:
      state.error ||
      "",

    createdAt:
      state.createdAt ||
      state.startedAt ||
      now,

    updatedAt:
      now
  };

  await upsertRows(
    "Search Runs",
    [row],
    ["runId"]
  );

  return row;
}

async function getPersistedSearchRun(
  runId
) {
  await ensureApplicationSheets();

  const rows =
    await readSheet(
      "Search Runs"
    );

  const row =
    rows.find(
      (item) =>
        String(
          item.runId ||
          ""
        ) ===
        String(
          runId ||
          ""
        )
    );

  if (!row) {
    return null;
  }

  let sourceSummary =
    {};

  try {
    sourceSummary =
      row.sourceSummary
        ? JSON.parse(
            row.sourceSummary
          )
        : {};
  } catch (_) {
    sourceSummary =
      {};
  }

  return {
    runId:
      row.runId,

    candidateEmail:
      row.candidateEmail,

    status:
      row.status,

    startedAt:
      row.startedAt ||
      null,

    completedAt:
      row.completedAt ||
      null,

    summary: {
      totalJobsFound:
        row.totalJobsFound ===
        ""
          ? undefined
          : Number(
              row.totalJobsFound
            ),

      qualifiedJobs:
        row.qualifiedJobs ===
        ""
          ? undefined
          : Number(
              row.qualifiedJobs
            ),

      sourceSummary
    },

    error:
      row.error ||
      null
  };
}

/*
 * ============================================================
 * START DISCOVERY RUN
 * ============================================================
 */

function startRun(
  candidateEmail
) {
  const runId =
    randomUUID();

  const now =
    new Date()
      .toISOString();

  const state = {
    runId,
    candidateEmail,
    status:
      "running",
    startedAt:
      now,
    completedAt:
      null,
    summary:
      null,
    error:
      null,
    createdAt:
      now
  };

  /*
   * Preserve fast in-memory polling.
   */
  runs.set(
    runId,
    state
  );

  /*
   * Best-effort persistent storage.
   */
  persistSearchRun(
    state
  ).catch(
    (error) => {
      console.error(
        "[SearchRun] Failed to persist initial run:",
        error
      );
    }
  );

  /*
   * Best-effort activity logging.
   */
  logSearchStarted(
    state
  ).catch(
    (error) => {
      console.error(
        "[ActivityLog] Failed to log search start:",
        error
      );
    }
  );

  runDiscoveryForCandidate(
    candidateEmail
  )
    .then(
      async (summary) => {
        state.status =
          "completed";

        state.completedAt =
          new Date()
            .toISOString();

        state.summary =
          summary;

        state.error =
          null;

        try {
          await persistSearchRun(
            state
          );
        } catch (error) {
          console.error(
            "[SearchRun] Failed to persist completed run:",
            error
          );
        }

        try {
          await logSearchCompleted({
            ...state,

            totalJobsFound:
              summary?.totalJobsFound ??
              summary?.totalJobs ??
              summary?.totalFetchedJobs,

            qualifiedJobs:
              summary?.qualifiedJobs ??
              summary?.shortlistedJobs ??
              summary?.savedJobs,

            sourceSummary:
              summary?.jobsBySource ??
              summary?.sourceSummary ??
              {}
          });
        } catch (error) {
          console.error(
            "[ActivityLog] Failed to log completed search:",
            error
          );
        }
      }
    )
    .catch(
      async (error) => {
        state.status =
          "failed";

        state.completedAt =
          new Date()
            .toISOString();

        state.error =
          error?.message ||
          String(error);

        try {
          await persistSearchRun(
            state
          );
        } catch (persistError) {
          console.error(
            "[SearchRun] Failed to persist failed run:",
            persistError
          );
        }

        try {
          await logSearchFailed(
            state,
            state.error
          );
        } catch (logError) {
          console.error(
            "[ActivityLog] Failed to log failed search:",
            logError
          );
        }
      }
    );

  return state;
}

/*
 * ============================================================
 * RUN DISCOVERY
 * ============================================================
 */

async function runDiscoveryForCandidate(
  email
) {
  const candidate =
    await getCandidate(
      email
    );

  if (!candidate) {
    throw new Error(
      "Candidate not found"
    );
  }

  return runDiscoveryPipeline(
    candidate
  );
}

/*
 * ============================================================
 * REGISTER API ROUTES
 * ============================================================
 */

function registerApiRoutes(
  app,
  {
    checkTriggerToken
  }
) {
  /*
   * ==========================================================
   * CANDIDATES
   * ==========================================================
   */

  app.get(
    "/api/candidates",
    async (
      req,
      res
    ) => {
      try {
        const rows =
          await readSheet(
            "Candidates"
          );

        res.json({
          data:
            rows.map(
              sanitizeCandidate
            )
        });
      } catch (err) {
        res
          .status(500)
          .json({
            error:
              "Failed to load candidates"
          });
      }
    }
  );

  app.get(
    "/api/candidates/:email",
    async (
      req,
      res
    ) => {
      try {
        const candidate =
          await getCandidate(
            req.params.email
          );

        if (!candidate) {
          return res
            .status(404)
            .json({
              error:
                "Candidate not found"
            });
        }

        res.json({
          data:
            sanitizeCandidate(
              candidate
            )
        });
      } catch (err) {
        res
          .status(500)
          .json({
            error:
              "Failed to load candidate"
          });
      }
    }
  );

  /*
   * ==========================================================
   * JOBS
   * ==========================================================
   */

  app.get(
    "/api/jobs",
    async (
      req,
      res
    ) => {
      try {
        const result =
          await getJobsPage(
            req.query
          );

        res.json({
          data:
            result.data,

          count:
            result
              .data
              .length,

          total:
            result
              .pagination
              .total,

          pagination:
            result
              .pagination,

          fetchedAt:
            new Date()
              .toISOString()
        });
      } catch (err) {
        console.error(
          "Jobs API error:",
          err
        );

        res
          .status(500)
          .json({
            error:
              "Failed to load jobs"
          });
      }
    }
  );

  /*
   * ==========================================================
   * GET ONE JOB
   * ==========================================================
   */

  app.get(
    "/api/jobs/:jobId",
    async (
      req,
      res
    ) => {
      try {
        const rows =
          await readSheet(
            "Shortlisted Jobs"
          );

        const job =
          rows.find(
            (j) =>
              String(
                j.jobId
              ) ===
              String(
                req.params
                  .jobId
              )
          );

        if (!job) {
          return res
            .status(404)
            .json({
              error:
                "Job not found"
            });
        }

        res.json({
          data:
            sanitizeJob(
              job
            )
        });
      } catch (err) {
        res
          .status(500)
          .json({
            error:
              "Failed to load job"
          });
      }
    }
  );

  /*
   * ============================================================
   * APPLICATION EXECUTION READINESS
   * ============================================================
   *
   * GET /api/applications/:applicationId/execution-readiness
   *
   * Read-only.
   *
   * Does NOT:
   *
   * - create an Application Attempt
   * - start browser execution
   * - change application status
   * - submit an application
   *
   * It only asks executionGuard.js whether a NEW execution may
   * safely begin.
   */

  app.get(
    "/api/applications/:applicationId/execution-readiness",
    async (
      req,
      res
    ) => {
      try {
        const applicationId =
          String(
            req.params
              .applicationId ||
            ""
          ).trim();

        if (
          !applicationId
        ) {
          return res
            .status(400)
            .json({
              error:
                "applicationId is required",

              code:
                "APPLICATION_ID_REQUIRED"
            });
        }

        /*
         * candidateEmail is optional here.
         *
         * If supplied, executionGuard verifies ownership.
         *
         * This is useful for the frontend candidate workspace,
         * but it is not being treated as authentication.
         */

        const candidateEmail =
          String(
            req.query
              .candidateEmail ||
            ""
          ).trim();

        const readiness =
          await getExecutionReadiness(
            applicationId,
            candidateEmail
              ? {
                  candidateEmail
                }
              : {}
          );

        return res.json({
          data:
            readiness,

          fetchedAt:
            new Date()
              .toISOString()
        });
      } catch (err) {
        /*
         * Preserve domain HTTP status codes when executionGuard
         * provides one.
         */

        const statusCode =
          Number.isInteger(
            err?.statusCode
          )
            ? err.statusCode
            : 500;

        if (
          statusCode >=
            500
        ) {
          console.error(
            "[ExecutionReadiness]",
            err
          );
        }

        return res
          .status(
            statusCode
          )
          .json({
            error:
              err?.message ||
              "Failed to determine execution readiness",

            code:
              err?.code ||
              "EXECUTION_READINESS_ERROR"
          });
      }
    }
  );

/*
 * ==========================================================
 * APPLICATION EXECUTION PREVIEW
 * ==========================================================
 *
 * This does NOT create an attempt.
 *
 * It allows the frontend to inspect:
 *
 * - detected application method
 * - application URL
 * - email recipient
 * - routing confidence
 * - whether human review is required
 * - prepared email draft when applicable
 */

app.get(
  "/api/applications/:applicationId/execution-preview",
  async (
    req,
    res
  ) => {
    try {
      const data =
        await previewApplicationExecution(
          req.params
            .applicationId
        );

      res.json({
        data
      });
    } catch (err) {
      const message =
        err?.message ||
        String(err);

      const lowerMessage =
        message.toLowerCase();

      const statusCode =
        lowerMessage.includes(
          "not found"
        )
          ? 404
          : lowerMessage.includes(
              "must be approved"
            )
            ? 409
            : lowerMessage.includes(
                "already been submitted"
              )
              ? 409
              : 400;

      res
        .status(
          statusCode
        )
        .json({
          error:
            message
        });
    }
  }
);

/*
 * ==========================================================
 * START APPLICATION EXECUTION
 * ==========================================================
 *
 * This:
 *
 * - validates the application
 * - detects the route
 * - creates an Application Attempt
 * - moves it to applying
 * - hands it to the correct channel
 *
 * For now:
 *
 * email
 *   → prepares email and pauses for review
 *
 * google_form
 * ats_form
 * company_form
 * linkedin_easy_apply
 * manual_only
 * unknown
 *   → pause for human review
 */

app.post(
  "/api/applications/:applicationId/execute",
  checkTriggerToken,
  async (
    req,
    res
  ) => {
    try {
      const data =
        await startApplicationExecution({
          applicationId:
            req.params
              .applicationId,

          applicationMode:
            req.body
              ?.applicationMode
        });

      res
        .status(202)
        .json({
          data
        });
    } catch (err) {
      console.error(
        "Application execution error:",
        err
      );

      const message =
        err?.message ||
        String(err);

      const lowerMessage =
        message.toLowerCase();

      const statusCode =
        lowerMessage.includes(
          "not found"
        )
          ? 404
          : lowerMessage.includes(
              "must be approved"
            )
            ? 409
            : lowerMessage.includes(
                "already been submitted"
              )
              ? 409
              : lowerMessage.includes(
                  "unsupported application mode"
                )
                ? 400
                : 400;

      res
        .status(
          statusCode
        )
        .json({
          error:
            message
        });
    }
  }
);  

  /*
   * ==========================================================
   * UPDATE JOB / PROSPECT STATUS
   * ==========================================================
   */

  app.patch(
    "/api/jobs/:jobId/status",
    checkTriggerToken,
    async (
      req,
      res
    ) => {
      try {
        const jobId =
          String(
            req.params
              .jobId ||
            ""
          ).trim();

        const candidateEmail =
          String(
            req.body
              ?.candidateEmail ||
            ""
          ).trim();

        const status =
          String(
            req.body
              ?.status ||
            ""
          ).trim();

        if (!jobId) {
          return res
            .status(400)
            .json({
              error:
                "jobId is required"
            });
        }

        if (
          !candidateEmail
        ) {
          return res
            .status(400)
            .json({
              error:
                "candidateEmail is required"
            });
        }

        if (
          !JOB_STATUSES.has(
            status
          )
        ) {
          return res
            .status(400)
            .json({
              error:
                `Invalid status. Allowed: ${[
                  ...JOB_STATUSES
                ].join(", ")}`
            });
        }

        const rows =
          await readSheet(
            "Shortlisted Jobs"
          );

        const existingJob =
          rows.find(
            (job) =>
              String(
                job.jobId
              ) ===
                jobId &&
              String(
                job.candidateEmail ||
                ""
              )
                .trim()
                .toLowerCase() ===
                candidateEmail
                  .toLowerCase()
          );

        if (
          !existingJob
        ) {
          return res
            .status(404)
            .json({
              error:
                "Job not found"
            });
        }

        const updatedJob = {
          ...existingJob,

          status
        };

        await upsertRows(
          "Shortlisted Jobs",
          [
            updatedJob
          ],
          [
            "jobId",
            "candidateEmail"
          ]
        );

        /*
         * Best-effort Activity Log.
         */
        try {
          if (
            status ===
            "Queued"
          ) {
            await logJobQueued(
              updatedJob
            );
          }

          if (
            status ===
            "New" &&
            String(
              existingJob.status ||
              ""
            ) ===
            "Queued"
          ) {
            await logJobUnqueued(
              updatedJob
            );
          }
        } catch (logError) {
          console.error(
            "[ActivityLog] Job status log failed:",
            logError
          );
        }

        res.json({
          data:
            sanitizeJob(
              updatedJob
            )
        });
      } catch (err) {
        console.error(
          "Job status update error:",
          err
        );

        res
          .status(500)
          .json({
            error:
              "Failed to update job status"
          });
      }
    }
  );

  /*
   * ==========================================================
   * DASHBOARD
   * ==========================================================
   */

  app.get(
    "/api/dashboard/:email",
    async (
      req,
      res
    ) => {
      try {
        const [
          candidate,
          jobs,
          summaries
        ] =
          await Promise.all([
            getCandidate(
              req.params.email
            ),

            getJobs(
              req.params.email,
              {
                limit:
                  100
              }
            ),

            readSheet(
              "Job Search Execution Summary"
            )
          ]);

        if (!candidate) {
          return res
            .status(404)
            .json({
              error:
                "Candidate not found"
            });
        }

        const candidateSummaries =
          summaries
            .filter(
              (s) =>
                (
                  s.candidateEmail ||
                  ""
                ).toLowerCase() ===
                req.params
                  .email
                  .toLowerCase()
            )
            .sort(
              (a, b) =>
                new Date(
                  b.executionDate ||
                  b.loggedAt ||
                  0
                ) -
                new Date(
                  a.executionDate ||
                  a.loggedAt ||
                  0
                )
            );

        const latest =
          candidateSummaries[0] ||
          null;

        res.json({
          data: {
            candidate:
              sanitizeCandidate(
                candidate
              ),

            jobs,

            stats: {
              totalJobs:
                jobs.length,

              qualifiedJobs:
                jobs.filter(
                  (j) =>
                    Number(
                      j.overallScore
                    ) >=
                    Number(
                      candidate
                        .minimumMatchScore ||
                      6
                    )
                ).length,

              averageScore:
                jobs.length
                  ? Number(
                      (
                        jobs.reduce(
                          (
                            sum,
                            j
                          ) =>
                            sum +
                            Number(
                              j.overallScore ||
                              0
                            ),
                          0
                        ) /
                        jobs.length
                      ).toFixed(
                        2
                      )
                    )
                  : 0,

              latestRun:
                latest
            },

            fetchedAt:
              new Date()
                .toISOString()
          }
        });
      } catch (err) {
        console.error(
          "Dashboard error:",
          err
        );

        res
          .status(500)
          .json({
            error:
              "Failed to load dashboard",

            details:
              err.message
          });
      }
    }
  );

  /*
   * ==========================================================
   * EXECUTIONS
   * ==========================================================
   */

  app.get(
    "/api/executions/:email",
    async (
      req,
      res
    ) => {
      try {
        const rows =
          await readSheet(
            "Job Search Execution Summary"
          );

        const data =
          rows
            .filter(
              (s) =>
                (
                  s.candidateEmail ||
                  ""
                ).toLowerCase() ===
                req.params
                  .email
                  .toLowerCase()
            )
            .sort(
              (a, b) =>
                new Date(
                  b.executionDate ||
                  b.loggedAt ||
                  0
                ) -
                new Date(
                  a.executionDate ||
                  a.loggedAt ||
                  0
                )
            );

        res.json({
          data
        });
      } catch (err) {
        res
          .status(500)
          .json({
            error:
              "Failed to load execution history"
          });
      }
    }
  );

  /*
   * ==========================================================
   * START SEARCH
   * ==========================================================
   */

  app.post(
    "/api/search/:email",
    checkTriggerToken,
    async (
      req,
      res
    ) => {
      try {
        const candidate =
          await getCandidate(
            req.params.email
          );

        if (!candidate) {
          return res
            .status(404)
            .json({
              error:
                "Candidate not found"
            });
        }

        res
          .status(202)
          .json({
            data:
              startRun(
                candidate
                  .candidateEmail
              )
          });
      } catch (err) {
        res
          .status(500)
          .json({
            error:
              err.message
          });
      }
    }
  );

  /*
   * ==========================================================
   * SEARCH RUN STATUS
   * ==========================================================
   */

  app.get(
    "/api/runs/:runId",
    async (
      req,
      res
    ) => {
      try {
        const runId =
          req.params
            .runId;

        /*
         * Fast in-memory lookup.
         */
        let run =
          runs.get(
            runId
          );

        /*
         * Persistent fallback.
         */
        if (!run) {
          run =
            await getPersistedSearchRun(
              runId
            );
        }

        if (!run) {
          return res
            .status(404)
            .json({
              error:
                "Run not found"
            });
        }

        res.json({
          data:
            run
        });
      } catch (err) {
        console.error(
          "Search run lookup error:",
          err
        );

        res
          .status(500)
          .json({
            error:
              "Failed to load search run"
          });
      }
    }
  );

  /*
   * ==========================================================
   * SYNC INTAKE
   * ==========================================================
   */

  app.post(
    "/api/sync-intake",
    checkTriggerToken,
    async (
      req,
      res
    ) => {
      try {
        res.json({
          data:
            await syncFormResponsesToCandidates()
        });
      } catch (err) {
        res
          .status(500)
          .json({
            error:
              err.message
          });
      }
    }
  );

  /*
   * ==========================================================
   * APPLICATION GENERATION
   * ==========================================================
   */

  app.post(
    "/api/applications/:candidateEmail/:jobId/generate",
    checkTriggerToken,
    async (
      req,
      res
    ) => {
      try {
        /*
         * Check if a reusable application already existed
         * before generation so the Activity Log is not duplicated.
         */
        const beforeRows =
          await readSheet(
            "Generated Applications"
          );

        const candidateEmail =
          String(
            req.params
              .candidateEmail ||
            ""
          )
            .trim()
            .toLowerCase();

        const jobId =
          String(
            req.params
              .jobId ||
            ""
          ).trim();

        const existedBefore =
          beforeRows.some(
            (row) =>
              String(
                row.jobId ||
                ""
              ).trim() ===
                jobId &&
              String(
                row.candidateEmail ||
                ""
              )
                .trim()
                .toLowerCase() ===
                candidateEmail &&
              [
                "generated",
                "under review",
                "approved",
                "applied"
              ].includes(
                String(
                  row.status ||
                  ""
                )
                  .trim()
                  .toLowerCase()
              )
          );

        const data =
          await generateApplicationForJob({
            candidateEmail:
              req.params
                .candidateEmail,

            jobId:
              req.params
                .jobId,

            applicationType:
              req.body
                ?.applicationType ||
              null
          });

        if (
          !existedBefore &&
          data?.status ===
            "Generated"
        ) {
          try {
            await logApplicationGenerated(
              data
            );
          } catch (logError) {
            console.error(
              "[ActivityLog] Failed to log generated application:",
              logError
            );
          }
        }

        res
          .status(201)
          .json({
            data:
              sanitizeApplication(
                data
              )
          });
      } catch (err) {
        console.error(
          "Application generation error:",
          err
        );

        res
          .status(500)
          .json({
            error:
              err.message
          });
      }
    }
  );

  /*
   * ==========================================================
   * LIST APPLICATIONS
   * ==========================================================
   */

    /*
 * ============================================================
 * APPLICATION QUERY ROUTES
 * ============================================================
 *
 * Read-only application lifecycle queries.
 *
 * Final endpoints:
 *
 * GET /api/applications/workspace
 * GET /api/applications/ready-for-review
 * GET /api/applications/counts
 *
 * All filtering and eligibility logic remains inside
 * applicationQueryService.js.
 */

app.use(
  "/api/applications",
  createApplicationQueryRouter()
);

  /*
   * ==========================================================
   * APPLICATION REVIEW ROUTES
   * ==========================================================
   *
   * Dedicated review lifecycle routes:
   *
   * GET  /api/applications/:applicationId/review
   * POST /api/applications/:applicationId/review
   * POST /api/applications/:applicationId/approve
   * POST /api/applications/:applicationId/reject
   *
   * Business logic remains inside applicationReviewService.js.
   * api.js only mounts the router.
   */

  app.use(
    "/api/applications",
    createApplicationReviewRouter({
      checkTriggerToken
    })
  );

  /*
 * ============================================================
 * APPLICATION QUESTION ROUTES
 * ============================================================
 *
 * Phase 3:
 *
 * - resolve inspected questions
 * - return unresolved questions
 * - store candidate answers
 * - confirm reusable answers
 * - retrieve stored answers
 *
 * Business logic remains inside:
 *
 * applicationQuestionService.js
 *
 * api.js only mounts the router.
 */

app.use(
  "/api/applications",
  createApplicationQuestionRouter({
    checkTriggerToken
  })
);

/*
 * ============================================================
 * APPLICATION EXECUTION RESUME ROUTES
 * ============================================================
 *
 * POST
 *
 * /api/applications/:applicationId/attempts/:attemptId/resume
 *
 * Resume works on an EXISTING active attempt.
 *
 * It must never create a second Application Attempt.
 */

app.use(
  "/api/applications",

  createApplicationResumeRouter({
    checkTriggerToken
  })
);

  app.get(
    "/api/applications",
    async (
      req,
      res
    ) => {
      try {
        if (
          !req.query
            .candidateEmail
        ) {
          return res
            .status(400)
            .json({
              error:
                "candidateEmail is required"
            });
        }

        const data =
          await listGeneratedApplications(
            req.query
              .candidateEmail,
            req.query
          );

        res.json({
          data:
            data.map(
              sanitizeApplication
            ),

          count:
            data.length,

          fetchedAt:
            new Date()
              .toISOString()
        });
      } catch (err) {
        res
          .status(500)
          .json({
            error:
              "Failed to load generated applications"
          });
      }
    }
  );

  /*
   * ==========================================================
   * GET APPLICATION
   * ==========================================================
   */

  app.get(
    "/api/applications/:applicationId",
    async (
      req,
      res
    ) => {
      try {
        const data =
          await getGeneratedApplication(
            req.params
              .applicationId
          );

        if (!data) {
          return res
            .status(404)
            .json({
              error:
                "Application not found"
            });
        }

        res.json({
          data:
            sanitizeApplication(
              data
            )
        });
      } catch (err) {
        res
          .status(500)
          .json({
            error:
              "Failed to load application"
          });
      }
    }
  );

  /*
   * ==========================================================
   * CREATE APPLICATION ATTEMPT
   * ==========================================================
   */

  app.post(
    "/api/applications/:applicationId/attempts",
    checkTriggerToken,
    async (
      req,
      res
    ) => {
      try {
        const data =
          await createApplicationAttempt({
            applicationId:
              req.params
                .applicationId,

            applicationMethod:
              req.body
                ?.applicationMethod,

            applicationMode:
              req.body
                ?.applicationMode
          });

        res
          .status(201)
          .json({
            data
          });
      } catch (err) {
        const message =
          err?.message ||
          String(err);

        const statusCode =
          message
            .toLowerCase()
            .includes(
              "not found"
            )
            ? 404
            : message
                .includes(
                  "must be Approved"
                )
              ? 409
              : 400;

        res
          .status(
            statusCode
          )
          .json({
            error:
              message
          });
      }
    }
  );

  /*
   * ==========================================================
   * LIST APPLICATION ATTEMPTS
   * ==========================================================
   */

  app.get(
    "/api/application-attempts",
    async (
      req,
      res
    ) => {
      try {
        const data =
          await listApplicationAttempts(
            req.query
          );

        res.json({
          data,

          count:
            data.length
        });
      } catch (err) {
        console.error(
          "Application attempts list error:",
          err
        );

        res
          .status(500)
          .json({
            error:
              "Failed to load application attempts"
          });
      }
    }
  );

  /*
   * ==========================================================
   * GET APPLICATION ATTEMPT
   * ==========================================================
   */

  app.get(
    "/api/application-attempts/:attemptId",
    async (
      req,
      res
    ) => {
      try {
        const data =
          await getApplicationAttempt(
            req.params
              .attemptId
          );

        if (!data) {
          return res
            .status(404)
            .json({
              error:
                "Application attempt not found"
            });
        }

        res.json({
          data
        });
      } catch (err) {
        res
          .status(500)
          .json({
            error:
              "Failed to load application attempt"
          });
      }
    }
  );

  /*
   * ==========================================================
   * START APPLICATION ATTEMPT
   * ==========================================================
   */

  app.patch(
    "/api/application-attempts/:attemptId/start",
    checkTriggerToken,
    async (
      req,
      res
    ) => {
      try {
        const data =
          await startApplicationAttempt(
            req.params
              .attemptId
          );

        res.json({
          data
        });
      } catch (err) {
        res
          .status(400)
          .json({
            error:
              err?.message ||
              String(err)
          });
      }
    }
  );

  /*
   * ==========================================================
   * APPLICATION ATTEMPT NEEDS REVIEW
   * ==========================================================
   */

  app.patch(
    "/api/application-attempts/:attemptId/needs-review",
    checkTriggerToken,
    async (
      req,
      res
    ) => {
      try {
        const data =
          await markAttemptNeedsReview(
            req.params
              .attemptId,

            req.body
              ?.reason ||
            ""
          );

        res.json({
          data
        });
      } catch (err) {
        res
          .status(400)
          .json({
            error:
              err?.message ||
              String(err)
          });
      }
    }
  );

  /*
   * ==========================================================
   * FAIL APPLICATION ATTEMPT
   * ==========================================================
   */

  app.patch(
    "/api/application-attempts/:attemptId/fail",
    checkTriggerToken,
    async (
      req,
      res
    ) => {
      try {
        const data =
          await failApplicationAttempt(
            req.params
              .attemptId,

            req.body
              ?.reason
          );

        res.json({
          data
        });
      } catch (err) {
        res
          .status(400)
          .json({
            error:
              err?.message ||
              String(err)
          });
      }
    }
  );

  /*
   * ==========================================================
   * SUBMIT APPLICATION ATTEMPT
   * ==========================================================
   */

  app.patch(
    "/api/application-attempts/:attemptId/submit",
    checkTriggerToken,
    async (
      req,
      res
    ) => {
      try {
        const data =
          await submitApplicationAttempt(
            req.params
              .attemptId,
            {
              confirmationReference:
                req.body
                  ?.confirmationReference,

              confirmationUrl:
                req.body
                  ?.confirmationUrl
            }
          );

        res.json({
          data
        });
      } catch (err) {
        console.error(
          "Submit application attempt error:",
          err
        );

        res
          .status(400)
          .json({
            error:
              err?.message ||
              String(err)
          });
      }
    }
  );

  /*
   * ==========================================================
   * ACTIVITY LOG
   * ==========================================================
   */

  app.get(
    "/api/activity",
    async (
      req,
      res
    ) => {
      try {
        const data =
          await listActivity(
            req.query
          );

        res.json({
          data,

          count:
            data.length,

          fetchedAt:
            new Date()
              .toISOString()
        });
      } catch (err) {
        console.error(
          "Activity API error:",
          err
        );

        res
          .status(500)
          .json({
            error:
              "Failed to load activity"
          });
      }
    }
  );
}

module.exports = {
  registerApiRoutes
};
