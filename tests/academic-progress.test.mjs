import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeSyncResult, normalizeState } from '../core/schema.mjs'

test('existing API detail snapshots are migrated to the inferred requirement tree on load', () => {
  const state = normalizeState({
    academicProgress: {
      requirementSource: 'api-detail',
      program: "sfmjd='0' > Materials Engineering",
      categories: [
        { id: 'required', title: "sfmjd='0' > Required", required: 20, earned: 10, children: [], courses: [] },
        { id: 'choice', title: "sfmjd='1' > Elective route", required: 4, earned: 0, children: [], courses: [] },
      ],
      roots: [{ id: 'required', title: "sfmjd='0' > Required", children: [] }],
    },
  })

  const progress = state.academicProgress
  assert.equal(progress.requirementSource, 'api-inferred-tree')
  assert.equal(progress.roots.length, 1)
  assert.equal(progress.roots[0].children[0].title, 'Required')
  assert.equal(progress.roots[0].children[0].children[0].title, 'Elective route')
  assert.equal(progress.roots[0].children[0].children[0].relation, 'or')
})

test('an API summary cannot replace the restored academic tree with flat requirement rows', () => {
  const previous = normalizeState({
    academicProgress: {
      categories: [{ id: 'old', title: 'Existing tree', required: 2, children: [] }],
      roots: [{ id: 'old-root', title: 'Degree requirements', required: 2, children: [] }],
    },
  })
  const next = mergeSyncResult(previous, {
    academicProgress: {
      categories: [
        { id: 'core', title: "sfmjd='0' > Core", required: 10, earned: 4 },
        { id: 'route', title: "sfmjd='1' > Alternative", required: 2, earned: 0 },
      ],
    },
  })

  assert.equal(next.academicProgress.requirementSource, 'api-inferred-tree')
  assert.equal(next.academicProgress.roots.length, 1)
  assert.equal(next.academicProgress.roots[0].children[0].children[0].relation, 'or')
})

test('inferred API trees correct a program-name node from unanimous course nature', () => {
  const state = normalizeState({
    academicProgress: {
      requirementSource: 'api-inferred-tree',
      categories: [{
        id: 'foundation',
        title: '2024 Polymer Engineering',
        required: 60,
        courses: [
          { id: 'one', title: 'Mathematics', nature: 'Public foundation required' },
          { id: 'two', title: 'Physics', nature: 'Public foundation required' },
        ],
      }],
      roots: [{
        id: 'plan',
        title: 'Degree requirements',
        children: [{
          id: 'foundation',
          title: '2024 Polymer Engineering',
          required: 60,
          courses: [
            { id: 'one', title: 'Mathematics', nature: 'Public foundation required' },
            { id: 'two', title: 'Physics', nature: 'Public foundation required' },
          ],
        }],
      }],
    },
  })

  assert.equal(state.academicProgress.categories[0].title, 'Public foundation required')
  assert.equal(state.academicProgress.roots[0].children[0].title, 'Public foundation required')
})

test('legacy API rows without an actual study term are migrated from in-progress to not-taken', () => {
  const state = normalizeState({
    academicProgress: {
      requirementSource: 'api-tree-detail',
      roots: [{ id: 'plan', title: 'Plan', children: [], courses: [
        { id: 'planned', title: 'Planned course', studyStatus: '在读', academicYear: null, term: null, score: null, bestScore: null, point: null },
        { id: 'current', title: 'Current course', studyStatus: '在读', academicYear: '2026', term: '3', score: null, bestScore: null, point: null },
      ] }],
    },
  })
  assert.deepEqual(state.academicProgress.roots[0].courses.map((course) => course.studyStatus), ['未修', '在读'])
})
