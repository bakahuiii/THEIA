function text(value) {
  return String(value ?? '').trim()
}

export function courseCodeOf(record) {
  return text(
    record?.courseCode || record?.courseId || record?.code || record?.id,
  ).toUpperCase()
}

export function categoryLabelOf(record) {
  return text(record?.nature) || text(record?.category) || null
}

export function categorySpecificity(value) {
  const label = text(value)
  if (!label) return 0
  const hasGroup = /(公共基础|专业基础|专业|实践环节|通识|素质教育|创新创业|外语|体育|军事)/.test(label)
  const hasRequirement = /(必修|选修|限选|核心|模块)/.test(label)
  if (hasGroup && hasRequirement) return 4
  if (hasRequirement) return 3
  if (hasGroup) return 2
  return 1
}

export function preferredCourseCategory(
  current,
  candidate,
  { replaceOnTie = false } = {},
) {
  const currentLabel = text(current)
  const candidateLabel = text(candidate)
  if (!candidateLabel) return currentLabel || null
  if (!currentLabel) return candidateLabel
  const candidateScore = categorySpecificity(candidateLabel)
  const currentScore = categorySpecificity(currentLabel)
  if (candidateScore > currentScore) return candidateLabel
  if (replaceOnTie && candidateScore === currentScore) return candidateLabel
  return currentLabel
}
