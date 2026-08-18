import * as cheerio from 'cheerio'
import { normalizeText, stableId } from './util.mjs'

const JWGLXT_HOST = 'jwglxt.buct.edu.cn'

// Read-only JWGLXT pages that are useful to students but are not part of the
// nine fast-path datasets.  Mutation-looking menu entries are deliberately not
// listed here: a GET of an application page is not a safe data contract.
export const JWGLXT_EXTRA_DOMAINS = Object.freeze({
  'academic-plan': Object.freeze({
    label: '培养方案与教学执行计划',
    routes: Object.freeze([
      Object.freeze({ code: 'N153540', path: 'jxzxjhgl/jxzxjhck_cxJxzxjhckIndex.html?gnmkdm=N153540&layout=default' }),
    ]),
  }),
  'academic-warning': Object.freeze({
    label: '学业预警',
    routes: Object.freeze([
      Object.freeze({ code: 'N105505', path: 'xjyj/xjyj_cxXjyjIndex.html?gnmkdm=N105505&layout=default' }),
      Object.freeze({ code: 'N305516', path: 'xyyjjk/xyyjclcx_cxXyyjclcxxsIndex.html?gnmkdm=N305516&layout=default' }),
    ]),
  }),
  'graduation-audit': Object.freeze({
    label: '毕业审核',
    routes: Object.freeze([
      Object.freeze({ code: 'N105508', path: 'bygl/bysh_cxByshjgHcIndex.html?gnmkdm=N105508&layout=default' }),
    ]),
  }),
  'grade-details': Object.freeze({
    label: '成绩明细',
    routes: Object.freeze([
      Object.freeze({ code: 'N305007', path: 'cjcx/cjcx_cxDgXsxmcj.html?gnmkdm=N305007&layout=default' }),
    ]),
  }),
  'exam-extra': Object.freeze({
    label: '考试附加信息',
    routes: Object.freeze([
      Object.freeze({ code: 'N358163', path: 'design/viewFunc_cxDesignFuncPageIndex.html?gnmkdm=N358163&layout=default' }),
      Object.freeze({ code: 'N358187', path: 'design/viewFunc_cxDesignFuncPageIndex.html?gnmkdm=N358187&layout=default' }),
      Object.freeze({ code: 'N352510', path: 'bkgl/bkmdwh_cxBkmdIndex.html?gnmkdm=N352510&layout=default' }),
    ]),
  }),
  'free-classroom': Object.freeze({
    label: '空闲教室',
    routes: Object.freeze([
      Object.freeze({ code: 'N2155', path: 'cdjy/cdjy_cxKxcdlb.html?gnmkdm=N2155&layout=default' }),
    ]),
  }),
  // Keep this distinct from the local `school-schedule` catalogue domain.
  // The latter is the term cache used by course selection; reusing its key
  // would merge two unrelated provenance records and make retained data look
  // absent after a failed refresh.
  'jwglxt-school-schedule': Object.freeze({
    label: '全校课表',
    routes: Object.freeze([
      Object.freeze({ code: 'N219933', path: 'design/viewFunc_cxDesignFuncPageIndex.html?gnmkdm=N219933&layout=default' }),
    ]),
  }),
  'weekly-schedule': Object.freeze({
    label: '按周课表',
    routes: Object.freeze([
      Object.freeze({ code: 'N2154', path: 'kbcx/xskbcxZccx_cxXskbcxIndex.html?gnmkdm=N2154&layout=default' }),
    ]),
  }),
  thesis: Object.freeze({
    label: '毕业设计与论文成绩',
    routes: Object.freeze([
      Object.freeze({ code: 'N532530', path: 'xsbysjgl/xsxt_cxXsxtIndex.html?gnmkdm=N532530&layout=default' }),
      Object.freeze({ code: 'N532540', path: 'xsbysjgl/xsgczl_cxXsgczlIndex.html?gnmkdm=N532540&layout=default' }),
      Object.freeze({ code: 'N532560', path: 'xsbysjgl/cjck_cxCjckIndex.html?gnmkdm=N532560&layout=default' }),
      Object.freeze({ code: 'N532566', path: 'xsbysjgl/xsxtgjzxg_cxXsxtgjzxgsqIndex.html?gnmkdm=N532566&layout=default' }),
    ]),
  }),
  'profile-extra': Object.freeze({
    label: '档案补充信息',
    routes: Object.freeze([
      Object.freeze({ code: 'N100801', path: 'xsxxxggl/xsgrxxwh_cxXsgrxx.html?gnmkdm=N100801&layout=default' }),
      Object.freeze({ code: 'N100802', path: 'xsxxxggl/xsjhrxxcj_cxXsjhrxxcjIndex.html?gnmkdm=N100802&layout=default' }),
      Object.freeze({ code: 'N100808', path: 'xsxxxggl/xsgrxxwh_cxXsGrxxxgIndex.html?gnmkdm=N100808&layout=default' }),
    ]),
  }),
  // These pages expose already-submitted application/status rows. THEIA may
  // read the page and its read-only grid, but never invokes the action
  // buttons, confirmation endpoints, uploads, or mutation forms.
  'academic-workflows': Object.freeze({
    label: '学业申请与审核状态',
    routes: Object.freeze([
      Object.freeze({ code: 'N151530', path: 'kcthgl/xskcthsq_cxXskcthIndex.html?sqlx=xnkc&gnmkdm=N151530&layout=default' }),
      Object.freeze({ code: 'N151540', path: 'kcthgl/xskcthsq_cxXskcthIndex.html?sqlx=xnxfjd&gnmkdm=N151540&layout=default' }),
      Object.freeze({ code: 'N151550', path: 'kcthgl/xskcthsq_cxXskcthIndex.html?sqlx=xwkcxfjd&gnmkdm=N151550&layout=default' }),
      Object.freeze({ code: 'N306115', path: 'dxyyxfrdgl/dxyyxfrdsq_cxDxyyxfrdsqIndex.html?doType=details&gnmkdm=N306115&layout=default' }),
      Object.freeze({ code: 'N306512', path: 'cjjfgl/cjjfsq_cxCjjfsqIndex.html?gnmkdm=N306512&layout=default' }),
      Object.freeze({ code: 'N307010', path: 'cjjglx/cjjglxsq_cxCjjglxsqIndex.html?gnmkdm=N307010&layout=default' }),
    ]),
  }),
  'student-status': Object.freeze({
    label: '学籍与专业状态',
    routes: Object.freeze([
      Object.freeze({ code: 'N102020', path: 'xjyd/xjydsq_cxXjydsq.html?doType=details&gnmkdm=N102020&layout=default' }),
      Object.freeze({ code: 'N106204', path: 'xszzy/xszzysqgl_cxXszzysqIndex.html?doType=details&gnmkdm=N106204&layout=default' }),
    ]),
  }),
  'student-workflows': Object.freeze({
    label: '学生事务申请状态',
    routes: Object.freeze([
      Object.freeze({ code: 'N106005', path: 'xszbbgl/xszbbgl_cxXszbbsqIndex.html?doType=details&gnmkdm=N106005&layout=default' }),
    ]),
  }),
  'selection-workflows': Object.freeze({
    label: '选课与报名状态',
    routes: Object.freeze([
      Object.freeze({ code: 'N1053', path: 'fxgl/fxbm_cxXsfxbmIndex.html?gnmkdm=N1053&layout=default' }),
      Object.freeze({ code: 'N1056', path: 'cxbm/cxbm_cxXscxbmIndex.html?gnmkdm=N1056&layout=default' }),
      Object.freeze({ code: 'N2511', path: 'jxrwbmgl/jxrwxmbm_cxJxrwxmbmIndex.html?gnmkdm=N2511&layout=default' }),
      Object.freeze({ code: 'N253512', path: 'xsxk/zzxkyzb_cxZzxkYzbIndex.html?gnmkdm=N253512&layout=default' }),
    ]),
  }),
  evaluation: Object.freeze({
    label: '教学评价状态',
    routes: Object.freeze([
      Object.freeze({ code: 'N401605', path: 'xspjgl/xspj_cxXspjIndex.html?doType=details&gnmkdm=N401605&layout=default' }),
    ]),
  }),
})

