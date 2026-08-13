import * as cheerio from 'cheerio'
import { absoluteUrl, normalizeText } from '../util.mjs'

function uniqueBy(values, key) {
  const seen = new Set()
  return values.filter((value) => {
    const id = key(value)
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

function optionText($, input) {
  const id = $(input).attr('id')
  const label = id ? $(`label[for="${id.replace(/"/g, '\\"')}"]`).first() : null
  return normalizeText(label?.text() || $(input).closest('label, td, li, div').first().text())
}

function testQuestions($) {
  const controls = $('input[type="radio"], input[type="checkbox"], textarea, select').toArray()
    .filter((node) => !$(node).attr('disabled') && !$(node).attr('hidden'))
  const groups = []
  const known = new Map()

  for (const input of controls) {
    const type = ($(input).attr('type') || input.tagName || '').toLowerCase()
    const name = $(input).attr('name') || `field-${groups.length}`
    const key = ['radio', 'checkbox'].includes(type) ? `${type}:${name}` : `field:${name}:${groups.length}`
    let group = known.get(key)
    if (!group) {
      const container = $(input).closest('.question, .question-item, .test-question, .exam-question, .que, li, tr, fieldset, .topic').first()
      group = {
        index: groups.length + 1,
        type: ['radio', 'checkbox'].includes(type) ? type : input.tagName.toLowerCase() === 'textarea' ? 'text' : 'select',
        prompt: normalizeText(container.length ? container.clone().find('input, textarea, select, label').remove().end().text() : $(input).parent().text()).slice(0, 2_000),
        choices: [],
      }
      known.set(key, group)
      groups.push(group)
    }
    if (['radio', 'checkbox'].includes(type)) {
      const label = optionText($, input)
      if (label) group.choices.push({ label, value: $(input).attr('value') || null })
    }
  }

  return groups.map((group) => ({
    ...group,
    prompt: group.prompt || `第 ${group.index} 题`,
    choices: uniqueBy(group.choices, (choice) => `${choice.value || ''}:${choice.label}`),
  }))
}

function attachmentLinks($, baseUrl) {
  const links = []
  $('a[href]').each((_index, node) => {
    const href = absoluteUrl($(node).attr('href'), baseUrl)
    const title = normalizeText($(node).attr('title') || $(node).text())
    if (!href || !title) return
    const url = new URL(href)
    const looksLikeFile = /\.(?:pdf|docx?|pptx?|xlsx?|zip|rar|txt|md|png|jpe?g|gif|mp4|mp3)$/i.test(url.pathname)
    const looksLikeDownload = /附件|下载|文件|课件|资料|download|attachment|resource|file/i.test(`${title} ${href}`)
    if (looksLikeFile || looksLikeDownload) links.push({ title: title.slice(0, 180), url: href })
  })
  return uniqueBy(links, (link) => link.url).slice(0, 80)
}

export function parseTheolWorkPage(html, { baseUrl, kind = 'assignment', fallbackTitle = '课程任务' } = {}) {
  const $ = cheerio.load(html)
  $('script, style, noscript, template').remove()
  const title = normalizeText($('h1, h2, .title, .task-title, .hw-title').first().text() || $('title').text() || fallbackTitle).slice(0, 300)
  const text = normalizeText($('body').text()).slice(0, 24_000)
  const questions = kind === 'online-test' ? testQuestions($) : []
  return {
    title: title || fallbackTitle,
    instructions: text || null,
    attachments: attachmentLinks($, baseUrl),
    questions,
  }
}

export function normalizeAnswerKey(input) {
  const values = Array.isArray(input) ? input : input?.answers
  if (!Array.isArray(values)) throw new Error('答题 JSON 必须包含 answers 数组')
  const answers = values.map((value, index) => {
    const question = Number(value?.question ?? value?.index ?? index + 1)
    const answer = value?.answer ?? value?.answers ?? value?.value
    if (!Number.isInteger(question) || question < 1 || answer === undefined || answer === null || answer === '') {
      throw new Error(`第 ${index + 1} 条答题数据不完整`)
    }
    return { question, answer: Array.isArray(answer) ? answer.map(String) : String(answer) }
  })
  if (!answers.length) throw new Error('答题 JSON 为空')
  return { schema: 'theia-test-answer-key/v1', answers }
}

export function answerTemplate(questions) {
  return {
    schema: 'theia-test-answer-key/v1',
    answers: questions.map((question) => ({
      question: question.index,
      answer: question.type === 'checkbox' ? [] : '',
    })),
  }
}
