const {
  chromium,
} = require("playwright");

const {
  assertSafeExternalUrl,
  createHostSafetyCache,
} = require("./browserSafety");

/*
 * ============================================================
 * BROWSER SERVICE
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * Centralized Playwright/Chromium lifecycle management for
 * JobVerse application inspection and execution.
 *
 * This service owns:
 *
 * - browser startup
 * - browser shutdown
 * - context isolation
 * - page creation
 * - safe navigation
 * - request interception
 * - resource controls
 * - timeouts
 * - concurrency limits
 * - crash recovery
 *
 * ============================================================
 * WHY THIS FILE EXISTS
 * ============================================================
 *
 * Application channels must NOT directly call:
 *
 *     chromium.launch()
 *
 * or:
 *
 *     browser.newContext()
 *
 * or:
 *
 *     page.goto()
 *
 * in random places.
 *
 * All browser lifecycle behavior should be centralized here.
 *
 * That gives JobVerse:
 *
 * - predictable browser configuration
 * - consistent security rules
 * - easier testing
 * - easier deployment
 * - easier migration to a dedicated worker later
 *
 * ============================================================
 * SECURITY MODEL
 * ============================================================
 *
 * Every application gets a fresh browser context.
 *
 * This prevents:
 *
 * - cookie leakage
 * - session leakage
 * - localStorage leakage
 * - cross-candidate authentication leakage
 *
 * ============================================================
 */

/*
 * ============================================================
 * CONFIGURATION
 * ============================================================
 */

const DEFAULT_NAVIGATION_TIMEOUT_MS =
  30000;

const DEFAULT_ACTION_TIMEOUT_MS =
  15000;

const DEFAULT_PAGE_LOAD_WAIT =
  "domcontentloaded";

/*
 * Browser sessions are expensive.
 *
 * Keep concurrency intentionally small by default.
 *
 * Later this can move to environment configuration or a job
 * queue.
 */
const DEFAULT_MAX_CONCURRENT_SESSIONS =
  2;

/*
 * Media resources are unnecessary for most application form
 * inspection and consume significant bandwidth/memory.
 */
const BLOCKED_RESOURCE_TYPES =
  new Set([
    "media",
    "font",
  ]);

/*
 * ============================================================
 * ENVIRONMENT HELPERS
 * ============================================================
 */

function normalizeString(
  value
) {
  return String(
    value ?? ""
  ).trim();
}

function parseBoolean(
  value,
  fallback = false
) {
  if (
    typeof value ===
    "boolean"
  ) {
    return value;
  }

  const normalized =
    normalizeString(
      value
    ).toLowerCase();

  if (
    [
      "true",
      "1",
      "yes",
      "on",
    ].includes(
      normalized
    )
  ) {
    return true;
  }

  if (
    [
      "false",
      "0",
      "no",
      "off",
    ].includes(
      normalized
    )
  ) {
    return false;
  }

  return fallback;
}

function parsePositiveInteger(
  value,
  fallback
) {
  const parsed =
    Number(
      value
    );

  if (
    !Number.isInteger(
      parsed
    ) ||
    parsed <= 0
  ) {
    return fallback;
  }

  return parsed;
}

function getNavigationTimeout() {
  return parsePositiveInteger(
    process.env
      .JOBVERSE_BROWSER_NAVIGATION_TIMEOUT_MS,
    DEFAULT_NAVIGATION_TIMEOUT_MS
  );
}

function getActionTimeout() {
  return parsePositiveInteger(
    process.env
      .JOBVERSE_BROWSER_ACTION_TIMEOUT_MS,
    DEFAULT_ACTION_TIMEOUT_MS
  );
}

function getMaxConcurrentSessions() {
  return parsePositiveInteger(
    process.env
      .JOBVERSE_BROWSER_MAX_CONCURRENT_SESSIONS,
    DEFAULT_MAX_CONCURRENT_SESSIONS
  );
}

function shouldRunHeadless() {
  /*
   * Production defaults to headless.
   *
   * Development can explicitly set:
   *
   * JOBVERSE_BROWSER_HEADLESS=false
   */
  return parseBoolean(
    process.env
      .JOBVERSE_BROWSER_HEADLESS,
    true
  );
}

function shouldBlockHeavyResources() {
  return parseBoolean(
    process.env
      .JOBVERSE_BROWSER_BLOCK_HEAVY_RESOURCES,
    true
  );
}

/*
 * ============================================================
 * BROWSER STATE
 * ============================================================
 */

let browserInstance =
  null;