export const JWGLXT_EXTRA_DOMAIN_NAMES = Object.freeze(Object.keys(JWGLXT_EXTRA_DOMAINS))
// These menu pages duplicate the canonical profile/schedule/selection data or
// expose low-value workflow shells. Keep the legacy names available only for
// snapshot migration and parser compatibility; they are no longer fetched,
// indexed, or exposed through the user-facing data API.
export const JWGLXT_REMOVED_EXTRA_DOMAIN_NAMES = Object.freeze([
  // These two domains are deliberately outside THEIA's local data model.
  // They must be discarded during snapshot migration as well as rejected from
  // new reads, otherwise an old cache can keep surfacing data we no longer
  // support.
  'academic-warning',
  'thesis',
  'jwglxt-school-schedule',
  'weekly-schedule',
  'profile-extra',
  'academic-workflows',
  'student-status',
  'student-workflows',
  'selection-workflows',
  'evaluation',
])
export const JWGLXT_IGNORED_EXTRA_DOMAIN_NAMES = Object.freeze([
  'academic-warning',
  'thesis',
])
export const JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES = Object.freeze(
  JWGLXT_EXTRA_DOMAIN_NAMES.filter((domain) => !JWGLXT_REMOVED_EXTRA_DOMAIN_NAMES.includes(domain)),
)
export const JWGLXT_EXTRA_PARSER_VERSION = 'jwglxt-extra/v5'

