const { callApplicationGroq, tryParseJSON } = require("../groq");
const config = require("../config");

const VALIDATOR_SYSTEM =
  "You are a strict factual validator for job application documents. Compare the generated document only " +
  "against the verified candidate evidence and candidate source material. Flag any claim that is not supported. " +
  "Do not flag wording changes that preserve the same factual meaning. Do not allow a job requirement itself to " +
  "become candidate evidence. Return JSON only.";

function validateValidatorOutput(value) {
  if (!value || typeof value !== "object") return { ok: false, reason: "Validator output is not an object" };
  if (typeof value.valid !== "boolean") return { ok: false, reason: "valid must be boolean" };
  if (!Array.isArray(value.unsupportedClaims) || !Array.isArray(value.warnings)) return { ok: false, reason: "Invalid claim/warning arrays" };
  return { ok: true, reason: null };
}

function buildValidationPrompt(documentText, candidate, evidence, requirements, documentType) {
  return `DOCUMENT TYPE: ${documentType}

GENERATED DOCUMENT
${documentText}

VERIFIED CANDIDATE EVIDENCE
${JSON.stringify(evidence)}

MASTER CV
${candidate.masterCVText || ""}

MASTER COVER LETTER
${candidate.masterCoverLetterText || ""}

JOB REQUIREMENTS (context only; NOT candidate evidence)
${JSON.stringify(requirements)}

Return exactly:
{
  "valid": true,
  "unsupportedClaims":[{"claim":"","reason":"","action":"REMOVE"}],
  "warnings":[]
}

Set valid=false if any meaningful candidate claim lacks support. Do not penalize the document for honestly omitting unsupported job requirements.`;
}

async function validateDocument(documentText, candidate, evidence, requirements, documentType) {
  const raw = await callApplicationGroq(
    config.GROQ_APPLICATION_MODEL,
    buildValidationPrompt(documentText, candidate, evidence, requirements, documentType),
    0.05,
    VALIDATOR_SYSTEM,
    1600
  );
  const parsed = tryParseJSON(raw);
  const validation = validateValidatorOutput(parsed);
  if (!validation.ok) throw new Error(`Document validator output invalid: ${validation.reason}`);
  return parsed;
}

module.exports = { validateDocument, validateValidatorOutput, buildValidationPrompt };
