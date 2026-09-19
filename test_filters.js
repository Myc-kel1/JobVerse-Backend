const {
  validateJobs, generateStableJobIds, filterByRecency, dedupeThisRun, applyHardRequirementFilter
} = require("./src/pipeline/filters");

const now = new Date();
const recent = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
const stale = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

let jobs = [
  { title: "Backend Engineer", url: "https://a.com/job1?utm_source=x", company: "A", location: "Remote", postedDate: recent, jobType: "Full-time", workModel: "Remote", shortDescription: "Great role" },
  { title: "Backend Engineer", url: "https://a.com/job1", company: "A", location: "Remote", postedDate: recent, jobType: "Full-time", workModel: "Remote", shortDescription: "Great role (duplicate via tracking param)" }, // should dedupe with above
  { title: "", url: "https://b.com/job2", company: "B" }, // should fail validation (no title)
  { title: "Old Job", url: "https://c.com/job3", company: "C", postedDate: stale, workModel: "Remote", shortDescription: "" }, // should fail recency
  { title: "Sales Representative", url: "https://d.com/job4", company: "D", postedDate: recent, workModel: "Remote", shortDescription: "" }, // should fail hard filter (excluded title)
];

const candidate = {
  jobType: "Full-time",
  workModel: "Remote",
  excludedTitles: "Sales Representative, Sales Manager",
  excludedKeywords: "commission-only"
};

let step = validateJobs(jobs);
console.log("After validate:", step.length, "(expected 4, drops empty-title job)");
if (step.length !== 4) throw new Error("FAILED validate");

step = generateStableJobIds(step);
console.log("Job IDs assigned:", step.map(j => j.jobId));
if (step[0].jobId !== step[1].jobId) throw new Error("FAILED: tracking-param URLs should produce the SAME jobId");
console.log("Confirmed: URL normalization strips tracking params so duplicates get the same ID.");

step = filterByRecency(step, 7);
console.log("After recency filter:", step.length, "(expected 3, drops the 30-day-old job)");
if (step.length !== 3) throw new Error("FAILED recency");

step = dedupeThisRun(step);
console.log("After dedupe:", step.length, "(expected 2, the two same-jobId items collapse to 1)");
if (step.length !== 2) throw new Error("FAILED dedupe");

step = applyHardRequirementFilter(step, candidate);
const passed = step.filter(j => j.hardFilterPassed);
const rejected = step.filter(j => !j.hardFilterPassed);
console.log("After hard filter: passed =", passed.length, ", rejected =", rejected.length, "(expected 1 passed, 1 rejected)");
console.log("Rejected reason:", rejected[0]?.rejectionReason);
if (passed.length !== 1 || rejected.length !== 1) throw new Error("FAILED hard filter");

console.log("\nAll pipeline assertions passed.");