const FIELD_ALIASES = Object.freeze({
  课程名称: 'courseName', 课程: 'courseName', 课程代码: 'courseCode', 课程号: 'courseCode',
  课程编号: 'courseCode', 课程名: 'courseName', 课程性质: 'nature', 课程类别: 'category',
  课程归属: 'affiliation', 课程标记: 'courseFlag', 课程重要性系数: 'importanceCoefficient',
  是否学位课程: 'degreeCourse', 学时: 'hours', 课时: 'hours',
  教学班: 'className', 教学班名称: 'className', 教学班组成: 'classComposition',
  教师: 'teacher', 任课教师: 'teacher', 指导教师: 'teacher', 教师姓名: 'teacher',
  学分: 'credits', 成绩: 'score', 总评成绩: 'overallScore', 课程成绩: 'score', 成绩组成: 'assessmentItem',
  学期: 'term', 学年: 'academicYear', 学年学期: 'term', 状态: 'status', 处理状态: 'processingStatus',
  学号: 'studentId', 姓名: 'name', 院系: 'department', 学院: 'department', 专业: 'major',
  年级: 'grade', 班级: 'academicClass', 校区名称: 'campus', 校区: 'campus', 楼宇: 'building',
  教学楼: 'building', 教室: 'classroom', 场地: 'classroom', 容量: 'capacity',
  校区号: 'campusCode', 校区ID: 'campusId',
  手机: 'phone', 手机号: 'phone', 联系电话: 'phone', 电话: 'phone', 电子邮箱: 'email',
  家庭住址: 'address', 家庭地址: 'address', 身份证号: 'idNumber', 证件号: 'idNumber',
  监护人: 'guardian', 监护人姓名: 'guardianName',
  审核状态: 'reviewStatus', 审核结论: 'auditConclusion', 审核时间: 'auditedAt',
  申请时间: 'appliedAt', 终审时间: 'finalReviewedAt', 终审人: 'finalReviewer',
  预警类型: 'warningType', 触发学期: 'triggeredTerm', 预警原因: 'reason', 原因: 'reason',
  处理人: 'handler', 处理意见: 'handlingOpinion', 时间: 'occurredAt',
  毕业资格: 'graduationEligibility', 学位资格: 'degreeEligibility', 缺项: 'missingItems',
  执行计划信息表ID: 'planId', 专业号ID: 'majorId', 专业代码: 'majorCode', 专业方向: 'track',
  计划人数: 'planCapacity', 最低毕业学分: 'minimumGraduationCredits', 不收费学分: 'nonTuitionCredits',
  第二课堂学分: 'secondClassCredits', 辅修学分: 'minorCredits', 二专业学分: 'secondMajorCredits',
  二学位学分: 'secondDegreeCredits', 学制: 'studyDuration', 授予学位: 'degreeAwarded',
  培养目标: 'trainingObjective', 培养要求: 'trainingRequirements', 核心课程: 'coreCourses',
  平时成绩: 'regularScore', 期中成绩: 'midtermScore', 期末成绩: 'finalScore',
  分项成绩: 'assessmentDetails', 组成比例: 'composition', 明细状态: 'detailStatus',
  考试时间: 'examTime', 考场: 'location', 空闲教室: 'classroom', 日期: 'date', 节次: 'periods',
  周次: 'weeks', 星期: 'weekday', 星期几: 'weekday', 节次范围: 'period',
  查询条件: 'queryCondition', 题目: 'thesisTitle', 论文题目: 'thesisTitle',
  任务书: 'taskBook', 开题: 'openingReport', 中期: 'midtermReport', 送审: 'reviewMaterials',
  答辩: 'defenseMaterials', 毕设成绩: 'thesisScore', 关键词: 'keywords',
  课程说明: 'description', 维护状态: 'maintenanceStatus', 监护人: 'guardian',
})

// JSON/JqGrid responses use terse database column names. Keep these aliases
// explicit so that a future field remains a string instead of silently being
// coerced or exposed under an unstable generated name.
const JSON_KEY_ALIASES = Object.freeze({
  kcmc: 'courseName', kch: 'courseCode', kchm: 'courseCode',
  jxbmc: 'className', jxb: 'className', jxban: 'className',
  jsxm: 'teacher', jsmc: 'teacher', xm: 'name',
  xf: 'credits', cj: 'score', zcj: 'overallScore', zpcj: 'overallScore',
  xmcj: 'componentScore', xmblmc: 'assessmentItem',
  kcxz: 'nature', kclb: 'category', kklb: 'category', kkbmmc: 'department',
  kcyqxs: 'importanceCoefficient', sfxwkc: 'degreeCourse', kcsx: 'courseFlag',
  kclbmc: 'category', kkxymc: 'department', xs: 'hours',
  xqhmc: 'campus', xqmc: 'campus', xqh: 'campusCode', xqh_id: 'campusId',
  jg_id: 'departmentId', zyh_id: 'majorId',
  cdbh: 'classroom', cdmc: 'classroom', lh: 'building', cdlbmc: 'classroomType',
  xqj: 'weekday', jc: 'period', jcs: 'periods', zcd: 'weeks', zc: 'weeks',
  xnm: 'academicYear', xn: 'academicYear', xnmc: 'academicYear', xnmmc: 'academicYearLabel',
  xqm: 'term', xq: 'term', xqmmc: 'termLabel',
  kssj: 'examTime', kssjmc: 'examTime', kcmc: 'courseName',
  ktmc: 'thesisTitle', bslx_mc: 'thesisType',
  jxzxjhxx_id: 'planId', jxzxjhkcxx_id: 'planCourseId', jxzxjhxxid: 'planId', jxzxjhkcxxid: 'planCourseId',
  xh_id: 'studentInternalId', kch_id: 'courseInternalId', jxb_id: 'classInternalId',
  njdm: 'grade', njmc: 'grade', zyh: 'majorCode', zymc: 'major',
  bjgs: 'classCount', jhrs: 'planCapacity', kcs: 'courseCount', zyfxgs: 'trackCount',
  zdxf: 'minimumGraduationCredits', xz: 'studyDuration', dlbs: 'planScope', rwbj: 'taskFlag',
  bjmc: 'academicClass', bh: 'classCode', xs_xh: 'studentId', xs_xm: 'name',
  xs_jg_mc: 'department', xs_nj_mc: 'grade', xs_zy_mc: 'major',
  warning_type: 'warningType', warningType: 'warningType',
  key1: 'recordKey',
})

