require("dotenv").config();

const { readSheet } = require("./src/googleSheets");
const jsearch = require("./src/sources/jsearch");
const adzuna = require("./src/sources/adzuna");

async function main() {
  const candidates = await readSheet("Candidates");

  const candidate = candidates.find(
    (c) =>
      (c.candidateEmail || "").toLowerCase() ===
      "ayanbajomichael@gmail.com"
  );

  if (!candidate) {
    throw new Error("Candidate not found");
  }

  console.log("\n==============================");
  console.log("CANDIDATE");
  console.log("==============================");
  console.log({
    candidateEmail: candidate.candidateEmail,
    preferredJobTitle: candidate.preferredJobTitle,
    workModel: candidate.workModel,
    desiredLocation: candidate.desiredLocation,
    jobRecencyDays: candidate.jobRecencyDays,
    maxSearchPages: candidate.maxSearchPages
  });

  console.log("\n==============================");
  console.log("JSEARCH");
  console.log("==============================");

  const jsearchResult = await jsearch.fetchJobsForCandidate(candidate);

  console.log("Request count:", jsearchResult.requestCount);
  console.log("Jobs:", jsearchResult.jobs.length);
  console.log("Errors:", jsearchResult.errors);

  console.log("\n==============================");
  console.log("ADZUNA");
  console.log("==============================");

  const adzunaResult = await adzuna.fetchJobsForCandidate(candidate);

  console.log("Request count:", adzunaResult.requestCount);
  console.log("Jobs:", adzunaResult.jobs.length);
  console.log("Errors:", adzunaResult.errors);
}

main().catch((error) => {
  console.error("\nFATAL ERROR:");
  console.error(error);
  process.exit(1);
});