function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderTimestamp(now = new Date()) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    timeZone: 'Asia/Shanghai',
  }).formatToParts(now)
  const get = (type) => parts.find((part) => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`
}

const MOTION_STATE_LABELS = Object.freeze({
  available: '可预约',
  occupied: '已占用',
  closed: '闭馆',
  expired: '已过期',
  selected: '已选定',
  unknown: '未知',
})

function motionStateLabel(value) {
  return MOTION_STATE_LABELS[value] || String(value || '未知')
}

function motionStateClass(value) {
  if (value === 'available') return 'available'
  if (value === 'occupied') return 'occupied'
  if (value === 'closed' || value === 'expired') return 'closed'
  return 'unknown'
}

export function renderMotionVenueTableHtml(statuses, { title = '', date = '' } = {}) {
  const heading = title || '场馆状态表'
  const subtitle = []
  if (date) subtitle.push(`日期：${escapeHtml(date)}`)
  const venues = statuses.map((status) => {
    const query = status?.query || {}
    const tables = Array.isArray(status?.availability?.tables) ? status.availability.tables : []
    return { status, query, tables }
  }).filter((item) => item.tables.length)
  const sections = venues.map(({ status, query, tables }) => {
    const caption = [query?.campus?.label, query?.venue, query?.activity].filter(Boolean).join(' · ') || '场馆'
    const blocks = tables.map((table) => {
      const headers = Array.isArray(table.headers) ? table.headers : []
      const timeHeader = headers[0] || '时间\\场地'
      // 过滤敏感列：同步过滤表头和数据列，避免只删表头不删数据
      const allowedIndices = []
      const courtHeaders = []
      for (let i = 1; i < headers.length; i += 1) {
        if (!SENSITIVE_COURT_HEADER.test(String(headers[i]))) {
          allowedIndices.push(i)
          courtHeaders.push(headers[i])
        }
      }
      const rows = (Array.isArray(table.slots) ? table.slots : []).map((slot) => {
        const time = escapeHtml(String(slot?.time || ''))
        const allCourts = Array.isArray(slot?.courts) ? slot.courts : []
        const courts = allowedIndices.map((index, displayIndex) => {
          const cell = allCourts[index]
          const label = courtHeaders[displayIndex] || `场地${displayIndex + 1}`
          const stateClass = motionStateClass(cell?.state)
          const statusText = escapeHtml(String(cell?.status ?? motionStateLabel(cell?.state)))
          return `<td><span class="cell ${stateClass}"><b>${escapeHtml(String(label))}</b><small>${statusText}</small></span></td>`
        }).join('')
        return `<tr><th>${time}</th>${courts}</tr>`
      }).join('')
      const headerCells = courtHeaders.map((header) => `<th>${escapeHtml(String(header))}</th>`).join('')
      return `<table class="motion"><thead><tr><th>${escapeHtml(timeHeader)}</th>${headerCells}</tr></thead><tbody>${rows}</tbody></table>`
    }).join('')
    return `<div class="motion-section"><div class="motion-caption">${escapeHtml(caption)}</div>${blocks}</div>`
  }).join('')
  if (statuses.length > 1) subtitle.push(`共 ${statuses.length} 个场馆`)
  const dataCapturedAt = statuses.reduce((latest, item) => {
    const ts = item?.capturedAt || item?.cachedAt || null
    return ts && (!latest || ts > latest) ? ts : latest
  }, null)
  return `
    <div class="title">${escapeHtml(heading)}</div>
    <div class="subtitle">${subtitle.join(' · ') || escapeHtml('实时场馆状态')}</div>
    ${sections}
    <div class="count">数据时间：${escapeHtml(formatCapturedAt(dataCapturedAt) || renderTimestamp())}</div>
  `
}

const SENSITIVE_COURT_HEADER = /(?:姓名|学号|手机|电话|身份证|联系人|预约人|申请人|用户名|账号|密码|email)/iu

export function renderFreeClassroomImageHtml(records, { title = '空闲教室', building = '', periods = '', capturedAt = null } = {}) {
  // Each cached record is one free classroom. Extract the building name and
  // classroom name; group by building so the reply distinguishes 一教/二教.
  const rows = records.map((record) => ({
    classroom: String(cellValue(record, ['classroom', 'cdmc', 'cdbh', 'room']) || ''),
    building: String(cellValue(record, ['jxlmc', 'building', 'lh', '教学楼']) || ''),
    seats: String(cellValue(record, ['capacity', 'zws', 'qszws']) || ''),
  })).filter((row) => row.classroom)
  if (building) {
    // Allow filtering by a short label such as "1", "2", "一教", "二教".
    const needle = String(building).toLocaleLowerCase().replace(/\s+/g, '')
    if (needle) {
      const filtered = rows.filter((row) => {
        const b = String(row.building).toLocaleLowerCase().replace(/\s+/g, '')
        return b.includes(needle) || needle.includes(b) || /一教|第一教学/u.test(needle) && /一教|第一教学/u.test(b) || /二教|第二教学/u.test(needle) && /二教|第二教学/u.test(b)
      })
      if (filtered.length) return renderRoomGrouping(filtered, { title, building, periods, capturedAt })
    }
  }
  if (!rows.length) return null
  return renderRoomGrouping(rows, { title, building, periods, capturedAt })
}

function formatCapturedAt(value) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return renderTimestamp(d)
}

function renderRoomGrouping(rows, { title = '空闲教室', building = '', periods = '', capturedAt = null }) {
  const byBuilding = new Map()
  for (const row of rows) {
    const key = row.building || '未标注教学楼'
    if (!byBuilding.has(key)) byBuilding.set(key, [])
    byBuilding.get(key).push(row)
  }
  // 阶梯教室（教室名含“阶”，如 A阶101）排在所有普通教室（A101）前面；
  // 每组内部按教室名升序排列（A101 A102 … A201）。
  const roomRank = (name) => {
    const text = String(name || '')
    // 允许“阶”等中文字符夹在字母和数字之间：A阶101 -> prefix=A, number=101
    const match = text.match(/^([A-Za-z\u3400-\u9fff]*?)(\d+)/u)
    const prefix = match?.[1] || ''
    const number = match?.[2] ? Number(match[2]) : Number.MAX_SAFE_INTEGER
    const isStaircase = /阶/u.test(text)
    return {
      staircase: isStaircase ? 0 : 1,
      prefix,
      number,
      text,
    }
  }
  const compareRooms = (left, right) => {
    const a = roomRank(left.classroom)
    const b = roomRank(right.classroom)
    if (a.staircase !== b.staircase) return a.staircase - b.staircase
    const prefixCompare = a.prefix.localeCompare(b.prefix, 'en', { sensitivity: 'base' })
    if (prefixCompare !== 0) return prefixCompare
    if (a.number !== b.number) return a.number - b.number
    return a.text.localeCompare(b.text, 'zh-CN')
  }
  const periodLabel = periods
    ? ` · 节次：${periods.split(',').map((item) => escapeHtml(item.trim())).filter(Boolean).join('、')}`
    : ''
  const sections = [...byBuilding.entries()].map(([buildingName, rooms]) => {
    const sorted = [...rooms].sort(compareRooms)
    const cells = sorted.map((room) => `<div class="room-card"><b>${escapeHtml(room.classroom)}</b>${room.seats ? `<small>${escapeHtml(room.seats)}座</small>` : ''}</div>`).join('')
    return `<div class="room-section"><div class="room-caption">${escapeHtml(buildingName)} · ${rooms.length} 间</div><div class="room-grid">${cells}</div></div>`
  }).join('')
  return `
    <div class="title">${escapeHtml(title)}</div>
    <div class="subtitle">共 ${rows.length} 间空闲教室${periodLabel}</div>
    ${sections}
    <div class="count">数据时间：${escapeHtml(formatCapturedAt(capturedAt) || renderTimestamp())}</div>
  `
}

function cellValue(record, names) {
  for (const name of names) {
    const direct = record?.[name]
    if (direct !== undefined && direct !== null && String(direct).trim() !== '') return String(direct)
    const entry = Array.isArray(record?.fields)
      ? record.fields.find((item) => String(item?.name || '') === name || String(item?.label || '') === name)
      : null
    if (entry?.value !== undefined && entry.value !== null && String(entry.value).trim() !== '') return String(entry.value)
  }
  return null
}

export function renderFreeClassroomTableHtml(state, { domain = 'free-classroom', title = '', limit = 50 } = {}) {
  const source = state.academicExtras?.domains?.[domain] || null
  const records = Array.isArray(source?.records) ? source.records : []
  if (!records.length) return null
  const selected = records.slice(0, limit)
  const heading = title || source?.label || '空闲教室'
  const rows = selected.map((record) => [
    cellValue(record, ['classroom', 'cdmc', 'cdbh', 'room']),
    cellValue(record, ['jxlmc', 'building', 'lh', '教学楼']),
    cellValue(record, ['campus', 'xqmc', 'xiaoqu']),
    cellValue(record, ['classroomType', 'cdlbmc', 'cdlb_id']),
    cellValue(record, ['capacity', 'zws', 'qszws']),
  ])
  const body = rows.map((cells) => `<tr>${cells.map((cell) => `<td>${escapeHtml(cell ?? '—')}</td>`).join('')}</tr>`).join('')
  return `
    <div class="title">${escapeHtml(heading)}</div>
    <div class="subtitle">查询时间：${escapeHtml(source?.capturedAt || '未知')} · 共 ${records.length} 条空闲教室</div>
    <table>
      <thead><tr><th>教室</th><th>教学楼</th><th>校区</th><th>类别</th><th>座位</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
    ${records.length > selected.length ? `<div class="count">仅显示前 ${selected.length} 条，共 ${records.length} 条</div>` : ''}
    <div class="count">数据时间：${escapeHtml(formatCapturedAt(source?.capturedAt) || renderTimestamp())}</div>
  `
}