const JSON_FIELD_LABELS = Object.freeze({
  jxzxjhxx_id: '执行计划信息表ID', jxzxjhkcxx_id: '执行计划课程信息表ID',
  zyh_id: '专业号ID', zyh: '专业代码', zymc: '专业', njdm: '年级', njmc: '年级',
  jg_id: '学院ID', jgmc: '学院', xqh_id: '校区ID', xqmc: '校区',
  bjgs: '班级数', jhrs: '计划人数', kcs: '课程数', zyfxgs: '专业方向数',
  zdxf: '最低毕业学分', xz: '学制', dlbs: '大类标识', rwbj: '任务标记',
  kch: '课程代码', kch_id: '课程ID', kcmc: '课程名称', jxb_id: '教学班ID', jxbmc: '教学班',
  kkbm_id: '开课学院ID', xh_id: '学号',
  kkbmmc: '开课学院', xmblmc: '成绩组成', xmcj: '分项成绩', zpcj: '总评成绩',
  xnmmc: '学年', xqmmc: '学期', xf: '学分', cj: '成绩', xnm: '学年代码', xqm: '学期代码',
})

// Labels for normalized field names. This is also used when reading an older
// snapshot whose `fields` array still contains a terse database key.
const FIELD_DISPLAY_LABELS = Object.freeze({
  courseName: '课程名称', courseCode: '课程代码', courseInternalId: '课程ID', className: '教学班', teacher: '教师',
  department: '开课学院', credits: '学分', score: '成绩', overallScore: '总评成绩',
  componentScore: '分项成绩', assessmentItem: '成绩组成', academicYear: '学年代码',
  academicYearLabel: '学年', term: '学期代码', termLabel: '学期', studentId: '学号', studentInternalId: '学号', kkbmId: '开课学院ID',
  grade: '年级', departmentId: '学院ID', majorId: '专业号ID', majorCode: '专业代码', major: '专业', track: '专业方向', status: '状态',
  planId: '执行计划信息表ID', planCourseId: '执行计划课程信息表ID', planCapacity: '计划人数',
  courseCount: '课程数', trackCount: '专业方向数', minimumGraduationCredits: '最低毕业学分',
  studyDuration: '学制', classroom: '教室', building: '楼宇', campus: '校区',
})

const JSON_META_KEYS = new Set([
  'html', 'raw', 'body', 'content', 'message', 'error', 'success', 'ok', 'rows', 'items', 'data',
  'queryModel', 'userModel', 'pageable', 'rangeable', 'listnav', 'localeKey', 'pageTotal',
  'totalResult', 'totalCount', 'currentPage', 'currentResult', 'offset', 'limit', 'pageNo',
  'pageSize', 'showCount', 'sorts', 'entityOrField', 'row_id', 'rowId', 'date', 'dateDigit',
  'dateDigitSeparator', 'day', 'month', 'year', 'jgpxzd',
])

const DROP_TEXT = /^(操作|排序|清空|来源|选择|查看|详情)$/u
const UI_ONLY_RECORD_TEXT = new Set(['志愿', '收起', '状态', '专业', '操作', '排序', '清空', '来源', '选择', '查看', '详情'])
const PLACEHOLDER_ROW = /^(?:请选择筛选条件!?|没有符合条件记录!?|无数据显示!?|暂无数据!?|未查询到[^<]*记录!?|暂无记录!?)$/u
const NUMERIC_FIELDS = new Set([
  'credits', 'score', 'overallScore', 'componentScore', 'regularScore', 'midtermScore', 'finalScore', 'capacity', 'thesisScore',
  'importanceCoefficient', 'hours', 'planCapacity', 'minimumGraduationCredits',
  'nonTuitionCredits', 'secondClassCredits', 'minorCredits', 'secondMajorCredits', 'secondDegreeCredits',
])

function clean(value, maximum = 800) {
  const result = normalizeText(value)
  return result ? result.slice(0, maximum) : null
}

function fieldKey(label, index) {
  const normalized = clean(label, 120) || ''
  if (FIELD_ALIASES[normalized]) return FIELD_ALIASES[normalized]
  const compact = normalized.replace(/[^A-Za-z0-9_]+/g, '').toLowerCase()
  const jsonAlias = Object.entries(JSON_KEY_ALIASES).find(([key]) => key.replace(/[^A-Za-z0-9_]+/g, '').toLowerCase() === compact)?.[1]
  if (jsonAlias) return jsonAlias
  const ascii = normalized
    .replace(/[^a-zA-Z0-9]+(.)/g, (_all, character) => String(character).toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, '')
  return ascii ? ascii[0].toLowerCase() + ascii.slice(1, 80) : `field${index + 1}`
}

function fieldLabel(rawKey, name, fallback = rawKey) {
  return clean(JSON_FIELD_LABELS[rawKey] || FIELD_DISPLAY_LABELS[name] || fallback, 120) || name
}

function scalar(value, key = null) {
  const text = clean(value)
  if (!text) return null
  if (NUMERIC_FIELDS.has(String(key || '')) && /^-?\d+(?:\.\d+)?$/u.test(text)) return Number(text)
  return text
}

function valueForRecord(value, key = null) {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) {
    const items = value.map((entry) => clean(typeof entry === 'object' ? JSON.stringify(entry) : entry, 800)).filter(Boolean)
    return items.length ? items.join('；') : null
  }
  if (value && typeof value === 'object') return clean(JSON.stringify(value), 800)
  return scalar(value, key)
}

function uniqueFields(headers, cells) {
  const used = new Map()
  return headers.map((header, index) => {
    const base = fieldKey(header, index)
    const count = used.get(base) || 0
    used.set(base, count + 1)
    const name = count ? `${base}${count + 1}` : base
    const value = scalar(cells[index], name)
    return value === null || DROP_TEXT.test(String(header || '').trim()) ? null : {
      name,
      label: clean(header, 120) || name,
      value,
    }
  }).filter(Boolean)
}

