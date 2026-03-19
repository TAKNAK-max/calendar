import express from 'express'
import cors from 'cors'
import fs from 'node:fs/promises'
import path from 'node:path'

const app = express()
const port = Number(process.env.PORT ?? 8787)
const dataDir = process.env.DATA_DIR ?? '/data'
const API_KEY = process.env.API_KEY ?? ''

const MAX_FAILURES = 3
const BLOCK_DURATION_MS = 24 * 60 * 60 * 1000
const failureMap = new Map()

const BACKUP_DIR = path.join(dataDir, 'backups')
const MAX_BACKUPS = 3

function todayJST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

async function createBackup() {
  const today = todayJST()
  const backupPath = path.join(BACKUP_DIR, today)
  try { await fs.access(backupPath); return { date: today, skipped: true } } catch {}

  await fs.mkdir(backupPath, { recursive: true })
  const files = await fs.readdir(dataDir)
  for (const file of files) {
    if (!/^\d{4}\.json$/.test(file) && file !== 'settings.json') continue
    await fs.copyFile(path.join(dataDir, file), path.join(backupPath, file))
  }

  const allBackups = (await fs.readdir(BACKUP_DIR)).filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e)).sort()
  while (allBackups.length > MAX_BACKUPS) {
    const oldest = allBackups.shift()
    await fs.rm(path.join(BACKUP_DIR, oldest), { recursive: true, force: true })
  }

  console.log(`[backup] created backup for ${today}`)
  return { date: today, skipped: false }
}

function scheduleDailyBackup() {
  const nowJST = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const nextMidnightJST = new Date(nowJST)
  nextMidnightJST.setUTCHours(15, 0, 1, 0) // 15:01 UTC = 00:01 JST
  if (nextMidnightJST.getTime() <= Date.now()) {
    nextMidnightJST.setUTCDate(nextMidnightJST.getUTCDate() + 1)
  }
  const msUntilMidnight = nextMidnightJST.getTime() - Date.now()
  setTimeout(() => {
    createBackup().catch((err) => console.error('[backup] failed:', err.message))
    setInterval(() => {
      createBackup().catch((err) => console.error('[backup] failed:', err.message))
    }, 24 * 60 * 60 * 1000)
  }, msUntilMidnight)
  console.log(`[backup] next backup in ${Math.round(msUntilMidnight / 60000)} minutes`)
}

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip
}

function checkRateLimit(ip) {
  const record = failureMap.get(ip)
  if (!record) return { blocked: false, remaining: MAX_FAILURES }
  if (record.blockedUntil && Date.now() < record.blockedUntil) {
    return { blocked: true, blockedUntil: record.blockedUntil }
  }
  if (record.blockedUntil && Date.now() >= record.blockedUntil) {
    failureMap.delete(ip)
    return { blocked: false, remaining: MAX_FAILURES }
  }
  return { blocked: false, remaining: MAX_FAILURES - record.count }
}

function recordFailure(ip) {
  const record = failureMap.get(ip) || { count: 0 }
  record.count += 1
  if (record.count >= MAX_FAILURES) {
    record.blockedUntil = Date.now() + BLOCK_DURATION_MS
  }
  failureMap.set(ip, record)
  return { remaining: MAX_FAILURES - record.count, blockedUntil: record.blockedUntil }
}

function clearFailure(ip) {
  failureMap.delete(ip)
}

app.use(cors())
app.use(express.json({ limit: '2mb' }))

app.use((req, res, next) => {
  if (req.path === '/health') return next()
  if (!API_KEY) return next()

  const ip = getClientIp(req)
  const limit = checkRateLimit(ip)
  if (limit.blocked) {
    res.status(429).json({
      error: 'too_many_attempts',
      blockedUntil: limit.blockedUntil,
    })
    return
  }

  const provided = req.headers['x-api-key']
  if (provided !== API_KEY) {
    const result = recordFailure(ip)
    res.status(401).json({
      error: 'invalid_api_key',
      remainingAttempts: Math.max(0, result.remaining),
      blockedUntil: result.blockedUntil,
    })
    return
  }

  clearFailure(ip)
  next()
})

function yearFromDate(dateText) {
  const date = new Date(`${dateText}T00:00:00`)
  if (Number.isNaN(date.getTime())) return null
  return date.getFullYear()
}

function sanitizeEntry(entry) {
  if (!entry || typeof entry !== 'object') return null
  if (typeof entry.id !== 'string' || typeof entry.date !== 'string' || typeof entry.text !== 'string') return null
  if (entry.person !== 'tarchin' && entry.person !== 'yacchin') return null
  if (entry.category !== 'quick' && entry.category !== 'free') return null

  const year = yearFromDate(entry.date)
  if (year === null) return null

  const NOTIFY_MODES = ['off', 'time', '15min', '30min', '1h', '2h']

  return {
    id: entry.id,
    date: entry.date,
    text: entry.text,
    person: entry.person,
    category: entry.category,
    color: typeof entry.color === 'string' ? entry.color : undefined,
    time:
      typeof entry.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(entry.time)
        ? entry.time
        : undefined,
    notifyMode: NOTIFY_MODES.includes(entry.notifyMode) ? entry.notifyMode : undefined,
    notifyTo: Array.isArray(entry.notifyTo)
      ? entry.notifyTo.filter((p) => p === 'tarchin' || p === 'yacchin')
      : [],
    googleEventId: typeof entry.googleEventId === 'string' ? entry.googleEventId : undefined,
  }
}

