import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeObjectValue, mergeScheduleCollection, mergeSingleSourceCollection, mergeTermCollection } from '../core/sync-merge.mjs'

test('generic source merge preserves old data for failed or unconfirmed empty results', () => {
  const previous = [{ id: 'old', title: '旧' }]
  assert.deepEqual(mergeSingleSourceCollection(previous, [], { succeeded: true, emptyConfirmed: false }), previous)
  assert.deepEqual(mergeSingleSourceCollection(previous, [{ id: 'new' }], { succeeded: false }), previous)
  assert.deepEqual(mergeSingleSourceCollection(previous, [{ id: 'new' }], { succeeded: true, completeness: 'complete' }), [{ id: 'new' }])
})
test('partial term merge replaces only successful terms', () => {
  const previous = [{ id: 'old-a', termId: '2025-3' }, { id: 'old-b', termId: '2025-12' }]
  const next = mergeTermCollection(previous, [{ id: 'new-a', termId: '2025-3' }], { succeeded: true, completeness: 'partial', successfulTermIds: ['2025-3'] })
  assert.deepEqual(next, [{ id: 'old-b', termId: '2025-12' }, { id: 'new-a', termId: '2025-3' }])
})

test('positioned schedules cannot be erased by unpositioned course rows', () => {
  const previous = [{ id: 'scheduled', weekday: 1, period: '1-2' }]
  const fresh = [{ id: 'course-only', title: '课程列表' }]
  assert.deepEqual(mergeScheduleCollection(previous, fresh, { succeeded: true, completeness: 'partial' }), previous)
})

test('partial object updates preserve unknown fields and complete null can clear', () => {
  const previous = { gpa: 3.2, roots: [{ id: 'root' }] }
  assert.deepEqual(mergeObjectValue(previous, { gpa: 3.3 }, { succeeded: true, completeness: 'partial' }), { gpa: 3.3, roots: [{ id: 'root' }] })
  assert.deepEqual(mergeObjectValue(previous, null, { succeeded: true, completeness: 'complete', contentEmptyConfirmed: true }), null)
})
