const jsearch = require("./src/sources/jsearch");
const adzuna = require("./src/sources/adzuna");
const remotive = require("./src/sources/remotive");

console.log("=== JSearch normalize ===");
const jsJob = jsearch.normalize({
  job_id: "js1", job_title: "Backend Engineer", employer_name: "Acme",
  job_is_remote: true, job_employment_type: "Full-time",
  job_description: "Build <b>APIs</b>", job_apply_link: "https://acme.com/job1",
  job_posted_at_datetime_utc: "2026-08-20T00:00:00Z", job_min_salary: 60000, job_max_salary: 90000, job_salary_currency: "USD"
});
console.log(jsJob);
if (jsJob.sourceName !== "RapidAPI - JSearch" || jsJob.workModel !== "Remote") throw new Error("FAILED jsearch normalize");

console.log("\n=== Adzuna normalize ===");
const adzJob = adzuna.normalize({
  id: 555, title: "Remote Data Analyst", company: { display_name: "DataCo" },
  location: { display_name: "London, UK" }, description: "Fully remote analytics role.",
  redirect_url: "https://adzuna.com/job/555", created: "2026-08-19T10:00:00Z",
  salary_min: 40000, salary_max: 55000, contract_time: "full_time"
}, "gb");
console.log(adzJob);
if (adzJob.sourceName !== "Adzuna" || adzJob.salaryCurrency !== "GBP" || adzJob.workModel !== "Remote") throw new Error("FAILED adzuna normalize");

console.log("\n=== Remotive normalize ===");
const remJob = remotive.normalize({
  id: 999, url: "https://remotive.com/remote-jobs/dev-1", title: "Frontend Developer",
  company_name: "RemoteCo", job_type: "full_time", publication_date: "2026-08-18T00:00:00",
  candidate_required_location: "Worldwide", salary: "$70,000 - $90,000",
  description: "<p>Build UIs with React.</p>"
});
console.log(remJob);
if (remJob.sourceName !== "Remotive" || remJob.workModel !== "Remote") throw new Error("FAILED remotive normalize");
if (remJob.salaryMin !== 70000 || remJob.salaryMax !== 90000) throw new Error("FAILED remotive salary parsing");

console.log("\n=== Remotive salary parsing edge cases ===");
console.log("No salary:", remotive.parseSalary(null));
console.log("Single number:", remotive.parseSalary("$50,000"));
console.log("Range:", remotive.parseSalary("$50,000 - $70,000"));
if (remotive.parseSalary(null).min !== null) throw new Error("FAILED null salary");
if (remotive.parseSalary("$50,000").min !== 50000) throw new Error("FAILED single salary");

console.log("\nAll source normalizer assertions passed. All three produce the SAME internal schema shape.");

// Confirm all three produce identical key sets, since the shared pipeline
// downstream depends on this consistency.
const keys1 = Object.keys(jsJob).sort().join(",");
const keys2 = Object.keys(adzJob).sort().join(",");
const keys3 = Object.keys(remJob).sort().join(",");
if (keys1 !== keys2 || keys2 !== keys3) {
  throw new Error("FAILED: schema mismatch between sources!\n" + keys1 + "\n" + keys2 + "\n" + keys3);
}
console.log("Confirmed: all three sources produce byte-identical field sets.");
