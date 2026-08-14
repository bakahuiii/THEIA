import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createAdvisorReadOnlyTools,
  parseAdvisorAgentTurn,
  runReadOnlyAdvisorAgent,
} from '../core/advisor/index.mjs'

function tools() {
  return createAdvisorReadOnlyTools({
    snapshotRevision: 'agent-revision-001',
    dataQuality: { schema: 'quality', domains: {} },
    claims: [{ id: 'claim-gpa', displayText: 'GPA is locally computed', evidenceRefs: ['evidence-gpa'] }],
    urgentItems: [{ id: 'deadline-1', domain: 'assignments', title: 'Submit work' }],
    risks: [{ id: 'risk-1', domain: 'academic-progress', title: 'Need review' }],
  })
}

function narrative() {
  return JSON.stringify({
    schema: 'theia-advisor-model-narrative/v1',
    blocks: [], recommendations: [], uncertainties: [], questionsForUser: [], suggestedActionIds: [],
  })
}

test('read-only agent accepts only the declared tool-call and final schemas', () => {
  assert.deepEqual(parseAdvisorAgentTurn(JSON.stringify({
    schema: 'theia-advisor-tool-call/v1', tool: 'find_claims', args: { query: 'GPA' },
  })), { kind: 'tool', tool: 'find_claims', args: { query: 'GPA' } })
  assert.equal(parseAdvisorAgentTurn(narrative()).kind, 'final')
  assert.throws(() => parseAdvisorAgentTurn(JSON.stringify({
    schema: 'theia-advisor-tool-call/v1', tool: 'open_url', args: {}, url: 'https://example.test',
  })), /unknown field/)
  assert.equal(
    parseAdvisorAgentTurn(`Here is the result:\n\`\`\`json\n${narrative()}\n\`\`\``).kind,
    'final',
  )
})

test('read-only agent executes projected tools then returns a final narrative without ambient capability', async () => {
  const requests = []
  const replies = [
    JSON.stringify({ schema: 'theia-advisor-tool-call/v1', tool: 'find_claims', args: { query: 'GPA' } }),
    narrative(),
  ]
  const result = await runReadOnlyAdvisorAgent({
    model: 'agent-model', tools: tools(), messages: [{ role: 'user', content: 'Check my GPA.' }],
    provider: {
      async generate(request) {
        requests.push(structuredClone(request))
        return { text: replies.shift() }
      },
    },
  })
  assert.equal(result.text, narrative())
  assert.equal(result.modelCalls, 2)
  assert.deepEqual(result.calls.map((call) => call.name), ['find_claims'])
  assert.equal(requests[1].messages.at(-1).role, 'user')
  assert.match(requests[1].messages.at(-1).content, /claim-gpa/)
  assert.ok(requests.every((request) => request.messages.every((message) => ['system', 'user', 'assistant'].includes(message.role))))
})

test('read-only agent fails closed on repeated tools and cannot exceed its tool budget', async () => {
  const reply = JSON.stringify({ schema: 'theia-advisor-tool-call/v1', tool: 'get_data_health', args: {} })
  await assert.rejects(runReadOnlyAdvisorAgent({
    model: 'agent-model', tools: tools(), messages: [{ role: 'user', content: 'Check.' }],
    provider: { async generate() { return { text: reply } } },
}), /per-tool budget exhausted/)
})

test('read-only agent repairs a final narrative rejected by the evidence verifier', async () => {
  const invalid = JSON.stringify({
    schema: 'theia-advisor-model-narrative/v1',
    blocks: [{ claimIds: ['claim:forged'], referenceIds: [], explanation: 'invalid' }],
    recommendations: [], uncertainties: [], questionsForUser: [], suggestedActionIds: [],
  })
  const replies = [invalid, narrative()]
  const result = await runReadOnlyAdvisorAgent({
    model: 'agent-model', tools: tools(), messages: [{ role: 'user', content: 'Check.' }],
    provider: { async generate() { return { text: replies.shift() } } },
    validateFinal(text) {
      if (text.includes('claim:forged')) {
        const error = new Error('unknown claim')
        error.code = 'citation_invalid'
        throw error
      }
    },
  })
  assert.equal(result.text, narrative())
  assert.equal(result.modelCalls, 2)
})
