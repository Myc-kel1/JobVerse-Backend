const config = require("./config");

/*
 * ============================================================
 * SYSTEM PROMPTS
 * ============================================================
 */

const SYSTEM_MESSAGE =
  "You score job fit against a candidate. " +
  "Use only supplied evidence; never invent facts. " +
  "Unknown information is not automatically a failure. " +
  "Exclusion rules override the score. " +
  "Score each criterion independently. " +
  "Return ONLY the requested JSON object.";

const APPLICATION_SYSTEM_MESSAGE =
  "You are a strict application-document engine. " +
  "Use only verified candidate evidence and the supplied job. " +
  "Never invent skills, employers, education, certifications, titles, dates, achievements, registrations, years of experience, or other facts. " +
  "Missing information is unknown. " +
  "Return only the requested JSON.";

/*
 * ============================================================
 * APPLICATION AI QUEUE
 * ============================================================
 */

let lastApplicationCallAt = 0;

let applicationQueue =
  Promise.resolve();

/*
 * ============================================================
 * DISCOVERY RESPONSE REQUIREMENTS
 * ============================================================
 */

const REQUIRED_NUMERIC = [
  "overallScore",
  "titleMatch",
  "skillMatch",
  "experienceMatch",
  "workModelMatch",
  "locationMatch",
  "jobTypeMatch",
  "salaryMatch",
  "recencyScore"
];

/*
 * ============================================================
 * SMALL CONFIG HELPER
 * ============================================================
 *
 * Supports config values implemented either as:
 *
 *   VALUE
 *
 * or:
 *
 *   VALUE()
 *
 * This makes this file safer against the mixed config style
 * already used elsewhere in the project.
 */

function resolveConfigValue(
  value,
  fallback = undefined
) {
  try {
    if (
      typeof value ===
      "function"
    ) {
      const resolved =
        value();

      return (
        resolved ??
        fallback
      );
    }

    return (
      value ??
      fallback
    );
  } catch (_) {
    return fallback;
  }
}

/*
 * ============================================================
 * JOB SCORING PROMPT
 * ============================================================
 */

function buildPrompt(
  candidate,
  job
) {
  return `
You are JobVerse's job-matching scoring engine.

Your task is to evaluate how well the CANDIDATE matches the JOB
using ONLY the evidence supplied below.

IMPORTANT

- Read the ENTIRE job description carefully.
- Extract important requirements directly from the job description.
- Do not invent candidate experience.
- Do not invent candidate skills.
- Do not invent certifications.
- Do not invent employers.
- Do not invent education.
- Do not invent salary information.
- Unknown information should receive neutral treatment where appropriate.
- Explicit exclusion rules override the match score.

CANDIDATE

Name:
${candidate.candidateName || ""}

Preferred Job Title:
${candidate.preferredJobTitle || ""}

Preferred Job Type:
${candidate.jobType || ""}

Preferred Work Model:
${candidate.workModel || ""}

Desired Location:
${candidate.desiredLocation || ""}

Preferred Skills:
${
  Array.isArray(
    candidate.preferredSkills
  )
    ? candidate.preferredSkills.join(
        ", "
      )
    : candidate.preferredSkills || ""
}

Salary Range:
${candidate.salaryRangeMin || ""} - ${
    candidate.salaryRangeMax || ""
  }

Excluded Titles:
${
  Array.isArray(
    candidate.excludedTitles
  )
    ? candidate.excludedTitles.join(
        ", "
      )
    : candidate.excludedTitles || ""
}

Excluded Keywords:
${
  Array.isArray(
    candidate.excludedKeywords
  )
    ? candidate.excludedKeywords.join(
        ", "
      )
    : candidate.excludedKeywords || ""
}

Exclusion Rules:
${
  Array.isArray(
    candidate.exclusionRules
  )
    ? candidate.exclusionRules.join(
        ", "
      )
    : candidate.exclusionRules || ""
}

JOB

Job ID:
${job.jobId || ""}

Job Title:
${job.title || ""}

Company:
${job.company || ""}

Location:
${job.location || ""}

Work Model:
${job.workModel || ""}

Job Type:
${job.jobType || ""}

Salary:
${job.salary || ""}

Posted Date:
${job.postedDate || ""}

FULL JOB DESCRIPTION

${job.description || job.shortDescription || ""}

SCORING PROCESS

1. Identify important required and preferred requirements.

2. Compare those requirements with supplied candidate information.

3. Skills:
   - Match genuinely equivalent terminology.
   - Do not invent skills.
   - Put supported matches in matchedSkills.
   - Put important unsupported requirements in missingSkills.

4. Experience:
   - Use explicit experience information when available.
   - Do not invent years of experience.
   - Unknown information should not automatically receive zero.

5. Work model:
   - Remote, hybrid and onsite are distinct.

6. Location:
   - Respect explicit geographic restrictions.

7. Job type:
   - Compare candidate preference against the actual job.

8. Salary:
   - Compare only when reliable salary information exists.

9. Recency:
   - Use postedDate when reliable.

10. Exclusions:
    - Explicit candidate exclusions override the score.

Return scores from 0 to 10 for:

- titleMatch
- skillMatch
- experienceMatch
- workModelMatch
- locationMatch
- jobTypeMatch
- salaryMatch
- recencyScore

Return exactly:

{
  "overallScore": number,
  "titleMatch": number,
  "skillMatch": number,
  "experienceMatch": number,
  "workModelMatch": number,
  "locationMatch": number,
  "jobTypeMatch": number,
  "salaryMatch": number,
  "recencyScore": number,
  "excluded": boolean,
  "exclusionReason": string,
  "matchedSkills": [],
  "missingSkills": [],
  "rationale": string
}

Return JSON only.
Do not use markdown.
`;
}