let browserLaunchPromise =
  null;

let activeSessions =
  0;

const sessionWaiters =
  [];

/*
 * ============================================================
 * CONCURRENCY CONTROL
 * ============================================================
 *
 * Browser sessions can consume considerable memory.
 *
 * This simple semaphore prevents too many contexts being opened
 * simultaneously.
 */

async function acquireSessionSlot() {
  const maxSessions =
    getMaxConcurrentSessions();

  if (
    activeSessions <
    maxSessions
  ) {
    activeSessions +=
      1;

    return;
  }

  await new Promise(
    (resolve) => {
      sessionWaiters.push(
        resolve
      );
    }
  );

  activeSessions +=
    1;
}

function releaseSessionSlot() {
  activeSessions =
    Math.max(
      activeSessions -
      1,
      0
    );

  const next =
    sessionWaiters.shift();

  if (
    next
  ) {
    next();
  }
}

/*
 * ============================================================
 * BROWSER HEALTH
 * ============================================================
 */

function isBrowserUsable() {
  return Boolean(
    browserInstance &&
    browserInstance
      .isConnected()
  );
}

/*
 * ============================================================
 * LAUNCH BROWSER
 * ============================================================
 *
 * One Chromium process is reused.
 *
 * Isolation happens using separate contexts rather than
 * launching a new browser process for every application.
 *
 * This dramatically reduces startup cost and memory usage.
 */

async function launchBrowser() {
  if (
    isBrowserUsable()
  ) {
    return browserInstance;
  }

  /*
   * Prevent multiple concurrent callers from launching multiple
   * Chromium processes.
   */
  if (
    browserLaunchPromise
  ) {
    return browserLaunchPromise;
  }

  browserLaunchPromise =
    (async () => {
      try {
        const browser =
          await chromium.launch({
            /*
             * Your environment successfully verified the full
             * Chromium installation using:
             *
             * channel: "chromium"
             *
             * This also avoids relying on the separate headless
             * shell download.
             */
            channel:
              "chromium",

            headless:
              shouldRunHeadless(),

            /*
             * Keep launch arguments conservative.
             *
             * Do not disable browser security features.
             */
            args: [],
          });

        browser.on(
          "disconnected",
          () => {
            /*
             * Browser crashes/disconnects must invalidate the
             * cached instance.
             */
            if (
              browserInstance ===
              browser
            ) {
              browserInstance =
                null;
            }
          }
        );

        browserInstance =
          browser;

        return browser;
      } finally {
        browserLaunchPromise =
          null;
      }
    })();

  return browserLaunchPromise;
}

/*
 * ============================================================
 * CLOSE BROWSER
 * ============================================================
 */

async function closeBrowser() {
  const browser =
    browserInstance;

  browserInstance =
    null;

  browserLaunchPromise =
    null;

  if (
    !browser
  ) {
    return;
  }

  try {
    if (
      browser.isConnected()
    ) {
      await browser.close();
    }
  } catch (err) {
    console.error(
      "[BrowserService] Failed to close browser:",
      err
    );
  }
}

/*
 * ============================================================
 * CREATE ISOLATED CONTEXT
 * ============================================================
 */

async function createBrowserContext() {
  const browser =
    await launchBrowser();

  const context =
    await browser.newContext({
      /*
       * Fresh isolated session.
       *
       * No shared authentication or storage.
       */
      storageState:
        undefined,

      /*
       * We intentionally do not accept downloads silently.
       */
      acceptDownloads:
        false,

      /*
       * Job application pages generally work with standard
       * desktop dimensions.
       */
      viewport: {
        width:
          1440,

        height:
          900,
      },

      /*
       * Standard locale.
       *
       * This can later become candidate-specific if necessary.
       */
      locale:
        "en-US",

      /*
       * HTTPS errors should remain visible.
       *
       * We do NOT disable TLS validation.
       */
      ignoreHTTPSErrors:
        false,
    });

  context.setDefaultTimeout(
    getActionTimeout()
  );

  context.setDefaultNavigationTimeout(
    getNavigationTimeout()
  );

  return context;
}

/*
 * ============================================================
 * SAFE REQUEST ROUTING
 * ============================================================
 *
 * Validating only the first page URL is insufficient.
 *
 * JavaScript running on a public page may attempt requests to
 * private/internal destinations.
 *
 * Therefore every HTTP(S) browser request is checked.
 */

