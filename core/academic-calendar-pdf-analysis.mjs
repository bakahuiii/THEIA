import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { pdfTextLoadOptions } from './pdf-text-loader.mjs'

export const ANALYSIS_SCHEMA = 'theia-academic-calendar-analysis/v1'
export const PARSER_VERSION = '2026-08-12.3'

function clean(value) {
  return String(value ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim()
}

function compact(value) {
  return clean(value).replace(/\s+/g, '')
}

function iso(value) {
  const time = new Date(value || '').getTime()
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null
}

export async function extractPdfText(pdfPath) {
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: await readFile(pdfPath), ...pdfTextLoadOptions() })
  try {
    const result = await parser.getText()
    return String(result?.text || '')
  } finally {
    await parser.destroy().catch(() => undefined)
  }
}

function academicYearOf(text) {
  return clean(text).match(/(20\d{2})\s*[-－]\s*(20\d{2})/)?.[0]?.replace(/\s/g, '') || null
}

function semesterOf(text) {
  return clean(text).match(/第[一二三四]学期/)?.[0] || null
}

function semesterYear(year, month, semester) {
  const start = Number(String(year || '').slice(0, 4))
  if (!Number.isInteger(start) || !month) return null
  return semester === '第二学期' && month <= 8 ? start + 1 : start
}

function parseDateRange(dateText, schoolYear, semester) {
  const value = clean(dateText).replace(/[至到]/g, '～')
  const year = String(schoolYear || '').match(/(20\d{2})/)?.[1]
  const make = (month, day) => {
    const y = semesterYear(year, month, semester)
    return y && month && day ? iso(`${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`) : null
  }
  const range = value.match(/(\d{1,2})月(\d{1,2})日\s*[～~-]\s*(\d{1,2})月(\d{1,2})日/)
  if (range) return { startDate: make(+range[1], +range[2]), endDate: make(+range[3], +range[4]) }
  const sameMonth = value.match(/(\d{1,2})月(\d{1,2})日\s*[～~-]\s*(\d{1,2})日/)
  if (sameMonth) return { startDate: make(+sameMonth[1], +sameMonth[2]), endDate: make(+sameMonth[1], +sameMonth[3]) }
  const single = value.match(/(\d{1,2})月(\d{1,2})日/)
  if (single) return { startDate: make(+single[1], +single[2]), endDate: make(+single[1], +single[2]) }
  return { startDate: null, endDate: null }
}

function parseWeekLabel(value) {
  const label = clean(value)
  if (/开学前/.test(label)) return { weekLabel: label, weekStart: null, weekEnd: null }
  const numbers = [...label.matchAll(/\d+/g)].map((match) => Number(match[0]))
  return { weekLabel: label, weekStart: numbers[0] ?? null, weekEnd: numbers.at(-1) ?? null }
}

function courseSelectionWindow(entry) {
  if (!entry?.startDate || !entry?.endDate || !/选.*课|课程.*选/.test(entry.summary || '')) return null
  // Thesis topic “补选” is unrelated to the student course-selection portal.
  if (/论文|设计.*题目|题目.*补选/.test(entry.summary)) return null
  return {
    id: `selection-window:${entry.id}`,
    sourceEntryId: entry.id,
    summary: entry.summary,
    dateText: entry.dateText,
    weekdayText: entry.weekdayText,
    startDate: entry.startDate,
    endDate: entry.endDate,
    startAt: `${entry.startDate}T00:00`,
    endAt: `${entry.endDate}T23:59`,
  }
}

export function parseWeeklyCalendarPdf(text, options = {}) {
  const source = String(text || '').replace(/\r/g, '')
  const header = source.split('\n').find((line) => /学年.*学期.*周历/.test(line)) || ''
  const academicYear = academicYearOf(header)
  const semester = semesterOf(header)
  const body = source.split(/【备注】|\[备注\]/, 1)[0]
  const entries = []
  for (const rawLine of body.split('\n')) {
    const line = clean(rawLine)
    if (!line || /^(北京化工大学|周\s*次|--|\d+ of \d+)/.test(line) || /学年.*周历/.test(line)) continue
    const match = line.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/)
    const compactMatch = line.match(/^(\S+)\s+(\S+)\s+(.+)$/)
    const weekValue = match?.[1] || compactMatch?.[1]
    if (!weekValue || !/^\d|^第|^开学前/.test(weekValue)) continue
    const weeks = parseWeekLabel(weekValue)
    const dates = parseDateRange(match?.[2] || compactMatch?.[2], academicYear, semester)
    const summary = clean(match?.[4] || compactMatch?.[3])
    if (!summary) continue
    entries.push({
      id: `weekly:${entries.length}:${weekValue}:${summary.slice(0, 24)}`,
      ...weeks,
      dateText: match?.[2] || compactMatch?.[2],
      weekdayText: match?.[3] || null,
      summary,
      ...dates,
    })
  }
  const notesText = source.includes('【备注】') ? source.split('【备注】').slice(1).join('\n') : ''
  const contacts = [...notesText.matchAll(/([^\n]+学院|教务处)电话[^\n]*/g)].map((match) => clean(match[0]))
  return {
    schema: ANALYSIS_SCHEMA,
    parserVersion: PARSER_VERSION,
    source: { assetKey: 'weeklyCalendar', filename: options.filename || null, sourceUrl: options.sourceUrl || null, parsedAt: new Date().toISOString() },
    academicYear,
    semester,
    entries,
    courseSelectionWindows: entries.map(courseSelectionWindow).filter(Boolean),
    notes: { raw: notesText ? notesText.split('\n').map(clean).filter(Boolean).slice(0, 80) : [], contacts },
  }
}

