const {
  callApplicationGroq,
  tryParseJSON
} = require("../groq");

const config = require("../config");

const MATCHER_SYSTEM =
  "You are JobVerse's authoritative job-requirement matcher. " +
  "Use only verified candidate evidence. " +
  "Never invent, infer, upgrade, or broaden candidate qualifications. " +
  "Classify every requirement exactly once. " +
  "Keep evidence and reasons extremely concise. " +
  "Return JSON only.";

const VALID_IMPORTANCE = new Set([
  "required",
  "preferred",
  "informational"
]);

const VALID_STATUS = new Set([
  "supported",
  "partial",
  "unsupported"
]);

const VALID_RELEVANCE = new Set([
  "high",
  "medium",
  "low"
]);

const VALID_STRENGTH = new Set([
  "strong",
  "moderate",
  "weak",
  "none"
]);

/*
 * ============================================================
 * HELPERS
 * ============================================================
 */

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function calculatePriority(match) {
  if (match.status === "unsupported") {
    return "none";
  }

  if (match.status === "partial") {
    if (
      match.importance === "required" &&
      match.relevance === "high"
    ) {
      return "medium";
    }

    return "low";
  }

  if (
    match.importance === "required" &&
    match.relevance === "high" &&
    (
      match.evidenceStrength === "strong" ||
      match.evidenceStrength === "moderate"
    )
  ) {
    return "high";
  }

  if (
    match.importance === "required" &&
    match.relevance === "medium"
  ) {
    return "medium";
  }

  if (
    match.importance === "preferred" &&
    match.relevance === "high" &&
    match.evidenceStrength === "strong"
  ) {
    return "high";
  }

  if (
    match.importance === "preferred" &&
    (
      match.relevance === "high" ||
      match.relevance === "medium"
    )
  ) {
    return "medium";
  }

  return "low";
}

/*
 * ============================================================
 * COMPACT EVIDENCE
 * ============================================================
 *
 * The matcher does not need the entire Gemini evidence object.
 * We only give it the information required to establish whether
 * employer requirements are supported.
 */

function buildCompactEvidence(evidence) {
  return {
    skills: (evidence.skills || []).map(
      (skill) => ({
        name: skill.name,
        strength: skill.strength,
        evidence: skill.evidence
      })
    ),

    experience: (evidence.experience || []).map(
      (item) => ({
        title: item.title,
        organization: item.organization,
        dates: item.dates,
        responsibilities: item.responsibilities,
        technologies: item.technologies,
        strength: item.strength
      })
    ),

    projects: (evidence.projects || []).map(
      (project) => ({
        name: project.name,
        technologies: project.technologies,
        highlights: project.highlights,
        strength: project.strength
      })
    ),

    education: (evidence.education || []).map(
      (item) => ({
        degree: item.degree,
        institution: item.institution,
        dates: item.dates,
        status: item.status
      })
    ),

    certifications: (evidence.certifications || []).map(
      (item) => ({
        name: item.name,
        issuer: item.issuer,
        status: item.status
      })
    )
  };
}

/*
 * ============================================================
 * MATCHER PROMPT
 * ============================================================
 */

