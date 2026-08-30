import { ADVISOR_READ_ONLY_TOOL_NAMES } from './read-only-tools.mjs'
import { parseAdvisorAgentTurn } from './read-only-agent-helpers.mjs'

const STREAM_TEXT_DECISION_CHARACTERS = 192

export function streamProtocolState(value) {
  const source = String(value ?? '').trimStart()
  if (!source.startsWith('{')) return 'text'
  const afterBrace = source.slice(source.match(/^\{\s*/u)[0].length)
  const key = '"schema"'
  if (!afterBrace || key.startsWith(afterBrace)) return 'pending'
  if (!afterBrace.startsWith(key)) return 'text'
  const afterKey = afterBrace.slice(key.length).trimStart()
  if (!afterKey) return 'pending'
  if (!afterKey.startsWith(':')) return 'text'
  const valueStart = afterKey.slice(1).trimStart()
  const marker = '"theia-advisor-tool-call/v1"'
  if (!valueStart || marker.startsWith(valueStart)) return 'pending'
  return valueStart.startsWith(marker) ? 'tool' : 'text'
}

// A provider streams every model turn through the same callback, including
// internal tool-call JSON. Buffer only a brief classification window for
// ordinary prose, while retaining a possible protocol turn until it is safe.
export function createAgentStreamGate(onEvent, toolNames = ADVISOR_READ_ONLY_TOOL_NAMES) {
  let buffered = ''
  let emitted = ''
  let mode = 'undecided'

  const emit = (delta) => {
    if (!delta) return
    emitted += delta
    onEvent?.({ type: 'delta', delta })
  }

  const push = (delta) => {
    const value = String(delta ?? '')
    if (!value) return
    if (mode === 'protected') {
      buffered += value
      return
    }
    if (mode === 'candidate') {
      buffered += value
      const state = streamProtocolState(buffered)
      if (state === 'tool') {
        mode = 'protected'
        return
      }
      if (state === 'pending') return
      if (emitted) {
        emit(buffered)
        buffered = ''
        mode = 'text'
        return
      }
      mode = 'undecided'
      const firstBrace = buffered.indexOf('{')
      if (firstBrace >= 0) {
        const nextCandidate = buffered.slice(firstBrace)
        const nextState = streamProtocolState(nextCandidate)
        if (nextState !== 'text') {
          if (firstBrace > 0 && buffered.length >= STREAM_TEXT_DECISION_CHARACTERS) emit(buffered.slice(0, firstBrace))
          buffered = nextCandidate
          mode = nextState === 'tool' ? 'protected' : 'candidate'
          return
        }
      }
      if (buffered.length >= STREAM_TEXT_DECISION_CHARACTERS) {
        emit(buffered)
        buffered = ''
        mode = 'text'
      }
      return
    }
    if (mode === 'text') {
      const brace = value.indexOf('{')
      if (brace < 0) {
        emit(value)
        return
      }
      const prefix = value.slice(0, brace)
      const candidate = value.slice(brace)
      const state = streamProtocolState(candidate)
      if (state === 'text') {
        emit(value)
        return
      }
      emit(prefix)
      buffered = candidate
      mode = state === 'tool' ? 'protected' : 'candidate'
      return
    }
    buffered += value
    const firstBrace = buffered.indexOf('{')
    if (firstBrace >= 0) {
      const candidate = buffered.slice(firstBrace)
      const state = streamProtocolState(candidate)
      if (state !== 'text') {
        if (firstBrace > 0 && buffered.length >= STREAM_TEXT_DECISION_CHARACTERS) emit(buffered.slice(0, firstBrace))
        buffered = candidate
        mode = state === 'tool' ? 'protected' : 'candidate'
        return
      }
    }
    if (buffered.length < STREAM_TEXT_DECISION_CHARACTERS) return
    emit(buffered)
    buffered = ''
    mode = 'text'
  }

  const finish = (responseText) => {
    const complete = String(responseText ?? '')
    const visible = complete || buffered
    const turn = parseAdvisorAgentTurn(visible, { toolNames })
    if (turn.kind === 'tool' || turn.kind === 'invalid-tool') return
    const finalText = turn.text
    if (finalText.startsWith(emitted)) {
      emit(finalText.slice(emitted.length))
      return
    }
    // A provider may normalize whitespace in its terminal result. In that
    // uncommon case, prefer the authoritative final result over stale deltas.
    if (!emitted) emit(finalText)
  }

  return Object.freeze({ push, finish })
}
