# THEIA Local Data Interface

THEIA exposes a read-only loopback API for local integrations. It never exposes school passwords, cookies, authentication pages, raw school HTML, or model API keys.

While the desktop client is running, read `api-runtime.json` from the THEIA data directory or call `discoverTheiaApi()` from `theia-client.mjs`. The service is bound to `127.0.0.1`.

```js
import { fetchTheiaFeed } from './integration/theia-client.mjs'

const feed = await fetchTheiaFeed()
```

The normalized campus feed is available at `GET /v1/feed` and uses `theia-campus-feed/v1`. `GET /v1/snapshot` provides the complete local state, excluding credentials and browser sessions.

The read-only API surface is deliberately small and stable:

- `GET /v1/health`, `/v1/profile`, `/v1/sync`, and `/v1/collections`
- `GET /v1/terms`, `/v1/courses`, `/v1/schedule`, `/v1/exams`, `/v1/grades`, `/v1/selected-courses`, `/v1/assignments`, `/v1/workspaces`, `/v1/notices`, and `/v1/emails`
- `GET /v1/academic-progress`, `/v1/fitness?year=...`, `/v1/school-schedule?termId=...&keyword=...`, and `/v1/data-catalog`
- `GET /v1/{collection}.csv` and `/v1/calendar.ics` for interoperable exports

Collection responses include `schema`, `collection`, `updatedAt`, `total`, and `items`. Apply `?since=<ISO-8601>` to a collection endpoint or its CSV form to receive only records changed at or after that point. `academic-progress?since=...` returns `notModified: true` with no item when its snapshot predates the requested point.