function buildMatcherPrompt(
  evidence,
  requirements
) {
  const compactEvidence =
    buildCompactEvidence(evidence);

  const compactRequirements =
    (requirements.requirements || []).map(
      (item) => ({
        requirement:
          item.requirement,

        importance:
          item.importance
      })
    );

  return `
VERIFIED CANDIDATE EVIDENCE

${JSON.stringify(compactEvidence)}

EMPLOYER REQUIREMENTS

${JSON.stringify(compactRequirements)}

TASK

Compare EVERY employer requirement against VERIFIED CANDIDATE
EVIDENCE.

Return exactly one result per requirement.

============================================================
STATUS
============================================================

supported
=
verified evidence fully establishes the requirement.

partial
=
verified evidence establishes only part of the requirement.

unsupported
=
verified evidence does not establish it.

============================================================
STRICT MATCHING RULES
============================================================

Never upgrade evidence.

JavaScript != automatically JavaScript ES6
HTML != automatically HTML5
CSS != automatically CSS3
React.js != automatically React Hooks
React.js != automatically Redux
REST APIs != automatically microservices
Docker != automatically Kubernetes
cloud deployment != automatically AWS
Python != automatically Django
Python != automatically Flask
FastAPI != automatically Django
FastAPI != automatically Flask

Valid equivalents are allowed:

React = React.js
Postgres = PostgreSQL
REST API = REST APIs

OR requirements:

"FastAPI, Flask, or Django"

is supported if any explicitly allowed option is evidenced.

AND requirements:

"REST APIs and microservices"

is partial when REST APIs are evidenced but microservices are not.

============================================================
EDUCATION
============================================================

An ongoing bachelor's degree does NOT satisfy a requirement
for a completed bachelor's degree.

============================================================
EXPERIENCE LENGTH
============================================================

Never estimate years of experience.

If 5 years are required and 5 years are not explicitly established,
the requirement is unsupported.

============================================================
RELEVANCE
============================================================

high
=
core capability for the role.

medium
=
meaningful secondary capability.

low
=
minor/peripheral requirement.

Do not classify everything as high.

============================================================
EVIDENCE STRENGTH
============================================================

strong
=
multiple explicit examples or substantial demonstrated usage.

moderate
=
clear explicit support.

weak
=
explicit but limited support.

none
=
unsupported.

============================================================
OUTPUT SIZE RULES
============================================================

Keep the response VERY concise.

For each requirement:

- maximum 2 evidence strings
- each evidence string maximum about 18 words
- reason maximum about 20 words
- unsupported evidence MUST be []

Do not reproduce long CV passages.

Do not explain general technology concepts.

Do not repeat the requirement inside the reason.

Do not use:
"implies"
"suggests"
"likely"
"probably"

============================================================
RETURN EXACTLY
============================================================

{
  "matches": [
    {
      "requirement": "",
      "importance": "required|preferred|informational",
      "status": "supported|partial|unsupported",
      "relevance": "high|medium|low",
      "evidenceStrength": "strong|moderate|weak|none",
      "evidence": [],
      "reason": ""
    }
  ]
}

JSON only.
`;
}

/*
 * ============================================================
 * VALIDATION
 * ============================================================
 */

function validateMatch(match) {
  if (
    !match ||
    typeof match !== "object"
  ) {
    return false;
  }

  if (
    typeof match.requirement !== "string" ||
    !match.requirement.trim()
  ) {
    return false;
  }

  if (
    !VALID_IMPORTANCE.has(
      match.importance
    )
  ) {
    return false;
  }

  if (
    !VALID_STATUS.has(
      match.status
    )
  ) {
    return false;
  }

  if (
    !VALID_RELEVANCE.has(
      match.relevance
    )
  ) {
    return false;
  }

  if (
    !VALID_STRENGTH.has(
      match.evidenceStrength
    )
  ) {
    return false;
  }

  if (
    !Array.isArray(
      match.evidence
    )
  ) {
    return false;
  }

  if (
    typeof match.reason !==
    "string"
  ) {
    return false;
  }

  if (
    match.evidence.length >
    2
  ) {
    return false;
  }

  if (
    match.status === "unsupported" &&
    match.evidence.length !== 0
  ) {
    return false;
  }

  if (
    match.status === "unsupported" &&
    match.evidenceStrength !== "none"
  ) {
    return false;
  }

  if (
    match.status !== "unsupported" &&
    match.evidenceStrength === "none"
  ) {
    return false;
  }

  return true;
}

