import { stableId } from './util.mjs'
import { isStandardCourseCode } from './parsers/jwglxt.mjs'

const API_MARKER = /^\s*sfmjd\s*=\s*['\"]?([01])['\"]?\s*>\s*/i

function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function planMarker(title) {
  return String(title || '').match(API_MARKER)?.[1] || null
}

export function cleanAcademicRequirementTitle(title) {
  return String(title || '').replace(API_MARKER, '').replace(/\s+/g, ' ').trim()
}

function titleFromCourseNature(title, courses) {
  const cleaned = cleanAcademicRequirementTitle(title)
  // Zhengfang's API occasionally gives the first requirement node the degree
  // plan name (for example, "2024 ...") instead of its own label. Course
  // rows retain the authoritative course nature, so use an unanimous label
  // only for that clearly malformed program-name shape.
  if (!/^20\d{2}\s*/.test(cleaned)) return cleaned
  const labels = (Array.isArray(courses) ? courses : [])
    .map((course) => String(course?.nature || '').trim())
    .filter(Boolean)
  if (!labels.length) return cleaned
  const counts = new Map()
  for (const label of labels) counts.set(label, (counts.get(label) || 0) + 1)
  const [label, count] = [...counts.entries()].sort((left, right) => right[1] - left[1])[0]
  return count === labels.length ? label : cleaned
}

function cloneRequirement(requirement, detailsById, sourceUrl) {
  const id = String(requirement?.id || '').trim()
  const detail = detailsById.get(id)
  const courses = detail?.courses || requirement?.courses || []
  const title = titleFromCourseNature(requirement?.title, courses) || 'Unnamed requirement'
  return {
    ...requirement,
    id: id || stableId('academic-api-requirement', title),
    title,
    relation: 'and',
    parentId: null,
    children: [],
    courses,
    sourceUrl: sourceUrl || requirement?.sourceUrl || null,
  }
}

function rootCredits(progress) {
  const planned = progress?.courseCounts?.planned
  const required = finiteNumber(planned?.total)
  const earned = finiteNumber(planned?.passed)
  const remaining = finiteNumber(planned?.notTaken)
  return {
    required: required ?? 0,
    earned,
    remaining: remaining ?? (required !== null && earned !== null ? Math.max(0, required - earned) : null),
  }
}

export function inferAcademicRequirementTree(progress, { details = [], sourceUrl = null } = {}) {
  if (!progress || typeof progress !== 'object') return progress
  const sourceRequirements = Array.isArray(progress.categories) ? progress.categories : []
  if (!sourceRequirements.length) return progress

  const detailsById = new Map((Array.isArray(details) ? details : [])
    .filter((detail) => detail && detail.id != null)
    .map((detail) => [String(detail.id), detail]))
  const requirements = sourceRequirements.map((requirement) => cloneRequirement(requirement, detailsById, sourceUrl || progress.sourceUrl))
  const programTitle = cleanAcademicRequirementTitle(progress.program)
  const root = {
    id: stableId('academic-plan-root', programTitle || sourceUrl || progress.sourceUrl || 'degree-plan'),
    title: programTitle || '\u57f9\u517b\u65b9\u6848',
    ...rootCredits(progress),
    status: null,
    relation: 'and',
    parentId: null,
    children: [],
    courses: [],
    sourceUrl: sourceUrl || progress.sourceUrl || null,
  }

  let currentSection = null
  for (let index = 0; index < requirements.length; index += 1) {
    const requirement = requirements[index]
    const marker = planMarker(sourceRequirements[index]?.title)
    if (marker === '1' && currentSection) {
      requirement.relation = 'or'
      requirement.parentId = currentSection.id
      currentSection.children.push(requirement)
      continue
    }
    requirement.parentId = root.id
    root.children.push(requirement)
    currentSection = requirement
  }

  return {
    ...progress,
    program: programTitle || progress.program || null,
    categories: requirements,
    roots: [root],
    sourceUrl: sourceUrl || progress.sourceUrl || null,
    requirementSource: 'api-inferred-tree',
  }
}

export function hasAcademicRequirementDetails(progress) {
  return Boolean(progress && (
    (Array.isArray(progress.roots) && progress.roots.length > 0)
    || (Array.isArray(progress.categories) && progress.categories.length > 0)
  ))
}

function numberOrNull(value) {
  const match = String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : null
}

function hasActualApiStudyRecord(course) {
  return ['XNM', 'XQM', 'XQMMC'].some((field) => String(course?.[field] ?? '').trim())
}

function apiCourseStatus(course) {
  const code = Number(course?.XDZT)
  if (code === 2) return '\u672a\u901a\u8fc7'
  if (code === 3) return hasActualApiStudyRecord(course) ? '\u5728\u8bfb' : '\u672a\u4fee'
  if (code === 4) return '\u5df2\u4fee'
  if (code === 1) return '\u672a\u4fee'
  return null
}

function apiRequirementCourses(entry) {
  const requirementId = String(entry.id || stableId('academic-api-requirement', entry.title)).trim()
  return (entry.courses || []).map((course, index) => {
    const courseCode = String(course?.KCH || '').trim().toUpperCase()
    const title = String(course?.KCMC || '').trim()
    if (!title) return null
    const score = course?.CJ ?? course?.MAXCJ ?? null
    return {
      id: stableId('academic-api-requirement-course', requirementId, courseCode || title, index),
      studyStatus: apiCourseStatus(course),
      academicYear: String(course?.XNM || '').trim() || null,
      term: String(course?.XQMMC ?? course?.XQM ?? '').trim() || null,
      courseCode: isStandardCourseCode(courseCode) ? courseCode : null,
      title,
      hours: String(course?.ZXS ?? course?.XS ?? '').trim() || null,
      nature: String(course?.KCXZMC || '').trim() || null,
      credits: numberOrNull(course?.XF),
      category: String(course?.KCLBMC || '').trim() || null,
      bestScore: course?.MAXCJ == null ? null : String(course.MAXCJ),
      point: numberOrNull(course?.JD),
      score: score == null ? null : String(score),
      makeupScore: course?.BKCJ == null ? null : String(course.BKCJ),
      retakeScore: course?.CXCJ == null ? null : String(course.CXCJ),
      recommendedYear: String(course?.JYXDXNM || '').trim() || null,
      recommendedTerm: String(course?.JYXDXQM || '').trim() || null,
    }
  }).filter(Boolean)
}

function directCourseBranch(requirement) {
  const title = /\u9009\u4fee/.test(String(requirement.title || '')) ? '\u4efb\u610f\u9009\u4fee' : '\u65e0\u65b9\u5411'
  return {
    ...requirement,
    id: `${requirement.id}:direct-courses`,
    title,
    relation: 'and',
    parentId: requirement.id,
    children: [],
    courses: requirement.courses,
    directCourseBranch: true,
  }
}

function officialRequirementRoots(categoriesById, originalCategories) {
  const roots = []
  for (const requirement of categoriesById.values()) requirement.children = []
  for (const original of originalCategories) {
    const target = categoriesById.get(String(original.id))
    if (!target) continue
    const parent = original.parentId ? categoriesById.get(String(original.parentId)) : null
    if (parent && parent !== target) parent.children.push(target)
    else roots.push(target)
  }
  return roots
}

function separateDirectCourseBranches(categoriesById, originalCategories) {
  for (const original of originalCategories) {
    const target = categoriesById.get(String(original.id))
    if (!target) continue
    const officialChildren = target.children || []
    const directCourses = target.courses || []
    target.children = directCourses.length && officialChildren.length
      ? [directCourseBranch(target), ...officialChildren]
      : officialChildren
    if (directCourses.length && officialChildren.length) target.courses = []
  }
}

export function degreePlanDetailsToProgress(summary, detailResult, {
  treeSource = 'api-tree-detail',
  inferredSource = 'api-inferred-tree',
  capturedAt = new Date().toISOString(),
} = {}) {
  const sourceTree = detailResult?.progress
  const detailsById = new Map((detailResult?.details || []).map((entry) => [String(entry.id), entry]))
  const originalCategories = Array.isArray(sourceTree?.categories) ? sourceTree.categories : []
  if (!originalCategories.length) return null
  if (!Array.isArray(sourceTree?.roots) || !sourceTree.roots.length) {
    const inferred = inferAcademicRequirementTree({
      ...sourceTree,
      ...summary,
      categories: originalCategories,
      sourceUrl: detailResult.sourceUrl || summary?.sourceUrl || null,
      capturedAt,
    }, {
      details: (detailResult?.details || []).map((entry) => ({
        ...entry,
        courses: apiRequirementCourses(entry),
      })),
      sourceUrl: detailResult.sourceUrl || summary?.sourceUrl || null,
    })
    return inferred ? { ...inferred, requirementSource: inferredSource } : null
  }
  const categoriesById = new Map(originalCategories.map((entry) => {
    const detail = detailsById.get(String(entry.id))
    return [String(entry.id), {
      ...entry,
      courses: detail ? apiRequirementCourses(detail) : (entry.courses || []),
      sourceUrl: detailResult.sourceUrl || entry.sourceUrl || summary?.sourceUrl || null,
      children: [],
    }]
  }))
  const roots = officialRequirementRoots(categoriesById, originalCategories)
  separateDirectCourseBranches(categoriesById, originalCategories)
  if (!roots.length) return null
  return {
    ...sourceTree,
    categories: [...categoriesById.values()],
    roots,
    sourceUrl: detailResult.sourceUrl || summary?.sourceUrl || null,
    capturedAt,
    requirementSource: treeSource,
  }
}

export function mergeAcademicProgressDetails(summary, detailedProgress) {
  return {
    ...detailedProgress,
    gpa: summary?.gpa ?? detailedProgress?.gpa,
    courseCounts: summary?.courseCounts ?? detailedProgress?.courseCounts,
    program: detailedProgress?.program ?? summary?.program ?? null,
  }
}

function hasMeaningfulTree(progress) {
  return Array.isArray(progress?.roots) && progress.roots.some((root) => Array.isArray(root?.children) && root.children.length > 0)
}

function hasActualStudyRecord(course) {
  return Boolean(String(course?.academicYear ?? '').trim() || String(course?.term ?? '').trim())
}

function repairUnstartedCourses(progress) {
  const repairCourse = (course) => {
    if (course?.studyStatus !== '\u5728\u8bfb' || hasActualStudyRecord(course)) return course
    if (course?.score != null || course?.bestScore != null || course?.point != null) return course
    return { ...course, studyStatus: '\u672a\u4fee' }
  }
  const repairRequirement = (requirement) => ({
    ...requirement,
    courses: Array.isArray(requirement?.courses) ? requirement.courses.map(repairCourse) : [],
    children: Array.isArray(requirement?.children) ? requirement.children.map(repairRequirement) : [],
  })
  return {
    ...progress,
    categories: Array.isArray(progress?.categories)
      ? progress.categories.map((requirement) => ({ ...requirement, courses: Array.isArray(requirement?.courses) ? requirement.courses.map(repairCourse) : [] }))
      : progress?.categories,
    roots: Array.isArray(progress?.roots) ? progress.roots.map(repairRequirement) : progress?.roots,
  }
}

function repairInferredRequirementTitles(progress) {
  if (!String(progress?.requirementSource || '').endsWith('inferred-tree')) return progress
  const titleById = new Map()
  for (const requirement of progress.categories || []) {
    const title = titleFromCourseNature(requirement?.title, requirement?.courses)
    if (title && title !== requirement.title) titleById.set(String(requirement.id), title)
  }
  if (!titleById.size) return progress
  const updateNode = (node) => ({
    ...node,
    title: titleById.get(String(node.id)) || node.title,
    children: Array.isArray(node.children) ? node.children.map(updateNode) : [],
  })
  return {
    ...progress,
    categories: progress.categories.map((requirement) => ({
      ...requirement,
      title: titleById.get(String(requirement.id)) || requirement.title,
    })),
    roots: Array.isArray(progress.roots) ? progress.roots.map(updateNode) : progress.roots,
  }
}

export function normalizeAcademicProgress(progress) {
  if (!progress || typeof progress !== 'object') return null
  const categories = Array.isArray(progress.categories) ? progress.categories : []
  const hasApiMarkers = categories.some((requirement) => planMarker(requirement?.title))
  const normalized = hasApiMarkers && !hasMeaningfulTree(progress)
    ? inferAcademicRequirementTree(progress)
    : repairInferredRequirementTitles(progress)
  return repairUnstartedCourses(normalized)
}
