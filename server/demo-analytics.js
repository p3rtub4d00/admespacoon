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
  return { clubId, type: input.type, day, eventKey, createdAt: now, expiresAt: new Date(now.getTime() + DEMO_RETENTION_DAYS * 86400000) }
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
