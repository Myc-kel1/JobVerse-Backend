require("dotenv").config();

const { scoreJob } = require("./src/groq");

const candidate = {
  preferredJobTitle: "Software Engineer",
  preferredSkills: "Python, FastAPI, React, JavaScript",
  jobType: "Full-time",
  workModel: "Remote",
  salaryRangeMin: "",
  salaryRangeMax: "",
  desiredLocation: "Nigeria",
  exclusionRules: ""
};

const job = {
  title: "Backend Software Engineer",
  company: "Test Company",
  location: "Remote",
  workModel: "Remote",
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: "",
  jobType: "Full-time",
  postedDateKnown: true,
  shortDescription:
    "We are looking for a Backend Software Engineer with Python and API development experience. Experience with FastAPI and cloud deployment is preferred."
};

async function main() {
  try {
    const result = await scoreJob(candidate, job);

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("ERROR:", error);
  }
}

main();
