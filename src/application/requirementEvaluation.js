const {
  callApplicationGroq,
  tryParseJSON
} = require("../groq");

const config = require("../config");

const EVALUATION_SYSTEM =
  "You are JobVerse's authoritative job-requirement evaluation engine. " +
  "Extract employer requirements and compare them against verified candidate evidence in one operation. " +
  "Never invent or upgrade candidate qualifications. " +
  "Return concise JSON only.";

const VALID_IMPORTANCE =
  new Set([
    "required",
    "preferred",
    "informational"
  ]);

const VALID_STATUS =
  new Set([
    "supported",
    "partial",
    "unsupported"
  ]);

const VALID_RELEVANCE =
  new Set([
    "high",
    "medium",
    "low"
  ]);

const VALID_STRENGTH =
  new Set([
    "strong",
    "moderate",
    "weak",
    "none"
  ]);

/*
 * ============================================================
 * PRIORITY
 * ============================================================
 */

function calculatePriority(match) {
  if (
    match.status ===
    "unsupported"
  ) {
    return "none";
  }

  if (
    match.status ===
    "partial"
  ) {
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
 */

function buildCompactEvidence(evidence) {
  return {
    skills:
      (evidence.skills || []).map(
        (skill) => ({
          name:
            skill.name,

          strength:
            skill.strength,

          evidence:
            skill.evidence
        })
      ),

    experience:
      (evidence.experience || []).map(
        (item) => ({
          title:
            item.title,

          organization:
            item.organization,

          dates:
            item.dates,

          responsibilities:
            item.responsibilities,

          technologies:
            item.technologies,

          strength:
            item.strength
        })
      ),

    projects:
      (evidence.projects || []).map(
        (project) => ({
          name:
            project.name,

          technologies:
            project.technologies,

          highlights:
            project.highlights,

          strength:
            project.strength
        })
      ),

    education:
      evidence.education || [],

    certifications:
      evidence.certifications || []
  };
}

/*
 * ============================================================
 * PROMPT
 * ============================================================
 */

function buildEvaluationPrompt(
  job,
  evidence,
  requestedApplicationType
) {
  return `
TARGET APPLICATION TYPE REQUEST

${requestedApplicationType || "Standard"}

============================================================
JOB
============================================================

Title:
${job.title || ""}

Company:
${job.company || ""}

Job Type:
${job.jobType || ""}

Location:
${job.location || ""}

Work Model:
${job.workModel || ""}

FULL JOB DESCRIPTION

${job.description || job.shortDescription || ""}

============================================================
VERIFIED CANDIDATE EVIDENCE
============================================================

${JSON.stringify(
  buildCompactEvidence(evidence)
)}

============================================================
TASK
============================================================

Perform TWO tasks in one response:

1. Extract the employer's important requirements.

2. Compare every extracted requirement against VERIFIED
   CANDIDATE EVIDENCE.

============================================================
REQUIREMENT EXTRACTION
============================================================

Extract important:

- required skills
- preferred skills
- frameworks
- programming languages
- databases
- tools
- experience requirements
- education requirements
- certifications
- industry requirements
- responsibilities
- ATS keywords

For every important requirement assign:

importance:
required | preferred | informational

============================================================
MATCH STATUS
============================================================

supported
=
verified evidence fully establishes the requirement.

partial
=
verified evidence establishes only part of it.

unsupported
=
verified evidence does not establish it.

============================================================
STRICT NO-UPGRADE RULES
============================================================

JavaScript != automatically JavaScript ES6

HTML != automatically HTML5

CSS != automatically CSS3

React.js != automatically React Hooks

React.js != automatically Redux

REST APIs != automatically microservices

Docker != automatically Kubernetes

Cloud deployment != automatically AWS

Python != automatically Django

Python != automatically Flask

FastAPI != automatically Django

FastAPI != automatically Flask

============================================================
VALID EQUIVALENCE
============================================================

React = React.js

Postgres = PostgreSQL

REST API = REST APIs

A requirement using OR may be satisfied by one explicitly
supported alternative.

Example:

FastAPI, Flask, or Django

is supported when FastAPI is verified.

A requirement using AND must not be marked supported when only
one component is established.

Example:

REST APIs and microservices

with only REST API evidence:

status = partial

============================================================
EDUCATION
============================================================

Current undergraduate study does NOT prove completion of a
bachelor's degree.

============================================================
YEARS OF EXPERIENCE
============================================================

Never estimate years.

If 5 years are required and verified evidence does not
explicitly establish 5 years:

unsupported.

============================================================
RELEVANCE
============================================================

high
=
core capability for this particular role.

medium
=
meaningful secondary capability.

low
=
minor or peripheral.

Do not mark everything high.

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
EVIDENCE
============================================================

Maximum 2 evidence strings per requirement.

Each evidence string should be short.

Prefer concrete project/work evidence.

Unsupported requirements must have:

"evidence": []

Never use:

implies
suggests
probably
likely

============================================================
APPLICATION TYPE
============================================================

Return one of:

NHS
Executive
Technical
Education
ATS
Standard

If the requested type is valid, preserve it unless the job
clearly requires another supported format.

============================================================
RETURN EXACTLY
============================================================

{
  "applicationType": "Technical",

  "requiredSkills": [],
  "preferredSkills": [],
  "experienceRequirements": [],
  "educationRequirements": [],
  "certifications": [],
  "industryRequirements": [],
  "responsibilities": [],
  "atsKeywords": [],

  "requirements": [
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

Keep reasons concise.

JSON only.
`;
}

/*
 * ============================================================
 * VALIDATION
 * ============================================================
 */

function validateEvaluation(parsed) {
  if (
    !parsed ||
    typeof parsed !== "object"
  ) {
    return {
      ok: false,
      reason:
        "Evaluation is not an object"
    };
  }

  const arrays = [
    "requiredSkills",
    "preferredSkills",
    "experienceRequirements",
    "educationRequirements",
    "certifications",
    "industryRequirements",
    "responsibilities",
    "atsKeywords",
    "requirements"
  ];

  for (const key of arrays) {
    if (!Array.isArray(parsed[key])) {
      return {
        ok: false,
        reason:
          `${key} must be an array`
      };
    }
  }

  if (
    typeof parsed.applicationType !==
    "string"
  ) {
    return {
      ok: false,
      reason:
        "applicationType must be a string"
    };
  }

  for (
    const item of
    parsed.requirements
  ) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.requirement !== "string" ||
      !VALID_IMPORTANCE.has(item.importance) ||
      !VALID_STATUS.has(item.status) ||
      !VALID_RELEVANCE.has(item.relevance) ||
      !VALID_STRENGTH.has(item.evidenceStrength) ||
      !Array.isArray(item.evidence) ||
      typeof item.reason !== "string"
    ) {
      return {
        ok: false,
        reason:
          `Invalid requirement evaluation: ${JSON.stringify(item)}`
      };
    }

    if (
      item.status === "unsupported" &&
      item.evidence.length !== 0
    ) {
      return {
        ok: false,
        reason:
          `Unsupported requirement contains evidence: ${item.requirement}`
      };
    }

    if (
      item.status === "unsupported" &&
      item.evidenceStrength !== "none"
    ) {
      return {
        ok: false,
        reason:
          `Unsupported requirement has evidence strength: ${item.requirement}`
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
 * RESULT ENRICHMENT
 * ============================================================
 */

function buildEvaluationResult(parsed) {
  const requirements =
    parsed.requirements.map(
      (item) => ({
        ...item,

        priority:
          calculatePriority(item)
      })
    );

  const supportedRequirements =
    requirements.filter(
      (item) =>
        item.status === "supported"
    );

  const partiallySupportedRequirements =
    requirements.filter(
      (item) =>
        item.status === "partial"
    );

  const unsupportedRequirements =
    requirements.filter(
      (item) =>
        item.status === "unsupported"
    );

  const requiredUnsupportedRequirements =
    unsupportedRequirements.filter(
      (item) =>
        item.importance === "required"
    );

  const requiredPartialRequirements =
    partiallySupportedRequirements.filter(
      (item) =>
        item.importance === "required"
    );

  const supportedRequiredRequirements =
    supportedRequirements.filter(
      (item) =>
        item.importance === "required"
    );

  const highPriorityMatches =
    requirements.filter(
      (item) =>
        item.priority === "high"
    );

  const mediumPriorityMatches =
    requirements.filter(
      (item) =>
        item.priority === "medium"
    );

  const lowPriorityMatches =
    requirements.filter(
      (item) =>
        item.priority === "low"
    );

  return {
    ...parsed,

    requirements,

    /*
     * Compatibility with the existing CV and
     * cover-letter generators.
     */
    matches:
      requirements,

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
 * MAIN EVALUATOR
 * ============================================================
 */

async function evaluateJobRequirements(
  job,
  evidence,
  requestedApplicationType = null
) {
  const raw =
    await callApplicationGroq(
      config.GROQ_APPLICATION_MODEL,

      buildEvaluationPrompt(
        job,
        evidence,
        requestedApplicationType
      ),

      0.05,

      EVALUATION_SYSTEM,

      2800
    );

  const parsed =
    tryParseJSON(raw);

  const validation =
    validateEvaluation(parsed);

  if (!validation.ok) {
    throw new Error(
      `Requirement evaluation failed: ${validation.reason}`
    );
  }

  const result =
    buildEvaluationResult(parsed);

  console.log(
    "[Requirement evaluation] high priority:",
    result.highPriorityMatches.map(
      (item) =>
        item.requirement
    )
  );

  console.log(
    "[Requirement evaluation] supported:",
    result.supportedRequiredRequirements.map(
      (item) =>
        item.requirement
    )
  );

  console.log(
    "[Requirement evaluation] partial:",
    result.requiredPartialRequirements.map(
      (item) =>
        item.requirement
    )
  );

  console.log(
    "[Requirement evaluation] unsupported:",
    result.requiredUnsupportedRequirements.map(
      (item) =>
        item.requirement
    )
  );

  return result;
}

module.exports = {
  evaluateJobRequirements,
  buildEvaluationPrompt,
  buildCompactEvidence,
  validateEvaluation,
  buildEvaluationResult,
  calculatePriority
};