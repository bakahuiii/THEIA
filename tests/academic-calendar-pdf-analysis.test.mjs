import test from 'node:test'
import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import { parseTeachingSchedulePdf, parseWeeklyCalendarPdf } from '../core/academic-calendar-pdf-analysis.mjs'
import { pdfTextLoadOptions } from '../core/pdf-text-loader.mjs'

const WEEKLY = `2025-2026学年第二学期本科教学工作周历（学生版）
周 次 日 期 星 期 事 项
0 2月27日～3月1日 五～日 上学期课程补（缓）考，具体见教务管理系统
1～2 3月2日～3月12日 一～四 3月批次本科生毕业、学位资格再审核
18 6月29日～7月5日 一～日 期末考试
第3学期第1-3周 7月6日～7月24日 一～五 组织2025级大类分专业工作
开学前1周 8月24日~8月28日 一～五 学生网上正选下学期课程
【备注】：[1] 教务处电话：东区64435704`

const TEACHING = `北京化工大学 2025-2026 学年第二学期本科生教学进程表
备注：
1．表中“A”为数据结构课程设计
2．表中“D”为电气工程综合实践
2024 级化工、材料、机电、
信息、经管、化学、数理、
文法、生命、工程师、艺术、
宏德
教学 17 周 考试
2023 级自动化、自实 教学 3 周 D 教学 13 周 考试
校
历 班
级`

test('PDF text extraction uses bundled CMaps and standard fonts', async () => {
  const options = pdfTextLoadOptions()
  assert.equal(options.cMapPacked, true)
  assert.equal(options.useWorkerFetch, false)
  await access(`${options.cMapUrl}UniGB-UCS2-H.bcmap`)
  await access(`${options.standardFontDataUrl}FoxitDingbats.pfb`)
})

test('weekly calendar becomes one editable entry per PDF row', () => {
  const result = parseWeeklyCalendarPdf(WEEKLY)
  assert.equal(result.entries.length, 5)
  assert.deepEqual(result.entries[0], {
    id: 'weekly:0:0:上学期课程补（缓）考，具体见教务管理系统',
    weekLabel: '0', weekStart: 0, weekEnd: 0,
    dateText: '2月27日～3月1日', weekdayText: '五～日',
    summary: '上学期课程补（缓）考，具体见教务管理系统', startDate: '2026-02-27', endDate: '2026-03-01',
  })
  assert.equal(result.entries[2].summary, '期末考试')
  assert.equal(result.entries[3].weekLabel, '第3学期第1-3周')
  assert.equal(result.entries[4].startDate, '2026-08-24')
  assert.equal(result.courseSelectionWindows.length, 1)
  assert.equal(result.courseSelectionWindows[0].startAt, '2026-08-24T00:00')
  assert.equal(result.courseSelectionWindows[0].endAt, '2026-08-28T23:59')
})

test('teaching schedule joins wrapped cohorts and retains only used marker notes', () => {
  const result = parseTeachingSchedulePdf(TEACHING, {
    profile: { studentId: '2024TEST01' },
    courses: [{ title: '材料科学基础' }],
  })
  assert.equal(result.rows.length, 2)
  assert.equal(result.rows[0].rawClassText, '2024级化工、材料、机电、信息、经管、化学、数理、文法、生命、工程师、艺术、宏德')
  assert.deepEqual(result.rows[0].schedule.phases, [{ kind: 'teaching', weeks: 17 }, { kind: 'exam' }])
  assert.deepEqual(result.rows[0].markerNotes, {})
  assert.equal(result.match.status, 'matched')
  assert.equal(result.match.selected.classGroups.includes('材料'), true)
  const automation = result.rows[1]
  assert.deepEqual(automation.markers, ['D'])
  assert.deepEqual(automation.markerNotes, { D: '电气工程综合实践' })

  const cohortOnly = parseTeachingSchedulePdf(TEACHING, { profile: { studentId: '2024TEST01' } })
  assert.equal(cohortOnly.match.status, 'cohort-only')
  assert.equal(cohortOnly.match.selected.rawClassText.includes('材料'), true)
  assert.equal(cohortOnly.match.selected.schedule.teachingWeeks, 17)

  const materialTrack = parseTeachingSchedulePdf(TEACHING, {
    profile: { studentId: '2024TEST01' }, academicTrack: '高材',
  })
  assert.equal(materialTrack.match.status, 'matched')
  assert.equal(materialTrack.match.selected.classGroups.includes('材料'), true)
  assert.equal(materialTrack.match.basis.includes('table-alias:高材->材料'), true)

  const functionalMaterialTrack = parseTeachingSchedulePdf(TEACHING, {
    profile: { studentId: '2024TEST01' }, academicTrack: '功材',
  })
  assert.equal(functionalMaterialTrack.match.status, 'matched')
  assert.equal(functionalMaterialTrack.match.basis.includes('table-alias:功材->材料'), true)
})
