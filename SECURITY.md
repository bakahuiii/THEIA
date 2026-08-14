# Security Policy

## Supported builds

Security fixes are applied to the latest code on `main`. Packaged builds must
be regenerated from that source and verified before distribution.

## Reporting a vulnerability

Do not include real passwords, cookies, API keys, mail bodies, student IDs,
unredacted authenticated URLs, or campus data in a public issue.

Report a suspected vulnerability privately to the repository owner. Include a
minimal reproducible description, affected version, impact, and only sanitized
diagnostic event names or error codes. The project's
`auth-diagnostics.ndjson` guidance is documented in
`docs/ai/22-distribution-compatibility-and-recovery.md`.

## Project boundaries

THEIA must preserve these boundaries:

- campus requests may target only official `*.buct.edu.cn` services;
- local integration APIs bind only to `127.0.0.1` and remain read-only;
- passwords, cookies, authorization values, API keys, mail bodies, and raw
  authenticated URLs must not enter source control, diagnostics, exports, or
  loopback responses;
- course selection, submissions, tests, and other non-idempotent school-side
  actions are never automatically retried.

MIT licensing does not replace an Authenticode publisher certificate. Windows
installer signing is separately required for trusted broad distribution.
