import { compactError } from '../util.mjs'
import { AuthRequiredError } from '../source-client.mjs'

const BASE = 'https://tygl.buct.edu.cn/'
const FITNESS_KEYWORDS = /体质测试|体测成绩|体质健康|国家学生体质/i

export function upgradeTyglRedirectUrl(value) {
  try {
    const url = new URL(String(value || ''))
    if (url.protocol !== 'http:' || url.hostname !== 'tygl.buct.edu.cn') return null
    if (url.username || url.password || (url.port && url.port !== '80')) return null
    url.protocol = 'https:'
    url.port = ''
    return url.toString()
  } catch {
    return null
  }
}

function plainText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function permittedFitnessUrl(value, base) {
  try {
    const url = new URL(String(value || '').trim(), base)
    if (!/(^|\.)buct\.edu\.cn$/i.test(url.hostname)) return null
    return url.toString()
  } catch {
    return null
  }
}

function attribute(markup, name) {
  return String(markup || '').match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(1).find(Boolean) || ''
}

function yearRank(value) {
  const numbers = String(value || '').match(/\d+/g)?.map(Number) || []
  if (!numbers.length) return -1
  return numbers[0] * 100 + (numbers[1] || 0)
}

function parseTimeSecs(str) {
  if (!str) return null
  const trimmed = plainText(str).replace(/["″]/g, '')
  const match = trimmed.match(/(\d+)\s*['’]\s*(\d+)?/)
  if (match) return Number(match[1]) * 60 + Number(match[2] || 0)
  // Health Cloud writes endurance results as `4.55分`, meaning 4 minutes
  // 55 seconds rather than the decimal value 4.55 minutes.
  const minuteNotation = trimmed.match(/^(\d+)\.(\d{1,2})\s*(?:分|分钟)$/)
  if (minuteNotation && Number(minuteNotation[2]) < 60) {
    return Number(minuteNotation[1]) * 60 + Number(minuteNotation[2])
  }
  const n = parseFloat(trimmed)
  return Number.isNaN(n) ? null : Math.round(n)
}

function parseNum(str) {
  const n = parseFloat(plainText(str))
  return Number.isNaN(n) ? null : n
}

function buildColumnMap(headerRow) {
  const map = {}
  const cells = [...headerRow.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)]
  cells.forEach((match, index) => {
    const text = plainText(match[1])
    if (/肺活量/.test(text)) map.vitality = index
    else if (/50\s*[米m]/i.test(text)) map.run50 = index
    else if (/坐位/.test(text)) map.flex = index
    else if (/立定/.test(text)) map.jump = index
    else if (/引体向上/.test(text)) { map.strength = index; map.isMale = true }
    else if (/仰卧起坐/.test(text)) { map.strength = index; map.isMale = false }
    else if (/1000/.test(text)) { map.endure = index; map.endureMale = true }
    else if (/800/.test(text)) { map.endure = index; map.endureMale = false }
    else if (/年份|测试年|学年/.test(text)) map.year = index
    else if (/性别/.test(text)) map.gender = index
  })
  return map
}

function extractCells(row) {
  return [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => plainText(match[1]))
}

function scoreFromFitnessTable(tableHtml) {
  if (!/肺活量|50\s*米|引体|仰卧|立定|坐位/.test(tableHtml)) return null
  const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[0])
  const headerIndex = rows.findIndex((row) => /<t[hd]\b/i.test(row) && /肺活量|50\s*米|引体|仰卧|立定|坐位/.test(row))
  if (headerIndex === -1) return null
  const columns = buildColumnMap(rows[headerIndex])
  if (columns.vitality === undefined && columns.run50 === undefined) return null

  const candidates = rows
    .slice(headerIndex + 1)
    .filter((row) => /<td\b/i.test(row))
    .map((row, index) => ({ cells: extractCells(row), index }))
    .filter(({ cells }) => cells.length)
  if (!candidates.length) return null
  const selected = candidates.reduce((best, current) => {
    if (columns.year === undefined) return current
    const bestRank = yearRank(best.cells[columns.year])
    const currentRank = yearRank(current.cells[columns.year])
    return currentRank >= bestRank ? current : best
  })
  const get = (key) => columns[key] === undefined ? undefined : selected.cells[columns[key]]
  const detectedGender = get('gender')
  const gender = /男/.test(detectedGender || '') ? 'male'
    : /女/.test(detectedGender || '') ? 'female'
      : columns.isMale === true ? 'male'
        : columns.isMale === false ? 'female'
          : null
  return {
    vitality: parseNum(get('vitality')),
    run50: parseNum(get('run50')),
    flex: parseNum(get('flex')),
    jump: parseNum(get('jump')),
    strength: parseNum(get('strength')),
    endureSecs: parseTimeSecs(get('endure')),
    gender,
    year: get('year') || null,
  }
}

function labeledScoreFromFitnessTable(tableHtml) {
  if (!/身体机能\s*\(\s*肺活量\s*\)|50\s*米跑|坐立体前屈|立定跳远/.test(tableHtml)) return null
  const values = {
    vitality: null,
    run50: null,
    flex: null,
    jump: null,
    strength: null,
    endureSecs: null,
    gender: null,
  }
  let measurements = 0
  const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
  for (const row of rows) {
    const cells = extractCells(row[0])
    // Health Cloud prints two metric/result/score/level groups in each row.
    for (const [label, result] of [[cells[0], cells[1]], [cells[4], cells[5]]]) {
      const metric = plainText(label)
      const numeric = parseNum(result)
      if (numeric === null) continue
      if (/肺活量/.test(metric)) values.vitality = numeric
      else if (/50\s*米/.test(metric)) values.run50 = numeric
      else if (/坐立.*前屈/.test(metric)) values.flex = numeric
      else if (/立定/.test(metric)) values.jump = numeric
      else if (/引体/.test(metric)) { values.strength = numeric; values.gender = 'male' }
      else if (/仰卧/.test(metric)) { values.strength = numeric; values.gender = 'female' }
      else if (/1000\s*米/.test(metric)) { values.endureSecs = parseTimeSecs(result); values.gender = 'male' }
      else if (/800\s*米/.test(metric)) { values.endureSecs = parseTimeSecs(result); values.gender = 'female' }
      else continue
      measurements += 1
    }
  }
  if (!measurements) return null
  const year = plainText(tableHtml).match(/测试年度\s*(20\d{2})/)?.[1] || null
  return { ...values, year }
}

function scoreFromPage(html) {
  const tables = [...String(html || '').matchAll(/<table[\s\S]*?<\/table>/gi)]
  const pageYear = plainText(html).match(/测试年度\s*(20\d{2})/)?.[1] || null
  const scores = tables
    .map((match) => labeledScoreFromFitnessTable(match[0]) || scoreFromFitnessTable(match[0]))
    .filter(Boolean)
    .map((score) => score.year ? score : { ...score, year: pageYear })
  return scores.sort((left, right) => yearRank(right.year) - yearRank(left.year))[0] || null
}

function profileFromPage(html) {
  const values = {}
  const rows = [...String(html || '').matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
  for (const row of rows) {
    const cells = extractCells(row[0])
    for (let index = 0; index + 1 < cells.length; index += 2) {
      const label = cells[index]
      const value = cells[index + 1]
      if (/^性别$/.test(label) && !values.gender) values.gender = /男/.test(value) ? 'male' : /女/.test(value) ? 'female' : null
      else if (/^年级$/.test(label) && !values.academicGrade) values.academicGrade = value || null
      else if (/^身高$/.test(label) && values.heightCm === undefined) {
        const height = parseNum(value)
        values.heightCm = height === null ? null : (/米/.test(value) && height < 3 ? height * 100 : height)
      } else if (/^体重$/.test(label) && values.weightKg === undefined) {
        values.weightKg = parseNum(value)
      }
    }
  }
  const grade = String(values.academicGrade || '')
  return {
    gender: values.gender || null,
    academicGrade: values.academicGrade || null,
    gradeGroup: /大一|大二/.test(grade) ? '12' : /大三|大四/.test(grade) ? '34' : null,
    heightCm: values.heightCm ?? null,
    weightKg: values.weightKg ?? null,
  }
}

function findFitnessPageUrl(html, base) {
  const sources = [
    ...String(html || '').matchAll(/<a\b[\s\S]*?<\/a>/gi),
    ...String(html || '').matchAll(/<[^>]+\bdata-(?:url|href)=[^>]*>/gi),
  ]
  for (const match of sources) {
    const markup = match[0]
    const label = [plainText(markup), attribute(markup, 'title'), attribute(markup, 'data-name')].join(' ')
    if (!FITNESS_KEYWORDS.test(label)) continue
    const rawUrl = attribute(markup, 'href') || attribute(markup, 'data-url') || attribute(markup, 'data-href')
    const target = permittedFitnessUrl(rawUrl, base)
    if (target && !/^javascript:/i.test(rawUrl)) return target
  }
  const inlineUrls = [...String(html || '').matchAll(/(?:location(?:\.href)?|window\.open)\s*\(\s*['"]([^'"]+)['"]/gi)]
  for (const match of inlineUrls) {
    const target = permittedFitnessUrl(match[1], base)
    if (target) return target
  }
  return null
}

function newestYearRequest(html, pageUrl) {
  const forms = [...String(html || '').matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)]
  for (const form of forms) {
    const body = form[2]
    const select = body.match(/<select\b([^>]*)>([\s\S]*?)<\/select>/i)
    if (!select) continue
    const name = attribute(select[1], 'name')
    if (!name) continue
    const options = [...select[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)]
      .map((option) => ({ value: attribute(option[1], 'value') || plainText(option[2]), label: plainText(option[2]) }))
      .filter((option) => option.value)
      .sort((left, right) => yearRank(right.label || right.value) - yearRank(left.label || left.value))
    if (!options.some((option) => yearRank(option.label || option.value) >= 200000)) continue
    const newest = options[0]
    if (!newest) continue
    const values = Object.fromEntries(
      [...body.matchAll(/<input\b([^>]*)>/gi)]
        .map((input) => [attribute(input[1], 'name'), attribute(input[1], 'value')])
        .filter(([key]) => key),
    )
    values[name] = newest.value
    const action = permittedFitnessUrl(attribute(form[1], 'action') || pageUrl, pageUrl)
    if (action) return { url: action, values, method: String(attribute(form[1], 'method') || 'get').toLowerCase(), year: newest.label || newest.value }
  }
  return null
}

async function loadNewestFitnessYear(client, page) {
  const request = newestYearRequest(page.text, page.url)
  if (!request) return null
  if (request.method === 'post') {
    const text = await client.form(request.url, request.values, { source: '体测成绩系统', referer: page.url })
    return { text, url: request.url, selectedYear: request.year }
  }
  const url = new URL(request.url)
  Object.entries(request.values).forEach(([key, value]) => url.searchParams.set(key, value))
  const result = await client.page(url.toString(), { source: '体测成绩系统' })
  return { ...result, selectedYear: request.year }
}

export class TyglAdapter {
  constructor(client, { fitnessPageLoader } = {}) {
    this.client = client
    this.fitnessPageLoader = fitnessPageLoader
  }

  async fetchScore({ year } = {}) {
    const home = await this.client.page(BASE, { source: '体测成绩系统' })
    if (!home.text || home.text.length < 200) throw new AuthRequiredError('体测成绩系统', home.url)
    if (/统一身份认证|请登录|\bcas\/login\b/i.test(home.url) || /统一身份认证/.test(home.text)) {
      throw new AuthRequiredError('体测成绩系统', home.url)
    }

    const interactivePage = this.fitnessPageLoader
      ? await this.fitnessPageLoader({ year }).catch(() => null)
      : null
    const fitnessUrl = findFitnessPageUrl(home.text, home.url)
    const fitnessPage = interactivePage || (fitnessUrl
      ? await this.client.page(fitnessUrl, { source: '体测成绩系统' })
      : home)
    const newestPage = await loadNewestFitnessYear(this.client, fitnessPage)
    const score = scoreFromPage(newestPage?.text || fitnessPage.text)
      || scoreFromPage(fitnessPage.text)
      || scoreFromPage(home.text)

    const profile = profileFromPage(newestPage?.text || fitnessPage.text || home.text)
    const fallback = {
      vitality: null, run50: null, flex: null,
      jump: null, strength: null, endureSecs: null,
      gender: null, year: newestPage?.selectedYear || null,
    }
    return {
      ...(score || fallback),
      gender: profile.gender || score?.gender || null,
      academicGrade: profile.academicGrade,
      gradeGroup: profile.gradeGroup,
      heightCm: profile.heightCm,
      weightKg: profile.weightKg,
      yearKey: interactivePage?.yearKey || null,
      availableYears: Array.isArray(interactivePage?.availableYears) ? interactivePage.availableYears : [],
    }
  }

  async status() {
    const checkedAt = new Date().toISOString()
    try {
      const result = await this.client.page(BASE, { source: '体测成绩系统' })
      if (/统一身份认证|\bcas\/login\b/i.test(result.url)) throw new AuthRequiredError('体测成绩系统', result.url)
      return { connected: true, checkedAt, url: result.url }
    } catch (error) {
      return { connected: false, checkedAt, authRequired: error instanceof AuthRequiredError, error: compactError(error) }
    }
  }
}
