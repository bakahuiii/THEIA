import { THEIA_READABLE_DOMAINS } from './theia.mjs'
import {
  compact,
  formatClock,
  formatTime,
  safeReply,
  splitCommand,
  theiaError,
} from './command-formatters.mjs'

export function createTheiaCommands({ theia, now = () => new Date() } = {}) {
  const theiaDomainLabels = Object.freeze({
    courses: '课程',
    schedule: '课表',
    grades: '成绩',
    exams: '考试',
    'selected-courses': '已选课程',
    assignments: '作业',
    notices: '通知',
    'academic-progress': '学业进度',
    'academic-extras': '教务资料',
  })

  function theiaSections(overview) {
    return [...(overview?.sections ?? []), ...(overview?.extraDomains ?? [])]
      .filter((section) => theiaDomainLabels[section?.domain])
  }

  function theiaSection(overview, domain) {
    return theiaSections(overview).find((section) => section.domain === domain) ?? null
  }

  function theiaQuality(section) {
    if (!section) return '状态未知'
    if (section.completeness === 'complete') return '完整'
    if (section.completeness === 'partial') return '部分'
    if (section.completeness === 'unknown') return '未知'
    return compact(section.statusLabel || section.status || '状态未知', 30)
  }

  function theiaSyncLines(overview, domain = null) {
    const sync = overview?.sync ?? {}
    const section = domain ? theiaSection(overview, domain) : null
    const lines = []
    if (sync.lastSuccessAt && Number.isFinite(Date.parse(sync.lastSuccessAt))) {
      lines.push(`最近成功同步：${formatTime(sync.lastSuccessAt)}`)
    } else {
      lines.push('注意：尚无成功同步记录，空结果不能解释为没有数据。')
    }
    if (sync.lastRunAt && Number.isFinite(Date.parse(sync.lastRunAt))
      && (!sync.lastSuccessAt || Date.parse(sync.lastRunAt) > Date.parse(sync.lastSuccessAt))) {
      lines.push('注意：最近一次同步尝试尚未形成新的成功水位。')
    }
    if (section) {
      lines.push(`${section.label || theiaDomainLabels[domain]}：${section.count ?? 0} 条 · ${theiaQuality(section)}${section.stale ? ' · 可能过期' : ''}`)
      if (section.status === 'not-read') lines.push('注意：该数据域尚未成功读取，空结果不能解释为没有数据。')
      if (section.status === 'auth-required') lines.push('注意：该数据域需要在 THEIA 中重新登录。')
      if (section.status === 'failed') lines.push('注意：该数据域最近读取失败，当前结果可能不完整。')
      if (section.retainedPrevious) lines.push('注意：本轮读取失败，当前显示沿用了上一次保留数据。')
      if (section.completeness === 'partial') lines.push('注意：该数据域只完成了部分读取。')
    } else if (sync.lastError) {
      lines.push('注意：最近同步存在未完成来源，当前显示可能不完整。')
    }
    return lines
  }

  function chinaDayBounds() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai',
    }).formatToParts(now()).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
    const start = Date.parse(`${parts.year}-${parts.month}-${parts.day}T00:00:00+08:00`)
    return { start, end: start + 24 * 60 * 60 * 1_000 }
  }

  function dated(value) {
    const timestamp = Date.parse(value ?? '')
    return Number.isFinite(timestamp) ? timestamp : null
  }

  function recordTitle(item) {
    const title = item?.title || item?.label || item?.name || '未命名记录'
    const course = item?.courseName
    return compact(course && title !== course ? `${course} · ${title}` : course || title, 130)
  }

  function courseTitle(item) {
    const title = item?.title || item?.label || item?.courseName || '未命名课程'
    const course = item?.courseName
    const name = course && title !== course ? `${course} · ${title}` : title
    return item?.courseCode ? `${compact(item.courseCode, 30)} · ${compact(name, 100)}` : compact(name, 130)
  }

  function displayNumber(value) {
    return value === null || value === undefined || value === '' ? '未提供' : compact(value, 40)
  }

  function chinaWeekday() {
    const { start } = chinaDayBounds()
    const day = new Date(start).getUTCDay()
    return day === 0 ? 7 : day
  }

  function scheduleWeekday(value) {
    const raw = String(value ?? '').trim().toLowerCase()
    const numeric = Number(raw)
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 7) return numeric
    const match = raw.match(/(?:星期|周|礼拜)?([一二三四五六日天])/u)
    if (!match) return null
    return { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 }[match[1]] ?? null
  }

  async function theiaStatus() {
    const [overview, assignments, exams, progress, analysis, plan] = await Promise.all([
      theia.overview(),
      theia.assignments({ scope: 'current', limit: 100 }),
      theia.exams({ scope: 'current', limit: 100 }),
      theia.academicProgress(),
      theia.academicAnalysis(),
      theia.academicPlanDocument(),
    ])
    const sections = theiaSections(overview)
    const relevant = THEIA_READABLE_DOMAINS.map((domain) => theiaSection(overview, domain)).filter(Boolean)
    const pendingAssignments = (assignments?.items ?? []).filter((item) => !['submitted', 'completed'].includes(item?.status)).length
    const upcomingExams = (exams?.items ?? []).filter((item) => {
      const at = dated(item?.startAt || item?.examTime)
      return at === null || at >= chinaDayBounds().start
    }).length
    const progressItem = progress?.item
    const analysisItem = analysis?.item
    const planItem = plan?.item
    return safeReply([
      '【THEIA · 状态】',
      '本机只读接口：已连接',
      `当前学期：${overview.currentTerm?.label || '未标注'}`,
      `数据域：${relevant.map((section) => `${section.label || theiaDomainLabels[section.domain]} ${section.count ?? 0}`).join(' · ')}`,
      `质量：${relevant.map((section) => `${section.label || theiaDomainLabels[section.domain]} ${theiaQuality(section)}${section.stale ? '（旧）' : ''}${section.retainedPrevious ? '（沿用旧数据）' : ''}`).join(' · ')}`,
      `近期事项：待处理作业 ${pendingAssignments} · 后续考试 ${upcomingExams}`,
      ...(progressItem ? [`学业进度：${progressItem.gpa !== undefined ? `GPA ${displayNumber(progressItem.gpa)}` : 'GPA 未提供'}${progressItem.program ? ` · ${compact(progressItem.program, 100)}` : ''}`] : ['学业进度：暂无可确认数据']),
      ...(analysisItem ? [`学业分析：${analysisItem.gpa?.value !== undefined ? `GPA ${displayNumber(analysisItem.gpa.value)}` : 'GPA 未提供'}${analysisItem.creditLedger?.earnedCredits !== undefined ? ` · 已获学分 ${displayNumber(analysisItem.creditLedger.earnedCredits)}` : ''}`] : ['学业分析：暂无可确认数据']),
      ...(planItem ? [`培养计划：${compact(planItem.title || planItem.sourceFilename || '已读取元数据', 120)}${planItem.minimumGraduationCredits !== undefined ? ` · 毕业学分 ${displayNumber(planItem.minimumGraduationCredits)}` : ''}`] : ['培养计划：暂无可确认数据']),
      ...(sections.length > relevant.length ? [`其它可读域：${sections.filter((section) => !THEIA_READABLE_DOMAINS.includes(section.domain)).map((section) => `${section.label} ${section.count ?? 0}`).join(' · ')}`] : []),
      ...theiaSyncLines(overview),
    ])
  }

  async function theiaToday() {
    const [overview, schedule, assignments, exams] = await Promise.all([
      theia.overview(),
      theia.schedule({ scope: 'current', limit: 100 }),
      theia.assignments({ scope: 'current', limit: 100 }),
      theia.exams({ scope: 'current', limit: 100 }),
    ])
    const { start, end } = chinaDayBounds()
    const rows = []
    for (const item of schedule?.items ?? []) {
      const at = dated(item.startAt)
      const recurringToday = scheduleWeekday(item.weekday) === chinaWeekday()
      if ((at !== null && at >= start && at < end) || (at === null && recurringToday)) {
        const time = at === null ? compact(item.time || item.period || '时间待确认', 50) : formatClock(item.startAt)
        rows.push({ at: at ?? start + 86_400_000, text: `${time} · 课程 · ${courseTitle(item)}` })
      }
    }
    for (const item of exams?.items ?? []) {
      const value = item.startAt
      const at = dated(value)
      if (at !== null && at >= start && at < end) rows.push({ at, text: `${formatClock(value)} · 考试 · ${courseTitle(item)}` })
    }
    for (const item of assignments?.items ?? []) {
      const at = dated(item.dueAt)
      if (!['submitted', 'completed'].includes(item.status) && at !== null && at >= start && at < end) rows.push({ at, text: `${formatClock(item.dueAt)} · 截止 · ${recordTitle(item)}` })
    }
    rows.sort((left, right) => left.at - right.at)
    return safeReply([
      '【THEIA · 今天】',
      ...(rows.length ? rows.slice(0, 12).map((item) => `· ${item.text}`) : ['当前数据域没有可确认的今日日程；这不等于学校系统明确无安排。']),
      ...(rows.length > 12 ? [`另有 ${rows.length - 12} 项，请在 THEIA 桌面端查看。`] : []),
      ...theiaSyncLines(overview),
      ...['schedule', 'assignments', 'exams'].flatMap((domain) => theiaSyncLines(overview, domain).slice(1)),
      ...(rows.some((item) => item.text.includes('时间待确认')) ? ['注意：部分课表只有星期/节次，没有可换算的具体时刻。'] : []),
    ])
  }

  async function theiaTasks() {
    const [overview, response] = await Promise.all([theia.overview(), theia.assignments({ scope: 'current', limit: 100 })])
    const items = (response?.items ?? []).filter((item) => {
      return !['submitted', 'completed'].includes(item?.status)
    }).sort((left, right) => (dated(left.dueAt) ?? Infinity) - (dated(right.dueAt) ?? Infinity))
    return safeReply([
      '【THEIA · 待处理作业】',
      ...(items.length ? items.slice(0, 10).map((item, index) => {
        const status = item.status && item.status !== 'pending' ? ` · ${compact(item.statusLabel || item.status, 30)}` : ''
        return `${index + 1}. ${recordTitle(item)} · 截止 ${formatTime(item.dueAt)}${status}`
      }) : ['当前数据域未列出尚未完成的作业。']),
      ...(items.length > 10 ? [`另有 ${items.length - 10} 项，请在 THEIA 桌面端查看。`] : []),
      ...theiaSyncLines(overview, 'assignments'),
    ])
  }

  async function theiaExams() {
    const [overview, response] = await Promise.all([theia.overview(), theia.exams({ scope: 'current', limit: 100 })])
    const today = chinaDayBounds().start
    const items = (response?.items ?? []).filter((item) => {
      const at = dated(item.startAt || item.examTime)
      return at === null || at >= today
    }).sort((left, right) => (dated(left.startAt || left.examTime) ?? Infinity) - (dated(right.startAt || right.examTime) ?? Infinity))
    return safeReply([
      '【THEIA · 考试】',
      ...(items.length ? items.slice(0, 10).map((item, index) => {
        const time = dated(item.startAt || item.examTime) === null ? `时间待确认：${compact(item.examTime || '未提供', 80)}` : formatTime(item.startAt || item.examTime)
        return `${index + 1}. ${courseTitle(item)} · ${time}${item.status && item.status !== 'upcoming' ? ` · ${compact(item.statusLabel || item.status, 30)}` : ''}`
      }) : ['当前数据域未列出可确认的后续考试。']),
      ...(items.length > 10 ? [`另有 ${items.length - 10} 项，请在 THEIA 桌面端查看。`] : []),
      ...theiaSyncLines(overview, 'exams'),
    ])
  }

  async function theiaDomainOverview() {
    const overview = await theia.overview()
    return safeReply([
      '【THEIA · 数据域】',
      ...theiaSections(overview).map((section) => `${section.label || theiaDomainLabels[section.domain]}：${section.count ?? 0} 条 · ${theiaQuality(section)}${section.stale ? ' · 可能过期' : ''}${section.retainedPrevious ? ' · 沿用旧数据' : ''}`),
      ...theiaSyncLines(overview),
    ])
  }

  async function theiaCourses() {
    const [overview, response] = await Promise.all([theia.overview(), theia.courses({ scope: 'current', limit: 100 })])
    const items = response?.items ?? []
    return safeReply(['【THEIA · 课程】', ...(items.length ? items.slice(0, 12).map((item, index) => `${index + 1}. ${courseTitle(item)}${item.credits !== undefined ? ` · ${displayNumber(item.credits)} 学分` : ''}${item.teacher ? ` · ${compact(item.teacher, 50)}` : ''}`) : ['当前数据域没有可确认的课程记录。']), ...(items.length > 12 ? [`另有 ${items.length - 12} 项，请在 THEIA 桌面端查看。`] : []), ...theiaSyncLines(overview, 'courses')])
  }

  async function theiaGrades() {
    const [overview, response] = await Promise.all([theia.overview(), theia.grades({ scope: 'current', limit: 100 })])
    const items = response?.items ?? []
    return safeReply(['【THEIA · 成绩】', ...(items.length ? items.slice(0, 12).map((item, index) => `${index + 1}. ${courseTitle(item)} · 成绩 ${displayNumber(item.score)}${item.point !== undefined ? ` · 绩点 ${displayNumber(item.point)}` : ''}${item.statusLabel ? ` · ${compact(item.statusLabel, 30)}` : ''}`) : ['当前数据域没有可确认的成绩记录。']), ...(items.length > 12 ? [`另有 ${items.length - 12} 项，请在 THEIA 桌面端查看。`] : []), ...theiaSyncLines(overview, 'grades')])
  }

  async function theiaSelectedCourses() {
    const [overview, response] = await Promise.all([theia.overview(), theia.selectedCourses({ scope: 'current', limit: 100 })])
    const items = response?.items ?? []
    return safeReply(['【THEIA · 已选课程】', ...(items.length ? items.slice(0, 12).map((item, index) => `${index + 1}. ${courseTitle(item)}${item.credits !== undefined ? ` · ${displayNumber(item.credits)} 学分` : ''}${item.statusLabel ? ` · ${compact(item.statusLabel, 30)}` : ''}`) : ['当前数据域没有可确认的已选课程记录。']), ...(items.length > 12 ? [`另有 ${items.length - 12} 项，请在 THEIA 桌面端查看。`] : []), ...theiaSyncLines(overview, 'selected-courses')])
  }

  async function theiaNotices() {
    const [overview, response] = await Promise.all([theia.overview(), theia.notices({ scope: 'all', limit: 100 })])
    const items = response?.items ?? []
    return safeReply(['【THEIA · 通知】', ...(items.length ? items.slice(0, 10).map((item, index) => `${index + 1}. ${recordTitle(item)}${item.publishedAt ? ` · ${formatTime(item.publishedAt)}` : ''}${item.statusLabel ? ` · ${compact(item.statusLabel, 30)}` : ''}${item.summary ? `\n   ${compact(item.summary, 150)}` : ''}`) : ['当前数据域没有可确认的通知记录。']), ...(items.length > 10 ? [`另有 ${items.length - 10} 项，请在 THEIA 桌面端查看。`] : []), ...theiaSyncLines(overview, 'notices')])
  }

  async function theiaAcademicProgress() {
    const [overview, response] = await Promise.all([theia.overview(), theia.academicProgress()])
    const item = response?.item
    const counts = item?.courseCounts ?? {}
    const countParts = Object.entries(counts).flatMap(([key, value]) => {
      if (!value || typeof value !== 'object') return []
      const label = { planned: '计划', completed: '完成', passed: '通过', notTaken: '未修' }[key] || key
      const total = value.total ?? value.count
      return total === undefined ? [] : [`${label} ${total}`]
    })
    return safeReply(['【THEIA · 学业进度】', item ? `专业：${compact(item.program || '未标注', 150)}` : '当前没有可确认的学业进度记录。', item?.gpa !== undefined ? `GPA：${displayNumber(item.gpa)}` : '', countParts.length ? `课程统计：${countParts.join(' · ')}` : '', item?.roots?.length ? `培养要求树：${item.roots.length} 个一级节点` : '', ...theiaSyncLines(overview, 'academic-progress')].filter(Boolean))
  }

  async function theiaAcademicAnalysis() {
    const [overview, response] = await Promise.all([theia.overview(), theia.academicAnalysis()])
    const item = response?.item
    const ledger = item?.creditLedger ?? {}
    const courseCount = Array.isArray(item?.courses) ? item.courses.length : null
    return safeReply(['【THEIA · 学业分析】', item ? `GPA：${displayNumber(item.gpa?.value)} · 来源 ${compact(item.gpa?.source || '未知', 30)}` : '当前没有可确认的学业分析。', ledger.earnedCredits !== undefined ? `已获学分：${displayNumber(ledger.earnedCredits)}` : '', ledger.requiredCredits !== undefined ? `要求学分：${displayNumber(ledger.requiredCredits)}` : '', courseCount === null ? '' : `纳入分析课程：${courseCount}`, ...theiaSyncLines(overview, 'academic-progress')].filter(Boolean))
  }

  async function theiaAcademicPlan() {
    const [overview, response] = await Promise.all([theia.overview(), theia.academicPlanDocument()])
    const item = response?.item
    return safeReply(['【THEIA · 培养计划】', item ? `标题：${compact(item.title || item.sourceFilename || '当前培养计划', 180)}` : '当前没有可确认的培养计划文档。', item?.durationYears !== null && item?.durationYears !== undefined ? `学制：${displayNumber(item.durationYears)} 年` : '', item?.minimumGraduationCredits !== null && item?.minimumGraduationCredits !== undefined ? `最低毕业学分：${displayNumber(item.minimumGraduationCredits)}` : '', item?.pageCount ? `文档页数：${displayNumber(item.pageCount)}` : '', item ? 'Iris 只返回培养计划元数据，不转发 PDF、页面正文、本地路径或附件。' : '', ...theiaSyncLines(overview, 'academic-extras')].filter(Boolean))
  }

  let theiaAgentThreadId = ''

  async function theiaAgent(question) {
    const message = String(question ?? '').trim()
    if (!message) return '格式：theia agent <问题>，例如「theia agent 我今天有哪些需要优先处理的事？」'
    if (typeof theia.agent !== 'function') return '当前 THEIA 版本尚未提供 Agent 对话接口，请先更新 THEIA。'
    const result = await theia.agent(message, { threadId: theiaAgentThreadId || undefined })
    if (result?.threadId) theiaAgentThreadId = result.threadId
    const answer = String(result?.answer || '').trim()
    return safeReply(['【THEIA · Agent】', answer || 'Agent 没有返回可展示的回答。'])
  }

  // `theia classroom <节次>` — live query the free-classroom table for one
  // period (节次) and render a PNG grouped by building. The period argument is
  // required: "theia classroom 1" = 第一节课.
  async function theiaClassroom(rest = '') {
    if (typeof theia.classroomTableImage !== 'function') return '当前 THEIA 版本尚未提供空闲教室图片接口，请先更新 THEIA。'
    const periodArg = String(rest || '').trim().split(/\s+/)[0] || ''
    // Accept a single period ("1") or a range ("3-4", "3-5", "3-6").
    const rangeMatch = periodArg.match(/^(\d{1,2})\s*[-~至]\s*(\d{1,2})$/u)
    const singleMatch = periodArg.match(/^\d{1,2}$/u)
    if (!rangeMatch && !singleMatch) {
      return '格式：theia classroom <节次>，例如「theia classroom 1」或「theia classroom 3-5」查看第3到第5节的空闲教室。'
    }
    let periods
    if (rangeMatch) {
      const start = Number(rangeMatch[1])
      const end = Number(rangeMatch[2])
      if (start < 1 || end > 20 || start > end) return '节次范围无效，请使用 1-20 之间的升序范围，例如「theia classroom 3-5」。'
      periods = Array.from({ length: end - start + 1 }, (_item, index) => String(start + index)).join(',')
    } else {
      const n = Number(singleMatch[0])
      if (n < 1 || n > 20) return '节次无效，请使用 1-20 之间的数字。'
      periods = String(n)
    }
    const label = periods.includes(',') ? `第${periods.replace(/,/g, '-')}节` : `第${periods}节`
    const png = await theia.classroomTableImage({ periods })
    if (png && png.length) {
      return { type: 'image', mime: 'image/png', data: png.toString('base64'), fileName: 'free-classroom.png', text: `【THEIA · 空闲教室 · ${label}】` }
    }
    const overview = await theia.overview()
    const extra = Array.isArray(overview?.extraDomains)
      ? overview.extraDomains.find((item) => item.domain === 'free-classroom')
      : null
    if (extra) return safeReply(['【THEIA · 空闲教室】', `已缓存 ${extra.count} 条结果 · ${extra.label || '空闲教室'}`, `最近查询：${extra.capturedAt ? formatTime(extra.capturedAt) : '未标注'}`, '实时查询不可用，请在 THEIA 桌面端「工具 · 空闲教室」查看表格。', ...theiaSyncLines(overview, 'academic-extras')])
    return safeReply(['【THEIA · 空闲教室】', '当前没有已缓存的空闲教室记录。请先在 THEIA 桌面端「工具 · 空闲教室」查询一次。', ...theiaSyncLines(overview, 'academic-extras')])
  }

  // `theia motion` — render the latest venue status table as a PNG
  async function theiaMotion(rest) {
    const { head: project } = splitCommand(rest)
    if (!project) return '格式：theia motion <运动项目>，例如「theia motion 羽毛球 获取今天羽毛球的状态表」。'
    if (typeof theia.motionTableImage !== 'function') return '当前 THEIA 版本尚未提供运动场馆图片接口，请先更新 THEIA。'
    const png = await theia.motionTableImage(project)
    if (png && png.length) {
      return { type: 'image', mime: 'image/png', data: png.toString('base64'), fileName: 'motion-venue.png', text: `【THEIA · 运动 · ${compact(project, 80)}】最新场馆状态如下：` }
    }
    // Fall back to text when image rendering is unavailable.
    try {
      const result = await theia.motion(project)
      const statuses = Array.isArray(result?.statuses) ? result.statuses : []
      const venues = Array.isArray(result?.venues) ? result.venues : []
      const lines = [`【THEIA · 运动 · ${compact(result?.project || project, 80)}】`, '图片渲染不可用，以下为文字版：']
      if (!statuses.length) {
        lines.push('今天没有已缓存的状态表。请先在 THEIA 中刷新运动场馆数据后重试。')
        if (venues.length) lines.push(`可查询来源：${venues.slice(0, 6).map((venue) => `${venue.campusLabel || '未标注校区'} · ${venue.label || venue.activity}`).join('；')}`)
        return safeReply(lines)
      }
      for (const status of statuses.slice(0, 8)) {
        const query = status?.query || {}
        lines.push(`${query.campus?.label || '未标注校区'} · ${query.venue || result.project} · ${query.date || result.date}`)
        const tables = Array.isArray(status?.availability?.tables) ? status.availability.tables : []
        for (const table of tables) {
          for (const slot of Array.isArray(table?.slots) ? table.slots : []) {
            const courts = Array.isArray(slot?.courts) ? slot.courts : []
            const cells = courts.map((court) => `${court.court || '场地'} ${court.status || court.state || '未知'}`).join('、')
            lines.push(`  ${slot.time || '时间未标注'}：${cells || '暂无场地明细'}`)
          }
        }
        if (status.cachedAt) lines.push(`  数据时间：${formatTime(status.cachedAt)}${status.fromCache ? ' · 本机缓存' : ''}`)
      }
      if (statuses.length > 8) lines.push(`另有 ${statuses.length - 8} 张状态表，请在 THEIA 中查看。`)
      return safeReply(lines)
    } catch (error) {
      return theiaError(error)
    }
  }

  return {
    theiaStatus,
    theiaToday,
    theiaTasks,
    theiaExams,
    theiaDomainOverview,
    theiaCourses,
    theiaGrades,
    theiaSelectedCourses,
    theiaNotices,
    theiaAcademicProgress,
    theiaAcademicAnalysis,
    theiaAcademicPlan,
    theiaAgent,
    theiaClassroom,
    theiaMotion,
  }
}

