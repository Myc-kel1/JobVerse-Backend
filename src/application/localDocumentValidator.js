/*
 * ============================================================
 * LOCAL DOCUMENT VALIDATOR
 * ============================================================
 *
 * This validator does NOT ask another AI model to reinterpret
 * the candidate's qualifications.
 *
 * It checks generated output against the authoritative
 * verified-evidence + requirement-evaluation structures.
 */

/*
 * ============================================================
 * NORMALIZATION
 * ============================================================
 */

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#./ -]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value) {
  return String(value)
    .replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );
}

/*
 * ============================================================
 * VERIFIED SKILL SET
 * ============================================================
 */

function buildVerifiedSkillSet(evidence) {
  const result =
    new Set();

  for (
    const skill of
    evidence.skills || []
  ) {
    const name =
      normalize(skill.name);

    if (name) {
      result.add(name);
    }
  }

  return result;
}

/*
 * ============================================================
 * ALLOWED ALIASES
 * ============================================================
 */

function skillIsVerified(
  skillName,
  verifiedSkills
) {
  const value =
    normalize(skillName);

  if (!value) {
    return false;
  }

  if (
    verifiedSkills.has(value)
  ) {
    return true;
  }

  const aliases = {
    "react":
      ["react.js"],

    "react.js":
      ["react"],

    "postgres":
      ["postgresql"],

    "postgresql":
      ["postgres"],

    "rest api":
      ["rest apis"],

    "rest apis":
      ["rest api"]
  };

  for (
    const alias of
    aliases[value] || []
  ) {
    if (
      verifiedSkills.has(
        normalize(alias)
      )
    ) {
      return true;
    }
  }

  return false;
}

/*
 * ============================================================
 * RISKY UPGRADE PAIRS
 * ============================================================
 */

const UPGRADE_RULES = [
  {
    generated:
      "typescript",

    evidence:
      "typescript"
  },

  {
    generated:
      "javascript es6",

    evidence:
      "javascript es6"
  },

  {
    generated:
      "es6",

    evidence:
      "es6"
  },

  {
    generated:
      "html5",

    evidence:
      "html5"
  },

  {
    generated:
      "css3",

    evidence:
      "css3"
  },

  {
    generated:
      "react hooks",

    evidence:
      "react hooks"
  },

  {
    generated:
      "redux",

    evidence:
      "redux"
  },

  {
    generated:
      "microservices",

    evidence:
      "microservices"
  },

  {
    generated:
      "kubernetes",

    evidence:
      "kubernetes"
  },

  {
    generated:
      "aws",

    evidence:
      "aws"
  }
];

/*
 * ============================================================
 * UNSUPPORTED REQUIREMENT TERMS
 * ============================================================
 */

function buildUnsupportedTerms(
  evaluation
) {
  const terms =
    new Set();

  for (
    const item of
    evaluation.unsupportedRequirements ||
    []
  ) {
    const requirement =
      normalize(
        item.requirement
      );

    /*
     * Focus on concrete technical concepts.
     */
    for (
      const rule of
      UPGRADE_RULES
    ) {
      if (
        requirement.includes(
          normalize(
            rule.generated
          )
        )
      ) {
        terms.add(
          normalize(
            rule.generated
          )
        );
      }
    }
  }

  return terms;
}

/*
 * ============================================================
 * TEXT EXTRACTION
 * ============================================================
 */

function cvToText(cv) {
  return JSON.stringify(
    cv || {}
  );
}

function coverLetterToText(cover) {
  if (
    typeof cover === "string"
  ) {
    return cover;
  }

  return (
    cover?.coverLetter ||
    ""
  );
}

/*
 * ============================================================
 * TECH-UPGRADE CHECK
 * ============================================================
 */

function checkTechnologyUpgrades(
  text,
  evidence
) {
  const warnings = [];

  const normalizedText =
    normalize(text);

  const verifiedSkills =
    buildVerifiedSkillSet(
      evidence
    );

  for (
    const rule of
    UPGRADE_RULES
  ) {
    const generated =
      normalize(
        rule.generated
      );

    const requiredEvidence =
      normalize(
        rule.evidence
      );

    if (
      normalizedText.includes(
        generated
      ) &&
      !verifiedSkills.has(
        requiredEvidence
      )
    ) {
      warnings.push(
        `Generated document contains unverified technology/version: ${rule.generated}`
      );
    }
  }

  return warnings;
}

/*
 * ============================================================
 * CV SKILLS CHECK
 * ============================================================
 */

function validateCVSkills(
  cv,
  evidence
) {
  const warnings = [];

  const verifiedSkills =
    buildVerifiedSkillSet(
      evidence
    );

  for (
    const skill of
    cv.skills || []
  ) {
    const name =
      typeof skill === "string"
        ? skill
        : skill.name;

    if (
      name &&
      !skillIsVerified(
        name,
        verifiedSkills
      )
    ) {
      warnings.push(
        `CV contains skill not found in verified evidence: ${name}`
      );
    }
  }

  return warnings;
}

