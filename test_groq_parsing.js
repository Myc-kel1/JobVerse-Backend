const { validateAIOutput, tryParseJSON } = require("./src/groq");

// Case 1: clean valid response
const good = tryParseJSON(JSON.stringify({
  overallScore: 8.5, titleMatch: 9, skillMatch: 8, experienceMatch: 7, workModelMatch: 10,
  locationMatch: 10, jobTypeMatch: 10, salaryMatch: 6, recencyScore: 9,
  excluded: false, exclusionReason: null, matchedSkills: ["Python", "React"], missingSkills: ["AWS"],
  rationale: "Strong technical match."
}));
console.log("Case 1 (valid):", validateAIOutput(good));
if (!validateAIOutput(good).ok) throw new Error("FAILED case 1");

// Case 2: wrapped in a markdown code fence (models do this despite instructions)
const fenced = tryParseJSON("```json\n" + JSON.stringify({
  overallScore: 7, titleMatch: 7, skillMatch: 7, experienceMatch: 7, workModelMatch: 7,
  locationMatch: 7, jobTypeMatch: 7, salaryMatch: 7, recencyScore: 7,
  excluded: false, exclusionReason: null, matchedSkills: [], missingSkills: [], rationale: "ok"
}) + "\n```");
console.log("Case 2 (code-fenced):", validateAIOutput(fenced));
if (!validateAIOutput(fenced).ok) throw new Error("FAILED case 2 - code fence stripping broken");

// Case 3: missing a required field
const missing = tryParseJSON(JSON.stringify({ overallScore: 5, titleMatch: 5 }));
console.log("Case 3 (missing fields):", validateAIOutput(missing));
if (validateAIOutput(missing).ok) throw new Error("FAILED case 3 - should have been rejected");

// Case 4: excluded not boolean
const badType = tryParseJSON(JSON.stringify({
  overallScore: 5, titleMatch: 5, skillMatch: 5, experienceMatch: 5, workModelMatch: 5,
  locationMatch: 5, jobTypeMatch: 5, salaryMatch: 5, recencyScore: 5,
  excluded: "false", matchedSkills: [], missingSkills: [], rationale: "x"
}));
console.log("Case 4 (excluded as string):", validateAIOutput(badType));
if (validateAIOutput(badType).ok) throw new Error("FAILED case 4 - should have been rejected");

// Case 5: totally malformed / not JSON at all
const garbage = tryParseJSON("I cannot provide a score for this job.");
console.log("Case 5 (not JSON):", garbage, validateAIOutput(garbage));
if (validateAIOutput(garbage).ok) throw new Error("FAILED case 5 - should have been rejected");

console.log("\nAll AI parsing/validation assertions passed.");