async function installNetworkGuard(
  context
) {
  const hostCache =
    createHostSafetyCache();

  await context.route(
    "**/*",
    async (
      route
    ) => {
      const request =
        route.request();

      const url =
        request.url();

      let parsed;

      try {
        parsed =
          new URL(
            url
          );
      } catch (_) {
        await route.abort(
          "blockedbyclient"
        );

        return;
      }

      /*
       * Browser-internal URLs such as:
       *
       * data:
       * blob:
       * about:
       *
       * are not external network destinations.
       */
      if (
        ![
          "http:",
          "https:",
        ].includes(
          parsed.protocol
        )
      ) {
        await route.continue();

        return;
      }

      /*
       * --------------------------------------------------------
       * BLOCK HEAVY RESOURCES
       * --------------------------------------------------------
       */

      if (
        shouldBlockHeavyResources() &&
        BLOCKED_RESOURCE_TYPES.has(
          request.resourceType()
        )
      ) {
        await route.abort(
          "blockedbyclient"
        );

        return;
      }

      /*
       * --------------------------------------------------------
       * HOST SAFETY CHECK
       * --------------------------------------------------------
       */

      try {
        await hostCache.check(
          parsed.hostname
        );

        /*
         * Port validation is included in the full URL safety
         * function.
         */
        await assertSafeExternalUrl(
          url
        );

        await route.continue();
      } catch (err) {
        console.warn(
          "[BrowserService] Blocked unsafe browser request:",
          {
            url,

            reason:
              err?.message ||
              String(
                err
              ),
          }
        );

        await route.abort(
          "blockedbyclient"
        );
      }
    }
  );

  return hostCache;
}

/*
 * ============================================================
 * CREATE PAGE
 * ============================================================
 */

async function createPage(
  context
) {
  const page =
    await context.newPage();

  /*
   * Prevent unexpected browser dialogs from blocking the
   * worker indefinitely.
   *
   * We dismiss them and allow the higher-level inspector to
   * decide whether manual review is needed.
   */
  page.on(
    "dialog",
    async (
      dialog
    ) => {
      try {
        await dialog.dismiss();
      } catch (_) {
        /*
         * Dialog may already have disappeared.
         */
      }
    }
  );

  /*
   * Log page-level errors for observability.
   */
  page.on(
    "pageerror",
    (
      error
    ) => {
      console.warn(
        "[BrowserService] Page JavaScript error:",
        error?.message ||
        error
      );
    }
  );

  return page;
}

/*
 * ============================================================
 * SAFE NAVIGATION
 * ============================================================
 */

async function navigatePage(
  page,
  destination,
  {
    waitUntil =
      DEFAULT_PAGE_LOAD_WAIT,

    timeout =
      getNavigationTimeout(),
  } = {}
) {
  /*
   * Validate destination BEFORE telling the browser to visit it.
   */
  const safety =
    await assertSafeExternalUrl(
      destination
    );

  let response;

  try {
    response =
      await page.goto(
        safety.url,
        {
          waitUntil,

          timeout,
        }
      );
  } catch (err) {
    /*
     * Give higher layers a meaningful message.
     */
    throw new Error(
      `Browser navigation failed: ${
        err?.message ||
        String(err)
      }`
    );
  }

  /*
   * page.goto may return null for some navigation types.
   */
  if (
    !response
  ) {
    return {
      url:
        page.url(),

      status:
        null,

      ok:
        true,

      response:
        null,
    };
  }

  return {
    url:
      page.url(),

    status:
      response.status(),

    ok:
      response.ok(),

    response,
  };
}

/*
 * ============================================================
 * WAIT FOR PAGE STABILITY
 * ============================================================
 *
 * Dynamic ATS sites often continue rendering after the first
 * DOMContentLoaded event.
 *
 * We keep this intentionally conservative.
 *
 * networkidle should not be the default because many modern
 * websites maintain analytics/websocket traffic indefinitely.
 */

async function waitForPageStability(
  page,
  {
    delayMs =
      500,
  } = {}
) {
  /*
   * Give reactive frameworks a brief opportunity to render.
   */
  if (
    delayMs >
    0
  ) {
    await page.waitForTimeout(
      delayMs
    );
  }

  /*
   * Wait until the document itself is interactive/complete.
   */
  await page.waitForFunction(
    () =>
      document.readyState ===
        "interactive" ||
      document.readyState ===
        "complete",
    null,
    {
      timeout:
        getActionTimeout(),
    }
  );
}

/*
 * ============================================================
 * SESSION CREATION
 * ============================================================
 *
 * A browser session represents one isolated application
 * inspection/execution environment.
 */