function directCellText($, node) {
  const title = clean($(node).attr('title'), 800)
  if (title) return title
  const clone = $(node).clone()
  // jqGrid cells often contain a hidden dropdown table. Its column labels are
  // UI metadata, not part of the value of the outer row.
  clone.find('table,ul,ol,script,style').remove()
  return clean(clone.text(), 800)
}

function isPagerTable($, table) {
  const node = $(table)
  return node.hasClass('ui-jqgrid-htable')
    || node.hasClass('ui-pg-table')
    || node.hasClass('navtable')
    || node.hasClass('right_table_head')
    || Boolean(node.closest('.ui-pg-table').length)
}

function isDataTable($, table) {
  const node = $(table)
  if (isPagerTable($, table)) return false
  // Nested tables belong to a dropdown/detail cell of an outer grid. They do
  // not represent independent records.
  if (!node.hasClass('ui-jqgrid-btable') && (node.closest('td,th').length || node.parents('td,th').length)) return false
  if (node.closest('.ui-jqgrid').length && !node.hasClass('ui-jqgrid-btable') && node.attr('role') !== 'grid') return false
  if (node.hasClass('ui-jqgrid-btable') || node.attr('role') === 'grid') return true
  return node.find('th').length > 0
}

function tableHeaders($, table) {
  const node = $(table)
  if (node.hasClass('ui-jqgrid-btable') || node.attr('role') === 'grid') {
    const header = node.closest('.ui-jqgrid').find('table.ui-jqgrid-htable').first()
    if (!header.length) return []
    return header.find('tr').first().find('th,td').map((_index, cell) => directCellText($, cell) || '').get()
  }
  const rows = node.find('tr').toArray()
  if (!rows.length) return []
  const headerRow = rows.find((row) => $(row).find('th').length)
    || rows.find((row) => $(row).hasClass('js-sort-table'))
    || rows[0]
  return $(headerRow).find('th,td').map((_index, cell) => directCellText($, cell) || '').get()
}

function pageTitle($, fallback) {
  return clean($('h1,h2,.panel-title,.caption,.title1,title').first().text(), 240) || clean(fallback, 240) || 'JWGLXT 只读页面'
}

function recordFromRow($, cells, headers, domain, routeCode, index, sourceUrl, capturedAt) {
  const fields = uniqueFields(headers, cells)
  if (!fields.length) return null
  const values = Object.fromEntries(fields.map((field) => [field.name, field.value]))
  const title = clean(values.courseName || values.thesisTitle || values.major || values.track || values.className
    || values.classroom || values.warningType || values.auditConclusion || values.title || fields[0]?.value, 320)
  return {
    id: stableId('jwglxt-extra', domain, routeCode, index, fields.map((field) => `${field.name}:${field.value}`).join('|')),
    title,
    ...values,
    fields,
    source: 'jwglxt',
    sourceUrl,
    routeCode,
    capturedAt,
  }
}

function recordFromJsonObject(row, domain, routeCode, index, sourceUrl, capturedAt) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null
  const used = new Map()
  const fields = []
  for (const [rawKey, rawValue] of Object.entries(row)) {
    if (!/^[A-Za-z\u3400-\u9fff][A-Za-z0-9_\u3400-\u9fff-]{0,119}$/u.test(rawKey)) continue
    if (JSON_META_KEYS.has(rawKey) || /^(?:html|raw|body|content|message|error|success|rows|items|data)$/iu.test(rawKey)) continue
    const base = fieldKey(rawKey, fields.length)
    const count = used.get(base) || 0
    used.set(base, count + 1)
    const name = count ? `${base}${count + 1}` : base
    const value = valueForRecord(rawValue, name)
    if (value === null || value === '') continue
    fields.push({ name, label: fieldLabel(rawKey, name), value })
  }
  if (!fields.length) return null
  const values = Object.fromEntries(fields.map((field) => [field.name, field.value]))
  const title = clean(values.courseName || values.thesisTitle || values.major || values.track || values.className
    || values.classroom || values.warningType || values.auditConclusion || values.title || values.name || fields[0]?.value, 320)
  return {
    id: stableId('jwglxt-extra', domain, routeCode, index, fields.map((field) => `${field.name}:${field.value}`).join('|')),
    title,
    ...values,
    fields,
    source: 'jwglxt',
    sourceUrl,
    routeCode,
    capturedAt,
  }
}

const JSON_ARRAY_KEYS = Object.freeze([
  'items', 'rows', 'data', 'result', 'list', 'aaData', 'records', 'recordList',
  'dataList', 'gradeList', 'courseList', 'courses', 'kbList', 'sjkList', 'jxhjkcList',
])

