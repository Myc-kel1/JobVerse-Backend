require("dotenv").config();

const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

const GEMINI_MODEL =
  process.env.GEMINI_MODEL ||
  "gemini-3.8-flash";

/*
 * ============================================================
 * JOB SCORING SCHEMA
 * ============================================================
 */

const SCORE_SCHEMA = {
  type: "object",

  properties: {
    titleMatch: {
      type: "number"
    },

    skillMatch: {
      type: "number"
    },

    experienceMatch: {
      type: "number"
    },

    workModelMatch: {
      type: "number"
    },

    locationMatch: {
      type: "number"
    },

    jobTypeMatch: {
      type: "number"
    },

    salaryMatch: {
      type: "number"
    },

    recencyScore: {
      type: "number"
    },

    overallScore: {
      type: "number"
    },

    excluded: {
      type: "boolean"
    },

    exclusionReason: {
      type: "string"
    },

    matchedSkills: {
      type: "array",
      items: {
        type: "string"
      }
    },

    missingSkills: {
      type: "array",
      items: {
        type: "string"
      }
    },

    rationale: {
      type: "string"
    }
  },

  required: [
    "titleMatch",
    "skillMatch",
    "experienceMatch",
    "workModelMatch",
    "locationMatch",
    "jobTypeMatch",
    "salaryMatch",
    "recencyScore",
    "overallScore",
    "excluded",
    "exclusionReason",
    "matchedSkills",
    "missingSkills",
    "rationale"
  ]
};

/*
 * ============================================================
 * JOB SCORING PROMPT
 * ============================================================
 */

function buildPrompt(job, candidate) {
  return `
You are JobVerse's job-matching scoring engine.

Evaluate how well the CANDIDATE matches the JOB using ONLY
the supplied information.

STRICT RULES

- Read the complete job description.
- Extract important requirements directly from the description.
- Never invent candidate experience.
- Never invent candidate skills.
- Never invent certifications.
- Never invent employers.
- Never invent education.
- Never invent salary.
- Unknown information should not automatically receive zero.
- Explicit candidate exclusions override the score.

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
  Array.isArray(candidate.preferredSkills)
    ? candidate.preferredSkills.join(", ")
    : candidate.preferredSkills || ""
}

Salary Range:
${candidate.salaryRangeMin || ""} - ${
    candidate.salaryRangeMax || ""
  }

Excluded Titles:
${
  Array.isArray(candidate.excludedTitles)
    ? candidate.excludedTitles.join(", ")
    : candidate.excludedTitles || ""
}

Excluded Keywords:
${
  Array.isArray(candidate.excludedKeywords)
    ? candidate.excludedKeywords.join(", ")
    : candidate.excludedKeywords || ""
}

Exclusion Rules:
${
  Array.isArray(candidate.exclusionRules)
    ? candidate.exclusionRules.join(", ")
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
   - Match genuine semantic equivalents.
   - Do not invent skills.
   - Put supported skills in matchedSkills.
   - Put important unsupported skills in missingSkills.

4. Experience:
   - Use explicit supplied experience.
   - Unknown information receives a neutral treatment.
   - Do not invent years of experience.

5. Work model:
   - Remote, hybrid and onsite are distinct.

6. Location:
   - Respect explicit geographic restrictions.

7. Salary:
   - Compare only when reliable salary data exists.

8. Exclusion rules:
   - Explicit candidate exclusions override scoring.

Return scores from 0 to 10.

Return JSON only.
`;
}

/*
 * ============================================================
 * JOB SCORING VALIDATION
 * ============================================================
 */