function validateMatcherOutput(
  parsed,
  requirements
) {
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray(parsed.matches)
  ) {
    return {
      ok: false,
      reason:
        "Matcher output must contain matches array"
    };
  }

  const sourceRequirements =
    requirements.requirements || [];

  if (
    parsed.matches.length !==
    sourceRequirements.length
  ) {
    return {
      ok: false,

      reason:
        `Matcher returned ${parsed.matches.length} matches for ${sourceRequirements.length} requirements`
    };
  }

  for (
    const match of parsed.matches
  ) {
    if (!validateMatch(match)) {
      return {
        ok: false,

        reason:
          `Invalid requirement match: ${JSON.stringify(match)}`
      };
    }
  }

  const returned =
    new Set(
      parsed.matches.map(
        (match) =>
          normalizeText(
            match.requirement
          )
      )
    );

  for (
    const requirement of
    sourceRequirements
  ) {
    if (
      !returned.has(
        normalizeText(
          requirement.requirement
        )
      )
    ) {
      return {
        ok: false,

        reason:
          `Matcher omitted requirement: ${requirement.requirement}`
      };
    }
  }

  return {
    ok: true,
    reason: null
  };
}

/*
 * ============================================================
 * RESULT BUILDER
 * ============================================================
 */

function buildMatchResult(matches) {
  const enriched =
    matches.map(
      (match) => ({
        ...match,

        priority:
          calculatePriority(match)
      })
    );

  const supportedRequirements =
    enriched.filter(
      (match) =>
        match.status ===
        "supported"
    );

  const partiallySupportedRequirements =
    enriched.filter(
      (match) =>
        match.status ===
        "partial"
    );

  const unsupportedRequirements =
    enriched.filter(
      (match) =>
        match.status ===
        "unsupported"
    );

  const requiredUnsupportedRequirements =
    unsupportedRequirements.filter(
      (match) =>
        match.importance ===
        "required"
    );

  const requiredPartialRequirements =
    partiallySupportedRequirements.filter(
      (match) =>
        match.importance ===
        "required"
    );

  const supportedRequiredRequirements =
    supportedRequirements.filter(
      (match) =>
        match.importance ===
        "required"
    );

  const highPriorityMatches =
    enriched.filter(
      (match) =>
        match.priority ===
        "high"
    );

  const mediumPriorityMatches =
    enriched.filter(
      (match) =>
        match.priority ===
        "medium"
    );

  const lowPriorityMatches =
    enriched.filter(
      (match) =>
        match.priority ===
        "low"
    );

  return {
    matches: enriched,

    supportedRequirements,

    partiallySupportedRequirements,

    unsupportedRequirements,

    requiredUnsupportedRequirements,

    requiredPartialRequirements,

    supportedRequiredRequirements,

    highPriorityMatches,

    mediumPriorityMatches,

    lowPriorityMatches
  };
}

/*
 * ============================================================
 * REQUIREMENT MATCHER
 * ============================================================
 */

async function matchEvidenceToRequirements(
  evidence,
  requirements
) {
  if (
    !requirements ||
    !Array.isArray(
      requirements.requirements
    )
  ) {
    throw new Error(
      "Requirement matcher requires requirements.requirements"
    );
  }

  const raw =
    await callApplicationGroq(
      config.GROQ_APPLICATION_MODEL,

      buildMatcherPrompt(
        evidence,
        requirements
      ),

      0.05,

      MATCHER_SYSTEM,

      /*
       * Increased slightly from 3000,
       * but the prompt/output are now much more compact.
       */
      2400
    );

  const parsed =
    tryParseJSON(raw);

  const validation =
    validateMatcherOutput(
      parsed,
      requirements
    );

  if (!validation.ok) {
    throw new Error(
      `Requirement matcher validation failed: ${validation.reason}`
    );
  }

  const result =
    buildMatchResult(
      parsed.matches
    );

  console.log(
    "[Requirement matcher] high priority:",
    result.highPriorityMatches.map(
      (match) =>
        match.requirement
    )
  );

  console.log(
    "[Requirement matcher] supported:",
    result.supportedRequiredRequirements.map(
      (match) =>
        match.requirement
    )
  );

  console.log(
    "[Requirement matcher] partial:",
    result.requiredPartialRequirements.map(
      (match) =>
        match.requirement
    )
  );

  console.log(
    "[Requirement matcher] unsupported:",
    result.requiredUnsupportedRequirements.map(
      (match) =>
        match.requirement
    )
  );

  return result;
}

/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  matchEvidenceToRequirements,
  buildMatcherPrompt,
  buildCompactEvidence,
  validateMatcherOutput,
  buildMatchResult,
  calculatePriority
};