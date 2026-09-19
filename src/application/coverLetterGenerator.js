const {
  callApplicationGroq,
  tryParseJSON
} = require("../groq");

const config = require("../config");

const COVER_SYSTEM =
  "You write concise, professional, job-specific cover letters using only verified candidate evidence. " +
  "The AUTHORITATIVE REQUIREMENT MATCH controls what is supported, partial, or unsupported. " +
  "Emphasize the strongest verified facts relevant to the target role without exaggerating them. " +
  "Never invent experience, skills, technologies, employers, achievements, metrics, qualifications, education, certifications, dates, years of experience, or company knowledge. " +
  "Return JSON only.";

/*
 * ============================================================
 * PRIORITY HELPERS
 * ============================================================
 */

function priorityRank(priority) {
  switch (priority) {
    case "high":
      return 3;

    case "medium":
      return 2;

    case "low":
      return 1;

    default:
      return 0;
  }
}

function getCoverLetterMatches(
  requirementMatch
) {
  return (
    requirementMatch.matches || []
  )
    .filter(
      (match) =>
        match.status === "supported" ||
        match.status === "partial"
    )
    .sort(
      (a, b) =>
        priorityRank(b.priority) -
        priorityRank(a.priority)
    )
    .slice(0, 8);
}

/*
 * ============================================================
 * VALIDATION
 * ============================================================
 */

function validateCoverLetter(value) {
  if (
    !value ||
    typeof value !== "object"
  ) {
    return {
      ok: false,
      reason:
        "Cover-letter output is not an object"
    };
  }

  if (
    typeof value.coverLetter !== "string" ||
    !value.coverLetter.trim()
  ) {
    return {
      ok: false,
      reason:
        "coverLetter is empty"
    };
  }

  const wordCount =
    value.coverLetter
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .length;

  if (wordCount > 450) {
    return {
      ok: false,
      reason:
        `Cover letter exceeds 450 words (${wordCount})`
    };
  }

  return {
    ok: true,
    reason: null
  };
}

/*
 * ============================================================
 * COMPACT EVIDENCE
 * ============================================================
 */

