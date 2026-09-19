const { flattenAndNormalize } = require("./src/pipeline/flatten");

// Real sample response shape pasted earlier in this project (data.jobs, not data directly)
const sample = {
  status: "OK",
  data: {
    jobs: [
      {
        job_id: "abc123",
        job_title: "Software Engineer (Python & React)",
        employer_name: "Human Resource Services Company",
        job_employment_type: "Full-time",
        job_apply_link: "https://remote4africa.com/jobs/software-engineer-python-react",
        job_description: "Summary<br>This role is <b>open</b> to candidates based in LATAM.",
        job_is_remote: false,
        job_posted_at_datetime_utc: "2026-08-22T00:00:00.000Z",
        job_city: null,
        job_state: null,
        job_country: null,
        job_min_salary: null,
        job_max_salary: null
      },
      {
        job_id: "def456",
        job_title: "Senior Software Engineer (Customer Platform)",
        employer_name: "US-wfhub",
        job_employment_type: "Full-time",
        job_apply_link: "https://wfhub.example.com/job",
        job_description: "Design, build, and evolve backend services.",
        job_is_remote: false,
        job_posted_at_datetime_utc: "2026-08-21T00:00:00.000Z",
        job_city: null,
        job_state: null,
        job_country: "CA",
        job_min_salary: null,
        job_max_salary: null
      }
    ]
  }
};

const result = flattenAndNormalize([sample]);
console.log("Jobs extracted:", result.length);
console.log(JSON.stringify(result, null, 2));

if (result.length !== 2) throw new Error("FAILED: expected 2 jobs, got " + result.length);
if (result[0].title !== "Software Engineer (Python & React)") throw new Error("FAILED: title mismatch");
if (result[0].description.includes("<br>")) throw new Error("FAILED: HTML not stripped");
if (result[1].location !== "CA") throw new Error("FAILED: location fallback wrong");

console.log("\nAll assertions passed.");
