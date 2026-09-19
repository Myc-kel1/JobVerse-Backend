require("dotenv").config();

const {
  buildPrompt,
  callGroq,
  tryParseJSON,
  validateAIOutput
} = require("./src/groq");

const config = require("./src/config");

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
  const prompt = buildPrompt(candidate, job);

  console.log("========== MODEL ==========");
  console.log(config.GROQ_PRIMARY_MODEL);

  console.log("\n========== PROMPT ==========");
  console.log(prompt);

  console.log("\n========== CALLING GROQ ==========");

  try {
    const raw = await callGroq(
      config.GROQ_PRIMARY_MODEL,
      prompt,
      0.1
    );

    console.log("\n========== RAW RESPONSE ==========");
    console.log(raw);

    console.log("\n========== PARSED ==========");

    const parsed = tryParseJSON(raw);

    console.log(parsed);

    console.log("\n========== VALIDATION ==========");

    const validation = validateAIOutput(parsed);

    console.log(validation);

  } catch (error) {
    console.error("\n========== ERROR ==========");
    console.error(error);
  }
}

main();