function parseJsonValue(value) {
  if (typeof value !== 'string') return value
  let current = value.trim()
  for (let index = 0; index < 3 && /^[\[{]/u.test(current); index += 1) {
    try { current = JSON.parse(current) } catch { break }
  }
  return current
}

function jsonRecords(value, depth = 0, seen = new Set()) {
  const parsed = parseJsonValue(value)
  if (Array.isArray(parsed)) return { recognized: true, rows: parsed.filter((item) => item && typeof item === 'object') }
  if (!parsed || typeof parsed !== 'object' || depth > 6 || seen.has(parsed)) return { recognized: false, rows: [] }
  seen.add(parsed)
  let empty = false
  for (const key of JSON_ARRAY_KEYS) {
    if (!Object.hasOwn(parsed, key)) continue
    const candidate = parsed[key]
    const result = jsonRecords(candidate, depth + 1, seen)
    if (result.rows.length) return result
    if (result.recognized) empty = true
  }
  const keys = Object.keys(parsed)
  const looksLikeRecord = keys.some((key) => Object.hasOwn(JSON_KEY_ALIASES, key)
    || Object.hasOwn(FIELD_ALIASES, key) || /^(?:id|title|name|value|label)$/iu.test(key))
  return looksLikeRecord ? { recognized: true, rows: [parsed] } : { recognized: empty, rows: [] }
}

export function parseJwglxtExtraJson(payload, {
  domain,
  routeCode,
  sourceUrl,
  capturedAt = new Date().toISOString(),
  label,
  includeCandidateRecords = false,
} = {}) {
  const parsed = parseJsonValue(payload)
  if (!parsed || (typeof parsed !== 'object' && !Array.isArray(parsed))) throw new Error('jwglxt_extra_invalid_json')
  if (parsed?.success === false || parsed?.ok === false || String(parsed?.status || '').toLowerCase() === 'error') {
    throw new Error('jwglxt_extra_error_payload')
  }
  const result = jsonRecords(parsed)
  if (!result.recognized) throw new Error('jwglxt_extra_unexpected_json')
  const records = result.rows.map((row, index) => recordFromJsonObject(row, domain, routeCode, index, sourceUrl, capturedAt)).filter(Boolean)
  const normalized = normalizeJwglxtExtraDomain({
    label: label || domain,
    routeCodes: [routeCode].filter(Boolean),
    sourceUrl,
    capturedAt,
    completeness: 'complete',
    records,
    queryStats: { attempted: 1, succeeded: 1, failed: 0 },
  }, domain)
  // Cultivation-plan rows are only a transient selector for the one official
  // PDF. Keep them out of the normalized domain while allowing the adapter to
  // prove which current-major PDF it may safely request.
  return includeCandidateRecords && domain === 'academic-plan'
    ? { ...normalized, candidateRecords: records }
    : normalized
}

function attachments($, sourceUrl) {
  return $('a[href]').toArray().map((node) => {
    const href = String($(node).attr('href') || '').trim()
    const label = clean($(node).text(), 160)
    if (!href || !(/(?:\.pdf|\.docx?|\.xlsx?|download|attachment|下载|附件)/iu.test(`${href} ${label}`))) return null
    try {
      const url = new URL(href, sourceUrl)
      if (url.origin !== new URL(sourceUrl).origin) return null
      return { id: stableId('jwglxt-attachment', url.pathname, url.search), label: label || url.pathname.split('/').pop() || '附件', type: /\.pdf(?:$|\?)/iu.test(url.pathname) ? 'pdf' : 'download', sourceUrl: url.toString() }
    } catch { return null }
  }).filter(Boolean).filter((item, index, values) => values.findIndex((candidate) => candidate.id === item.id) === index).slice(0, 24)
}

function pageMessages($) {
  const selectors = [
    '[role="alert"]', '.alert', '.alert-danger', '.alert-warning', '.alert-info',
    '.text-danger', '.text-warning', '.tips', '#tips', '#cdTsxx', '.modal-body',
  ]
  const values = selectors.flatMap((selector) => $(selector).toArray().map((node) => clean($(node).text(), 600)))
    .filter((value) => value && !/^\s*(?:操作|提示)\s*$/u.test(value))
  return [...new Set(values)].slice(0, 16)
}

export function parseJwglxtExtraPage(html, {
  domain,
  routeCode,
  sourceUrl,
  capturedAt = new Date().toISOString(),
} = {}) {
  const $ = cheerio.load(String(html || ''))
  const title = pageTitle($, domain)
  const records = []
  $('table').filter((_tableIndex, table) => isDataTable($, table)).each((_tableIndex, table) => {
    const headers = tableHeaders($, table)
    if (headers.length < 1) return
    const rows = $(table).find('tr').toArray().filter((row) => {
      const node = $(row)
      // `find('tr')` also sees rows inside a dropdown table embedded in a
      // jqGrid cell. Only rows owned directly by this data table are records.
      if (node.parents('table').first()[0] !== table) return false
      if (node.hasClass('jqgfirstrow') || node.hasClass('emptyrow')) return false
      return node.find('td').length > 0
    })
    for (const [index, row] of rows.entries()) {
      // Keep empty cells in the array; jqGrid column positions are meaningful
      // and dropping a blank hidden cell shifts every following field.
      const cells = $(row).children('td').map((_index, node) => directCellText($, node) || '').get()
      if (!cells.length || cells.every((value) => !value)) continue
      // Zhengfang renders an empty jqGrid as a one-cell placeholder row
      // (often with colspan). It is UI state, not a campus record; keeping it
      // would make a never-queried page look like a successful result.
      if (cells.length === 1 && PLACEHOLDER_ROW.test(cells[0] || '')) continue
      const record = recordFromRow($, cells, headers, domain, routeCode, records.length + index, sourceUrl, capturedAt)
      if (record) records.push(record)
    }
  })
  // A search/jqGrid page's labels are filters, not a data row. Only use the
  // label/value fallback for detail pages (for example N100801); otherwise a
  // blank warning or school-schedule grid would be persisted as one synthetic
  // record containing its query controls.
  const hasQueryUi = $('form#searchForm, form[id^="queryForm"], .ui-jqgrid, table[role="grid"], table[data-related_guid]').length > 0
  // A few read-only thesis pages render an empty jqGrid shell even though
  // their useful payload is the selected year/semester in the surrounding
  // form. Keep the normal empty-grid guard for query pages, but allow those
  // two detail/status routes to expose the same page fields as the direct API
  // client.
  const allowDetailFallback = domain === 'thesis' && ['N532540', 'N532560'].includes(String(routeCode || ''))
  if (!records.length && (!hasQueryUi || allowDetailFallback)) {
    const fields = []
    $('label,dt').each((_index, node) => {
      const label = clean($(node).text(), 120)
      if (!label || DROP_TEXT.test(label)) return
      const valueNode = $(node).nextAll('input,select,textarea,dd,.form-control-static,p,span').first()
        .add($(node).next('div').find('input,select,textarea,dd,.form-control-static,p,span').first()).first()
        .add($(node).parent().find('input,select,textarea,dd,.form-control-static,p,span').first()).first()
      const value = valueForRecord(valueNode.val?.() ?? valueNode.attr('value') ?? valueNode.text(), fieldKey(label, fields.length))
      const name = fieldKey(label, fields.length)
      if (label && value !== null && !fields.some((field) => field.name === name)) fields.push({ name, label, value })
    })
    if (fields.length) records.push({
      id: stableId('jwglxt-extra', domain, routeCode, 'fields', fields.map((field) => `${field.name}:${field.value}`).join('|')),
      title,
      ...Object.fromEntries(fields.map((field) => [field.name, field.value])),
      fields,
      source: 'jwglxt', sourceUrl, routeCode, capturedAt,
    })
  }
  const filters = $('select[name],input[name]').toArray().map((node) => String($(node).attr('name') || '').trim())
    .filter(Boolean).filter((name, index, values) => values.indexOf(name) === index).slice(0, 64)
  return normalizeJwglxtExtraDomain({
    label: title,
    routeCodes: [routeCode].filter(Boolean),
    sourceUrl,
    capturedAt,
    completeness: records.length ? 'complete' : 'partial',
    records,
    attachments: attachments($, sourceUrl),
    filters,
    messages: pageMessages($),
  }, domain)
}

function normalizeRecord(record, domain, index) {
  if (!record || typeof record !== 'object') return null
  const fields = Array.isArray(record.fields)
    ? record.fields.map((field, fieldIndex) => ({
      name: fieldKey(field?.name || field?.label, fieldIndex),
      label: fieldLabel(field?.name || '', fieldKey(field?.name || field?.label, fieldIndex), field?.label || field?.name),
      value: scalar(field?.value, field?.name || field?.label),
    })).filter((field) => field.value !== null).slice(0, 80)
    : []
  // Older parser versions could persist a toolbar/header as a record. Remove
  // those rows during every snapshot read so an upgrade cannot keep showing
  // "志愿 / 收起 / 状态 / 专业" as if they were academic facts. A real major,
  // course, or status value remains untouched when it has any non-UI value.
  const title = String(record.title || '').trim()
  if (UI_ONLY_RECORD_TEXT.has(title)) return null
  if (fields.length && fields.every((field) => UI_ONLY_RECORD_TEXT.has(String(field.value).trim()))) return null
  const safe = {}
  for (const [key, value] of Object.entries(record)) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,79}$/u.test(key) || ['raw', 'html', 'body', 'content'].includes(key)) continue
    if (key === 'fields') continue
    const normalized = Array.isArray(value)
      ? value.map((entry) => valueForRecord(entry, key)).filter(Boolean).slice(0, 80)
      : valueForRecord(value, key)
    if (normalized !== null && normalized !== undefined && normalized !== '') safe[key] = normalized
  }
  if (fields.length) safe.fields = fields
  safe.id = clean(record.id, 240) || stableId('jwglxt-extra', domain, index, JSON.stringify(fields))
  safe.title = clean(record.title || safe.title || fields[0]?.value, 320) || `${domain}记录`
  return safe
}