function filePathForYear(year) {
  return path.join(dataDir, `${year}.json`)
}

function settingsFilePath() {
  return path.join(dataDir, 'settings.json')
}

function sanitizeColorSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const normalized = {}
  for (const [key, color] of Object.entries(value)) {
    if (typeof color !== 'string') continue
    normalized[key] = color
  }
  return normalized
}

async function readSettings() {
  const filePath = settingsFilePath()
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    return {
      colorSettings: sanitizeColorSettings(parsed?.colorSettings) ?? {},
    }
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return { colorSettings: {} }
    }
    throw error
  }
}

async function writeSettings(settings) {
  await fs.mkdir(dataDir, { recursive: true })
  const filePath = settingsFilePath()
  await fs.writeFile(filePath, JSON.stringify(settings, null, 2), 'utf8')
}

async function readYear(year) {
  const filePath = filePathForYear(year)
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(sanitizeEntry).filter(Boolean)
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return []
    throw error
  }
}

async function writeYear(year, entries) {
  const filePath = filePathForYear(year)
  await fs.mkdir(dataDir, { recursive: true })
  const sorted = [...entries].sort((a, b) => {
    if (a.date === b.date) return a.id.localeCompare(b.id)
    return a.date.localeCompare(b.date)
  })
  await fs.writeFile(filePath, JSON.stringify(sorted, null, 2), 'utf8')
}

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/verify-key', (_req, res) => {
  res.json({ ok: true })
})

app.post('/sync-range', async (req, res) => {
  try {
    const { startYear, endYear, entries, removedIds = [], colorSettings } = req.body ?? {}
    if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || startYear > endYear) {
      res.status(400).json({ error: 'startYear/endYear が不正です' })
      return
    }
    if (endYear - startYear > 5) {
      res.status(400).json({ error: '同期範囲は最大6年です' })
      return
    }
    if (!Array.isArray(entries)) {
      res.status(400).json({ error: 'entries は配列で指定してください' })
      return
    }
    if (!Array.isArray(removedIds)) {
      res.status(400).json({ error: 'removedIds は配列で指定してください' })
      return
    }
    if (colorSettings !== undefined && sanitizeColorSettings(colorSettings) === null) {
      res.status(400).json({ error: 'colorSettings はオブジェクトで指定してください' })
      return
    }

    const years = []
    for (let year = startYear; year <= endYear; year += 1) years.push(year)

    const serverEntriesById = new Map()
    for (const year of years) {
      const yearEntries = await readYear(year)
      for (const item of yearEntries) {
        serverEntriesById.set(item.id, item)
      }
    }

    const mergedById = new Map(serverEntriesById)
    const validRemovedIds = removedIds.filter((id) => typeof id === 'string')
    for (const id of validRemovedIds) {
      mergedById.delete(id)
    }

    for (const rawEntry of entries) {
      const item = sanitizeEntry(rawEntry)
      if (!item) continue
      const year = yearFromDate(item.date)
      if (year === null || year < startYear || year > endYear) continue
      mergedById.set(item.id, item)
    }

    const currentSettings = await readSettings()
    const requestColorSettings = sanitizeColorSettings(colorSettings)
    const mergedColorSettings = requestColorSettings ?? currentSettings.colorSettings
    if (requestColorSettings) {
      await writeSettings({ colorSettings: mergedColorSettings })
    }

    const byYear = new Map(years.map((year) => [year, []]))
    for (const item of mergedById.values()) {
      const year = yearFromDate(item.date)
      if (year === null || year < startYear || year > endYear) continue
      byYear.get(year).push(item)
    }

    for (const year of years) {
      await writeYear(year, byYear.get(year))
    }

    const mergedEntries = Array.from(mergedById.values()).sort((a, b) => {
      if (a.date === b.date) return a.id.localeCompare(b.id)
      return a.date.localeCompare(b.date)
    })

    res.json({
      years,
      entries: mergedEntries,
      removedIds: validRemovedIds,
      colorSettings: mergedColorSettings,
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'internal_error' })
  }
})

app.get('/backups', async (_req, res) => {
  try {
    await fs.mkdir(BACKUP_DIR, { recursive: true })
    const entries = await fs.readdir(BACKUP_DIR)
    const dates = entries.filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e)).sort().reverse()
    res.json({ dates })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'internal_error' })
  }
})

app.post('/backup', async (_req, res) => {
  try {
    const result = await createBackup()
    res.json(result)
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'backup_failed' })
  }
})

app.post('/restore', async (req, res) => {
  try {
    const { date } = req.body ?? {}
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'invalid_date' })
      return
    }
    const backupPath = path.join(BACKUP_DIR, date)
    const files = await fs.readdir(backupPath)
    let restored = 0
    for (const file of files) {
      if (!/^\d{4}\.json$/.test(file) && file !== 'settings.json') continue
      await fs.copyFile(path.join(backupPath, file), path.join(dataDir, file))
      restored += 1
    }
    console.log(`[backup] restored from ${date} (${restored} files)`)
    res.json({ ok: true, date, restored })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'restore_failed' })
  }
})

app.post('/clear-all', async (_req, res) => {
  try {
    await fs.mkdir(dataDir, { recursive: true })
    const files = await fs.readdir(dataDir)
    let deletedFiles = 0
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      await fs.rm(path.join(dataDir, file), { force: true })
      deletedFiles += 1
    }
    res.json({ deletedFiles })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'internal_error' })
  }
})

app.listen(port, () => {
  console.log(`calendar-sync-server listening on :${port}`)
  scheduleDailyBackup()
})