/*
 * ============================================================
 * SHARED GROQ REQUEST
 * ============================================================
 *
 * reasoningEffort defaults to "low".
 *
 * Application generation does not require large internal
 * reasoning traces. Reducing reasoning effort helps preserve
 * completion-token and TPM capacity.
 */

async function callGroq(
  model,
  prompt,
  temperature = 0.1,
  systemMessage = SYSTEM_MESSAGE,
  maxTokens = 1800,
  reasoningEffort = "low"
) {
  const apiKey =
    resolveConfigValue(
      config.GROQ_API_KEY
    );

  if (!apiKey) {
    throw new Error(
      "Missing GROQ_API_KEY"
    );
  }

  const requestBody = {
    model,

    temperature,

    /*
     * Use the completion-token field supported by
     * reasoning-capable OpenAI-compatible models.
     */
    max_completion_tokens:
      maxTokens,

    /*
     * Jobverse performs structured extraction,
     * matching, validation and document generation.
     *
     * Low reasoning is sufficient and reduces
     * unnecessary reasoning-token usage.
     */
    reasoning_effort:
      reasoningEffort,

    /*
     * Jobverse only needs the final response.
     */
    include_reasoning:
      false,

    messages: [
      {
        role: "system",
        content:
          systemMessage
      },

      {
        role: "user",
        content:
          prompt
      }
    ]
  };

  let res;

  try {
    res =
      await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json",

            Authorization:
              `Bearer ${apiKey}`
          },

          body:
            JSON.stringify(
              requestBody
            )
        }
      );
  } catch (error) {
    /*
     * Preserve network errors exactly so
     * callApplicationGroq() can determine whether
     * they are retryable.
     */
    throw error;
  }

  /*
   * ==========================================================
   * RATE LIMIT
   * ==========================================================
   */

  if (res.status === 429) {
  const body =
    await res
      .json()
      .catch(
        () => ({})
      );

  const retryAfter =
    res.headers.get(
      "retry-after"
    );

  const limitTokens =
    res.headers.get(
      "x-ratelimit-limit-tokens"
    );

  const remainingTokens =
    res.headers.get(
      "x-ratelimit-remaining-tokens"
    );

  const resetTokens =
    res.headers.get(
      "x-ratelimit-reset-tokens"
    );

  const limitRequests =
    res.headers.get(
      "x-ratelimit-limit-requests"
    );

  const remainingRequests =
    res.headers.get(
      "x-ratelimit-remaining-requests"
    );

  const resetRequests =
    res.headers.get(
      "x-ratelimit-reset-requests"
    );

  console.error(
    "[Groq rate limit]",
    {
      message:
        body?.error?.message ||
        "Groq rate limit exceeded",

      retryAfter,

      limitTokens,
      remainingTokens,
      resetTokens,

      limitRequests,
      remainingRequests,
      resetRequests
    }
  );

  const err =
    new Error(
      body?.error?.message ||
      "Groq rate limit exceeded"
    );

  err.rateLimited =
    true;

  err.status =
    429;

  err.retryAfter =
    retryAfter;

  err.rateLimitInfo = {
    limitTokens,
    remainingTokens,
    resetTokens,
    limitRequests,
    remainingRequests,
    resetRequests
  };

  throw err;
}

  /*
   * ==========================================================
   * OTHER HTTP ERRORS
   * ==========================================================
   */

  if (!res.ok) {
    const body =
      await res.text();

    const error =
      new Error(
        `Groq request failed (${res.status}): ${body.slice(
          0,
          1000
        )}`
      );

    error.status =
      res.status;

    throw error;
  }

  /*
   * ==========================================================
   * RESPONSE
   * ==========================================================
   */

  const data =
    await res.json();

  const choice =
    data.choices?.[0];

  const finishReason =
    choice?.finish_reason;

  const promptTokens =
    data.usage?.prompt_tokens ||
    0;

  const completionTokens =
    data.usage?.completion_tokens ||
    0;

  const totalTokens =
    data.usage?.total_tokens ||
    (
      promptTokens +
      completionTokens
    );

  /*
   * Different OpenAI-compatible providers/models may
   * expose reasoning tokens through slightly different
   * usage objects.
   */
  const reasoningTokens =
    data.usage
      ?.completion_tokens_details
      ?.reasoning_tokens ||
    data.usage
      ?.output_tokens_details
      ?.reasoning_tokens ||
    0;

  console.log(
    `[Groq] ` +
    `model=${data.model || model} ` +
    `finish_reason=${finishReason || "unknown"} ` +
    `prompt_tokens=${promptTokens} ` +
    `completion_tokens=${completionTokens} ` +
    `reasoning_tokens=${reasoningTokens} ` +
    `total_tokens=${totalTokens}`
  );

  /*
   * Structured output must never continue when
   * Groq reports truncation.
   */
  if (
    finishReason ===
    "length"
  ) {
    throw new Error(
      `Groq response was truncated because it reached max_tokens (${maxTokens})`
    );
  }

  const content =
    choice?.message?.content;

  if (
    typeof content !==
      "string" ||
    !content.trim()
  ) {
    throw new Error(
      "Groq returned an empty response"
    );
  }

  return content;
}

