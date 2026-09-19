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
 * NEWLY imported here so prospect/job statuses can be persisted
 * without requiring another inline import later.
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

const runs =
  new Map();

/*
 * ============================================================
 * APPLICATION STATUSES
 * ============================================================
 *
 * EXISTING FLOW — UNCHANGED.
 */
const APPLICATION_STATUSES =
  new Set([
    "Generated",
    "Under Review",
    "Approved",
    "Rejected",
    "Applied"
  ]);

/*
 * ============================================================
 * JOB / PROSPECT STATUSES
 * ============================================================
 *
 * NEW.
 *
 * These are intentionally separate from application statuses.
 *
 * A prospect can be:
 *
 * New
 *   ↓
 * Queued
 *   ↓
 * Applied
 *
 * or:
 *
 * New
 *   ↓
 * Skipped
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
 *
 * EXISTING — UNCHANGED.
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
 *
 * EXISTING — UNCHANGED.
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
 *
 * EXISTING — UNCHANGED.
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
 *
 * EXISTING — UNCHANGED.
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
 *
 * EXISTING — UNCHANGED.
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
 *
 * IMPORTANT:
 *
 * THIS IS DELIBERATELY LEFT UNCHANGED.
 *
 * The dashboard already depends on this returning Job[].
 *
 * We do not change its return shape because doing so could
 * break your existing dashboard flow.
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
 * NEW: PAGINATED JOB QUERY
 * ============================================================
 *
 * This helper exists specifically for the frontend jobs API.
 *
 * Unlike getJobs(), candidateEmail is OPTIONAL.
 *
 * This gives us:
 *
 * GET /api/jobs
 *   → jobs across all candidates
 *
 * GET /api/jobs?candidateEmail=...
 *   → jobs for one candidate
 *
 * It also returns pagination metadata.
 *
 * IMPORTANT:
 *
 * We add this as a separate helper rather than changing
 * getJobs() so existing internal flows remain untouched.
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
   * ----------------------------------------------------------
   * CANDIDATE FILTER
   * ----------------------------------------------------------
   *
   * Optional.
   *
   * No candidateEmail means:
   *
   * All candidates.
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
   * ----------------------------------------------------------
   * STATUS FILTER
   * ----------------------------------------------------------
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
   * ----------------------------------------------------------
   * SOURCE FILTER
   * ----------------------------------------------------------
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
   * ----------------------------------------------------------
   * MINIMUM SCORE FILTER
   * ----------------------------------------------------------
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
   * ----------------------------------------------------------
   * SORT
   * ----------------------------------------------------------
   *
   * Preserve your existing behavior:
   *
   * highest matching score first.
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

  /*
   * ----------------------------------------------------------
   * PAGINATION
   * ----------------------------------------------------------
   *
   * Defaults:
   *
   * page = 1
   * pageSize = 10
   *
   * "limit" is also accepted temporarily for backward
   * compatibility with the frontend version we already made.
   */
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

  /*
   * Total is calculated BEFORE slicing.
   *
   * This is what allows the frontend to display:
   *
   * Page 1 of 4
   * Showing 1-10 of 37
   */
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
 * START DISCOVERY RUN
 * ============================================================
 *
 * EXISTING — UNCHANGED.
 */
function startRun(
  candidateEmail
) {
  const runId =
    randomUUID();

  const state = {
    runId,
    candidateEmail,
    status:
      "running",
    startedAt:
      new Date()
        .toISOString(),
    completedAt:
      null,
    summary:
      null,
    error:
      null
  };

  runs.set(
    runId,
    state
  );

  runDiscoveryForCandidate(
    candidateEmail
  )
    .then(
      (summary) => {
        state.status =
          "completed";

        state.completedAt =
          new Date()
            .toISOString();

        state.summary =
          summary;
      }
    )
    .catch(
      (error) => {
        state.status =
          "failed";

        state.completedAt =
          new Date()
            .toISOString();

        state.error =
          error.message;
      }
    );

  return state;
}

