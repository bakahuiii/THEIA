import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cacheFitnessResults,
  cacheSchoolScheduleResult,
  cachedFitnessResult,
  cachedSchoolScheduleResult,
  emptyDataCatalog,
  normalizeDataCatalog,
} from '../core/data-catalog.mjs'

test('fitness archive keeps source metadata and switches cached years without a fetch', () => {
  const catalog = cacheFitnessResults(emptyDataCatalog(), [
    {
      yearKey: '2025-2026_1',
      year: '2025',
      vitality: 4684,
      run50: 7.3,
      flex: 12.5,
      jump: 250,
      strength: 8,
      endureSecs: 295,
      gender: 'male',
      academicGrade: '大二',
      gradeGroup: '12',
      heightCm: 175,
      weightKg: 66.7,
      availableYears: [
        { yearKey: '2026-2027_1', label: '2026（1）' },
        { yearKey: '2025-2026_1', label: '2025（1）' },
      ],
    },
    {
      yearKey: '2026-2027_1',
      year: '2026',
      availableYears: [
        { yearKey: '2026-2027_1', label: '2026（1）' },
        { yearKey: '2025-2026_1', label: '2025（1）' },
      ],
    },
  ], '2026-08-11T01:00:00.000Z')

  const historical = cachedFitnessResult(catalog, '2025-2026_1')
  const current = cachedFitnessResult(catalog, '2026-2027_1')
  assert.equal(historical.endureSecs, 295)
  assert.equal(historical.cachedAt, '2026-08-11T01:00:00.000Z')
  assert.equal(current.refreshState, 'empty')
  assert.equal(current.vitality, null)
  assert.deepEqual(historical.availableYears.map((entry) => entry.yearKey), ['2026-2027_1', '2025-2026_1'])
  assert.equal(catalog.collections.fitness.records['2025-2026_1'].parserVersion, 'tygl-fitness/v1')
})

test('data catalog normalization drops malformed records and preserves valid snapshots', () => {
  const catalog = normalizeDataCatalog({
    updatedAt: 'invalid',
    collections: {
      fitness: {
        availableYears: [{ yearKey: '2025-2026_1', label: '2025（1）' }, { yearKey: 'bad', label: 'bad' }],
        records: {
          '2025-2026_1': {
            capturedAt: '2026-08-11T01:00:00.000Z',
            normalized: { yearKey: '2025-2026_1', vitality: '4684', gender: 'male' },
          },
          bad: { normalized: { vitality: 1 } },
        },
      },
    },
  })
  assert.equal(catalog.updatedAt, null)
  assert.deepEqual(Object.keys(catalog.collections.fitness.records), ['2025-2026_1'])
  assert.equal(cachedFitnessResult(catalog, '2025-2026_1').vitality, 4684)
})

test('school-wide schedule search cache retains the query scope and normalized teaching classes', () => {
  const catalog = cacheSchoolScheduleResult(emptyDataCatalog(), {
    scope: { termId: '2026-3', keyword: '高等数学', teacher: '', department: '' },
    total: 3271,
    items: [{ JXB_ID: 'JXB-01', courseCode: 'MAT13904T', title: '高等数学 A', JXBMC: '高分子 01', HBXX: '高材 2401、高材 2402', jxbzc: '备用教学班组成', teacher: '李老师', time: '星期一第1-2节', location: '第一教学楼 203', credits: '5.5', KCXZMC: '公共基础必修', KCLBMC: '素质教育课程', KKBMMC: '数理学院' }],
  }, '2026-08-11T02:00:00.000Z')

  const record = cachedSchoolScheduleResult(catalog, { termId: '2026-3', keyword: '高等数学', teacher: '', department: '' })
  assert.equal(record.total, 1)
  assert.equal(Object.values(catalog.collections.schoolSchedule.records)[0].total, 3271)
  assert.equal(record.capturedAt, '2026-08-11T02:00:00.000Z')
  assert.equal(record.fromCache, true)
  assert.equal(record.items[0].courseCode, 'MAT13904T')
  assert.equal(record.items[0].classId, 'JXB-01')
  assert.equal(record.items[0].className, '高分子 01')
  assert.equal(record.items[0].combinedClassInfo, '高材 2401、高材 2402')
  assert.equal(record.items[0].credits, 5.5)
  assert.equal(record.items[0].nature, '公共基础必修')
  assert.equal(record.items[0].category, '素质教育课程')
  assert.equal(record.items[0].department, '数理学院')
  assert.equal(record.scope.termId, '2026-3')

  const byCombinedClass = cachedSchoolScheduleResult(catalog, { termId: '2026-3', keyword: '高材 2402' })
  assert.equal(byCombinedClass.items.length, 1)
  assert.equal(byCombinedClass.items[0].className, '高分子 01')
})

