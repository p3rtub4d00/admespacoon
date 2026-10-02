import crypto from 'node:crypto'

export const DEMO_EVENT_TYPES = ['visit', 'admin_open', 'contact_click', 'reservation_completed']
export const DEMO_RETENTION_DAYS = 90
export function analyticsDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Manaus', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const value = type => parts.find(part => part.type === type).value
  return `${value('year')}-${value('month')}-${value('day')}`
}
export function daysBefore(day, days) {
  const date = new Date(day + 'T12:00:00Z')
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}
export function demoEventRecord(clubId, input, secret, now = new Date()) {
  if (!input || !DEMO_EVENT_TYPES.includes(input.type) || typeof input.eventId !== 'string' || !/^[A-Za-z0-9-]{8,80}$/.test(input.eventId)) {
    throw Object.assign(new Error('Evento de demonstração inválido.'), { statusCode: 400 })
  }
  const day = analyticsDay(now)
  const bucket = input.type === 'reservation_completed' ? '' : day
  const eventKey = crypto.createHmac('sha256', secret).update([clubId, input.type, bucket, input.eventId].join('|')).digest('hex')
  const location = input.type === 'visit' ? sanitizeDemoLocation(input.location) : null
  return { clubId, type: input.type, day, eventKey, ...(location ? { location } : {}), createdAt: now, expiresAt: new Date(now.getTime() + DEMO_RETENTION_DAYS * 86400000) }
}
export function demoAnalyticsSummary(rows, now = new Date()) {
  const today = analyticsDay(now)
  const start7 = daysBefore(today, 6)
  const monthStart = today.slice(0, 7) + '-01'
  const empty = () => Object.fromEntries(DEMO_EVENT_TYPES.map(type => [type, 0]))
  const periods = { today: empty(), last7: empty(), month: empty() }
  const daily = Array.from({ length: 7 }, (_, i) => ({ day: daysBefore(today, 6 - i), ...empty() }))
  for (const row of rows) {
    const { day, type } = row._id
    if (!DEMO_EVENT_TYPES.includes(type) || day > today) continue
    const count = Number(row.count) || 0
    if (day === today) periods.today[type] += count
    if (day >= start7) periods.last7[type] += count
    if (day >= monthStart) periods.month[type] += count
    const target = daily.find(item => item.day === day)
    if (target) target[type] += count
  }
  return { periods, daily, timezone: 'America/Manaus', updatedAt: now.toISOString() }
}

export function sanitizeDemoLocation(value) {
  const clean = field => typeof field === 'string' ? field.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0,80) : ''
  const countryCode = clean(value?.countryCode).toUpperCase()
  if (!/^[A-Z]{2}$/.test(countryCode)) return null
  return { city: clean(value.city), region: clean(value.region), country: clean(value.country), countryCode }
}

export function demoLocationSummary(rows, now = new Date()) {
  const today = analyticsDay(now)
  const starts = { today, last7: daysBefore(today,6), month: today.slice(0,7) + '-01' }
  return Object.fromEntries(Object.entries(starts).map(([period,start]) => {
    const locations = new Map()
    let total = 0, unknown = 0
    for (const row of rows) {
      if (row._id.type !== 'visit' || row._id.day < start || row._id.day > today) continue
      const count = Number(row.count) || 0
      total += count
      const location = sanitizeDemoLocation(row._id.location)
      if (!location) { unknown += count; continue }
      const key = JSON.stringify(location)
      const previous = locations.get(key)
      locations.set(key, { ...location, count: (previous?.count || 0) + count })
    }
    const ranked = [...locations.values()].sort((a,b) => b.count - a.count || JSON.stringify(a).localeCompare(JSON.stringify(b)))
    return [period, { rows: ranked.slice(0,20), total, unknown, other: ranked.slice(20).reduce((sum,row) => sum + row.count,0) }]
  }))
}
