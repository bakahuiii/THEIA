# Runtime Data Flow

Read this before changing a source adapter, persisted data, the local API, or a local-data integration.

## Ownership

```text
school service / IMAP / local tool
  -> core adapter or service
  -> CampusStore.update() or .replace()
  -> immutable fragments + manifest
  -> CampusStore snapshot subscribers
  +-> snapshotWithRevision() -> in-process deterministic Advisor overview -> trusted IPC
  +-> atomic theia-feed.json -> renderer snapshot, loopback API, CLI, external local consumers
```

- The renderer never reads disk files or parses school pages.
- `CampusStore` is the only owner of persistent business data.
- Credentials, cookies, API keys, raw HTML and browser sessions are never part of `CampusState` or a fragment.
- Temporary UI state stays in React hooks. Persisted state belongs in `core/schema.mjs` and `CampusStore`.

## Runtime Boundaries

| Layer | Owns | Must not do |
| --- | --- | --- |
| Renderer | presentation, local interaction state | disk access, direct HTTP scraping, credentials |
| Preload/IPC | narrow typed commands | expose Electron/session internals |
| Core adapters | source-specific fetch and normalization | UI-specific state or persistence bypasses |
| Core services | merge, retry, source ownership | direct renderer mutation |
| CampusStore | normalized snapshots and durable writes | network access |
| Local API/CLI | read-only external data contract | write endpoints or public binding |
| Core Advisor | one versioned snapshot, data quality, evidence, local claims, risks and agenda | network/model calls, loopback reads, store writes |

## Write Rules

1. Normalize input before it reaches `CampusStore`.
2. Use `store.update()` for a targeted state change or `store.replace()` for a full synchronized state.
3. Do not write `buct-data.json`, `data/`, or `theia-feed.json` directly from a feature.
4. A successful store write updates the sharded primary store first; feed writing is then queued in the same snapshot order.
5. Preserve old source data when a source fails. A failed API/SSO refresh must not clear a previous valid collection.
6. Persist data and its domain provenance in the same `store.update()`/`replace()` transaction. Never advance a domain watermark from global `snapshot.updatedAt`.

## In-process Advisor Read

The deterministic Advisor is an internal consumer, not an external integration. `electron/advisor-overview-service.mjs` calls `CampusStore.snapshotWithRevision()` once, samples the evaluation clock once, and builds one self-consistent overview in process. It must not call the loopback API, read `theia-feed.json`, or build/read an AI export package.

The overview instance is identified by `{snapshotRevision, evaluatedAt, timeZone, rulesVersion}`. Consumers replace the whole instance when any member changes; they must not merge dynamic values from different evaluations by stable claim ID. Full invariants are in `16-advisor-p0-foundation.md`.

## Source Ownership

- JWGLXT owns academic profile, terms, grades, exams, selected courses, academic progress and personal schedule.
- 北化在线THEOL owns courses, assignments and notices originating from THEOL.
- IMAP owns email metadata and on-demand cached bodies.
- `dataCatalog` owns source-tagged local archives such as fitness and the school-wide schedule cache.
- The academic-calendar service owns its official binary assets and editable PDF analyses in `%APPDATA%/THEIA/academic-calendar/manifest.json`; its safe, structured summary is mirrored into `dataCatalog.academicCalendar` through `cacheAcademicCalendarAssets()`.
- A collection must have one merge authority. Do not let an unrelated adapter replace it with an empty result.

## Feed Contract

`theia-feed.json` is an atomically generated compatibility export. It is derived data, not a source of truth.

- `events` is the normalized calendar-oriented view.
- `tasks` is the assignment/workspace view.
- `academic` contains academic collections.
- `localData` contains `dataCatalog` and mail metadata.

External AI should prefer the loopback API when THEIA is running. It can read the Feed when THEIA is not running. Both are read-only.

This external-consumer guidance does not apply to the in-process Advisor. A model request in a future `AdvisorRuntime` must instead freeze a versioned snapshot and its disclosed claim catalog for the lifetime of that request.

## Adding Data

For every new persisted collection:

1. Add a normalized default and migration handling in `core/schema.mjs`.
2. Add a fragment mapping in `core/store.mjs`.
3. Decide whether it belongs in the Feed, a local API endpoint, CSV/NDJSON export, or none of them.
4. Add tests for normalization, storage/reload and public output.
5. Update the matching focused document under `docs/ai/`.

Do not add data to a renderer-only cache when it is needed by future AI features.

## Academic Calendar PDFs

`core/academic-calendar-pdf-analysis.mjs` parses the official working-week calendar and teaching-schedule PDFs locally with their text layer. It never uses a model or stores the raw PDF text.

- `weeklyCalendar.entries` is flat: one official table row equals one editable event object. Keep uncertain dates as `null` while retaining `dateText`.
- `teachingSchedule.rows` preserves every cohort row; `match.selected` is only set when the student ID year and a defensible major keyword agree. A cohort-only result must remain explicit.
- Only letter markers present in the selected row may be copied into `markerNotes`; do not attach the full A-T legend.
- Reparse when either PDF changes, the parser version changes, or the local academic-track context changes. Parsing errors retain the last successful analysis.
- `weeklyCalendar.courseSelectionWindows` is derived only from course-selection events (论文题目补选 is excluded). The selection UI may apply the nearest not-yet-ended window, while `CourseSelectionJournal` keeps manually edited start/end values even when the sentinel is disabled.
- The teaching parser has explicit official-document aliases `高材 -> 材料` and `功材 -> 材料`. Keep the student's original track in context and record the alias in `match.basis`; never silently rewrite the profile to the table's shortened label.
