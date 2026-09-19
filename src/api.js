const { randomUUID } = require("crypto");
const { readSheet } = require("./googleSheets");
const { runDiscoveryForCandidate: runDiscoveryPipeline } = require("./runDiscovery");
const { syncFormResponsesToCandidates } = require("./syncCandidateIntake");
const {
  generateApplicationForJob,
  listGeneratedApplications,
  getGeneratedApplication
} = require("./application/applicationService");

const runs = new Map();
const APPLICATION_STATUSES = new Set(["Generated", "Under Review", "Approved", "Rejected", "Applied"]);

function sanitizeCandidate(candidate) {
  if (!candidate) return null;
  const { masterCVText, masterCoverLetterText, cvExtractionError, coverLetterExtractionError, ...safe } = candidate;
  return safe;
}

function sanitizeJob(job) {
  return {
    ...job,
    matchedSkills: typeof job.matchedSkills === "string" ? job.matchedSkills.split(",").map((s) => s.trim()).filter(Boolean) : job.matchedSkills || [],
    missingSkills: typeof job.missingSkills === "string" ? job.missingSkills.split(",").map((s) => s.trim()).filter(Boolean) : job.missingSkills || []
  };
}

function sanitizeApplication(application) {
  if (!application) return null;
  const { cvText, coverLetterText, ...safe } = application;
  return {
    ...safe,
    factualWarnings: parseJsonArray(application.factualWarnings),
    missingRequirements: parseJsonArray(application.missingRequirements),
    keyAlignmentPoints: parseJsonArray(application.keyAlignmentPoints)
  };
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

async function getCandidate(email) {
  const candidates = await readSheet("Candidates");
  return candidates.find((c) => (c.candidateEmail || "").toLowerCase() === email.toLowerCase()) || null;
}

async function getJobs(email, query = {}) {
  const rows = await readSheet("Shortlisted Jobs");
  let jobs = rows.filter((j) => (j.candidateEmail || "").toLowerCase() === email.toLowerCase());
  if (query.status) jobs = jobs.filter((j) => (j.status || "").toLowerCase() === query.status.toLowerCase());
  if (query.source) jobs = jobs.filter((j) => (j.sourceName || "").toLowerCase() === query.source.toLowerCase());
  if (query.minScore) jobs = jobs.filter((j) => Number(j.overallScore) >= Number(query.minScore));
  jobs.sort((a, b) => Number(b.overallScore || 0) - Number(a.overallScore || 0));
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
  return jobs.slice(0, limit).map(sanitizeJob);
}

function startRun(candidateEmail) {
  const runId = randomUUID();
  const state = { runId, candidateEmail, status: "running", startedAt: new Date().toISOString(), completedAt: null, summary: null, error: null };
  runs.set(runId, state);
  runDiscoveryForCandidate(candidateEmail)
    .then((summary) => { state.status = "completed"; state.completedAt = new Date().toISOString(); state.summary = summary; })
    .catch((error) => { state.status = "failed"; state.completedAt = new Date().toISOString(); state.error = error.message; });
  return state;
}

async function runDiscoveryForCandidate(email) {
  const candidate = await getCandidate(email);
  if (!candidate) throw new Error("Candidate not found");
  return runDiscoveryPipeline(candidate);
}

function registerApiRoutes(app, { checkTriggerToken }) {
  app.get("/api/candidates", async (req, res) => {
    try { const rows = await readSheet("Candidates"); res.json({ data: rows.map(sanitizeCandidate) }); }
    catch (err) { res.status(500).json({ error: "Failed to load candidates" }); }
  });

  app.get("/api/candidates/:email", async (req, res) => {
    try {
      const candidate = await getCandidate(req.params.email);
      if (!candidate) return res.status(404).json({ error: "Candidate not found" });
      res.json({ data: sanitizeCandidate(candidate) });
    } catch (err) { res.status(500).json({ error: "Failed to load candidate" }); }
  });

  app.get("/api/jobs", async (req, res) => {
    try {
      if (!req.query.candidateEmail) return res.status(400).json({ error: "candidateEmail is required" });
      const data = await getJobs(req.query.candidateEmail, req.query);
      res.json({ data, count: data.length, fetchedAt: new Date().toISOString() });
    } catch (err) { res.status(500).json({ error: "Failed to load jobs" }); }
  });

  app.get("/api/jobs/:jobId", async (req, res) => {
    try {
      const rows = await readSheet("Shortlisted Jobs");
      const job = rows.find((j) => String(j.jobId) === String(req.params.jobId));
      if (!job) return res.status(404).json({ error: "Job not found" });
      res.json({ data: sanitizeJob(job) });
    } catch (err) { res.status(500).json({ error: "Failed to load job" }); }
  });

  app.get("/api/dashboard/:email", async (req, res) => {
    try {
      const [candidate, jobs, summaries] = await Promise.all([getCandidate(req.params.email), getJobs(req.params.email, { limit: 100 }), readSheet("Job Search Execution Summary")]);
      if (!candidate) return res.status(404).json({ error: "Candidate not found" });
      const candidateSummaries = summaries.filter((s) => (s.candidateEmail || "").toLowerCase() === req.params.email.toLowerCase()).sort((a, b) => new Date(b.executionDate || b.loggedAt || 0) - new Date(a.executionDate || a.loggedAt || 0));
      const latest = candidateSummaries[0] || null;
      res.json({ data: { candidate: sanitizeCandidate(candidate), jobs, stats: { totalJobs: jobs.length, qualifiedJobs: jobs.filter((j) => Number(j.overallScore) >= Number(candidate.minimumMatchScore || 6)).length, averageScore: jobs.length ? Number((jobs.reduce((sum, j) => sum + Number(j.overallScore || 0), 0) / jobs.length).toFixed(2)) : 0, latestRun: latest }, fetchedAt: new Date().toISOString() } });
    } catch (err) { console.error("Dashboard error:", err); res.status(500).json({ error: "Failed to load dashboard", details: err.message }); }
  });

  app.get("/api/executions/:email", async (req, res) => {
    try {
      const rows = await readSheet("Job Search Execution Summary");
      const data = rows.filter((s) => (s.candidateEmail || "").toLowerCase() === req.params.email.toLowerCase()).sort((a, b) => new Date(b.executionDate || b.loggedAt || 0) - new Date(a.executionDate || a.loggedAt || 0));
      res.json({ data });
    } catch (err) { res.status(500).json({ error: "Failed to load execution history" }); }
  });

  app.post("/api/search/:email", checkTriggerToken, async (req, res) => {
    try {
      const candidate = await getCandidate(req.params.email);
      if (!candidate) return res.status(404).json({ error: "Candidate not found" });
      res.status(202).json({ data: startRun(candidate.candidateEmail) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/runs/:runId", (req, res) => {
    const run = runs.get(req.params.runId);
    if (!run) return res.status(404).json({ error: "Run not found" });
    res.json({ data: run });
  });

  app.post("/api/sync-intake", checkTriggerToken, async (req, res) => {
    try { res.json({ data: await syncFormResponsesToCandidates() }); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Application generation is deliberately separate from discovery. It only
  // operates on a selected shortlist job and never runs for every discovery result.
  app.post("/api/applications/:candidateEmail/:jobId/generate", checkTriggerToken, async (req, res) => {
    try {
      const data = await generateApplicationForJob({ candidateEmail: req.params.candidateEmail, jobId: req.params.jobId, applicationType: req.body?.applicationType || null });
      res.status(201).json({ data: sanitizeApplication(data) });
    } catch (err) {
      console.error("Application generation error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/applications", async (req, res) => {
    try {
      if (!req.query.candidateEmail) return res.status(400).json({ error: "candidateEmail is required" });
      const data = await listGeneratedApplications(req.query.candidateEmail, req.query);
      res.json({ data: data.map(sanitizeApplication), count: data.length, fetchedAt: new Date().toISOString() });
    } catch (err) { res.status(500).json({ error: "Failed to load generated applications" }); }
  });

  app.get("/api/applications/:applicationId", async (req, res) => {
    try {
      const data = await getGeneratedApplication(req.params.applicationId);
      if (!data) return res.status(404).json({ error: "Application not found" });
      res.json({ data: sanitizeApplication(data) });
    } catch (err) { res.status(500).json({ error: "Failed to load application" }); }
  });

  app.patch("/api/applications/:applicationId/status", checkTriggerToken, async (req, res) => {
    try {
      const status = String(req.body?.status || "").trim();
      if (!APPLICATION_STATUSES.has(status)) return res.status(400).json({ error: `Invalid status. Allowed: ${[...APPLICATION_STATUSES].join(", ")}` });
      const current = await getGeneratedApplication(req.params.applicationId);
      if (!current) return res.status(404).json({ error: "Application not found" });
      const { upsertRows } = require("./googleSheets");
      const updated = { ...current, status, updatedAt: new Date().toISOString() };
      await upsertRows("Generated Applications", [updated], ["applicationId"]);
      res.json({ data: sanitizeApplication(updated) });
    } catch (err) { res.status(500).json({ error: "Failed to update application status" }); }
  });
}

module.exports = { registerApiRoutes };
