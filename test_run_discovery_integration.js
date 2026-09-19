const path = require("path");
const Module = require("module");

// Lightweight manual mocking: pre-populate Node's require cache for the
// three source modules, the AI scorer, and Google Sheets, so this test
// exercises the REAL merge/validate/dedupe/filter pipeline in
// runDiscovery.js end-to-end, without making any real network calls.

function mockModule(relativePath, exportsObj) {
  const fullPath = require.resolve(relativePath);
  require.cache[fullPath] = {
    id: fullPath,
    filename: fullPath,
    loaded: true,
    exports: exportsObj
  };
}

const savedRows = [];

mockModule("./src/sources/jsearch", {
  fetchJobsForCandidate: async () => ({
    jobs: [
      { jobId: null, title: "Backend Engineer", company: "Acme", location: "Remote", url: "https://acme.com/j1", jobType: "Full-time", workModel: "Remote", postedDate: new Date().toISOString(), shortDescription: "Great Java role", sourceName: "RapidAPI - JSearch" }
    ],
    errors: [],
    requestCount: 3
  })
});

mockModule("./src/sources/adzuna", {
  fetchJobsForCandidate: async () => ({
    jobs: [
      { jobId: null, title: "Backend Developer", company: "Beta Co", location: "London", url: "https://adzuna.com/j2", jobType: "Full-time", workModel: null, postedDate: new Date().toISOString(), shortDescription: "Another role", sourceName: "Adzuna" },
      { jobId: null, title: "Sales Representative", company: "Gamma", location: "Remote", url: "https://adzuna.com/j3", jobType: "Full-time", workModel: "Remote", postedDate: new Date().toISOString(), shortDescription: "Sales role", sourceName: "Adzuna" } // should be hard-filtered out
    ],
    errors: [],
    requestCount: 2
  })
});

mockModule("./src/sources/remotive", {
  fetchJobsForCandidate: async () => {
    throw new Error("Simulated Remotive outage");
  }
});

mockModule("./src/groq", {
  scoreAllJobs: async (candidate, jobs) =>
    jobs.map((j) => ({
      ...j,
      overallScore: 8,
      titleMatch: 8, skillMatch: 8, experienceMatch: 8, workModelMatch: 8,
      locationMatch: 8, jobTypeMatch: 8, salaryMatch: 8, recencyScore: 8,
      excluded: false, matchedSkills: ["Java"], missingSkills: [], rationale: "Good fit",
      aiParseSuccess: true
    }))
});

mockModule("./src/googleSheets", {
  readSheet: async (tab) => (tab === "Shortlisted Jobs" ? [] : []),
  upsertRows: async (tab, rows) => {
    savedRows.push(...rows);
  },
  appendRows: async () => {}
});

async function run() {
  const { runDiscoveryForCandidate } = require("./src/runDiscovery");

  const candidate = {
    candidateEmail: "test@example.com",
    candidateName: "Test Candidate",
    preferredJobTitle: "Backend Engineer",
    searchKeywords: "Java, Spring",
    jobType: "Full-time",
    workModel: "Remote",
    excludedTitles: "Sales Representative, Sales Manager",
    excludedKeywords: "",
    jobRecencyDays: 7,
    minimumMatchScore: 7,
    maxResults: 10,
    maxSearchPages: 2
  };

  const summary = await runDiscoveryForCandidate(candidate);
  console.log("Summary:", JSON.stringify(summary, null, 2));

  if (summary.jobsBySource.jsearch !== 1) throw new Error("FAILED: expected 1 job from jsearch");
  if (summary.jobsBySource.adzuna !== 2) throw new Error("FAILED: expected 2 jobs from adzuna");
  if (summary.jobsBySource.remotive !== 0) throw new Error("FAILED: expected 0 jobs from remotive (it threw)");
  if (summary.fetchErrors !== 1) throw new Error("FAILED: expected exactly 1 fetch error (the Remotive outage)");
  if (summary.totalJobsFound !== 3) throw new Error("FAILED: expected 3 total jobs merged (1 jsearch + 2 adzuna)");
  if (summary.hardRejectedJobs !== 1) throw new Error("FAILED: expected 1 hard-rejected job (Sales Representative)");
  if (summary.qualifiedJobs !== 2) throw new Error("FAILED: expected 2 qualified jobs to survive to scoring/save");

  console.log("Saved rows:", savedRows.map((r) => r.title));
  if (savedRows.length !== 2) throw new Error("FAILED: expected exactly 2 rows saved to Shortlisted Jobs");
  if (savedRows.some((r) => r.title === "Sales Representative")) throw new Error("FAILED: hard-rejected job was saved!");

  console.log("\nAll runDiscovery multi-source integration assertions passed.");
}

run().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