function normalizedAttachments(source, domain) {
  const attachments = (Array.isArray(source.attachments) ? source.attachments : []).map((item) => ({
    id: clean(item?.id, 240), label: clean(item?.label, 160), type: clean(item?.type, 40), sourceUrl: clean(item?.sourceUrl, 800),
    cached: item?.cached === true,
    bytes: Number.isSafeInteger(Number(item?.bytes)) && Number(item.bytes) >= 0 ? Number(item.bytes) : null,
    sha256: /^[a-f0-9]{64}$/iu.test(String(item?.sha256 || '')) ? String(item.sha256).toLowerCase() : null,
    filename: clean(item?.filename, 160),
  })).filter((item) => item.id && item.sourceUrl)
    .filter((item, index, values) => values.findIndex((candidate) => candidate.id === item.id) === index)

  if (domain !== 'academic-plan') return attachments.slice(0, 24)
  // The cultivation-plan domain is intentionally an artifact cache, not a
  // second structured degree-plan model. Keep exactly one PDF descriptor;
  // prefer an already verified local file when migrating old snapshots.
  return attachments
    .filter((item) => String(item.type || '').toLowerCase() === 'pdf')
    .sort((left, right) => Number(right.cached) - Number(left.cached))
    .slice(0, 1)
}

function normalizedPathname(value) {
  return String(value || '').replace(/\/+$/u, '').toLowerCase() || '/'
}

