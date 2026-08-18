import test from 'node:test'
import assert from 'node:assert/strict'
import { ADVISOR_BENCHMARK_CORPUS, createAdvisorBenchmarkSnapshot } from '../scripts/advisor-benchmark-corpus.mjs'
import {
  PROVIDER_COMPATIBILITY_MATRIX,
  runAdvisorBenchmark,
} from '../scripts/benchmark-advisor.mjs'

test('versioned advisor benchmark corpus is deterministic and has the release target sizes', () => {
  const first = createAdvisorBenchmarkSnapshot()
  const second = createAdvisorBenchmarkSnapshot()
  assert.equal(ADVISOR_BENCHMARK_CORPUS.schema, 'theia-advisor-benchmark-corpus/v1')
  assert.equal(first.revision, second.revision)
  assert.deepEqual(first.domainDigests, second.domainDigests)
  assert.equal(first.state.courses.length, 2_000)
  assert.equal(first.state.grades.length, 10_000)
  assert.equal(first.state.schedule.length, 10_000)
  assert.equal(first.state.notices.length, 5_000)
})

test('advisor benchmark produces cold/hot percentiles, RSS, and all provider matrix rows', async () => {
  const report = await runAdvisorBenchmark({ iterations: 2, warmup: 1 })
  assert.equal(report.schema, 'theia-advisor-benchmark-report/v1')
  assert.equal(report.timings.cold.samples, 2)
  assert.equal(report.timings.hot.samples, 2)
  assert.ok(Number.isFinite(report.timings.cold.p95Ms))
  assert.ok(Number.isFinite(report.timings.hot.p95Ms))
  assert.ok(report.memory.additionalRssBytes >= 0)
  assert.deepEqual(report.providerCompatibility.map((entry) => entry.provider), PROVIDER_COMPATIBILITY_MATRIX.map((entry) => entry.provider))
  assert.equal(report.providerCompatibility.every((entry) => entry.providerKnown), true)
})