/*
 * ============================================================
 * EXPERIENCE IDENTITY CHECK
 * ============================================================
 */

function validateCVExperience(
  cv,
  evidence
) {
  const warnings = [];

  const verified =
    evidence.experience || [];

  for (
    const generated of
    cv.experience || []
  ) {
    const generatedTitle =
      normalize(
        generated.jobTitle
      );

    const generatedCompany =
      normalize(
        generated.company
      );

    const found =
      verified.some(
        (item) => {
          const title =
            normalize(
              item.title
            );

          const organization =
            normalize(
              item.organization
            );

          return (
            title ===
              generatedTitle &&
            organization ===
              generatedCompany
          );
        }
      );

    if (!found) {
      warnings.push(
        `CV contains unverified employment record: ${generated.jobTitle || ""} @ ${generated.company || ""}`
      );
    }
  }

  return warnings;
}

/*
 * ============================================================
 * PROJECT IDENTITY CHECK
 * ============================================================
 */

function validateCVProjects(
  cv,
  evidence
) {
  const warnings = [];

  const knownProjects =
    new Set(
      (
        evidence.projects ||
        []
      ).map(
        (item) =>
          normalize(
            item.name
          )
      )
    );

  for (
    const project of
    cv.projects || []
  ) {
    const name =
      normalize(
        project.name
      );

    if (
      name &&
      !knownProjects.has(name)
    ) {
      warnings.push(
        `CV contains project not found in verified evidence: ${project.name}`
      );
    }
  }

  return warnings;
}

/*
 * ============================================================
 * EDUCATION CHECK
 * ============================================================
 */

function validateCVEducation(
  cv,
  evidence
) {
  const warnings = [];

  const source =
    evidence.education || [];

  for (
    const generated of
    cv.education || []
  ) {
    const institution =
      normalize(
        generated.institution
      );

    const found =
      source.some(
        (item) =>
          normalize(
            item.institution
          ) === institution
      );

    if (!found) {
      warnings.push(
        `CV contains unverified education institution: ${generated.institution || ""}`
      );
    }
  }

  return warnings;
}

/*
 * ============================================================
 * NUMERICAL CLAIM CHECK
 * ============================================================
 *
 * Prevent common invented impact metrics.
 */

function findSuspiciousMetrics(
  text
) {
  const warnings = [];

  const patterns = [
    /\b\d+(?:\.\d+)?%\b/g,

    /\b\d+\s*(?:users|customers|clients|transactions|requests|sales)\b/gi,

    /\b(?:increased|improved|reduced|decreased|boosted|grew|saved)\b[^.!?\n]{0,50}\b\d+(?:\.\d+)?%/gi
  ];

  for (
    const pattern of
    patterns
  ) {
    const matches =
      String(text || "")
        .match(pattern);

    if (matches) {
      for (
        const match of
        matches
      ) {
        warnings.push(
          `Generated document contains metric requiring source verification: ${match}`
        );
      }
    }
  }

  return warnings;
}

/*
 * ============================================================
 * DEDUPLICATION
 * ============================================================
 */

function uniqueWarnings(
  warnings
) {
  return [
    ...new Set(
      warnings.filter(Boolean)
    )
  ];
}

/*
 * ============================================================
 * CV VALIDATOR
 * ============================================================
 */

function validateGeneratedCV(
  cv,
  evidence,
  evaluation
) {
  const text =
    cvToText(cv);

  const warnings =
    uniqueWarnings([
      ...validateCVSkills(
        cv,
        evidence
      ),

      ...validateCVExperience(
        cv,
        evidence
      ),

      ...validateCVProjects(
        cv,
        evidence
      ),

      ...validateCVEducation(
        cv,
        evidence
      ),

      ...checkTechnologyUpgrades(
        text,
        evidence
      ),

      ...findSuspiciousMetrics(
        text
      )
    ]);

  return {
    valid:
      warnings.length === 0,

    unsupportedClaims:
      warnings
  };
}

/*
 * ============================================================
 * COVER-LETTER VALIDATOR
 * ============================================================
 */

function validateGeneratedCoverLetter(
  cover,
  evidence,
  evaluation
) {
  const text =
    coverLetterToText(
      cover
    );

  const warnings =
    uniqueWarnings([
      ...checkTechnologyUpgrades(
        text,
        evidence
      ),

      ...findSuspiciousMetrics(
        text
      )
    ]);

  return {
    valid:
      warnings.length === 0,

    unsupportedClaims:
      warnings
  };
}

module.exports = {
  normalize,
  buildVerifiedSkillSet,
  skillIsVerified,
  validateGeneratedCV,
  validateGeneratedCoverLetter,
  findSuspiciousMetrics,
  checkTechnologyUpgrades
};