test('school-wide schedule cache returns the full filtered local result', () => {
  const scope = { termId: '2026-3', keyword: 'calculus', pageSize: 24 }
  const catalog = cacheSchoolScheduleResult(emptyDataCatalog(), {
    scope,
    total: 13,
    complete: true,
    items: Array.from({ length: 13 }, (_, index) => ({
      title: `Calculus ${index + 1}`,
      courseCode: `MAT${String(index + 1).padStart(5, '0')}`,
    })),
  })

  const result = cachedSchoolScheduleResult(catalog, { ...scope, page: 2, pageSize: 12 })
  assert.equal(result.page, 1)
  assert.equal(result.items.length, 13)
  assert.equal(result.items[0].title, 'Calculus 1')
  assert.equal(result.items[12].title, 'Calculus 13')
})

test('school-wide schedule cache migrates a raw Zhengfang jxbzc composition', () => {
  const catalog = cacheSchoolScheduleResult(emptyDataCatalog(), {
    scope: { termId: '2026-3' },
    complete: true,
    total: 3,
    items: [
      { kcmc: 'Materials safety', jxbzc: '材料A2413;材料A2414' },
      { kcmc: 'Physics', jxbzc: '2401;2402' },
      { kcmc: 'Chemistry', HBXX: '   ', jxbzc: '化工A2401;化工A2402' },
    ],
  })

  const record = cachedSchoolScheduleResult(catalog, { termId: '2026-3' })
  assert.equal(record.items.length, 3)
  assert.equal(record.items[0].combinedClassInfo, '材料A2413;材料A2414')
  assert.equal(record.items[1].combinedClassInfo, '2401;2402')
  assert.equal(record.items[2].combinedClassInfo, '化工A2401;化工A2402')
})

test('school-wide schedule stores one complete term and applies later filters locally', () => {
  const catalog = cacheSchoolScheduleResult(emptyDataCatalog(), {
    scope: { termId: '2026-3' },
    total: 3,
    complete: true,
    items: [
      { title: 'Advanced calculus', courseCode: 'MAT10001T', teacher: 'Wang', category: 'Public foundation' },
      { title: 'Organic chemistry', courseCode: 'CHE10001T', teacher: 'Li', category: 'Major required' },
      { title: 'Physical chemistry', courseCode: 'CHE10002T', teacher: 'Li', category: 'Major required' },
    ],
  })

  const filtered = cachedSchoolScheduleResult(catalog, { termId: '2026-3', teacher: 'Li', page: 1, pageSize: 12 })
  assert.equal(Object.keys(catalog.collections.schoolSchedule.records).length, 1)
  assert.equal(filtered.total, 2)
  assert.deepEqual(filtered.items.map((item) => item.courseCode), ['CHE10001T', 'CHE10002T'])
})

test('school-wide schedule ignores obsolete caches that omit current fields', () => {
  const catalog = normalizeDataCatalog({
    collections: {
      schoolSchedule: {
        records: {
          '2026-3||||||': {
            parserVersion: 'jwglxt-school-schedule/v7',
            scope: { termId: '2026-3' },
            complete: true,
            total: 10,
            items: [{ title: 'Stale page', courseCode: 'OLD-1' }],
          },
        },
      },
    },
  })
  assert.deepEqual(catalog.collections.schoolSchedule.records, {})
})