function buildCompactCoverEvidence(
  evidence
) {
  return {
    skills:
      (evidence.skills || [])
        .filter(
          (skill) =>
            skill.strength === "strong" ||
            skill.strength === "moderate"
        )
        .slice(0, 15)
        .map(
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
      (evidence.experience || [])
        .slice(0, 5)
        .map(
          (item) => ({
            title:
              item.title,

            organization:
              item.organization,

            responsibilities:
              item.responsibilities,

            technologies:
              item.technologies
          })
        ),

    projects:
      (evidence.projects || [])
        .slice(0, 6)
        .map(
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
      (evidence.education || [])
        .slice(0, 3)
        .map(
          (item) => ({
            degree:
              item.degree,

            institution:
              item.institution,

            status:
              item.status
          })
        )
  };
}

/*
 * ============================================================
 * PROMPT
 * ============================================================
 */

function buildCoverPrompt(
  candidate,
  evidence,
  requirements,
  requirementMatch,
  job,
  applicationType,
  correction = null
) {
  const strongestMatches =
    getCoverLetterMatches(
      requirementMatch
    );

  const compactEvidence =
    buildCompactCoverEvidence(
      evidence
    );

  const unsupported =
    (
      requirementMatch
        .unsupportedRequirements ||
      []
    )
      .filter(
        (match) =>
          match.importance ===
          "required"
      )
      .map(
        (match) =>
          match.requirement
      );

  return `
APPLICATION TYPE

${applicationType}

TARGET ROLE

Job Title:
${job.title || ""}

Company:
${job.company || ""}

============================================================
STRONGEST VERIFIED JOB MATCHES
============================================================

${JSON.stringify(strongestMatches)}

============================================================
VERIFIED CANDIDATE EVIDENCE
============================================================

${JSON.stringify(compactEvidence)}

============================================================
UNSUPPORTED REQUIRED QUALIFICATIONS
============================================================

${JSON.stringify(unsupported)}

Do NOT claim the candidate possesses these.

============================================================
CANDIDATE
============================================================

Name:
${candidate.candidateName || ""}

============================================================
TASK
============================================================

Write a concise, compelling cover letter for the target role.

The letter must catch employer attention by emphasizing the
candidate's strongest VERIFIED facts.

Do not merely list technologies.

Connect the strongest technologies to real verified:

- projects
- professional experience
- technical responsibilities
- integrations
- systems built

============================================================
ATTENTION AND EMPHASIS RULES
============================================================

1. Lead with role relevance.

2. In the opening paragraph:
   - identify the role
   - briefly establish the candidate's strongest relevant profile
   - mention 2-4 high-priority verified capabilities

3. In the main paragraph:
   use the strongest concrete project or work example.

4. Prefer factual specificity.

Prefer:

"Built TicketFlow using FastAPI, React.js and PostgreSQL,
including REST API services and authentication."

over:

"I have experience in full-stack development."

5. If professional experience exists, prefer using relevant
professional experience before personal projects.

6. If professional experience is absent, use the strongest
verified project evidence.

7. Emphasize facts without inflating them.

8. Evidence strength does NOT justify unsupported seniority.

Do not write:

"expert"
"senior"
"advanced"
"extensive"

unless explicitly supported.

============================================================
PARTIAL REQUIREMENTS
============================================================

A partial match may be mentioned only for the supported part.

Examples:

If:

JavaScript supported
ES6 unsupported

say:

"JavaScript"

not:

"JavaScript ES6"

If:

REST APIs supported
microservices unsupported

say:

"REST API development"

not:

"REST API and microservices development"

============================================================
STRICT FACTUAL RULES
============================================================

Never invent:

- technologies
- employers
- employment
- responsibilities
- degrees
- certifications
- dates
- years of experience
- company information
- metrics
- percentages
- user counts
- revenue
- performance gains
- awards

Never upgrade:

JavaScript → ES6
HTML → HTML5
CSS → CSS3
React → React Hooks
React → Redux
REST APIs → microservices
Docker → Kubernetes
cloud deployment → AWS

============================================================
STYLE
============================================================

Professional and confident.

Not exaggerated.

Not robotic.

Not overly enthusiastic.

Avoid generic filler such as:

"I am extremely passionate..."

"I am the perfect candidate..."

"I believe I would be an excellent fit..."

Prefer evidence-based confidence.

============================================================
LENGTH
============================================================

Target:
250-350 words.

Absolute maximum:
450 words.

Use approximately 4-5 short paragraphs:

1. Opening
2. Strongest technical/project/work evidence
3. Additional relevant evidence
4. Why the verified background fits the role
5. Short closing

Do not repeat the CV.

Do not enumerate every skill.

Do not discuss unsupported requirements.

Do not explain the requirement matcher.

${
  correction
    ? `
============================================================
VALIDATION CORRECTION
============================================================

Previous validation feedback:

${JSON.stringify(correction)}

Remove or correct every unsupported claim.

Do not try to justify unsupported claims.
`
    : ""
}

============================================================
RETURN EXACTLY
============================================================

{
  "coverLetter": ""
}

JSON only.

Do not use markdown.

Do not return explanations.
`;
}

/*
 * ============================================================
 * GENERATION
 * ============================================================
 */

async function generateTailoredCoverLetter(
  candidate,
  evidence,
  requirements,
  requirementMatch,
  job,
  applicationType,
  correction = null
) {
  const raw =
    await callApplicationGroq(
      config.GROQ_APPLICATION_MODEL,

      buildCoverPrompt(
        candidate,
        evidence,
        requirements,
        requirementMatch,
        job,
        applicationType,
        correction
      ),

      0.1,

      COVER_SYSTEM,

      /*
       * A 250-450 word cover letter does not
       * require thousands of completion tokens.
       */
      1400
    );

  const parsed =
    tryParseJSON(raw);

  const validation =
    validateCoverLetter(
      parsed
    );

  if (!validation.ok) {
    throw new Error(
      `Cover-letter generation validation failed: ${validation.reason}`
    );
  }

  return parsed;
}

module.exports = {
  generateTailoredCoverLetter,
  validateCoverLetter,
  buildCoverPrompt,
  buildCompactCoverEvidence,
  getCoverLetterMatches
};