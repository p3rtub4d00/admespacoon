export function parseDueDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw Object.assign(new Error('Informe uma data de vencimento válida.'), { statusCode: 400 })
  }
  const date = new Date(value + 'T12:00:00.000Z')
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value || date.getUTCFullYear() < 2000) {
    throw Object.assign(new Error('Informe uma data de vencimento válida.'), { statusCode: 400 })
  }
  return date
}

export function nextDueDateFromDay(dueDay, from = new Date()) {
  const day = Math.max(1, Math.min(Number(dueDay) || 10, 31))
  const year = from.getUTCFullYear()
  const month = from.getUTCMonth()
  const inMonth = offset => {
    const lastDay = new Date(Date.UTC(year, month + offset + 1, 0)).getUTCDate()
    return new Date(Date.UTC(year, month + offset, Math.min(day, lastDay), 12))
  }
  const date = inMonth(0)
  return date <= from ? inMonth(1) : date
}

export function requireCurrentOrFutureDate(date) {
  if (date.toISOString().slice(0, 10) < new Date().toISOString().slice(0, 10)) {
    throw Object.assign(new Error('Escolha hoje ou uma data futura para o vencimento.'), { statusCode: 400 })
  }
}