/*
 * ============================================================
 * DISCOVERY OUTPUT VALIDATION
 * ============================================================
 */

function validateAIOutput(
  parsed
) {
  if (
    !parsed ||
    typeof parsed !== "object"
  ) {
    return {
      ok: false,
      reason:
        "Response is not an object"
    };
  }

  const missingOrInvalid =
    REQUIRED_NUMERIC.filter(
      (field) => {
        const value =
          parsed[field];

        return (
          typeof value !==
            "number" ||
          value < 0 ||
          value > 10 ||
          Number.isNaN(value)
        );
      }
    );

  if (
    missingOrInvalid.length >
    0
  ) {
    return {
      ok: false,

      reason:
        "Invalid/missing numeric fields: " +
        missingOrInvalid.join(
          ", "
        )
    };
  }

  if (
    typeof parsed.excluded !==
    "boolean"
  ) {
    return {
      ok: false,
      reason:
        "excluded field is not a boolean"
    };
  }

  if (
    !Array.isArray(
      parsed.matchedSkills
    ) ||
    !Array.isArray(
      parsed.missingSkills
    )
  ) {
    return {
      ok: false,

      reason:
        "matchedSkills/missingSkills must be arrays"
    };
  }

  if (
    parsed.exclusionReason !==
      null &&
    typeof parsed.exclusionReason !==
      "string"
  ) {
    return {
      ok: false,

      reason:
        "exclusionReason must be string or null"
    };
  }

  if (
    typeof parsed.rationale !==
    "string"
  ) {
    return {
      ok: false,

      reason:
        "rationale must be a string"
    };
  }

  return {
    ok: true,
    reason: null
  };
}

