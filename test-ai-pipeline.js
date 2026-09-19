require("dotenv").config();

const {
  scoreAllJobsWithFallback
} = require("./src/aiScorer");

const candidate = {
  candidateName: "Test Candidate",
  candidateEmail: "test@example.com",

  preferredJobTitle: "Software Engineer",

  jobType: "Full-time",

  workModel: "Remote",

  desiredLocation: "Nigeria",

  preferredSkills: [
    "Python",
    "FastAPI",
    "REST APIs",
    "PostgreSQL"
  ],

  exclusionRules: [],

  excludedTitles: [],

  excludedKeywords: [],

  salaryRangeMin: "",

  salaryRangeMax: "",

  minimumMatchScore: 6
};

const jobs = [
  {
    jobId: "pipeline-test-001",

    title: "Python Backend Developer",

    company: "Example Company",

    location: "Remote",

    workModel: "Remote",

    jobType: "Full-time",

    salary: "",

    postedDate: new Date().toISOString(),

    description: `
We are looking for a Python Backend Developer.

Requirements:
- Python
- FastAPI
- REST API development
- PostgreSQL
- Backend development experience
- Git

The position is fully remote and full-time.
`
  }
];

async function main() {
  console.log(
    "Testing JobVerse production AI scoring path...\n"
  );

  console.log(
    "Jobs being scored:",
    jobs.length
  );

  try {
    const results =
      await scoreAllJobsWithFallback(
        candidate,
        jobs
      );

    console.log(
      "\nRESULTS:"
    );

    console.log(
      JSON.stringify(
        results,
        null,
        2
      )
    );

    const result = results[0];

    console.log(
      "\n--- PIPELINE VERIFICATION ---"
    );

    console.log(
      "Job ID:",
      result.jobId
    );

    console.log(
      "Provider:",
      result.aiProvider
    );

    console.log(
      "Model:",
      result.aiModel
    );

    console.log(
      "Fallback used:",
      result.fallbackUsed || false
    );

    console.log(
      "Success:",
      result.aiParseSuccess
    );

    console.log(
      "Overall score:",
      result.overallScore
    );

    if (
      result.aiParseSuccess === true &&
      result.jobId ===
        "pipeline-test-001"
    ) {
      console.log(
        "\n✅ AI PIPELINE TEST PASSED"
      );

      console.log(
        "The production scoring path is working."
      );
    } else {
      console.log(
        "\n❌ AI PIPELINE TEST FAILED"
      );

      process.exitCode = 1;
    }
  } catch (error) {
    console.error(
      "\nAI pipeline test crashed:"
    );

    console.error(error);

    process.exitCode = 1;
  }
}

main();

