# Storage Schema

## Primary Store

THEIA stores durable state at `%APPDATA%/THEIA` by default. `THEIA_DATA_ROOT` overrides this path.

```text
THEIA/
  data/
    manifest.json
    manifest.json.bak
    objects/
      state/
      academic/
      coursework/
      communication/
      catalog/
        school-schedule/
  buct-data.json          legacy migration snapshot only
  buct-data.json.bak      legacy recovery snapshot only
  theia-feed.json         derived compatibility export
  auth-diagnostics.ndjson safe diagnostics only
  academic-calendar/
    manifest.json         official assets plus local PDF analysis
    assets/               current calendar JPG and the two source PDFs
  session/                Electron session; never parse or export
```

`data/manifest.json` is the source-of-truth pointer. It has schema `theia-sharded-store/v1`, a revision, timestamps, and a map of fragment references.

Each fragment is immutable:

```json
{
  "schema": "theia-state-fragment/v1",
  "kind": "academic/grades",
  "digest": "sha256 of value JSON",
  "writtenAt": "ISO timestamp",
  "value": []
}
```

The manifest references paths such as `objects/academic/grades/<digest>.json`. Unchanged values reuse an existing object; a small setting or email change does not rewrite course history or the school-wide schedule.

## Fragment Map

| Fragment | CampusState field |
| --- | --- |
| `state/meta` | app version and timestamps |
| `state/profile`, `state/settings`, `state/sync` | identity-free state metadata |
| `academic/*` | terms, courses, schedule, exams, grades, selected courses, progress |
| `coursework/*` | assignments and workspaces |
| `communication/*` | notices and email metadata |
| `catalog/index` | all `dataCatalog` content except school schedule records |
| `catalog/school-schedule/<term>` | one complete cached school-wide schedule per term |

## Integrity and Recovery

1. New fragments are written to a temporary file and atomically renamed.
2. A new manifest is written only after every referenced fragment exists.
3. Before replacing the manifest, the prior manifest becomes `manifest.json.bak`.
4. On load, THEIA verifies every fragment schema, kind and SHA-256 digest.
5. THEIA uses the newest structurally valid manifest as the base and can recover an invalid fragment from the other manifest without discarding unrelated newer fragments.
6. If any required fragment is invalid in both manifests, load stops and leaves both manifests untouched instead of creating an empty store.
7. Only when sharded storage does not exist does THEIA import the legacy `buct-data.json` or `.bak` once and create fragments.

Do not delete legacy snapshots in code. Migration cleanup needs an explicit user-facing backup policy.

## Versioned Snapshot and Domain Provenance

In-process Advisor reads use `CampusStore.snapshotWithRevision()`. Its `state`, manifest `revision`, `committedAt`, and `domainDigests` are cloned from one committed view. Do not reconstruct this tuple by calling `snapshot()` and then reading storage metadata separately.

`CampusState.sync.domains` records source/domain provenance. Data quality has independent axes: content availability, freshness, completeness, and the latest attempt status may all describe the same domain at once. In particular:

- `contentEmptyConfirmed` describes the retained current content: a complete successful read previously proved that the collection was empty.
- `lastAttempt.emptyConfirmed` describes only the latest attempt. A later failure can therefore leave `contentEmptyConfirmed=true` while `lastAttempt.emptyConfirmed=false`.
- a missing legacy provenance record remains `freshness=unknown` and `completeness=unknown`; record timestamps and global `updatedAt` must not be used to invent a source watermark.

Aggregate domains are derived from required dependencies: `academic <- terms,courses,selected-courses`, `coursework <- assignments,workspaces`, and `local-data-catalog <- fitness,school-schedule,academic-calendar`. Their completeness is the weakest required dependency, and their `capturedAt`/`sourceSucceededAt` watermark is the oldest valid required dependency watermark. A missing required watermark yields no aggregate watermark rather than an optimistic fallback.

## Data Catalog

`dataCatalog` contains local source archives. Each record needs a stable identifier, scope, capture time, source, parser version and refresh state. Never store credentials, cookies, tokens, raw pages or unbounded mail bodies there.

School-wide schedule records are deliberately split by term. A full term is cached once; filtering and sorting must use the local record. Do not add UI or cache pagination: the course-selection view renders the complete filtered term.

`dataCatalog.academicCalendar` mirrors the asset metadata, OCR calendar, and `analysis` from the adjacent `academic-calendar/manifest.json`. Analysis contains only structured events, schedule rows, selected-row evidence and the marker definitions actually used by that row. The PDF binaries remain under `academic-calendar/assets`; raw PDF text, credentials and browser session data are never placed in the catalog or feed.

## Feed and API

`theia-feed.json` is derived from the latest durable snapshot and is atomically replaced. It may be large because it is a compatibility export for offline readers. Do not use it as a database or edit it manually.

When THEIA is running, use the loopback API on `127.0.0.1` instead:

```text
GET /v1/data-manifest
GET /v1/feed
GET /v1/grades
GET /v1/academic-progress
GET /v1/school-schedule?termId=2025-3&keyword=MAT13904T
```

Data endpoints are read-only. The separate Agent chat route may accept a question, but it must remain loopback-only and must not reveal credentials or browser session data.
