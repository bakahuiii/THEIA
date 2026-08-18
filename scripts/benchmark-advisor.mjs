import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { MODEL_PROVIDER_IDS } from '../core/model-provider-policy.mjs'
import { advisorOverviewFromVersionedSnapshot } from '../electron/advisor-overview-service.mjs'
import { canonicalDigest } from '../core/advisor/canonical.mjs'
import { ADVISOR_BENCHMARK_CORPUS, createAdvisorBenchmarkSnapshot } from './advisor-benchmark-corpus.mjs'

export const ADVISOR_BENCHMARK_REPORT_SCHEMA = 'theia-advisor-benchmark-report/v1'
export const ADVISOR_BENCHMARK_THRESHOLDS = Object.freeze({
  coldP95Ms: 1_000,
  hotP95Ms: 200,
  additionalRssBytes: 150 * 1024 * 1024,
})

export const PROVIDER_COMPATIBILITY_MATRIX = Object.freeze([
  {
    provider: 'openai-compatible',
    transport: 'OpenAI Responses-compatible',
    streaming: 'implemented',
    agentToolCalls: 'serialized text JSON loop',
    usage: 'transport-dependent',
    verification: 'model-service/provider contract tests',
  },
  {
    provider: 'anthropic-messages',
    transport: 'Anthropic Messages',
    streaming: 'implemented',
    agentToolCalls: 'serialized text JSON loop',
    usage: 'transport-dependent',
    verification: 'protocol stream contract tests',
  },
  {
    provider: 'gemini-generate-content',
    transport: 'Gemini generateContent',
    streaming: 'implemented',
    agentToolCalls: 'serialized text JSON loop',
    usage: 'transport-dependent',
    verification: 'protocol stream contract tests',
  },
  {
    provider: 'ollama-chat',
    transport: 'Ollama chat',
    streaming: 'implemented',
    agentToolCalls: 'serialized text JSON loop',
    usage: 'transport-dependent',
    verification: 'protocol stream contract tests',
  },
])

function numericOption(value, fallback, minimum, maximum) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right)
  if (!sorted.length) return 0
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1))]
}

function summarizeTimings(values) {
  return {
    samples: values.length,
    p50Ms: Number(percentile(values, 0.5).toFixed(3)),
    p95Ms: Number(percentile(values, 0.95).toFixed(3)),
    minMs: Number(Math.min(...values).toFixed(3)),
    maxMs: Number(Math.max(...values).toFixed(3)),
  }
}

function rss() {
  return process.memoryUsage().rss
}

function providerMatrix() {
  const expected = new Set(MODEL_PROVIDER_IDS)
  return PROVIDER_COMPATIBILITY_MATRIX.map((entry) => ({
    ...entry,
    providerKnown: expected.has(entry.provider),
  }))
}

export async function runAdvisorBenchmark({
  iterations = 20,
  warmup = 3,
  seed = ADVISOR_BENCHMARK_CORPUS.seed,
  now = '2026-08-16T04:00:00.000Z',
} = {}) {
  const sampleCount = numericOption(iterations, 20, 1, 200)
  const warmupCount = numericOption(warmup, 3, 0, 50)
  global.gc?.()
  const baselineRss = rss()
  const snapshot = createAdvisorBenchmarkSnapshot({ seed })
  const corpusRss = rss()
  const evaluate = (value) => advisorOverviewFromVersionedSnapshot(value, { clock: () => now })
  for (let index = 0; index < warmupCount; index += 1) evaluate(snapshot)

  const coldTimings = []
  const hotTimings = []
  let peakRss = Math.max(corpusRss, rss())
  for (let index = 0; index < sampleCount; index += 1) {
    const coldStarted = performance.now()
    evaluate(structuredClone(snapshot))
    coldTimings.push(performance.now() - coldStarted)
    peakRss = Math.max(peakRss, rss())

    const hotStarted = performance.now()
    evaluate(snapshot)
    hotTimings.push(performance.now() - hotStarted)
    peakRss = Math.max(peakRss, rss())
  }

  const cold = summarizeTimings(coldTimings)
  const hot = summarizeTimings(hotTimings)
  const additionalRssBytes = Math.max(0, peakRss - corpusRss)
  const thresholds = {
    ...ADVISOR_BENCHMARK_THRESHOLDS,
    coldP95Pass: cold.p95Ms < ADVISOR_BENCHMARK_THRESHOLDS.coldP95Ms,
    hotP95Pass: hot.p95Ms < ADVISOR_BENCHMARK_THRESHOLDS.hotP95Ms,
    additionalRssPass: additionalRssBytes < ADVISOR_BENCHMARK_THRESHOLDS.additionalRssBytes,
  }
  return {
    schema: ADVISOR_BENCHMARK_REPORT_SCHEMA,
    corpus: ADVISOR_BENCHMARK_CORPUS,
    corpusDigest: canonicalDigest({ schema: ADVISOR_BENCHMARK_CORPUS.schema, version: ADVISOR_BENCHMARK_CORPUS.version, seed }),
    methodology: {
      cold: 'structuredClone of the versioned corpus followed by one overview evaluation',
      hot: 'repeated overview evaluation against the same committed snapshot',
      clock: now,
      iterations: sampleCount,
      warmup: warmupCount,
      rss: 'additional RSS is peak process RSS minus RSS after corpus construction; baseline is reported for context',
    },
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuCount: typeof process.availableParallelism === 'function' ? process.availableParallelism() : null,
    },
    timings: { cold, hot },
    memory: {
      baselineRssBytes: baselineRss,
      corpusRssBytes: corpusRss,
      peakRssBytes: peakRss,
      additionalRssBytes,
    },
    thresholds,
    providerCompatibility: providerMatrix(),
  }
}

function cliOptions(argv) {
  const options = {}
  for (const argument of argv) {
    const match = argument.match(/^--([^=]+)=(.*)$/u)
    if (match) options[match[1]] = match[2]
  }
  return options
}

async function main() {
  const options = cliOptions(process.argv.slice(2))
  const report = await runAdvisorBenchmark({
    iterations: options.iterations,
    warmup: options.warmup,
  })
  const output = `${JSON.stringify({ ...report, generatedAt: new Date().toISOString() }, null, 2)}\n`
  if (options.output) await writeFile(resolve(options.output), output, 'utf8')
  process.stdout.write(output)
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invoked) await main()
