require("dotenv").config();

const groq = require("./src/groq");

// Temporarily replace Groq's scoreJob with a simulated failure.
// This affects ONLY this test process.
const originalScoreJob = groq.scoreJob;

groq.scoreJob = async () => {
  console.log("\n[TEST] Simulating Groq failure...");
  return {
    aiParseSuccess: false,
    aiProvider: "groq",
    aiModel: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
    aiParseError: "SIMULATED_GROQ_FAILURE"
  };
};

const {
  scoreJobWithFallback
} = require("./src/aiScorer");

const candidate = {
  candidateName: "Test Candidate",
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
  salaryRangeMax: ""
};

const job = {
  jobId: "fallback-test-001",
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
};

async function main() {
  console.log("Testing JobVerse AI fallback...");
  console.log("Groq will be simulated as FAILED.\n");

  try {
    const result = await scoreJobWithFallback(candidate, job);

    console.log("\nFINAL RESULT:");
    console.log(JSON.stringify(result, null, 2));

    console.log("\n--- FALLBACK VERIFICATION ---");
    console.log("Provider:", result.aiProvider);
    console.log("Model:", result.aiModel);
    console.log("Fallback used:", result.fallbackUsed || false);
    console.log("Fallback reason:", result.fallbackReason || "None");
    console.log("Success:", result.aiParseSuccess);

    if (
      result.aiParseSuccess === true &&
      result.aiProvider === "gemini" &&
      result.fallbackUsed === true
    ) {
      console.log("\n✅ FALLBACK TEST PASSED");
      console.log("Groq failed → Gemini successfully took over.");
    } else {
      console.log("\n❌ FALLBACK TEST FAILED");
      process.exitCode = 1;
    }
  } catch (error) {
    console.error("\nFallback test crashed:");
    console.error(error);
    process.exitCode = 1;
  } finally {
    // Restore the original function before the process exits.
    groq.scoreJob = originalScoreJob;
  }
}

main();

