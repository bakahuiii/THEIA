# Distribution compatibility and recovery

This note describes the temporary compatibility profile used by THEIA while
the 0.4.x builds are being tested by a wider group. It is intentionally short
so an AI maintainer can load it without reading the whole security design.

## What changed

- Official campus source URLs accept both `http:` and `https:` but only for
  `buct.edu.cn` and its subdomains. Credentials, arbitrary protocols, lookalike
  hosts, and redirects outside that allowlist remain rejected.
- The loopback API binds to `127.0.0.1`, remains read-only, and since 0.6.0
  requires a per-instance token (`Authorization: Bearer <token>` or `?token=<token>`,
  written to `api-runtime.json`). The literal `Origin: null` of any `file:` page is
  deliberately **not** accepted: packaged renderers read data through IPC, and a
  foreign `Origin` on a real request is rejected with 403 before touching data.
  No public bind or wildcard origin was added.
- IPC still requires the active main window, the exact main frame process and
  routing identity, and a local application renderer. During startup only, an
  empty or `about:blank` frame URL is tolerated. Set `THEIA_STRICT_IPC=1` to
  disable this compatibility tolerance.
- Automatic authentication actors share a serialized lifecycle. THEIA never
  opens the THEOL and JWGLXT CAS pages concurrently because the school session
  can evict the first login. Background recovery stays single-flight until its
  actor window closes or its bounded timeout expires.
- A failed hidden browser navigation destroys the hidden window. The next
  request creates a clean instance instead of reusing a broken renderer.
- Idempotent GET/HEAD campus requests retry a small number of transient network
  failures, including Electron's temporary `Redirect was cancelled` condition.
  POST requests are never retried automatically.
- If a configured advisor model fails to produce a usable response, THEIA
  returns a retryable error and does not synthesize a local answer. A configured
  fallback model is used only for a retryable provider failure before visible
  output or tool side effects.

## Strict mode and future hardening

The compatibility profile is a distribution aid, not a new trust boundary.
Before a public release, test the strict profile with:

```powershell
$env:THEIA_STRICT_IPC = '1'
npm test
```

Strict IPC still accepts the exact packaged document (including harmless
query/hash changes) and the configured loopback development renderer. It
rejects a blank startup URL. If a packaged build needs that tolerance, capture
the actual sender/frame URL in the sanitized diagnostics and fix the startup
ordering rather than permanently widening it.

An unusable advisor response follows the normal retryable error path and is not
replaced with a locally generated answer. The only model fallback is the
configured provider failover described above.

Never widen these boundaries:

1. Do not bind the local API to `0.0.0.0`, a LAN address, or an external proxy.
2. Do not allow arbitrary CORS origins, arbitrary campus-looking domains, URL
   credentials, `file:` source navigation, or user-controlled redirect hosts.
3. Do not log passwords, cookies, authorization headers, API keys, mail bodies,
   or raw authenticated URLs with query parameters.
4. Do not retry course-selection, assignment submission, test submission, or
   any other non-idempotent POST.

## Release signing

`signAndEditExecutable` lets electron-builder update executable metadata, but
it is not an Authenticode certificate. A production installer must be signed
with the project's trusted publisher certificate, including the installer,
uninstaller, and the main executable. Verify the final artifacts before
distribution:

```powershell
Get-AuthenticodeSignature .\release-bin\THEIA-*-x64-win.exe
Get-AuthenticodeSignature .\release-bin\win-unpacked\THEIA.exe
```

Do not substitute a locally self-signed certificate. It does not establish
publisher trust on other machines and can make Windows reputation warnings
harder to diagnose. Until a trusted certificate is configured, label a build
as unsigned and expect SmartScreen to require an explicit user decision.

## Recovery diagnostics

The sanitized file `%APPDATA%\\THEIA\\auth-diagnostics.ndjson` records the
following useful events:

- `auth.open_requested`, `auth.target_loading`, `auth.source_authenticated`;
- `auth.frame_poll_skipped`, `auth.background_timeout`;
- `auth.recovery_failed`, `sync.auth_required`;
- `source.request_retry`, `source.background_window_reset`;
- `ipc.denied`, `advisor.provider_failover`, and `network.proxy_ready`.

When reporting a distribution failure, include the event names, timestamps,
source labels, and error codes, but remove account identifiers, URLs with query
parameters, and all secret values.