function validateOutput(result) {
  if (
    !result ||
    typeof result !== "object"
  ) {
    return false;
  }

  const numericFields = [
    "titleMatch",
    "skillMatch",
    "experienceMatch",
    "workModelMatch",
    "locationMatch",
    "jobTypeMatch",
    "salaryMatch",
    "recencyScore",
    "overallScore"
  ];

  for (const field of numericFields) {
    if (
      typeof result[field] !== "number" ||
      result[field] < 0 ||
      result[field] > 10
    ) {
      return false;
    }
  }

  if (
    typeof result.excluded !== "boolean"
  ) {
    return false;
  }

  if (
    !Array.isArray(result.matchedSkills)
  ) {
    return false;
  }

  if (
    !Array.isArray(result.missingSkills)
  ) {
    return false;
  }

  if (
    typeof result.exclusionReason !== "string"
  ) {
    return false;
  }

  if (
    typeof result.rationale !== "string"
  ) {
    return false;
  }

  return true;
}

/*
 * ============================================================
 * GEMINI JOB SCORING
 * ============================================================
 */

async function scoreJobWithGemini(
  job,
  candidate
) {
  const prompt =
    buildPrompt(job, candidate);

  const maxAttempts = 3;

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt++
  ) {
    try {
      console.log(
        `Gemini attempt ${attempt}/${maxAttempts} for ${
          job.jobId ||
          job.title ||
          "unknown job"
        }`
      );

      const response =
        await ai.models.generateContent({
          model: GEMINI_MODEL,

          contents: prompt,

          config: {
            responseMimeType:
              "application/json",

            responseSchema:
              SCORE_SCHEMA
          }
        });

      const rawText =
        response.text;

      if (!rawText) {
        throw new Error(
          "Gemini returned an empty response"
        );
      }

      let parsed;

      try {
        parsed =
          JSON.parse(rawText);
      } catch (error) {
        throw new Error(
          `Gemini returned invalid JSON: ${error.message}`
        );
      }

      if (!validateOutput(parsed)) {
        throw new Error(
          "Gemini returned invalid scoring structure"
        );
      }

      return {
        ...job,
        ...parsed,

        aiParseSuccess: true,

        aiProvider: "gemini",

        aiModel: GEMINI_MODEL
      };
    } catch (error) {
      const message =
        error.message ||
        String(error);

      console.error(
        `Gemini attempt ${attempt} failed:`,
        message
      );

      if (attempt < maxAttempts) {
        const delay =
          attempt * 3000;

        await new Promise(
          (resolve) =>
            setTimeout(
              resolve,
              delay
            )
        );
      } else {
        return {
          ...job,

          aiParseSuccess: false,

          aiProvider: "gemini",

          aiModel: GEMINI_MODEL,

          aiParseError: message
        };
      }
    }
  }
}

/*
 * ============================================================
 * VERIFIED EVIDENCE SCHEMA
 * ============================================================
 */

