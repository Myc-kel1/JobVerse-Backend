const { scoreJob } = require("./groq");
const { scoreJobWithGemini } = require("./gemini");

/**
 * Score one job using Groq first.
 *
 * JobVerse's existing Groq scorer expects:
 *
 *   scoreJob(candidate, job)
 *
 * Gemini currently expects:
 *
 *   scoreJobWithGemini(job, candidate)
 *
 * This wrapper keeps those provider-specific signatures
 * isolated from the rest of the application.
 */
async function scoreJobWithFallback(candidate, job) {
  let groqResult;

  try {
    // IMPORTANT:
    // Existing groq.js expects candidate FIRST.
    groqResult = await scoreJob(
      candidate,
      job
    );
  } catch (error) {
    console.error(
      `Groq threw an exception for ${
        job.jobId ||
        job.title ||
        "unknown job"
      }:`,
      error.message
    );

    groqResult = {
      ...job,

      aiParseSuccess: false,
      aiProvider: "groq",
      aiParseError: error.message,
    };
  }

  /**
   * Groq succeeded.
   *
   * Return its result exactly as provided.
   */
  if (
    groqResult &&
    groqResult.aiParseSuccess === true
  ) {
    return {
      ...groqResult,

      aiProvider:
        groqResult.aiProvider ||
        "groq",

      fallbackUsed: false,
    };
  }

  /**
   * Groq failed.
   *
   * Try Gemini.
   */
  console.warn(
    `Groq scoring failed for ${
      job.jobId ||
      job.title ||
      "unknown job"
    }. Falling back to Gemini.`
  );

  let geminiResult;

  try {
    /**
     * Gemini expects JOB first.
     */
    geminiResult =
      await scoreJobWithGemini(
        job,
        candidate
      );
  } catch (error) {
    geminiResult = {
      ...job,

      aiParseSuccess: false,
      aiProvider: "gemini",
      aiParseError:
        error.message ||
        String(error),
    };
  }

  /**
   * Gemini succeeded.
   */
  if (
    geminiResult &&
    geminiResult.aiParseSuccess === true
  ) {
    return {
      ...geminiResult,

      aiProvider: "gemini",

      fallbackUsed: true,

      fallbackReason:
        groqResult.aiParseError ||
        "Groq failed",
    };
  }

  /**
   * Both providers failed.
   */
  return {
    ...job,

    aiParseSuccess: false,

    aiProvider: "none",

    aiParseError: {
      groq:
        groqResult?.aiParseError ||
        "Groq failed",

      gemini:
        geminiResult?.aiParseError ||
        "Gemini failed",
    },

    fallbackUsed: true,

    fallbackReason:
      groqResult?.aiParseError ||
      "Groq failed",
  };
}

/**
 * Score multiple jobs sequentially.
 *
 * Public application contract:
 *
 *   scoreAllJobsWithFallback(candidate, jobs)
 *
 * This matches runDiscovery.js.
 */
async function scoreAllJobsWithFallback(
  candidate,
  jobs,
  delayMs = 0
) {
  const results = [];

  for (const job of jobs) {
    const result =
      await scoreJobWithFallback(
        candidate,
        job
      );

    results.push(result);

    if (delayMs > 0) {
      await new Promise(
        (resolve) =>
          setTimeout(
            resolve,
            delayMs
          )
      );
    }
  }

  return results;
}

module.exports = {
  scoreJobWithFallback,
  scoreAllJobsWithFallback,
};