function markerNotesOf(text) {
  const normalized = String(text || '').replace(/\r/g, '').replace(/表中\s*/g, '表中')
  const notes = {}
  const regex = /表中[“"']?([A-T])[”"']?\s*为\s*([\s\S]*?)(?=\n?\s*\d+[．.]\s*表中|$)/g
  for (const match of normalized.matchAll(regex)) notes[match[1]] = compact(match[2]).replace(/[。；;]+$/, '')
  return notes
}

function classGroupsOf(classText) {
  return compact(classText.replace(/^20\d{2}\s*级\s*/, ''))
    .split(/[、,，]/).map((item) => item.replace(/[（(].*$/, '').trim()).filter(Boolean)
}

function parseSchedule(scheduleText) {
  const text = clean(scheduleText)
  const teachingWeeks = Number(text.match(/教学\s*(\d+)\s*周/)?.[1]) || null
  const phases = []
  if (teachingWeeks) phases.push({ kind: 'teaching', weeks: teachingWeeks })
  if (/考试/.test(text)) phases.push({ kind: 'exam' })
  for (const match of text.matchAll(/(生产实习|毕业环节|毕业设计|课程设计|小学期)\s*(\d+)?\s*周?/g)) {
    if (!phases.some((phase) => phase.kind === match[1])) phases.push({ kind: match[1], weeks: match[2] ? Number(match[2]) : null })
  }
  const markers = [...new Set([...text.matchAll(/(?:^|[^A-Za-z])([A-T])(?:$|[^A-Za-z])/g)].map((match) => match[1]))]
  return { teachingWeeks, examWeeks: /考试/.test(text), phases, markers }
}

function rowGroups(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map(clean).filter(Boolean)
  const start = lines.findIndex((line) => /^20\d{2}\s*级/.test(line))
  const rows = []
  let parts = null
  let lastCohortYear = null
  const flush = () => { if (parts?.length) rows.push(parts.join(' ')); parts = null }
  for (let index = Math.max(0, start); index < lines.length; index += 1) {
    const line = lines[index]
    if (/^校\s*历|^--|^北京化工大学|^三\s+月/.test(line)) { flush(); break }
    const explicitCohort = line.match(/^(20\d{2})\s*级/)
    const lawCohort = /^法学\s+[A-Z]\d/.test(line) ? lastCohortYear : null
    if (explicitCohort || lawCohort) {
      flush()
      if (explicitCohort) lastCohortYear = explicitCohort[1]
      parts = [explicitCohort ? line : `${lawCohort}级${line}`]
      continue
    }
    if (parts) parts.push(line)
  }
  flush()
  return rows
}

function parseTeachingRow(row, markerNotes) {
  const normalized = compact(row).replace(/^(20\d{2})级/, '$1级')
  const yearMatch = normalized.match(/^(20\d{2})级/)
  if (!yearMatch) return null
  const cohortYear = Number(yearMatch[1])
  const rest = normalized.slice(yearMatch[0].length)
  const scheduleIndex = rest.search(/教学|毕业环节|毕业设计|毕设设计|法学|小学期/)
  const classText = scheduleIndex >= 0 ? rest.slice(0, scheduleIndex) : rest
  const scheduleText = scheduleIndex >= 0 ? rest.slice(scheduleIndex) : ''
  const schedule = parseSchedule(scheduleText)
  return { cohortYear, classGroups: classGroupsOf(`${cohortYear}级${classText}`), rawClassText: `${cohortYear}级${classText}`, schedule, rawScheduleText: scheduleText, markers: schedule.markers, markerNotes: Object.fromEntries(schedule.markers.filter((key) => markerNotes[key]).map((key) => [key, markerNotes[key]])) }
}

export function inferAcademicTrack({ profile = null, courses = [], academicTrack = null } = {}) {
  const studentId = String(profile?.studentId || '')
  const cohortYear = /^20\d{2}/.test(studentId) ? Number(studentId.slice(0, 4)) : null
  const explicit = (Array.isArray(academicTrack) ? academicTrack : academicTrack ? [academicTrack] : [])
    .map((value) => String(value).trim()).filter(Boolean)
  // The official table collapses the material-school diversion into “材料”.
  // Keep the student's actual track while adding only its documented table alias.
  const tableAliases = { 高材: ['材料'], 功材: ['材料'], 高分子材料: ['材料'] }
  // General-education titles such as “化学” and “计算机” cannot safely identify
  // a major. Only use distinctive program words as an automatic hint; a user
  // supplied academicTrack remains authoritative and may contain any wording.
  const courseSignals = ['材料', '高材', '功材', '自动化', '机工', '装备', '机实', '大数据', '计科', '测控', '信工', '通信', '国贸', '会计', '财管', '生工', '生高', '生信', '生医', '制药', '数媒']
  const haystack = courses.map((course) => `${course?.title || ''} ${course?.category || ''} ${course?.department || ''}`).join(' ')
  const courseKeywords = courseSignals.filter((keyword) => haystack.includes(keyword))
  const aliases = explicit.flatMap((keyword) => tableAliases[keyword] || [])
  const keywords = [...new Set([...explicit, ...aliases, ...courseKeywords])]
  const basis = [
    cohortYear ? `studentId:${cohortYear}` : null,
    ...explicit.map((keyword) => `profile.academicTrack:${keyword}`),
    ...explicit.flatMap((keyword) => (tableAliases[keyword] || []).map((alias) => `table-alias:${keyword}->${alias}`)),
    ...courseKeywords.map((keyword) => `course-text:${keyword}`),
  ].filter(Boolean)
  return { cohortYear, keywords, basis }
}

export function academicTrackContextKey(context = {}) {
  const track = inferAcademicTrack(context)
  return JSON.stringify({ cohortYear: track.cohortYear, keywords: [...track.keywords].sort() })
}

export function parseTeachingSchedulePdf(text, options = {}) {
  const source = String(text || '').replace(/\r/g, '')
  const header = source.split('\n').find((line) => /学年.*教学进程表/.test(line)) || ''
  const firstRow = source.search(/\n20\d{2}\s*级/)
  const notes = markerNotesOf(source.slice(0, firstRow >= 0 ? firstRow : source.length))
  const rows = rowGroups(source).map((row) => parseTeachingRow(row, notes)).filter(Boolean)
  const track = inferAcademicTrack(options)
  const candidates = rows.filter((row) => !track.cohortYear || row.cohortYear === track.cohortYear)
  const matched = candidates.find((row) => track.keywords.some((keyword) => row.classGroups.includes(keyword) || row.rawClassText.includes(keyword))) || null
  const broadCohortRow = candidates.length
    ? [...candidates].sort((left, right) => right.classGroups.length - left.classGroups.length)[0]
    : null
  const selected = matched || (broadCohortRow?.classGroups.length > 1 ? broadCohortRow : null)
  return {
    schema: ANALYSIS_SCHEMA,
    parserVersion: PARSER_VERSION,
    source: { assetKey: 'teachingSchedule', filename: options.filename || null, sourceUrl: options.sourceUrl || null, parsedAt: new Date().toISOString() },
    academicYear: academicYearOf(header),
    semester: semesterOf(header),
    markerNotes: notes,
    rows,
    match: { status: matched ? 'matched' : candidates.length ? 'cohort-only' : 'unmatched', basis: track.basis, cohortYear: track.cohortYear, keywords: track.keywords, contextKey: academicTrackContextKey(options), selected },
  }
}

export async function analyzeAcademicCalendarPdfs({ weeklyPath, teachingPath, assets = {}, calendar = null, profile = null, courses = [], academicTrack = null } = {}) {
  const result = { schema: ANALYSIS_SCHEMA, parserVersion: PARSER_VERSION, updatedAt: new Date().toISOString(), weeklyCalendar: null, teachingSchedule: null }
  if (weeklyPath) result.weeklyCalendar = parseWeeklyCalendarPdf(await extractPdfText(weeklyPath), { ...assets.weeklyCalendar, filename: basename(weeklyPath) })
  if (teachingPath) result.teachingSchedule = parseTeachingSchedulePdf(await extractPdfText(teachingPath), { ...assets.teachingSchedule, filename: basename(teachingPath), profile, courses, academicTrack, calendar })
  return result
}
