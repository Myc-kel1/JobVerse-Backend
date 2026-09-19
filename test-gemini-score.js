require("dotenv").config();

const { scoreJobWithGemini } = require("./src/gemini");

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
    "PostgreSQL",
  ],

  exclusionRules: [],
  excludedTitles: [],
  excludedKeywords: [],

  salaryRangeMin: "",
  salaryRangeMax: "",
};

const job = {
  jobId: "gemini-test-001",

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
`,
};

async function main() {
  console.log("Testing Gemini JobVerse scoring...\n");

  const result = await scoreJobWithGemini(
    job,
    candidate
  );

  console.log(
    JSON.stringify(result, null, 2)
  );
}

main();