import test from 'node:test'
import assert from 'node:assert/strict'
import { preferredCourseCategory } from '../core/course-category.mjs'
import { normalizeState } from '../core/schema.mjs'

test('a specific requirement label wins over a generic course category', () => {
  assert.equal(
    preferredCourseCategory('\u4e13\u4e1a', '\u516c\u5171\u57fa\u7840\u5fc5\u4fee'),
    '\u516c\u5171\u57fa\u7840\u5fc5\u4fee',
  )
})

test('legacy course cards inherit the more specific grade category on load', () => {
  const state = normalizeState({
    courses: [
      {
        id: 'inorganic',
        code: 'CHE14000G',
        title: '\u65e0\u673a\u5316\u5b66\u539f\u7406',
        category: '\u4e13\u4e1a',
      },
    ],
    grades: [
      {
        id: 'grade-inorganic',
        courseCode: 'CHE14000G',
        nature: '\u516c\u5171\u57fa\u7840\u5fc5\u4fee',
      },
    ],
  })

  assert.equal(state.courses[0].category, '\u516c\u5171\u57fa\u7840\u5fc5\u4fee')
})