async function createBrowserSession() {
  await acquireSessionSlot();

  let context =
    null;

  let page =
    null;

  let hostSafetyCache =
    null;

  let released =
    false;

  try {
    context =
      await createBrowserContext();

    hostSafetyCache =
      await installNetworkGuard(
        context
      );

    page =
      await createPage(
        context
      );

    /*
     * Session cleanup is idempotent.
     */
    async function close() {
      if (
        released
      ) {
        return;
      }

      released =
        true;

      try {
        if (
          page &&
          !page.isClosed()
        ) {
          await page.close();
        }
      } catch (err) {
        console.warn(
          "[BrowserService] Failed to close page:",
          err?.message ||
          err
        );
      }

      try {
        if (
          context
        ) {
          await context.close();
        }
      } catch (err) {
        console.warn(
          "[BrowserService] Failed to close context:",
          err?.message ||
          err
        );
      }

      if (
        hostSafetyCache
      ) {
        hostSafetyCache.clear();
      }

      releaseSessionSlot();
    }

    return {
      browser:
        browserInstance,

      context,

      page,

      navigate:
        async (
          destination,
          options
        ) =>
          navigatePage(
            page,
            destination,
            options
          ),

      waitForStability:
        async (
          options
        ) =>
          waitForPageStability(
            page,
            options
          ),

      close,
    };
  } catch (err) {
    /*
     * If session creation fails before returning to the caller,
     * cleanup must still happen here.
     */
    try {
      if (
        page &&
        !page.isClosed()
      ) {
        await page.close();
      }
    } catch (_) {}

    try {
      if (
        context
      ) {
        await context.close();
      }
    } catch (_) {}

    if (
      hostSafetyCache
    ) {
      hostSafetyCache.clear();
    }

    releaseSessionSlot();

    throw err;
  }
}

/*
 * ============================================================
 * WITH BROWSER SESSION
 * ============================================================
 *
 * Preferred usage pattern:
 *
 * await withBrowserSession(async ({ page, navigate }) => {
 *   ...
 * });
 *
 * This guarantees cleanup through finally.
 */

async function withBrowserSession(
  callback
) {
  if (
    typeof callback !==
    "function"
  ) {
    throw new Error(
      "Browser session callback must be a function"
    );
  }

  const session =
    await createBrowserSession();

  try {
    return await callback(
      session
    );
  } finally {
    await session.close();
  }
}

/*
 * ============================================================
 * BROWSER HEALTH INFORMATION
 * ============================================================
 *
 * Useful later for:
 *
 * GET /health
 *
 * and operational dashboards.
 */

function getBrowserStatus() {
  return {
    connected:
      isBrowserUsable(),

    activeSessions,

    waitingSessions:
      sessionWaiters.length,

    maxConcurrentSessions:
      getMaxConcurrentSessions(),

    headless:
      shouldRunHeadless(),
  };
}

/*
 * ============================================================
 * GRACEFUL PROCESS SHUTDOWN
 * ============================================================
 *
 * Browser processes should not be left orphaned when Node exits
 * cleanly.
 *
 * We guard registration so requiring this module multiple times
 * does not attach duplicate handlers.
 */

let shutdownHandlersInstalled =
  false;

function installShutdownHandlers() {
  if (
    shutdownHandlersInstalled
  ) {
    return;
  }

  shutdownHandlersInstalled =
    true;

  const shutdown =
    async () => {
      try {
        await closeBrowser();
      } catch (err) {
        console.error(
          "[BrowserService] Browser shutdown error:",
          err
        );
      }
    };

  process.once(
    "SIGINT",
    shutdown
  );

  process.once(
    "SIGTERM",
    shutdown
  );
}

installShutdownHandlers();

/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  /*
   * Recommended high-level API.
   */
  withBrowserSession,
  createBrowserSession,

  /*
   * Navigation.
   */
  navigatePage,
  waitForPageStability,

  /*
   * Browser lifecycle.
   */
  launchBrowser,
  closeBrowser,

  /*
   * Monitoring.
   */
  getBrowserStatus,
  isBrowserUsable,

  /*
   * Configuration helpers useful for tests/health checks.
   */
  getNavigationTimeout,
  getActionTimeout,
  getMaxConcurrentSessions,

  /*
   * Constants.
   */
  DEFAULT_NAVIGATION_TIMEOUT_MS,
  DEFAULT_ACTION_TIMEOUT_MS,
  DEFAULT_MAX_CONCURRENT_SESSIONS,
};