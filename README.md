# Jobverse Backend

A self-contained Node.js replacement for the n8n job-discovery workflow. Reads
candidates from Google Sheets, searches RapidAPI's JSearch, scores results
with Groq, and saves qualified matches back to Google Sheets -- all without
depending on an n8n instance staying up.

Every piece of transformation logic in `src/pipeline/` and the AI response
parsing in `src/groq.js` has been unit-tested against realistic data (see
`test_*.js` in the project root, run via `npm test`) before being shipped.

## 1. Google Sheets access: service account setup

Unlike n8n's OAuth login flow, a server has no browser to click "Sign in with
Google" through. Instead it uses a **service account** -- a robot identity
that you grant direct access to your specific spreadsheet.

1. Go to [console.cloud.google.com](https://console.cloud.google.com), select
   or create a project, and enable both the **Google Sheets API** and the
   **Google Drive API** under "APIs & Services" -- Drive access is needed to
   download the CV/cover-letter files candidates upload through the form.
2. Go to **IAM & Admin > Service Accounts > Create Service Account**. Give it
   any name (e.g. `jobverse-backend`). You don't need to grant it any
   project-level roles.
3. Click into the new service account > **Keys** tab > **Add Key > Create new
   key > JSON**. This downloads a `.json` file -- open it, you'll need two
   fields from it: `client_email` and `private_key`.
4. Open your actual Google Sheet (the one with the `Candidates` and
   `Shortlisted Jobs` tabs) and click **Share**. Paste in the `client_email`
   value from step 3 and give it **Editor** access -- this is the step that
   actually grants the backend permission to read/write your data.
5. Separately, share the **Drive folder** where your Google Form stores
   uploaded files with that same `client_email` (Viewer access is enough).
   Google Forms creates this folder automatically the first time someone
   uploads a file -- find it from the form's Responses tab, or from Drive
   directly, and share it. Without this step, CV/cover-letter downloads will
   fail with a permissions error even though the Sheets access works fine.
6. Set `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
   in your environment from those same two fields. The private key contains
   literal `\n` characters in the JSON file -- paste it exactly as-is
   (including the quotes and `\n` sequences); `src/config.js` converts them
   to real newlines automatically.

## 2. Required sheet columns

This backend expects the same tabs and columns already established in the
n8n build:

- **Candidates**: candidateEmail, candidateName, preferredJobTitle, jobType,
  workModel, salaryRangeMin, salaryRangeMax, desiredLocation, exclusionRules,
  searchKeywords, minimumMatchScore, maxResults, maxSearchPages,
  jobRecencyDays, excludedTitles, excludedKeywords, preferredSkills, status,
  applicationsSentCount, applicationTarget, cvFileUrl, coverLetterFileUrl,
  masterCVText, masterCoverLetterText, dateRegistered
- **Shortlisted Jobs**: jobId, candidateEmail, candidateName, title, company,
  location, workModel, salaryMin, salaryMax, salaryCurrency, salaryPeriod,
  jobType, url, postedDate, sourceName, overallScore, titleMatch, skillMatch,
  experienceMatch, workModelMatch, locationMatch, jobTypeMatch, salaryMatch,
  recencyScore, matchedSkills, missingSkills, rationale, status, dateSaved
- **Job Search Execution Summary**: any columns -- rows are appended with
  whatever fields the summary object has, so this tab just needs to exist
  with *some* header row for the append call to succeed cleanly. Recommended:
  candidateEmail, executionDate, searchQueries, totalJobsFound, invalidJobs,
  jobsAfterRecencyFilter, duplicatesRemoved, previouslySeenJobs,
  hardRejectedJobs, aiEvaluatedJobs, aiFailures, qualifiedJobs,
  topResultsSaved, loggedAt

## 3. Local setup

```bash
npm install
cp .env.example .env    # then fill in real values
npm test                # confirms the pipeline logic works, no credentials needed
npm start                # boots the server; /health should respond immediately
                          # even before real credentials are filled in
```

## 4. Deploying to Render (as a proper always-on Node service)

1. Push this project to a GitHub repo.
2. In Render, **New > Web Service**, connect the repo.
3. Runtime: Node. Build command: `npm install`. Start command: `npm start`.
4. Under **Environment**, add every variable from `.env.example` with your
   real values -- including `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (paste it
   with the `\n` sequences intact, exactly as it appears in the downloaded
   JSON key).
5. Health check path: `/health`.
6. Pick a paid instance type rather than the free tier if you want this to
   stay running continuously and not spin down -- the free tier's spin-down
   behavior was the original reason for this rebuild.

## 5. Endpoints

| Method | Path | What it does |
|---|---|---|
| GET | `/health` | Liveness check |
| POST | `/run/:candidateEmail` | Manually trigger discovery for one candidate (the "Generate" action) |
| POST | `/run-all` | Manually trigger the full daily run for every active candidate |
| POST | `/sync-intake` | Manually trigger a Form Responses -> Candidates sync, including CV/cover-letter text extraction |

Both `/run` endpoints require an `X-Trigger-Token` header matching
`MANUAL_TRIGGER_TOKEN` if that variable is set (recommended for anything
beyond local testing).

The daily cron job runs automatically at `DAILY_RUN_HOUR` (server-local time,
24h format, default 8) -- no manual trigger needed for normal operation.

## 6. What this covers now

- **Three job sources merged**: JSearch (RapidAPI), Adzuna, and Remotive all feed into the same pipeline. Each source's failure is isolated -- if one API is down, the other two still contribute results.
- **Candidate intake sync**: reads new Google Form responses, downloads and extracts text from uploaded CV and cover letter files (PDF or DOCX), and writes the result into the Candidates sheet. Runs automatically every 5 minutes, or on demand via `POST /sync-intake`.

## 7. Still outstanding

- The Jobverse API layer (login/candidates/prospects endpoints the frontend needs) -- still exists only as the n8n version for now.
- Workflow 2 (application drafting/tailoring by type -- NHS, corporate, technical, executive, standard).

## 8. Google Form setup (not code -- do this in Google's own UI)

Add two File Upload questions to your existing intake form: "Upload your CV/Resume" and "Upload your Cover Letter" (both accepting PDF or DOCX). The exact question wording matters -- it becomes the column header in your Form Responses sheet, and `src/syncCandidateIntake.js`'s `FORM_FIELD_MAP` at the top of the file needs to match it exactly. Update that map if your form's wording differs from the defaults already in there.

## 9. Rate limits, from hard-won experience

- **RapidAPI (JSearch) free tier**: 200 requests/month. Each candidate's run
  uses roughly `keywords x maxSearchPages` requests.
- **Groq**: per-model, per-minute token caps (commonly 8,000 TPM on the free
  tier). `AI_CALL_DELAY_MS` (default 12 seconds) paces requests to stay under
  this -- lowering it risks 429 errors under real load.

## 10. Production authentication on Render (no service-account key)

The production implementation uses Google OAuth 2.0 with an offline refresh token instead of a downloadable service-account private key. This avoids the `iam.disableServiceAccountKeyCreation` organization-policy blocker and keeps the Google credential out of the source tree.

1. In Google Cloud, create an OAuth client ID for a desktop/local application or web application as appropriate for your project.
2. Add the OAuth client ID and secret to a local `.env` as `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`.
3. Set `GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/oauth2callback` for the one-time local consent flow.
4. Run `npm run oauth:google`, open the printed URL, sign in with the Google account that owns/has access to the Jobverse spreadsheet and Drive upload folder, and complete consent.
5. Copy the resulting `GOOGLE_OAUTH_REFRESH_TOKEN` into the local `.env` and into Render's Environment settings.
6. On Render, also set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`, `SPREADSHEET_ID`, `RAPIDAPI_KEY`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `GROQ_API_KEY`, `MANUAL_TRIGGER_TOKEN`, and `FRONTEND_ORIGIN`.

The application uses the refresh token only to obtain short-lived Google access tokens. The authenticated Google account must have Editor access to the Jobverse spreadsheet and Viewer access to the Drive folder containing uploaded CVs/cover letters.

## 11. UI/API layer

The backend now exposes read APIs intended for the Jobverse frontend:

- `GET /api/candidates`
- `GET /api/candidates/:email`
- `GET /api/jobs?candidateEmail=...`
- `GET /api/jobs/:jobId`
- `GET /api/dashboard/:email`
- `GET /api/executions/:email`
- `POST /api/search/:email`
- `GET /api/runs/:runId`
- `POST /api/sync-intake`

The existing `/run/:candidateEmail`, `/run-all`, and `/sync-intake` routes remain for backward compatibility with the original workflow.

The dashboard endpoint returns the candidate profile, latest stored jobs, aggregate statistics, latest execution summary, and a `fetchedAt` timestamp. The search endpoint starts the existing discovery pipeline asynchronously and returns a `runId`; the frontend can poll `/api/runs/:runId` and then refetch `/api/jobs` when the run completes.
"# JobVerse-Backend" 
