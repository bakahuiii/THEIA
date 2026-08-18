# Local API, CLI and Export

## Security Boundary

`core/local-api.mjs` binds only to `127.0.0.1`. It is read-only. Do not add public listeners, write endpoints, proxy forwarding or permissive CORS.

The active port is in `api-runtime.json`. Default port is `8765`; a small local fallback range is used if occupied.

## API Contract

```text
GET /v1/health
GET /v1/data-manifest
GET /v1/collections
GET /v1/profile
GET /v1/sync
GET /v1/feed
GET /v1/data-catalog
GET /v1/fitness?year=2025-2026_1
GET /v1/school-schedule?termId=2025-3&keyword=MAT13904T
GET /v1/academic-progress
GET /v1/academic-analysis
GET /v1/academic-extras/{domain}?q=...&limit=...
GET /v1/{terms|courses|schedule|exams|grades|selected-courses|assignments|workspaces|notices|emails}
GET /v1/{collection}.csv
GET /v1/calendar.ics
```

`/v1/data-manifest` exposes storage layout metadata and fragment names only. It does not expose arbitrary file reads. Collection endpoints may accept `?since=<ISO timestamp>`.

Use `/v1/feed` for a normalized full-data view, `/v1/academic-analysis` for GPA/credit/degree-plan reasoning, `/v1/academic-extras/{domain}` for one JWGLXT extension table, collection endpoints for selective reads, and `/v1/school-schedule` for local term-cache queries. The extension table supports `q`, `limit` and `since`, and returns `columns`, `completeness` and `queryStats` alongside `items`. All return normalized data; none should expose credentials, raw pages, session state or private binary attachments. The academic analysis is derived per snapshot and is not a write-back format.

## CLI

```text
theia status [--json]
theia export --format json|ndjson|theia|ics|csv --collection grades --output FILE
theia export --format ai --output DIRECTORY
theia work list|show|import ...
theia serve [--port 8765]
theia api
theia doctor
```

The CLI reads the same sharded `CampusStore` as the desktop application. It must never reconstruct its own file parser or write directly into `data/`.

`export --format ai` writes a new `THEIA-AI-EXPORT-YYYYMMDD-HHmmss/` child directory below the requested parent directory. It uses the same `core/ai-export.mjs` builder as the desktop Export for AI command, includes an SHA-256 manifest and never overwrites an existing package. Read `../reference/ai-export-contract.md` before modifying its schema, file inventory, or sanitation rules.

For an external AI task explicitly initiated by the user, prefer this package over a raw Feed or direct fragment reads. The package gives the model `AI_CONTEXT.md`, `DATA_DICTIONARY.md`, a source/availability explanation, and path/credential stripping. It is still a static, privacy-sensitive snapshot: validate `manifest.json` first; do not infer live school state or attempt URL/session/attachment access.

This package is not the runtime input path for THEIA's in-process Advisor. The Agent reads one `snapshotWithRevision()` directly from `CampusStore`, creates a bounded lazy workspace, and does not make a loopback request or round-trip through an export. It never silently reuses the full export package.

## AI Consumer Rules

The following rules are for processes outside the THEIA main process:

1. Prefer the loopback API while THEIA is running.
2. Otherwise read `theia-feed.json`; it is an atomic compatibility export.
3. For disk-level tooling, use `data/manifest.json` and verify each referenced fragment digest before consuming it.
4. Treat source URL, capture time, parser version and refresh state as provenance, not display noise.
5. Do not infer credential availability from data files.

Do not apply these rules to `core/advisor/`: an internal Advisor component that reads loopback/API/Feed data can lose the atomic relationship between state, revision and domain digests.