const EVIDENCE_SCHEMA = {
  type: "object",

  properties: {
    summary: {
      type: "string"
    },

    skills: {
      type: "array",

      items: {
        type: "object",

        properties: {
          name: {
            type: "string"
          },

          evidence: {
            type: "string"
          },

          strength: {
            type: "string"
          }
        },

        required: [
          "name",
          "evidence",
          "strength"
        ]
      }
    },

    experience: {
      type: "array",

      items: {
        type: "object",

        properties: {
          title: {
            type: "string"
          },

          organization: {
            type: "string"
          },

          dates: {
            type: "string"
          },

          responsibilities: {
            type: "array",
            items: {
              type: "string"
            }
          },

          technologies: {
            type: "array",
            items: {
              type: "string"
            }
          },

          evidence: {
            type: "string"
          },

          strength: {
            type: "string"
          }
        },

        required: [
          "title",
          "organization",
          "dates",
          "responsibilities",
          "technologies",
          "evidence",
          "strength"
        ]
      }
    },

    projects: {
      type: "array",

      items: {
        type: "object",

        properties: {
          name: {
            type: "string"
          },

          description: {
            type: "string"
          },

          technologies: {
            type: "array",
            items: {
              type: "string"
            }
          },

          highlights: {
            type: "array",
            items: {
              type: "string"
            }
          },

          evidence: {
            type: "string"
          },

          strength: {
            type: "string"
          }
        },

        required: [
          "name",
          "description",
          "technologies",
          "highlights",
          "evidence",
          "strength"
        ]
      }
    },

    education: {
      type: "array",

      items: {
        type: "object",

        properties: {
          degree: {
            type: "string"
          },

          institution: {
            type: "string"
          },

          dates: {
            type: "string"
          },

          status: {
            type: "string"
          },

          evidence: {
            type: "string"
          },

          strength: {
            type: "string"
          }
        },

        required: [
          "degree",
          "institution",
          "dates",
          "status",
          "evidence",
          "strength"
        ]
      }
    },

    certifications: {
      type: "array",

      items: {
        type: "object",

        properties: {
          name: {
            type: "string"
          },

          issuer: {
            type: "string"
          },

          status: {
            type: "string"
          },

          evidence: {
            type: "string"
          },

          strength: {
            type: "string"
          }
        },

        required: [
          "name",
          "issuer",
          "status",
          "evidence",
          "strength"
        ]
      }
    },

    achievements: {
      type: "array",

      items: {
        type: "object",

        properties: {
          name: {
            type: "string"
          },

          evidence: {
            type: "string"
          },

          strength: {
            type: "string"
          }
        },

        required: [
          "name",
          "evidence",
          "strength"
        ]
      }
    },

    jobTitles: {
      type: "array",

      items: {
        type: "object",

        properties: {
          title: {
            type: "string"
          },

          evidence: {
            type: "string"
          }
        },

        required: [
          "title",
          "evidence"
        ]
      }
    },

    industries: {
      type: "array",

      items: {
        type: "object",

        properties: {
          name: {
            type: "string"
          },

          evidence: {
            type: "string"
          }
        },

        required: [
          "name",
          "evidence"
        ]
      }
    }
  },

  required: [
    "summary",
    "skills",
    "experience",
    "projects",
    "education",
    "certifications",
    "achievements",
    "jobTitles",
    "industries"
  ]
};

/*
 * ============================================================
 * EVIDENCE PROMPT
 * ============================================================
 */

