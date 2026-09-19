const {
  callApplicationGroq,
  tryParseJSON
} = require("../groq");

const config = require("../config");

const CV_SYSTEM =
  "You create concise, high-impact professional CV content. " +
  "You must use only verified candidate evidence. " +
  "The AUTHORITATIVE REQUIREMENT MATCH controls what is supported, partial or unsupported. " +
  "Prioritize high-value verified evidence that is relevant to the target role. " +
  "Emphasize facts without exaggerating them. " +
  "Never invent skills, employment, technologies, achievements, metrics, education, certifications, responsibilities, dates or years of experience. " +
  "Return JSON only.";

/*
 * ============================================================
 * PRIORITY HELPERS
 * ============================================================
 */

function priorityRank(
  priority
) {
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

function getPrioritizedMatches(
  requirementMatch
) {
  return (
    requirementMatch.matches ||
    []
  )
    .filter(
      (match) =>
        match.status ===
          "supported" ||
        match.status ===
          "partial"
    )
    .sort(
      (a, b) =>
        priorityRank(
          b.priority
        ) -
        priorityRank(
          a.priority
        )
    );
}

/*
 * ============================================================
 * VALIDATION
 * ============================================================
 */

function validateCV(
  value
) {
  if (
    !value ||
    typeof value !== "object"
  ) {
    return {
      ok: false,
      reason:
        "CV output is not an object"
    };
  }

  if (
    typeof value.professionalSummary !==
    "string"
  ) {
    return {
      ok: false,
      reason:
        "professionalSummary must be a string"
    };
  }

  const arrays = [
    "skills",
    "experience",
    "projects",
    "education",
    "certifications",
    "achievements",
    "changes"
  ];

  for (const key of arrays) {
    if (!Array.isArray(value[key])) {
      return {
        ok: false,
        reason:
          `${key} must be an array`
      };
    }
  }

  if (value.skills.length > 15) {
    return {
      ok: false,
      reason:
        "skills exceeds maximum of 15"
    };
  }

  if (
    value.experience.length >
    5
  ) {
    return {
      ok: false,
      reason:
        "experience exceeds maximum of 5"
    };
  }

  if (
    value.projects.length >
    5
  ) {
    return {
      ok: false,
      reason:
        "projects exceeds maximum of 5"
    };
  }

  if (
    value.education.length >
    3
  ) {
    return {
      ok: false,
      reason:
        "education exceeds maximum of 3"
    };
  }

  if (
    value.certifications.length >
    5
  ) {
    return {
      ok: false,
      reason:
        "certifications exceeds maximum of 5"
    };
  }

  return {
    ok: true,
    reason: null
  };
}

/*
 * ============================================================
 * CV PROMPT
 * ============================================================
 */

function buildCVPrompt(
  candidate,
  evidence,
  requirements,
  requirementMatch,
  job,
  applicationType,
  correction = null
) {
  const prioritizedMatches =
    getPrioritizedMatches(
      requirementMatch
    );

  const highPriority =
    prioritizedMatches.filter(
      (match) =>
        match.priority ===
        "high"
    );

  const mediumPriority =
    prioritizedMatches.filter(
      (match) =>
        match.priority ===
        "medium"
    );

  const unsupported =
    (
      requirementMatch
        .unsupportedRequirements ||
      []
    ).map(
      (match) => ({
        requirement:
          match.requirement,

        reason:
          match.reason
      })
    );

  const compactEvidence = {
    summary:
      evidence.summary,

    skills:
      evidence.skills,

    experience:
      evidence.experience,

    projects:
      evidence.projects,

    education:
      evidence.education,

    certifications:
      evidence.certifications,

    achievements:
      evidence.achievements
  };

  return `
APPLICATION TYPE

${applicationType}

============================================================
TARGET JOB
============================================================

Title:
${job.title || ""}

Company:
${job.company || ""}

============================================================
VERIFIED CANDIDATE EVIDENCE
============================================================

${JSON.stringify(compactEvidence)}

============================================================
HIGH-PRIORITY VERIFIED MATCHES
============================================================

These are the strongest facts to emphasize first:

${JSON.stringify(highPriority)}

============================================================
MEDIUM-PRIORITY VERIFIED MATCHES
============================================================

${JSON.stringify(mediumPriority)}

============================================================
UNSUPPORTED REQUIREMENTS
============================================================

Do NOT claim these:

${JSON.stringify(unsupported)}

============================================================
CANDIDATE
============================================================

Name:
${candidate.candidateName || ""}

============================================================
PRIMARY GOAL
============================================================

Create a concise, professional, attention-grabbing CV tailored
to the target job.

The CV should make the candidate's strongest TRUE qualifications
easy for a recruiter or employer to notice quickly.

You must EMPHASIZE verified facts.

You must NEVER exaggerate those facts.

============================================================
IMPACT AND EMPHASIS RULES
============================================================

1. Lead with HIGH-PRIORITY supported evidence.

2. Put the strongest job-relevant technologies near the beginning
   of the Professional Summary.

3. Put the strongest relevant skills first in Skills.

4. Rank professional experience and projects by relevance to the
   target role, not merely by the order they appeared in the source.

5. Prefer specific factual wording over generic wording.

Prefer:

"Built backend services using Python and FastAPI."

over:

"Worked on backend development."

Prefer:

"Developed REST APIs backed by PostgreSQL."

over:

"Worked with databases."

Prefer:

"Built a responsive interface using React.js, HTML and CSS."

over:

"Created user interfaces."

6. When a verified project contains several relevant technologies,
   surface those technologies in the first bullet.

7. When verified experience exists, give professional experience
   appropriate prominence.

8. Employment/internship evidence should normally appear before
   Projects when it is relevant to the target role.

9. Use concrete technical scope when verified:

   - authentication
   - REST API development
   - payment integration
   - database integration
   - automation
   - notifications
   - event management
   - monitoring
   - deployment

10. Never invent a measurable result.

Do NOT create:

- percentages
- revenue
- user counts
- performance improvements
- transaction volumes
- time savings
- uptime percentages

unless explicitly present in verified evidence.

============================================================
EVIDENCE STRENGTH RULES
============================================================

Evidence marked "strong" should receive more prominence than
equally relevant evidence marked "moderate" or "weak".

However:

strength does NOT permit exaggeration.

Example:

Verified evidence:
{
  "name": "FastAPI",
  "strength": "strong"
}

Allowed:
"Built backend services using FastAPI."

Not allowed:
"Expert FastAPI engineer."

Do not convert evidence strength into unsupported seniority.

============================================================
REQUIREMENT MATCH RULES
============================================================

supported
=
may be clearly emphasized.

partial
=
may mention ONLY the supported portion.

unsupported
=
must never be presented as candidate capability.

Examples:

If JavaScript is supported but ES6 is not explicitly supported,
say:

"JavaScript"

not:

"JavaScript ES6"

If REST APIs are supported but microservices are not,
say:

"REST API development"

not:

"REST API and microservices architecture"

If React.js is supported but React Hooks are unsupported,
say:

"React.js"

not:

"React.js and React Hooks"

============================================================
NO VERSION UPGRADING
============================================================

Do not change:

HTML
to
HTML5

Do not change:

CSS
to
CSS3

Do not change:

JavaScript
to
JavaScript ES6

unless verified evidence explicitly supports those versions.

============================================================
PROFESSIONAL SUMMARY
============================================================

Maximum 90 words.

Aim for 3-4 concise sentences.

The summary should quickly communicate:

- candidate's professional/academic identity
- strongest job-relevant verified technologies
- strongest relevant experience or project scope
- type of contribution the candidate can make

Do not stuff every skill into the summary.

Prefer 4-7 strongest relevant capabilities.

============================================================
SKILLS
============================================================

Maximum 15.

Order by:

1. target-job relevance
2. evidence strength
3. usefulness to employer

Do not include irrelevant skills merely to fill space.

Use concise skill names.

============================================================
EXPERIENCE
============================================================

Maximum 5 records.

If verified professional/internship experience exists and is
relevant, include it.

Maximum 4 bullets per record.

Each bullet maximum approximately 25 words.

Prioritize bullets that show:

action
+
technical responsibility
+
verified technology
+
verified scope

Example structure:

"Developed backend API services using Python and FastAPI for ..."

Do not invent results.

============================================================
PROJECTS
============================================================

Maximum 5 projects.

Prefer projects most relevant to the target job.

Maximum 3 bullets each.

First bullet should ideally communicate:

what was built
+
most relevant verified technologies

Later bullets may emphasize:

- APIs
- authentication
- databases
- integrations
- automation
- UI
- deployment

only when verified.

Avoid vague bullets such as:

"Prepared deployment-ready architecture"

when stronger concrete evidence exists.

============================================================
EDUCATION
============================================================

Maximum 3 records.

Preserve completion status.

Do not convert:

"In View"
"Current"
"Present"
"Undergraduate"

into a completed degree.

============================================================
CERTIFICATIONS
============================================================

Maximum 5.

Preserve actual status.

Do not convert an in-progress certification into completed.

============================================================
ACHIEVEMENTS
============================================================

Maximum 5.

Only use explicitly verified achievements.

============================================================
CHANGES
============================================================

Maximum 8 short strings.

Describe meaningful tailoring decisions.

Examples:

"Prioritized FastAPI and Python experience for backend relevance."

"Moved TicketFlow ahead of less relevant projects."

Do not generate factual warnings here.

Factual warnings are handled centrally elsewhere.

${
  correction
    ? `
============================================================
VALIDATION CORRECTION
============================================================

A validator identified issues in the previous CV.

Feedback:

${JSON.stringify(correction)}

Fix the unsupported claims.

Remove unsupported claims rather than attempting to justify them.
`
    : ""
}

============================================================
RETURN EXACTLY
============================================================

{
  "professionalSummary": "",

  "skills": [
    {
      "name": "",
      "evidence": "",
      "priority": "high|medium|low"
    }
  ],

  "experience": [
    {
      "jobTitle": "",
      "company": "",
      "dates": "",
      "location": "",
      "bullets": []
    }
  ],

  "projects": [
    {
      "name": "",
      "dates": "",
      "bullets": []
    }
  ],

  "education": [
    {
      "qualification": "",
      "institution": "",
      "dates": "",
      "details": []
    }
  ],

  "certifications": [
    {
      "name": "",
      "issuer": "",
      "date": "",
      "details": ""
    }
  ],

  "achievements": [],

  "changes": []
}

Return valid JSON only.

Do not use markdown.

Do not add commentary outside the JSON.
`;
}

/*
 * ============================================================
 * GENERATION
 * ============================================================
 */

async function generateTailoredCV(
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

      buildCVPrompt(
        candidate,
        evidence,
        requirements,
        requirementMatch,
        job,
        applicationType,
        correction
      ),

      0.1,

      CV_SYSTEM,

      3000
    );

  const parsed =
    tryParseJSON(raw);

  const validation =
    validateCV(parsed);

  if (!validation.ok) {
    throw new Error(
      `CV generation validation failed: ${validation.reason}`
    );
  }

  return parsed;
}

module.exports = {
  generateTailoredCV,
  validateCV,
  buildCVPrompt,
  getPrioritizedMatches
};