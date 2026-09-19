const express = require("express");
const cron = require("node-cron");
const cors = require("cors");

const config = require("./config");

const {
  readSheet
} = require("./googleSheets");

const {
  runDiscoveryForCandidate
} = require("./runDiscovery");

const {
  runDailyDiscoveryForAllCandidates
} = require("./runDailyAll");

const {
  syncFormResponsesToCandidates
} = require("./syncCandidateIntake");

const {
  registerApiRoutes
} = require("./api");

const {
  ensureApplicationSheets
} = require("./application/applicationSheets");

/*
 * ============================================================
 * EXPRESS APP
 * ============================================================
 */

const app = express();

/*
 * ============================================================
 * CORS
 * ============================================================
 *
 * FRONTEND_ORIGIN should contain the deployed frontend URL.
 *
 * Example:
 *
 * https://jobverse-frontend.onrender.com
 *
 * Local development origins are also allowed.
 */

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000"
];

/*
 * Add production frontend dynamically.
 */
if (config.FRONTEND_ORIGIN) {
  allowedOrigins.push(
    config.FRONTEND_ORIGIN
  );
}

app.use(
  cors({
    origin(origin, callback) {
      /*
       * Requests with no Origin header include:
       *
       * - PowerShell
       * - Postman
       * - curl
       * - server-to-server calls
       *
       * These are allowed.
       */
      if (!origin) {
        return callback(
          null,
          true
        );
      }

      if (
        allowedOrigins.includes(
          origin
        )
      ) {
        return callback(
          null,
          true
        );
      }

      console.warn(
        `[CORS] Blocked origin: ${origin}`
      );

      return callback(
        new Error(
          `CORS blocked request from origin: ${origin}`
        )
      );
    },

    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS"
    ],

    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Trigger-Token"
    ],

    credentials: true
  })
);

/*
 * ============================================================
 * BODY PARSER
 * ============================================================
 */

app.use(
  express.json({
    limit: "1mb"
  })
);

/*
 * ============================================================
 * OPTIONAL REQUEST LOGGING
 * ============================================================
 */

app.use(
  (req, res, next) => {
    console.log(
      `[HTTP] ${req.method} ${req.path}`
    );

    next();
  }
);

/*
 * ============================================================
 * MANUAL TRIGGER AUTH
 * ============================================================
 */

function checkTriggerToken(
  req,
  res,
  next
) {
  /*
   * If no token is configured, manual triggers remain open.
   *
   * In production, MANUAL_TRIGGER_TOKEN should be configured.
   */
  if (
    !config.MANUAL_TRIGGER_TOKEN
  ) {
    return next();
  }

  const suppliedToken =
    req.headers[
      "x-trigger-token"
    ];

  if (
    suppliedToken !==
    config.MANUAL_TRIGGER_TOKEN
  ) {
    return res
      .status(401)
      .json({
        error:
          "Invalid or missing trigger token"
      });
  }

  next();
}

/*
 * ============================================================
 * HEALTH CHECK
 * ============================================================
 */

app.get(
  "/health",
  (req, res) => {
    res.status(200).json({
      status: "ok",

      service:
        "jobverse-backend",

      time:
        new Date()
          .toISOString()
    });
  }
);

/*
 * ============================================================
 * ROOT
 * ============================================================
 */

app.get(
  "/",
  (req, res) => {
    res.json({
      service:
        "Jobverse Backend",

      status:
        "ok",

      api:
        "/api"
    });
  }
);

/*
 * ============================================================
 * BACKWARDS-COMPATIBLE MANUAL RUN
 * ============================================================
 */