/*
 * ============================================================
 * JSON PARSER
 * ============================================================
 */

function tryParseJSON(
  raw
) {
  try {
    const cleaned =
      String(raw || "")
        .trim()
        .replace(
          /^```json\s*/i,
          ""
        )
        .replace(
          /^```\s*/i,
          ""
        )
        .replace(
          /```$/,
          ""
        )
        .trim();

    return JSON.parse(
      cleaned
    );
  } catch (_) {
    return null;
  }
}

/*
 * ============================================================
 * GROQ 429 RETRY TIMING
 * ============================================================
 */

function getGroqRetryDelayMs(
  err,
  attempt
) {
  const message =
    String(
      err?.message ||
      ""
    );

  /*
   * Examples:
   *
   * "Please try again in 19.5075s"
   *
   * "Please try again in 759s"
   */
  const messageMatch =
    message.match(
      /try again in\s+([\d.]+)s/i
    );

  if (messageMatch) {
    const seconds =
      Number(
        messageMatch[1]
      );

    if (
      Number.isFinite(
        seconds
      ) &&
      seconds > 0
    ) {
      /*
       * Small margin prevents retrying exactly
       * at the rate-window boundary.
       */
      return (
        Math.ceil(
          seconds *
          1000
        ) +
        1500
      );
    }
  }

  /*
   * Retry-After header fallback.
   */
  const retryAfter =
    Number(
      err?.retryAfter
    );

  if (
    Number.isFinite(
      retryAfter
    ) &&
    retryAfter > 0
  ) {
    return (
      Math.ceil(
        retryAfter *
        1000
      ) +
      1500
    );
  }

  /*
   * Final fallback:
   *
   * attempt 1 = 15s
   * attempt 2 = 30s
   * attempt 3 = 45s
   */
  return (
    Math.min(
      15 * attempt,
      60
    ) *
    1000
  );
}

/*
 * ============================================================
 * RETRYABLE NETWORK FAILURE CHECK
 * ============================================================
 */

function isRetryableGroqNetworkError(
  err
) {
  const code =
    err?.cause?.code ||
    err?.code ||
    "";

  const retryableCodes =
    new Set([
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_SOCKET",
      "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_BODY_TIMEOUT",
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "EAI_AGAIN",
      "ENETUNREACH",
      "EHOSTUNREACH"
    ]);

  if (
    retryableCodes.has(
      code
    )
  ) {
    return true;
  }

  const message =
    String(
      err?.message ||
      err?.cause?.message ||
      ""
    ).toLowerCase();

  return (
    message.includes(
      "fetch failed"
    ) ||
    message.includes(
      "socket"
    ) ||
    message.includes(
      "connect timeout"
    ) ||
    message.includes(
      "connection reset"
    ) ||
    message.includes(
      "network"
    )
  );
}

/*
 * ============================================================
 * NETWORK BACKOFF
 * ============================================================
 */

function getNetworkRetryDelayMs(
  attempt
) {
  /*
   * attempt 1 = 5s
   * attempt 2 = 10s
   * attempt 3 = 20s
   *
   * capped at 30s.
   */
  return Math.min(
    5000 *
      Math.pow(
        2,
        attempt - 1
      ),

    30000
  );
}

/*
 * ============================================================
 * APPLICATION GROQ QUEUE
 * ============================================================
 */

function callApplicationGroq(
  model,
  prompt,
  temperature = 0.1,
  systemMessage =
    APPLICATION_SYSTEM_MESSAGE,
  maxTokens = 3000
) {
  const run =
    applicationQueue.then(
      async () => {
        /*
         * ====================================================
         * APPLICATION CALL SPACING
         * ====================================================
         */

        const configuredDelay =
          Number(
            resolveConfigValue(
              config
                .APPLICATION_AI_CALL_DELAY_MS,
              30000
            )
          );

        const minDelay =
          Number.isFinite(
            configuredDelay
          ) &&
          configuredDelay >= 0
            ? configuredDelay
            : 30000;

        const elapsed =
          Date.now() -
          lastApplicationCallAt;

        const waitMs =
          Math.max(
            0,
            minDelay -
              elapsed
          );

        if (
          waitMs > 0
        ) {
          console.log(
            `[Groq application] Waiting ${Math.ceil(
              waitMs / 1000
            )}s before next AI call`
          );

          await new Promise(
            (resolve) =>
              setTimeout(
                resolve,
                waitMs
              )
          );
        }

        /*
         * ====================================================
         * ATTEMPTS
         * ====================================================
         */

        const maxAttempts =
          4;

        for (
          let attempt = 1;
          attempt <=
          maxAttempts;
          attempt++
        ) {
          try {
            console.log(
              `[Groq application] ` +
              `Attempt ${attempt}/${maxAttempts} ` +
              `model=${model} ` +
              `maxTokens=${maxTokens} ` +
              `reasoning=low`
            );

            const result =
              await callGroq(
                model,
                prompt,
                temperature,
                systemMessage,
                maxTokens,

                /*
                 * IMPORTANT:
                 *
                 * Application-generation stages use
                 * low reasoning effort.
                 */
                "low"
              );

            lastApplicationCallAt =
              Date.now();

            return result;
          } catch (err) {
            const rateLimited =
              Boolean(
                err?.rateLimited
              );

            const networkFailure =
              isRetryableGroqNetworkError(
                err
              );

            /*
             * Truncation, malformed response, validation
             * issues, etc. should not be blindly retried
             * here.
             */
            if (
              !rateLimited &&
              !networkFailure
            ) {
              throw err;
            }

            if (
              attempt ===
              maxAttempts
            ) {
              console.error(
                `[Groq application] Request failed after ${maxAttempts} attempts`,
                {
                  rateLimited,
                  networkFailure,

                  code:
                    err?.cause?.code ||
                    err?.code ||
                    null
                }
              );

              throw err;
            }

            let retryDelayMs;

            /*
             * ==================================================
             * RATE LIMIT
             * ==================================================
             */

            if (rateLimited) {
              retryDelayMs =
                getGroqRetryDelayMs(
                  err,
                  attempt
                );

                /*
 * Do not keep an application HTTP request open for extremely
 * long provider cooldowns such as daily-token quota resets.
 *
 * Short rate-limit windows are retried automatically.
 * Long windows are surfaced to the application immediately.
 */
const MAX_AUTOMATIC_RATE_LIMIT_WAIT_MS =
  120000; // 2 minutes

if (
  retryDelayMs >
  MAX_AUTOMATIC_RATE_LIMIT_WAIT_MS
) {
  const quotaError =
    new Error(
      `Groq quota exhausted. Provider requested a retry after approximately ${Math.ceil(
        retryDelayMs / 60000
      )} minutes.`
    );

  quotaError.code =
    "GROQ_QUOTA_EXHAUSTED";

  quotaError.status =
    429;

  quotaError.retryAfterMs =
    retryDelayMs;

  throw quotaError;
}

              console.warn(
                `[Groq application] Rate limited. ` +
                `Retrying in approximately ${Math.ceil(
                  retryDelayMs /
                  1000
                )}s.`
              );
            }

            /*
             * ==================================================
             * NETWORK FAILURE
             * ==================================================
             */

            else {
              retryDelayMs =
                getNetworkRetryDelayMs(
                  attempt
                );

              console.warn(
                `[Groq application] Temporary network failure ` +
                `(${err?.cause?.code || err?.code || "unknown"}). ` +
                `Retrying in ${Math.ceil(
                  retryDelayMs /
                  1000
                )}s.`
              );
            }

            /*
             * Update timing so the queue does not immediately
             * fire another application request.
             */
            lastApplicationCallAt =
              Date.now();

            await new Promise(
              (resolve) =>
                setTimeout(
                  resolve,
                  retryDelayMs
                )
            );
          }
        }

        throw new Error(
          "Groq application call failed unexpectedly"
        );
      }
    );

  /*
   * Keep the serialized queue alive even after
   * an individual failure.
   */
  applicationQueue =
    run.catch(
      () => {}
    );

  return run;
}

/*
 * ============================================================
 * DISCOVERY JOB SCORING
 * ============================================================
 */

async function scoreJob(
  candidate,
  job
) {
  const prompt =
    buildPrompt(
      candidate,
      job
    );

  const primaryModel =
    resolveConfigValue(
      config.GROQ_PRIMARY_MODEL
    );

  const retryModel =
    resolveConfigValue(
      config.GROQ_RETRY_MODEL
    );

  const models = [];

  if (primaryModel) {
    models.push([
      primaryModel,
      0.1
    ]);
  }

  if (
    retryModel &&
    retryModel !==
      primaryModel
  ) {
    models.push([
      retryModel,
      0.05
    ]);
  }

  if (
    models.length ===
    0
  ) {
    throw new Error(
      "No Groq discovery model configured"
    );
  }

  for (
    const [
      model,
      temperature
    ] of models
  ) {
    let raw;

    try {
      raw =
        await callGroq(
          model,
          prompt,
          temperature,
          SYSTEM_MESSAGE,

          /*
           * Discovery scoring should remain compact.
           */
          1200,

          /*
           * Low reasoning is enough for structured
           * candidate/job matching.
           */
          "low"
        );
    } catch (err) {
      /*
       * Preserve 429 behavior for discovery.
       */
      if (
        err?.rateLimited
      ) {
        throw err;
      }

      console.error(
        `[Groq discovery] Model ${model} failed:`,
        err.message ||
        err
      );

      continue;
    }

    const parsed =
      tryParseJSON(
        raw
      );

    const validation =
      validateAIOutput(
        parsed
      );

    if (
      validation.ok
    ) {
      return {
        ...job,
        ...parsed,

        aiParseSuccess:
          true,

        aiModel:
          model
      };
    }

    console.warn(
      `[Groq discovery] Invalid AI response from ${model}: ${validation.reason}`
    );
  }

  return {
    ...job,

    aiParseSuccess:
      false,

    aiParseError:
      "All configured Groq models failed to produce valid JSON"
  };
}

/*
 * ============================================================
 * SCORE ALL DISCOVERY JOBS
 * ============================================================
 */

async function scoreAllJobs(
  candidate,
  jobs,
  {
    delayMs
  } = {}
) {
  const configuredDelay =
    Number(
      resolveConfigValue(
        config.AI_CALL_DELAY_MS,
        12000
      )
    );

  const effectiveDelay =
    delayMs !== undefined
      ? Number(delayMs)
      : configuredDelay;

  const safeDelay =
    Number.isFinite(
      effectiveDelay
    ) &&
    effectiveDelay >= 0
      ? effectiveDelay
      : 12000;

  const results = [];

  for (
    const job of jobs
  ) {
    const scored =
      await scoreJob(
        candidate,
        job
      );

    results.push(
      scored
    );

    if (
      safeDelay > 0
    ) {
      await new Promise(
        (resolve) =>
          setTimeout(
            resolve,
            safeDelay
          )
      );
    }
  }

  return results;
}

/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  scoreJob,
  scoreAllJobs,

  validateAIOutput,
  tryParseJSON,

  buildPrompt,

  callGroq,
  callApplicationGroq,

  getGroqRetryDelayMs,
  getNetworkRetryDelayMs,
  isRetryableGroqNetworkError,

  resolveConfigValue
};