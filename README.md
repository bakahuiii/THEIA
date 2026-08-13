# THEIA

THEIA is a local-first Windows desktop workspace for Beijing University of Chemical Technology campus services.

## What it does

- Uses the school unified-authentication browser session for 北化在线THEOL and browser-backed campus pages. Academic data can instead use an optional, isolated Zhengfang API session with separately encrypted credentials when API priority is enabled.
- Reads schedules, courses, selected courses, exams, grades, official academic-progress data, notices, assignments, and online tests into a local normalized snapshot.
- Filters assignments that are already overdue, even when 北化在线THEOL continues to show them.
- Allows high-priority academic domains to run concurrently and starts the 北化在线THEOL home-page read alongside the academic sync. After the main sync completes, the per-course `Course task` scan runs silently through a single strictly serial queue.
- Provides a course-selection queue through the isolated Zhengfang API session. It acts only on targets explicitly chosen by the user and never automatically replays a selection POST after session expiry.
- Provides a high-resolution Changping campus map with aligned campus and satellite base layers.
- Prepares local assignment workspaces containing task text, attachments, parsed online-test questions, `manifest.json`, and templates.
- Calls a user-configured OpenAI-compatible model service to process prepared workspaces.
- For normal assignments, writes a local `model-answer.md`. For online tests, validates and writes `answers.json`.
- Opens the original school page in THEIA's built-in browser to upload a file or write test answers. THEIA never clicks the final school submission button.

## Model service and privacy

Configure the service URL and API key in **Settings**. THEIA automatically checks the compatible `/v1/models` endpoint, lists the available models, and selects a suitable text model. A manual model ID remains available for relays that do not expose model listing. THEIA uses the OpenAI-compatible Chat Completions endpoint:

```text
POST {service URL}/chat/completions
Authorization: Bearer {API key}
```

The service URL and model name are stored in THEIA settings. The API key is stored separately with Electron `safeStorage` / Windows DPAPI and is never included in campus data, exports, the loopback API, task manifests, or diagnostic logs. Model calls are made only in the Electron main process; the renderer never receives the API key.

The model receives only the prepared local task context. School passwords, cookies, browser storage, and authenticated pages are never sent to the model service by THEIA.

## Advisor readiness

THEIA now has a deterministic, model-free advisor foundation. `getAdvisorOverview` reads one atomic `CampusStore.snapshotWithRevision()` and locally evaluates per-domain data quality, evidence references, typed claims, data-quality risks, assignment/exam timing records, and a stable agenda. This path performs no school request, model request, browser-session read, or state write, so it remains available offline and without an API key.

This is the P0 trust foundation, not the conversational advisor. The existing `ModelService` still serves the explicit coursework and summary workflows described above; it is not an `AdvisorRuntime`. Provider abstraction, a consent-scoped context builder, strict model narrative schema, response citation/action validation, conversations, and tool loops remain unimplemented. Future advisor model calls must be explicit, disclose only the minimum authorized fields, and validate the response against the exact claim/evidence catalog frozen for that request.

## Assignment workflow

1. Sync 北化在线THEOL, then open **Assignments and tests**.
2. Choose **Prepare workspace** to save a local task package.
3. Choose **Use model** to create a draft answer or a complete answer JSON file.
4. Review the files in **Open workspace**.
5. For a test, choose **Write to test page**, inspect the built-in browser, then submit on the school page yourself.
6. For an assignment, choose the file to upload and inspect the built-in browser before submitting on the school page yourself.

## Run from source

Requires Node.js 22.12+ and npm 10+.

```powershell
npm install
npm run dev
```

The browser-only preview is intentionally limited: school authentication, encrypted credential storage, file dialogs, local model keys, and built-in source-browser actions require the installed Electron desktop client.

## Command line and local data API

THEIA also provides generic, read-only local data interfaces for scripts and other tools running on the same computer.

```powershell
npm run cli -- status
npm run cli -- export --format theia --output .\theia-feed.json
npm run cli -- export --format json --output .\theia-snapshot.json
npm run cli -- export --format ai --output .\theia-ai-exports
npm run cli -- export --format ics --output .\theia-calendar.ics
npm run cli -- export --format csv --collection grades --output .\grades.csv
npm run cli -- work list
npm run cli -- work show <assignment-id>
npm run cli -- doctor
```

`export --format ai` creates a new `THEIA-AI-EXPORT-YYYYMMDD-HHmmss` directory inside the chosen parent directory. It contains 16 normalized domain JSON files, `AI_CONTEXT.md`, `DATA_DICTIONARY.md`, and `manifest.json`; the manifest lists SHA-256 digests for the other 18 files. The package is a static, user-authorized AI reading snapshot, not a live school-system session or an import/write format. It excludes credentials, cookies, browser state, absolute paths, raw attachments, and workspace output files, but can still contain sensitive academic and mail data. Keep it local or share it only with a model service you explicitly trust. See [the AI export contract](docs/reference/ai-export-contract.md) for the exact schema and verification rules.

The desktop Settings page has a separate encrypted academic API credential
slot and an explicit source selector. When API priority is enabled with saved
credentials, THEIA uses the isolated academic API adapter; when it is disabled
or unconfigured, THEIA uses the unified-authentication browser path. A failed
enabled API request preserves the existing local snapshot and reports the source
error rather than silently switching paths during the same sync.

The direct API session must remain isolated from `persist:theia`: BUCT may
invalidate an earlier academic session when a second login is created. API
cookies must not be mirrored into the unified-authentication browser session.

While the desktop client is running, the loopback service binds only to `127.0.0.1` (default port `8765`, with the actual port in `api-runtime.json`):

```text
GET /v1/health
GET /v1/snapshot
GET /v1/feed
GET /v1/terms
GET /v1/courses
GET /v1/schedule
GET /v1/exams
GET /v1/grades
GET /v1/academic-progress
GET /v1/selected-courses
GET /v1/assignments
GET /v1/workspaces
GET /v1/notices
GET /v1/calendar.ics
```

`/v1/feed` uses the `theia-campus-feed/v1` schema. A reusable local client and schema are in [integration](integration/README.md).

## Data boundaries

- Data lives in `%APPDATA%\THEIA` by default. `THEIA_DATA_ROOT` is an isolated override. On a default-path launch, selected legacy files may be copied from `%APPDATA%\BUCT` only when the corresponding THEIA file is absent; the legacy directory is retained.
- `auth-diagnostics.ndjson` contains only authentication phase, sanitized host/path, and error summaries. It does not contain passwords, API keys, cookies, or URL query values.
- Unified-authentication, academic API, mailbox, and model-service credentials are separately DPAPI-encrypted and excluded from business snapshots, exports, and local API responses.
- Course selection runs only after the user explicitly chooses a teaching class and starts a bounded task. THEIA does not automate withdrawal, evaluation, or applications.

## Verify and package

```powershell
npm test
npm run lint
npm run build
npm run dist:installer
```
