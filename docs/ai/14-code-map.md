# 代码索引

## Renderer

```text
src/main.tsx                  React boot + providers
src/App.tsx                   页面装配
src/hooks/useTheiaApp.ts      renderer orchestration
src/types.ts                  state + bridge contract
src/bridge.ts                 desktop/web bridge selection
src/styles.css                tokens and all application styles
src/views/                    feature views
src/views/settings/           settings sections
src/views/tools/              calculation tools
src/layout/                   titlebar/sidebar/workspace shell
src/components/ui/            shadcn/Radix primitives
```

## Main 与业务层

```text
electron/main.mjs             lifecycle, BrowserWindows, IPC, queue, notifications
electron/*-vault.mjs          encrypted credential/key storage
electron/model-service.mjs    OpenAI-compatible model workflows
core/store.mjs                atomic state persistence
core/schema.mjs               normalization, feed and exports
core/source-client.mjs        session-aware school HTTP client
core/sync-service.mjs         synchronized collection updates
core/domain-provenance.mjs    per-source outcomes and derived-domain provenance
core/catalog-provenance.mjs   atomic local-catalog data/provenance updates
core/advisor/                 deterministic quality, evidence, claims, risks and agenda
core/adapters/                source-specific acquisition
core/parsers/                 HTML/JSON normalization
core/local-api.mjs            loopback read-only API
core/data-catalog.mjs         nonstandard historical data archive
electron/advisor-overview-service.mjs one-snapshot offline overview assembly
electron/model-service.mjs    existing model transport/workflows; not AdvisorRuntime
```

`core/advisor/` is deliberately Electron-free and network-free. Its main-process service consumes `CampusStore.snapshotWithRevision()` directly; `core/local-api.mjs`, `theia-feed.json`, and `core/ai-export.mjs` are external-consumer paths, not internal Advisor dependencies. See `16-advisor-p0-foundation.md` before extending either path.

## Assets and references

运行时视觉资产在 `src/assets/`；校园地图图片刻意较大，不要随意重压。`.references/` 与 crawl 文件夹是研究夹具，不是 production dependency。`dist/`、`build/`、`release-bin/`、cache 和 test launch profile 是生成物，不要当作源代码编辑。