app.post(
  "/run/:candidateEmail",

  checkTriggerToken,

  async (
    req,
    res
  ) => {
    try {
      const candidates =
        await readSheet(
          "Candidates"
        );

      const requestedEmail =
        String(
          req.params
            .candidateEmail ||
          ""
        )
          .trim()
          .toLowerCase();

      const candidate =
        candidates.find(
          (item) =>
            String(
              item.candidateEmail ||
              ""
            )
              .trim()
              .toLowerCase() ===
            requestedEmail
        );

      if (!candidate) {
        return res
          .status(404)
          .json({
            error:
              "Candidate not found"
          });
      }

      /*
       * Return immediately.
       *
       * Discovery continues asynchronously inside
       * the current Node process.
       */
      res
        .status(202)
        .json({
          status:
            "started",

          candidateEmail:
            candidate
              .candidateEmail
        });

      runDiscoveryForCandidate(
        candidate
      ).catch(
        (err) =>
          console.error(
            "[manual run] FAILED:",
            err
          )
      );
    } catch (err) {
      console.error(
        "[manual run] ERROR:",
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
 * ============================================================
 * RUN ALL CANDIDATES
 * ============================================================
 */

app.post(
  "/run-all",

  checkTriggerToken,

  async (
    req,
    res
  ) => {
    res
      .status(202)
      .json({
        status:
          "started"
      });

    runDailyDiscoveryForAllCandidates()
      .catch(
        (err) =>
          console.error(
            "[manual run-all] FAILED:",
            err
          )
      );
  }
);

/*
 * ============================================================
 * MANUAL INTAKE SYNC
 * ============================================================
 */

app.post(
  "/sync-intake",

  checkTriggerToken,

  async (
    req,
    res
  ) => {
    try {
      const results =
        await syncFormResponsesToCandidates();

      res.json({
        status:
          "done",

        results
      });
    } catch (err) {
      console.error(
        "[sync intake] FAILED:",
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
 * ============================================================
 * MAIN API ROUTES
 * ============================================================
 */

registerApiRoutes(
  app,
  {
    checkTriggerToken
  }
);

/*
 * ============================================================
 * CORS ERROR HANDLER
 * ============================================================
 */

app.use(
  (
    err,
    req,
    res,
    next
  ) => {
    if (
      err?.message
        ?.startsWith(
          "CORS blocked request"
        )
    ) {
      return res
        .status(403)
        .json({
          error:
            err.message
        });
    }

    next(err);
  }
);

/*
 * ============================================================
 * GENERAL ERROR HANDLER
 * ============================================================
 */

app.use(
  (
    err,
    req,
    res,
    next
  ) => {
    console.error(
      "[server] Unhandled error:",
      err
    );

    if (
      res.headersSent
    ) {
      return next(err);
    }

    res
      .status(
        err.status ||
        500
      )
      .json({
        error:
          err.message ||
          "Internal server error"
      });
  }
);

/*
 * ============================================================
 * PORT
 * ============================================================
 *
 * Render provides process.env.PORT.
 *
 * config.PORT can still provide your local fallback.
 */

const PORT =
  Number(
    process.env.PORT ||
    config.PORT ||
    3000
  );

/*
 * ============================================================
 * SERVER START
 * ============================================================
 */

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Jobverse backend listening on port ${PORT}`
    );

    /*
     * Ensure application sheets exist.
     */
    ensureApplicationSheets()
      .then(
        () =>
          console.log(
            "[application setup] Required application sheets are ready"
          )
      )
      .catch(
        (err) =>
          console.error(
            "[application setup] Could not initialize application sheets:",
            err.message
          )
      );
  }
);

/*
 * ============================================================
 * DAILY JOB DISCOVERY
 * ============================================================
 */

cron.schedule(
  `0 ${config.DAILY_RUN_HOUR} * * *`,

  () => {
    console.log(
      `[cron] Starting scheduled daily run at ${new Date().toISOString()}`
    );

    runDailyDiscoveryForAllCandidates()
      .catch(
        (err) =>
          console.error(
            "[cron] Daily run failed:",
            err
          )
      );
  }
);

/*
 * ============================================================
 * CANDIDATE INTAKE SYNC
 * ============================================================
 */

cron.schedule(
  "*/5 * * * *",

  () => {
    syncFormResponsesToCandidates()
      .catch(
        (err) =>
          console.error(
            "[cron] Intake sync failed:",
            err
          )
      );
  }
);