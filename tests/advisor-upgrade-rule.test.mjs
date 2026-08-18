import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import {
  ADVISOR_UPGRADE_RULE_CONFIG_SCHEMA,
  ADVISOR_UPGRADE_RULE_CONFIG_VERSION,
  loadTrustedUpgradeRule,
  serializeTrustedUpgradeRuleConfig,
  validateTrustedUpgradeRuleConfig,
} from '../electron/advisor-upgrade-rule.mjs'

function payload() {
  return {
    schema: ADVISOR_UPGRADE_RULE_CONFIG_SCHEMA,
    version: ADVISOR_UPGRADE_RULE_CONFIG_VERSION,
    source: {
      kind: 'official',
      label: '培养方案 2026 版',
      reference: 'BUCT:教务处/培养方案/2026',
      publishedAt: '2026-08-01T00:00:00.000Z',
    },
    rule: {
      id: 'year-two-credit-line',
      rulesVersion: 'buct-official/2026/v1',
      thresholdCredits: 30,
      requirementIds: ['required-node'],
    },
  }
}

test('trusted upgrade rule requires canonical digest and projects only the rule contract', () => {
  const parsed = JSON.parse(serializeTrustedUpgradeRuleConfig(payload()))
  const rule = validateTrustedUpgradeRuleConfig(parsed)
  assert.equal(rule.configSchema, ADVISOR_UPGRADE_RULE_CONFIG_SCHEMA)
  assert.equal(rule.configVersion, 1)
  assert.equal(rule.sourceKind, 'official')
  assert.equal(rule.sourceReference, 'BUCT:教务处/培养方案/2026')
  assert.equal(rule.thresholdCredits, 30)
  assert.deepEqual(rule.requirementIds, ['required-node'])
  assert.equal(Object.hasOwn(rule, 'digest'), false)
})

test('trusted upgrade rule rejects tampering, unsupported versions, and missing official provenance', () => {
  const parsed = JSON.parse(serializeTrustedUpgradeRuleConfig(payload()))
  assert.throws(() => validateTrustedUpgradeRuleConfig({ ...parsed, digest: '0'.repeat(64) }), /digest-mismatch/)
  assert.throws(() => validateTrustedUpgradeRuleConfig({ ...parsed, version: 2 }), /version-mismatch/)
  assert.throws(() => validateTrustedUpgradeRuleConfig({ ...parsed, source: { ...parsed.source, publishedAt: undefined } }), /official-source-date-missing/)
})

test('production loader fails closed for missing or invalid local config and accepts a verified file', async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-upgrade-rule-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const diagnostics = []
  assert.equal(await loadTrustedUpgradeRule({ root, onDiagnostic: (event, fields) => diagnostics.push({ event, fields }) }), null)
  await mkdir(resolve(root, 'advisor'), { recursive: true })
  await writeFile(resolve(root, 'advisor', 'upgrade-rule.v1.json'), '{"schema":"bad"}\n', 'utf8')
  assert.equal(await loadTrustedUpgradeRule({ root, onDiagnostic: (event, fields) => diagnostics.push({ event, fields }) }), null)
  await writeFile(resolve(root, 'advisor', 'upgrade-rule.v1.json'), serializeTrustedUpgradeRuleConfig(payload()), 'utf8')
  const loaded = await loadTrustedUpgradeRule({ root, onDiagnostic: (event, fields) => diagnostics.push({ event, fields }) })
  assert.equal(loaded.rulesVersion, 'buct-official/2026/v1')
  assert.equal(diagnostics.some((entry) => entry.event === 'advisor.upgrade_rule_rejected'), true)
  assert.equal(diagnostics.some((entry) => entry.event === 'advisor.upgrade_rule_loaded'), true)
  assert.match(await readFile(resolve(root, 'advisor', 'upgrade-rule.v1.json'), 'utf8'), /"digest"/u)
})
