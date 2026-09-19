const { mapFormResponse } = require("./src/syncCandidateIntake");

const sampleRow = {
  "Timestamp": "2026-09-08 10:00:00",
  "Email Address": "jane.doe@example.com",
  "Full Name": "Jane Doe",
  "Preferred Job Title": "Senior Java Developer",
  "Job Type": "Full-time",
  "Work Model": "Remote",
  "Minimum Salary": "60000",
  "Maximum Salary": "90000",
  "Desired Location": "Anywhere / Remote",
  "Things You Want to Avoid": "No sales roles",
  "Search Keywords": "Java, Spring Boot",
  "Key Skills": "Java, Spring, PostgreSQL",
  "Upload your CV/Resume": "https://drive.google.com/open?id=1AbC23dEfGhIjKlmNoP",
  "Upload your Cover Letter": "https://drive.google.com/open?id=9ZzY88xWvUtSrQ"
};

const mapped = mapFormResponse(sampleRow);
console.log(JSON.stringify(mapped, null, 2));

if (mapped.candidateEmail !== "jane.doe@example.com") throw new Error("FAILED: email mapping");
if (mapped.candidateName !== "Jane Doe") throw new Error("FAILED: name mapping");
if (mapped.minimumMatchScore !== 7) throw new Error("FAILED: default config not applied");
if (mapped.cvFileUrl.includes("id=1AbC23dEfGhIjKlmNoP") === false) throw new Error("FAILED: cv url mapping");
if (mapped.status !== "active") throw new Error("FAILED: default status");

console.log("\nAll intake mapping assertions passed.");
