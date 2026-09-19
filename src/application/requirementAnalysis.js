const {
  callApplicationGroq,
  tryParseJSON
} = require("../groq");

const config = require("../config");

const REQUIREMENT_SYSTEM =
  "You analyze job descriptions for an application tailoring system. " +
  "Extract requirements faithfully from the supplied job description. " +
  "Never invent requirements. " +
  "Classify each requirement as required, preferred, or informational only when the wording supports it. " +
  "Return JSON only.";

const APPLICATION_TYPES = [
  "NHS",
  "Executive",
  "Technical",
  "Education",
  "ATS",
  "Standard"
];

/**
 * Validate the requirement-analysis output.
 */
function validateRequirementAnalysis(value) {
  if (!value || typeof value !== "object") {
    return {
      ok: false,
      reason: "Analysis is not an object"
    };
  }

  const requiredArrays = [
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

  for (const key of requiredArrays) {
    if (!Array.isArray(value[key])) {
      return {
        ok: false,
        reason: `${key} must be an array`
      };
    }
  }

  if (
    !APPLICATION_TYPES.includes(
      value.applicationType
    )
  ) {
    return {
      ok: false,
      reason: "Invalid applicationType"
    };
  }

  /*
   * Validate the normalized requirements array.
   */
  for (const requirement of value.requirements) {
    if (
      !requirement ||
      typeof requirement !== "object"
    ) {
      return {
        ok: false,
        reason: "Every requirement must be an object"
      };
    }

    if (
      typeof requirement.requirement !== "string" ||
      !requirement.requirement.trim()
    ) {
      return {
        ok: false,
        reason:
          "Every requirement must contain requirement text"
      };
    }

    if (
      ![
        "required",
        "preferred",
        "informational"
      ].includes(requirement.importance)
    ) {
      return {
        ok: false,
        reason:
          `Invalid requirement importance: ${requirement.importance}`
      };
    }

    if (
      typeof requirement.evidence !== "string"
    ) {
      return {
        ok: false,
        reason:
          "Requirement evidence must be a string"
      };
    }
  }

  return {
    ok: true,
    reason: null
  };
}

/**
 * Build prompt for extracting job requirements.
 */
function buildRequirementPrompt(
  job,
  requestedType
) {
  return `JOB

Title:
${job.title || ""}

Company:
${job.company || ""}

Location:
${job.location || ""}

Work model:
${job.workModel || ""}

Job type:
${job.jobType || ""}

FULL JOB DESCRIPTION:

${job.description || ""}

REQUESTED APPLICATION TYPE:

${requestedType || "auto"}

APPLICATION TYPE RULES

- NHS:
  Use only when the role is clearly NHS / UK health-service
  oriented or the caller explicitly requests NHS.

- Executive:
  Senior leadership, management or executive role.

- Technical:
  Software, engineering, data, IT or other technical role.

- Education:
  Teaching, academic or education-oriented role.

- ATS:
  ATS-focused application when explicitly requested.

- Standard:
  Normal professional application.

REQUIREMENT EXTRACTION RULES

1. Extract only requirements actually supported by the job listing.

2. Do not invent employer requirements.

3. Separate required skills from preferred skills.

4. Extract explicit experience requirements.

5. Extract explicit education requirements.

6. Extract explicit certification requirements.

7. Extract industry-specific requirements.

8. Extract major responsibilities.

9. Extract meaningful ATS keywords.

10. The normalized "requirements" array is the authoritative
    list later used by the candidate evidence matcher.

11. Each meaningful employer requirement should appear once
    in the normalized requirements array.

12. Preserve multi-part requirements when the employer
    presents them together.

13. Set importance to:
    - required
    - preferred
    - informational

    based only on the wording of the listing.

14. The evidence field must contain either:
    - the relevant job-description wording, or
    - a faithful short paraphrase.

15. Job requirements are NOT candidate evidence.

RETURN EXACTLY:

{
  "applicationType":
    "NHS|Executive|Technical|Education|ATS|Standard",

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
      "importance":
        "required|preferred|informational",
      "evidence": ""
    }
  ]
}

Return valid JSON only.
Do not wrap the response in markdown.
Do not add commentary outside the JSON.`;
}

/**
 * Analyze one complete job description.
 */
async function analyzeJobRequirements(
  job,
  requestedType = null
) {
  if (!job.description) {
    throw new Error(
      "Full job description is required for application generation"
    );
  }

  const raw = await callApplicationGroq(
    config.GROQ_APPLICATION_MODEL,
    buildRequirementPrompt(
      job,
      requestedType
    ),
    0.1,
    REQUIREMENT_SYSTEM,
    1800
  );

  const parsed = tryParseJSON(raw);

  const validation =
    validateRequirementAnalysis(parsed);

  if (!validation.ok) {
    throw new Error(
      `Requirement analysis validation failed: ${validation.reason}`
    );
  }

  return parsed;
}

module.exports = {
  analyzeJobRequirements,
  validateRequirementAnalysis,
  buildRequirementPrompt,
  APPLICATION_TYPES
};