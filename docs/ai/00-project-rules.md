# Project Rules

## Stack

- Renderer: React 19, TypeScript, Vite, shadcn/Radix.
- Desktop runtime: Electron with `contextIsolation` enabled.
- Business logic: ESM modules in `core/`, directly covered by the constrained `node --test --test-concurrency=4` runner.
- Data root: `%APPDATA%/THEIA`, override only with `THEIA_DATA_ROOT`.

## Modification Rules

1. Search for the adapter, schema, storage, bridge, UI and tests before changing behavior.
2. A cross-process feature updates its IPC handler, preload bridge, TypeScript bridge type, web fallback and UI together.
3. Normalize data in core before persistence. Views do not parse source HTML or retain credentials.
4. Add tests for parsers, credentials, persistence, data exports and selection/submission behavior when touched.
5. Do not broadly restyle `src/styles.css` for a narrowly scoped feature.

## Persistence and Privacy

- The primary persistent store is `data/manifest.json`, backed by immutable checked fragments. Read `01-runtime-data-flow.md` and `06-storage-schema.md` before changing it.
- `buct-data.json` and `buct-data.json.bak` are legacy migration snapshots, not active write targets.
- Browser cookies remain under `session/` and must never enter state, fragments, Feed, logs or documentation.
- Credential vaults use Electron safe storage. Never write plaintext passwords or API keys to data files.
- `auth-diagnostics.ndjson` records safe metadata only: never cookies, passwords, email bodies, attachment content or model keys.

## Verification

```powershell
npm test
npm run build
npm run lint
npm run cli -- status --json
```

Do not package unless the user explicitly requests it. Preserve user data and legacy snapshots during migrations.
