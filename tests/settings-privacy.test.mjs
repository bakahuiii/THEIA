import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { normalizeState } from '../core/schema.mjs'
import { CampusStore } from '../core/store.mjs'

const SETTINGS_KEYS = [
  'academicApiEnabled',
  'academicAuthMode',
  'apiPort',
  'autoSync',
  'mail',
  'modelBaseUrl',
  'modelModels',
  'modelName',
  'modelProvider',
  'modelRouting',
  'openOriginalInApp',
  'syncIntervalMinutes',
]

const STATE_KEYS = [
  'academicProgress',
  'appVersion',
  'assignments',
  'courses',
  'createdAt',
  'dataCatalog',
  'emails',
  'exams',
  'grades',
  'notices',
  'profile',
  'schedule',
  'schema',
  'selectedCourses',
  'settings',
  'sync',
  'terms',
  'updatedAt',
  'workspaces',
]

test('normalizeState retains only explicitly allowed settings', () => {
  const secret = 'synthetic-settings-secret'
  const state = normalizeState({
    settings: {
      apiPort: 18765,
      syncIntervalMinutes: 45,
      autoSync: true,
      openOriginalInApp: false,
      academicAuthMode: 'api',
      academicApiEnabled: true,
      mail: {
        enabled: true,
        pollIntervalMinutes: 17,
        password: secret,
        authorization: `Bearer ${secret}`,
      },
      modelBaseUrl: 'https://model.example/v1/',
      modelProvider: 'gemini-generate-content',
      modelName: 'advisor-model',
      modelModels: [' advisor-model ', '', 'fast-model'],
      modelRouting: {
        advisorFastModel: ' fast-model ',
        advisorDeepModel: 'advisor-model',
        courseworkModel: null,
        fallbackModel: 'advisor-model',
        apiKey: secret,
      },
      modelApiKey: secret,
      mailPassword: secret,
      authorization: `Bearer ${secret}`,
      unknownFutureSetting: { secret },
    },
  })

  assert.deepEqual(Object.keys(state.settings).sort(), SETTINGS_KEYS)
  assert.deepEqual(state.settings, {
    apiPort: 18765,
    syncIntervalMinutes: 45,
    autoSync: true,
    openOriginalInApp: false,
    academicAuthMode: 'api',
    academicApiEnabled: true,
    mail: {
      enabled: true,
      pollIntervalMinutes: 17,
    },
    modelBaseUrl: 'https://model.example/v1',
    modelProvider: 'gemini-generate-content',
    modelName: 'advisor-model',
    modelModels: ['advisor-model', 'fast-model'],
    modelRouting: {
      advisorFastModel: 'fast-model',
      advisorDeepModel: 'advisor-model',
      courseworkModel: null,
      fallbackModel: 'advisor-model',
    },
  })
  assert.equal(JSON.stringify(state).includes(secret), false)
})

test('normalizeState rejects malformed allowed values instead of retaining nested secrets', () => {
  const secret = 'synthetic-nested-settings-secret'
  const nested = { modelApiKey: secret }
  const state = normalizeState({
    createdAt: nested,
    updatedAt: [secret],
    settings: {
      apiPort: nested,
      syncIntervalMinutes: [secret],
      autoSync: nested,
      openOriginalInApp: [secret],
      academicAuthMode: nested,
      academicApiEnabled: [secret],
      mail: {
        enabled: nested,
        pollIntervalMinutes: [secret],
      },
      modelBaseUrl: nested,
      modelName: nested,
      modelModels: [nested, [secret], 'x'.repeat(301), ' valid-model '],
    },
  })

  assert.equal(state.settings.apiPort, 8765)
  assert.equal(state.settings.syncIntervalMinutes, 30)
  assert.equal(state.settings.autoSync, false)
  assert.equal(state.settings.openOriginalInApp, true)
  assert.equal(state.settings.academicAuthMode, 'unified')
  assert.equal(state.settings.academicApiEnabled, false)
  assert.deepEqual(state.settings.mail, { enabled: false, pollIntervalMinutes: 5 })
  assert.equal(state.settings.modelBaseUrl, '')
  assert.equal(state.settings.modelName, '')
  assert.deepEqual(state.settings.modelModels, ['valid-model'])
  assert.equal(typeof state.createdAt, 'string')
  assert.equal(typeof state.updatedAt, 'string')
  assert.equal(JSON.stringify(state).includes(secret), false)
})

test('normalizeState clamps finite numeric settings to their supported integer ranges', () => {
  const state = normalizeState({
    settings: {
      apiPort: 100_000.9,
      syncIntervalMinutes: 1.9,
      mail: { pollIntervalMinutes: 90.8 },
    },
  })
  assert.equal(state.settings.apiPort, 65535)
  assert.equal(state.settings.syncIntervalMinutes, 5)
  assert.equal(state.settings.mail.pollIntervalMinutes, 60)
})

test('legacy store migration persists only allowed settings in the settings fragment', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-settings-privacy-'))
  const secret = 'synthetic-legacy-secret'
  try {
    await writeFile(resolve(root, 'buct-data.json'), `${JSON.stringify({
      modelApiKey: secret,
      password: secret,
      unknownLegacyState: { secret },
      settings: {
        apiPort: 19876,
        autoSync: true,
        modelName: 'legacy-advisor',
        modelApiKey: secret,
        mail: {
          enabled: true,
          pollIntervalMinutes: 9,
          password: secret,
        },
      },
    })}\n`, 'utf8')

    const store = new CampusStore(root)
    const state = await store.load()
    const manifest = JSON.parse(await readFile(resolve(root, 'data', 'manifest.json'), 'utf8'))
    const reference = manifest.fragments['state/settings']
    const fragment = JSON.parse(await readFile(resolve(root, 'data', reference.path), 'utf8'))
    const metaReference = manifest.fragments['state/meta']
    const metaFragment = JSON.parse(await readFile(resolve(root, 'data', metaReference.path), 'utf8'))
    const persistedFragments = await Promise.all(Object.values(manifest.fragments).map(async (item) => (
      readFile(resolve(root, 'data', item.path), 'utf8')
    )))

    assert.deepEqual(Object.keys(state).sort(), STATE_KEYS)
    assert.deepEqual(Object.keys(store.snapshot()).sort(), STATE_KEYS)
    assert.deepEqual(Object.keys(state.settings).sort(), SETTINGS_KEYS)
    assert.deepEqual(Object.keys(fragment.value).sort(), SETTINGS_KEYS)
    assert.deepEqual(Object.keys(fragment.value.mail).sort(), ['enabled', 'pollIntervalMinutes'])
    assert.equal(fragment.value.apiPort, 19876)
    assert.equal(fragment.value.autoSync, true)
    assert.equal(fragment.value.modelName, 'legacy-advisor')
    assert.deepEqual(Object.keys(metaFragment.value).sort(), ['appVersion', 'createdAt', 'updatedAt'])
    assert.equal(JSON.stringify(state).includes(secret), false)
    assert.equal(JSON.stringify(store.snapshot()).includes(secret), false)
    assert.equal(JSON.stringify(fragment.value).includes(secret), false)
    assert.equal(persistedFragments.join('\n').includes(secret), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