/*
 * ============================================================
 * RUN DISCOVERY
 * ============================================================
 *
 * EXISTING — UNCHANGED.
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
   *
   * UPDATED.
   *
   * candidateEmail is no longer required.
   *
   * This enables:
   *
   * GET /api/jobs
   *
   * to mean all candidates.
   *
   * Pagination is also returned.
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
          /*
           * Jobs on the current page.
           */
          data:
            result.data,

          /*
           * Number returned on THIS page.
           */
          count:
            result
              .data
              .length,

          /*
           * Total number of jobs matching all filters BEFORE
           * pagination.
           */
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
   *
   * EXISTING — UNCHANGED.
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
   * ==========================================================
   * UPDATE JOB / PROSPECT STATUS
   * ==========================================================
   *
   * NEW.
   *
   * Used later by:
   *
   * Queue
   * Skip
   * Applied
   *
   * Example:
   *
   * PATCH /api/jobs/3430c3a6/status
   *
   * {
   *   "candidateEmail": "...",
   *   "status": "Queued"
   * }
   *
   * IMPORTANT:
   *
   * This persists directly into Shortlisted Jobs so Review
   * Queue can later retrieve:
   *
   * GET /api/jobs?status=Queued
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

        /*
         * -----------------------------
         * VALIDATION
         * -----------------------------
         */

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

        /*
         * -----------------------------
         * FIND EXACT CANDIDATE/JOB ROW
         * -----------------------------
         *
         * jobId alone is not enough because the same job may
         * theoretically belong to more than one candidate.
         */
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

        /*
         * -----------------------------
         * PRESERVE THE FULL EXISTING ROW
         * -----------------------------
         *
         * This is important.
         *
         * We do NOT write only:
         *
         * {
         *   jobId,
         *   status
         * }
         *
         * because that could blank unrelated Sheets columns.
         *
         * We preserve everything and update status only.
         */
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
   *
   * EXISTING FLOW — UNCHANGED.
   *
   * Notice:
   *
   * This still calls the original getJobs(), NOT getJobsPage().
   *
   * So your existing dashboard behavior is preserved.
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
   *
   * EXISTING — UNCHANGED.
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
   *
   * EXISTING — UNCHANGED.
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
   *
   * EXISTING — UNCHANGED.
   */
  app.get(
    "/api/runs/:runId",
    (
      req,
      res
    ) => {
      const run =
        runs.get(
          req.params
            .runId
        );

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
    }
  );

  /*
   * ==========================================================
   * SYNC INTAKE
   * ==========================================================
   *
   * EXISTING — UNCHANGED.
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
   *
   * EXISTING — UNCHANGED.
   *
   * Application generation remains completely separate from
   * discovery/queueing.
   */
  app.post(
    "/api/applications/:candidateEmail/:jobId/generate",
    checkTriggerToken,
    async (
      req,
      res
    ) => {
      try {
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
   *
   * EXISTING — UNCHANGED.
   */
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
   *
   * EXISTING — UNCHANGED.
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
   * APPLICATION STATUS
   * ==========================================================
   *
   * EXISTING BEHAVIOR — UNCHANGED.
   *
   * The only tiny implementation change is that upsertRows is
   * already imported at the top of the file instead of being
   * required again inside this function.
   */
  app.patch(
    "/api/applications/:applicationId/status",
    checkTriggerToken,
    async (
      req,
      res
    ) => {
      try {
        const status =
          String(
            req.body
              ?.status ||
            ""
          ).trim();

        if (
          !APPLICATION_STATUSES.has(
            status
          )
        ) {
          return res
            .status(400)
            .json({
              error:
                `Invalid status. Allowed: ${[
                  ...APPLICATION_STATUSES
                ].join(", ")}`
            });
        }

        const current =
          await getGeneratedApplication(
            req.params
              .applicationId
          );

        if (!current) {
          return res
            .status(404)
            .json({
              error:
                "Application not found"
            });
        }

        const updated = {
          ...current,

          status,

          updatedAt:
            new Date()
              .toISOString()
        };

        await upsertRows(
          "Generated Applications",
          [
            updated
          ],
          [
            "applicationId"
          ]
        );

        res.json({
          data:
            sanitizeApplication(
              updated
            )
        });
      } catch (err) {
        res
          .status(500)
          .json({
            error:
              "Failed to update application status"
          });
      }
    }
  );
}

module.exports = {
  registerApiRoutes
};