function buildEvidencePrompt(
  candidate
) {
  return `
You are JobVerse's VERIFIED CANDIDATE EVIDENCE extraction engine.

Your task is to produce a factual evidence record from the
candidate's MASTER CV and MASTER COVER LETTER.

This evidence will later be used to decide whether the candidate
actually satisfies employer requirements.

Your task is NOT to make the candidate sound better.

Your task is to capture the strongest TRUE evidence already
present in the source.

============================================================
SOURCE PRIORITY
============================================================

The MASTER CV and MASTER COVER LETTER are factual sources.

Candidate preferences are NOT evidence.

Preferred Job Title:
${candidate.preferredJobTitle || ""}

Preferred Skills:
${
  Array.isArray(candidate.preferredSkills)
    ? candidate.preferredSkills.join(", ")
    : candidate.preferredSkills || ""
}

Job Type Preference:
${candidate.jobType || ""}

Work Model Preference:
${candidate.workModel || ""}

Desired Location:
${candidate.desiredLocation || ""}

============================================================
MASTER CV
============================================================

${candidate.masterCVText || ""}

============================================================
MASTER COVER LETTER
============================================================

${candidate.masterCoverLetterText || ""}

============================================================
STRICT FACTUAL RULES
============================================================

1. Never invent information.

2. Never treat preferred skills as proof of experience.

3. Never infer years of experience.

4. Never convert an ongoing degree into a completed degree.

5. Never convert an unfinished certification into a completed certification.

6. Never create employers.

7. Never create employment dates.

8. Never create technologies.

9. Never create metrics or numerical achievements.

10. Never convert a personal project into professional employment.

11. Never infer TypeScript from JavaScript.

12. Never infer JavaScript ES6 from generic JavaScript.

13. Never infer HTML5 from HTML.

14. Never infer CSS3 from CSS.

15. Never infer React Hooks from React.

16. Never infer Redux from React.

17. Never infer microservices from REST APIs.

18. Never infer AWS from deployment.

19. Never infer Kubernetes from Docker.

============================================================
EXPERIENCE EXTRACTION
============================================================

Employment and internship experience is extremely important.

Carefully inspect the ENTIRE source for:

- internships
- employment
- company work
- contract work
- professional roles
- volunteer technical roles
- company projects completed as part of employment

If the candidate explicitly worked at a company, extract it into
the experience array.

Do NOT omit an experience simply because it was an internship.

Examples of valid experience titles include:

- Backend Intern
- Software Engineering Intern
- Backend Developer
- Full Stack Developer
- Automation Engineer

Only use a title when explicitly supported by the source.

For each experience record:

- preserve organization
- preserve role/title
- preserve dates if available
- extract explicit responsibilities
- extract explicitly used technologies
- preserve concise source evidence

============================================================
SKILL EXTRACTION
============================================================

Extract every clearly supported professional/technical skill.

Inspect:

- Skills sections
- Work experience
- Internships
- Project descriptions
- Technology stacks
- Responsibilities
- Cover-letter descriptions

If a technology is explicitly used in a project or professional
experience, it may also appear in skills.

Examples:

If source says:

"Built backend services using Python and FastAPI"

then extract:

Python
FastAPI

If source says:

"Developed REST APIs"

then REST APIs may be extracted.

If source says only:

"JavaScript"

do NOT change it to:

"JavaScript ES6"

============================================================
PROJECT EXTRACTION
============================================================

Preserve strong project evidence.

For each project extract:

- project name
- concise description
- technologies explicitly used
- important factual highlights
- concise supporting evidence

Highlights should describe real scope such as:

- authentication
- payment integration
- REST API development
- database integration
- event management
- automation
- notifications
- deployment

only when explicitly supported.

Do not invent business impact.

============================================================
EVIDENCE STRENGTH
============================================================

Every skill, project, experience, education, certification and
achievement gets:

strength:
"strong" | "moderate" | "weak"

This is NOT a judgment of how impressive the person is.

It measures how much explicit supporting evidence exists.

Use:

strong
=
multiple explicit supporting facts,
or explicit hands-on usage with substantial project/work evidence.

moderate
=
clearly stated and supported by at least one meaningful source fact.

weak
=
explicitly stated, but very little contextual evidence exists.

Never label unsupported information as weak.
Unsupported information should simply be omitted.

============================================================
OUTPUT LIMITS
============================================================

Maximum:

30 skills
8 experience records
10 projects
5 education records
10 certifications
10 achievements
8 job titles
8 industries

Keep evidence concise.

============================================================
RETURN EXACTLY
============================================================

{
  "summary": "",

  "skills": [
    {
      "name": "",
      "evidence": "",
      "strength": "strong|moderate|weak"
    }
  ],

  "experience": [
    {
      "title": "",
      "organization": "",
      "dates": "",
      "responsibilities": [],
      "technologies": [],
      "evidence": "",
      "strength": "strong|moderate|weak"
    }
  ],

  "projects": [
    {
      "name": "",
      "description": "",
      "technologies": [],
      "highlights": [],
      "evidence": "",
      "strength": "strong|moderate|weak"
    }
  ],

  "education": [
    {
      "degree": "",
      "institution": "",
      "dates": "",
      "status": "",
      "evidence": "",
      "strength": "strong|moderate|weak"
    }
  ],

  "certifications": [
    {
      "name": "",
      "issuer": "",
      "status": "",
      "evidence": "",
      "strength": "strong|moderate|weak"
    }
  ],

  "achievements": [
    {
      "name": "",
      "evidence": "",
      "strength": "strong|moderate|weak"
    }
  ],

  "jobTitles": [
    {
      "title": "",
      "evidence": ""
    }
  ],

  "industries": [
    {
      "name": "",
      "evidence": ""
    }
  ]
}

Return JSON only.
`;
}

/*
 * ============================================================
 * VALIDATION HELPERS
 * ============================================================
 */

const VALID_STRENGTHS =
  new Set([
    "strong",
    "moderate",
    "weak"
  ]);

function validateStrength(
  value
) {
  return VALID_STRENGTHS.has(
    String(value || "")
      .toLowerCase()
  );
}