function isLegacyQueryEndpoint(url) {
  const pathname = normalizedPathname(url.pathname)
  if (pathname === '/jwglxt/query' || pathname.endsWith('/funcdata_cxfuncdatalist.html')) return true
  const basename = pathname.split('/').pop() || ''
  // The old parser stored the last read-only jqGrid/JSON endpoint. Keep the
  // migration bounded to Zhengfang's query-shaped names; arbitrary detail or
  // attachment URLs remain valid provenance and must not be rewritten.
  return /_cx[^/]*(?:list|index|data|query)\.html$/u.test(basename)
}

function canonicalSourcePageUrl(sourceUrl, domain, routeCodes = []) {
  const raw = clean(sourceUrl, 800)
  if (!raw) return raw
  const routes = JWGLXT_EXTRA_DOMAINS[domain]?.routes || []
  if (!routes.length) return raw
  try {
    const current = new URL(raw)
    const pagePaths = new Set(routes.map((candidate) => {
      try { return normalizedPathname(new URL(candidate.path, `${current.origin}/jwglxt/`).pathname) } catch { return null }
    }).filter(Boolean))
    // A multi-route domain can legitimately retain any of its menu pages,
    // regardless of which route code happened to be merged first.
    if (pagePaths.has(normalizedPathname(current.pathname))) return raw
    // Removed action pages (for example N109310/N109510) must not remain the
    // clickable provenance target of the consolidated academic-plan domain.
    // Point old snapshots at the surviving read-only menu page instead.
    if (domain === 'academic-plan' && /\/(?:dlflgl\/flzyqr_cxFlzyqrIndex|zyfxgl\/zyfxqr_cxZyfxqrIndex)\.html$/iu.test(current.pathname)) {
      return new URL(routes[0].path, `${current.origin}/jwglxt/`).toString()
    }
    if (current.hostname !== JWGLXT_HOST || !isLegacyQueryEndpoint(current)) return raw
    const route = routes.find((candidate) => routeCodes.includes(candidate.code)) || routes[0]
    const page = new URL(route.path, `${current.origin}/jwglxt/`)
    return page.toString()
  } catch {
    return raw
  }
}

export function normalizeJwglxtExtraDomain(value, domain = 'academic-plan') {
  const source = value && typeof value === 'object' ? value : {}
  const allowedRoutes = new Set((JWGLXT_EXTRA_DOMAINS[domain]?.routes || []).map((route) => route.code))
  const routeCodes = [...new Set((Array.isArray(source.routeCodes) ? source.routeCodes : [])
    .map((code) => clean(code, 32)).filter((code) => code && (!allowedRoutes.size || allowedRoutes.has(code))))].slice(0, 8)
  const sourceRecords = (Array.isArray(source.records) ? source.records : [])
    // N109310/N109510 are user-action confirmation pages, not a read-only
    // cultivation-plan dataset. Drop their old cached fragments after the
    // route inventory is corrected.
    .filter((record) => !((domain === 'academic-plan') && ['N109310', 'N109510'].includes(String(record?.routeCode || ''))))
  return {
    label: clean(source.label, 240) || JWGLXT_EXTRA_DOMAINS[domain]?.label || domain,
    routeCodes,
    sourceUrl: canonicalSourcePageUrl(source.sourceUrl, domain, source.routeCodes || []),
    capturedAt: typeof source.capturedAt === 'string' && Number.isFinite(Date.parse(source.capturedAt)) ? source.capturedAt : null,
    completeness: ['complete', 'partial', 'unknown'].includes(source.completeness) ? source.completeness : 'unknown',
    queryStats: {
      attempted: Number.isSafeInteger(Number(source.queryStats?.attempted)) ? Math.max(0, Number(source.queryStats.attempted)) : 0,
      succeeded: Number.isSafeInteger(Number(source.queryStats?.succeeded)) ? Math.max(0, Number(source.queryStats.succeeded)) : 0,
      failed: Number.isSafeInteger(Number(source.queryStats?.failed)) ? Math.max(0, Number(source.queryStats.failed)) : 0,
      capped: Boolean(source.queryStats?.capped),
    },
    messages: [...new Set((Array.isArray(source.messages) ? source.messages : []).map((value) => clean(value, 600)).filter(Boolean))].slice(0, 16),
    filters: [...new Set((Array.isArray(source.filters) ? source.filters : []).map((name) => clean(name, 80)).filter(Boolean))].slice(0, 64),
    attachments: normalizedAttachments(source, domain),
    records: domain === 'academic-plan'
      ? []
      : sourceRecords.map((record, index) => normalizeRecord(record, domain, index)).filter(Boolean).slice(0, 1_000),
  }
}

export function emptyAcademicExtras() {
  return {
    schema: 'theia-jwglxt-extras/v1',
    capturedAt: null,
    parserVersion: JWGLXT_EXTRA_PARSER_VERSION,
    domains: {},
  }
}

export function normalizeAcademicExtras(value) {
  const base = emptyAcademicExtras()
  const source = value && typeof value === 'object' ? value : {}
  const domains = {}
  for (const domain of JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES) {
    if (source.domains?.[domain]) domains[domain] = normalizeJwglxtExtraDomain(source.domains[domain], domain)
  }
  return {
    ...base,
    capturedAt: typeof source.capturedAt === 'string' && Number.isFinite(Date.parse(source.capturedAt)) ? source.capturedAt : null,
    parserVersion: JWGLXT_EXTRA_PARSER_VERSION,
    domains,
  }
}