function validateEvidenceObject(
  parsed
) {
  if (
    !parsed ||
    typeof parsed !== "object"
  ) {
    return {
      ok: false,
      reason:
        "Evidence result is not an object"
    };
  }

  const arrays = [
    "skills",
    "experience",
    "projects",
    "education",
    "certifications",
    "achievements",
    "jobTitles",
    "industries"
  ];

  for (const field of arrays) {
    if (!Array.isArray(parsed[field])) {
      return {
        ok: false,
        reason:
          `Evidence field "${field}" must be an array`
      };
    }
  }

  if (
    typeof parsed.summary !== "string"
  ) {
    return {
      ok: false,
      reason:
        "summary must be a string"
    };
  }

  for (const skill of parsed.skills) {
    if (
      !skill ||
      typeof skill !== "object" ||
      typeof skill.name !== "string" ||
      typeof skill.evidence !== "string" ||
      !validateStrength(skill.strength)
    ) {
      return {
        ok: false,
        reason:
          "Invalid skill evidence object"
      };
    }
  }

  for (
    const item of parsed.experience
  ) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.title !== "string" ||
      typeof item.organization !== "string" ||
      typeof item.dates !== "string" ||
      !Array.isArray(item.responsibilities) ||
      !Array.isArray(item.technologies) ||
      typeof item.evidence !== "string" ||
      !validateStrength(item.strength)
    ) {
      return {
        ok: false,
        reason:
          "Invalid experience evidence object"
      };
    }
  }

  for (
    const project of parsed.projects
  ) {
    if (
      !project ||
      typeof project !== "object" ||
      typeof project.name !== "string" ||
      typeof project.description !== "string" ||
      !Array.isArray(project.technologies) ||
      !Array.isArray(project.highlights) ||
      typeof project.evidence !== "string" ||
      !validateStrength(project.strength)
    ) {
      return {
        ok: false,
        reason:
          "Invalid project evidence object"
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
 * SKILL NORMALIZATION
 * ============================================================
 */

function canonicalizeSkillName(
  value
) {
  const original =
    String(value || "").trim();

  const key =
    original.toLowerCase();

  /*
   * Only normalize variants that do NOT alter
   * the factual meaning.
   *
   * Notice that HTML is NOT converted to HTML5,
   * CSS is NOT converted to CSS3,
   * JavaScript is NOT converted to ES6.
   */

  const aliases = {
    "rest api": "REST APIs",
    "rest apis": "REST APIs",
    "restful api": "REST APIs",
    "restful apis": "REST APIs",

    "reactjs": "React.js",
    "react.js": "React.js",

    "postgres": "PostgreSQL",
    "postgresql": "PostgreSQL",

    "fast api": "FastAPI",
    "fastapi": "FastAPI"
  };

  return (
    aliases[key] ||
    original
  );
}

function strengthRank(
  value
) {
  switch (
    String(value || "")
      .toLowerCase()
  ) {
    case "strong":
      return 3;

    case "moderate":
      return 2;

    case "weak":
      return 1;

    default:
      return 0;
  }
}

/*
 * ============================================================
 * EVIDENCE NORMALIZATION
 * ============================================================
 */

function normalizeEvidence(
  evidence
) {
  const skillMap =
    new Map();

  function addSkill({
    name,
    evidence: supportingEvidence,
    strength = "moderate"
  }) {
    const cleanName =
      canonicalizeSkillName(name);

    if (!cleanName) {
      return;
    }

    const key =
      cleanName.toLowerCase();

    const current =
      skillMap.get(key);

    const next = {
      name: cleanName,

      evidence:
        String(
          supportingEvidence ||
          ""
        ).trim(),

      strength:
        validateStrength(strength)
          ? String(strength).toLowerCase()
          : "moderate"
    };

    if (!current) {
      skillMap.set(
        key,
        next
      );

      return;
    }

    /*
     * Preserve stronger evidence if the same
     * skill appears more than once.
     */
    if (
      strengthRank(next.strength) >
      strengthRank(current.strength)
    ) {
      skillMap.set(
        key,
        next
      );
    }
  }

  /*
   * Directly extracted skills.
   */
  for (
    const skill of
    evidence.skills || []
  ) {
    addSkill(skill);
  }

  /*
   * Technologies explicitly extracted from projects
   * are also valid skill evidence.
   */
  for (
    const project of
    evidence.projects || []
  ) {
    for (
      const technology of
      project.technologies || []
    ) {
      addSkill({
        name: technology,

        evidence:
          project.evidence ||
          project.description ||
          `Used in project ${project.name || ""}`,

        strength:
          project.strength ||
          "moderate"
      });
    }
  }

  /*
   * Technologies explicitly extracted from
   * professional experience are also valid.
   */
  for (
    const experience of
    evidence.experience || []
  ) {
    for (
      const technology of
      experience.technologies || []
    ) {
      addSkill({
        name: technology,

        evidence:
          experience.evidence ||
          `Used during ${experience.title || "professional experience"}`,

        strength:
          experience.strength ||
          "moderate"
      });
    }
  }

  return {
    ...evidence,

    skills:
      Array.from(
        skillMap.values()
      )
  };
}

/*
 * ============================================================
 * GEMINI CANDIDATE EVIDENCE EXTRACTION
 * ============================================================
 */

async function extractCandidateEvidenceWithGemini(
  candidate
) {
  if (
    !candidate.masterCVText &&
    !candidate.masterCoverLetterText
  ) {
    throw new Error(
      "Candidate has no source text for Gemini evidence extraction"
    );
  }

  const prompt =
    buildEvidencePrompt(candidate);

  const maxAttempts = 3;

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt++
  ) {
    try {
      console.log(
        `Gemini evidence extraction attempt ${attempt}/${maxAttempts}`
      );

      const response =
        await ai.models.generateContent({
          model:
            GEMINI_MODEL,

          contents:
            prompt,

          config: {
            responseMimeType:
              "application/json",

            responseSchema:
              EVIDENCE_SCHEMA
          }
        });

      const rawText =
        response.text;

      if (!rawText) {
        throw new Error(
          "Gemini returned an empty evidence response"
        );
      }

      let parsed;

      try {
        parsed =
          JSON.parse(rawText);
      } catch (error) {
        throw new Error(
          `Gemini returned invalid evidence JSON: ${error.message}`
        );
      }

      const validation =
        validateEvidenceObject(
          parsed
        );

      if (!validation.ok) {
        throw new Error(
          validation.reason
        );
      }

      const normalized =
        normalizeEvidence(
          parsed
        );

      console.log(
        `[Gemini evidence] skills=${normalized.skills.length}, ` +
        `experience=${normalized.experience.length}, ` +
        `projects=${normalized.projects.length}, ` +
        `education=${normalized.education.length}, ` +
        `certifications=${normalized.certifications.length}`
      );

      console.log(
        "[Gemini evidence] Verified skills:",
        normalized.skills.map(
          (skill) =>
            `${skill.name} (${skill.strength})`
        )
      );

      console.log(
        "[Gemini evidence] Verified experience:",
        normalized.experience.map(
          (item) =>
            `${item.title} @ ${item.organization}`
        )
      );

      return normalized;
    } catch (error) {
      const message =
        error.message ||
        String(error);

      console.error(
        `Gemini evidence extraction attempt ${attempt} failed:`,
        message
      );

      if (
        attempt <
        maxAttempts
      ) {
        const delay =
          attempt *
          2000;

        await new Promise(
          (resolve) =>
            setTimeout(
              resolve,
              delay
            )
        );
      } else {
        throw new Error(
          `Gemini candidate evidence extraction failed: ${message}`
        );
      }
    }
  }
}

/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  scoreJobWithGemini,
  extractCandidateEvidenceWithGemini,
  buildEvidencePrompt,
  validateEvidenceObject,
  normalizeEvidence,
  canonicalizeSkillName
};