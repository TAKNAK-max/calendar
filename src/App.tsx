import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
// excel is loaded dynamically to keep initial bundle size small

type Person = 'tarchin' | 'yacchin'

type CalendarEntry = {
  id: string
  date: string
  text: string
  memo?: string
  person: Person
  category: 'quick' | 'free'
  color?: string
  time?: string
  notifyMode?: 'off' | 'time' | '15min' | '30min' | '1h' | '2h'
  notifyTo?: Person[]
  googleEventId?: string
}

type ServerSyncPayload = {
  startYear: number
  endYear: number
  entries: CalendarEntry[]
  removedIds: string[]
  colorSettings?: ColorSettings
}

type ServerSyncResponse = {
  years: number[]
  entries: CalendarEntry[]
  removedIds: string[]
  colorSettings?: ColorSettings
}

type ServerClearResponse = {
  deletedFiles: number
}

type ConfirmModalKind = 'warning' | 'info' | 'success' | 'error'

type ConfirmModalState = {
  kind: ConfirmModalKind
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => Promise<void> | void
}

type AuthState = 'checking' | 'need_key' | 'blocked' | 'authenticated'

type ColorSettings = Record<string, string>

type DayEditor = {
  isOpen: boolean
  date: string
  inputs: { rowId: string; value: string; memo: string; color: string; time: string; notifyMode: 'off' | 'time' | '15min' | '30min' | '1h' | '2h'; notifyTo: Person[]; entryId?: string }[]
}

type FreeInputModalState = {
  rowId: string | null
  text: string
  memo: string
  color: string
  time: string
  notifyMode: 'off' | 'time' | '15min' | '30min' | '1h' | '2h'
  notifyTo: Person[]
  isReadOnly: boolean
}

type ModalPosition = {
  x: number
  y: number
}

type ModalDragState = {
  pointerId: number
  offsetX: number
  offsetY: number
  width: number
  height: number
}

type SwipeState = {
  pointerId: number
  startX: number
  startY: number
  isSwiping: boolean
  pointerType: string
}

const WEEK_LABELS = ['日', '月', '火', '水', '木', '金', '土']
const QUICK_ACTIONS: Record<Person, string[]> = {
  tarchin: ['休'],
  yacchin: ['早', '中', '遅'],
}
const TARCHIN_VACATION = '休'
const LEGACY_QUICK_TEXT_MAP: Record<string, string> = {
  休暇: '休',
  早番: '早',
  中番: '中',
  遅番: '遅',
}

const STORAGE_API_KEY = 'futari-calendar-api-key'
const STORAGE_ENTRIES = 'futari-calendar-entries'
const STORAGE_PERSON = 'futari-calendar-person'
const STORAGE_COLORS = 'futari-calendar-colors'
const STORAGE_REMOVED_IDS = 'futari-calendar-removed-ids'
const DEFAULT_SYNC_URL = '/calendar-api'
const DEFAULT_FREE_TEXT_COLOR = '#7a869a'
const APP_VERSION = '0.0.2'
const DEFAULT_COLORS: ColorSettings = {
  'tarchin:休': '#f39a7a',
  'yacchin:早': '#78aad8',
  'yacchin:中': '#8d95d6',
  'yacchin:遅': '#6dc99a',
}

const today = new Date()
const initialMonth = new Date(today.getFullYear(), today.getMonth(), 1)

function isLocalModeQuery(): boolean {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  return params.get('mode') === 'local'
}

function toISODate(date: Date): string {
  const tz = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - tz).toISOString().slice(0, 10)
}

function formatMonth(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`
}

function buildMonthGrid(target: Date): Date[] {
  const start = new Date(target.getFullYear(), target.getMonth(), 1)
  const startWeek = start.getDay()
  const firstCell = new Date(start)
  firstCell.setDate(firstCell.getDate() - startWeek)

  return Array.from({ length: 42 }, (_, idx) => {
    const cell = new Date(firstCell)
    cell.setDate(firstCell.getDate() + idx)
    return cell
  })
}

function loadEntries(): CalendarEntry[] {
  const raw = localStorage.getItem(STORAGE_ENTRIES)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as CalendarEntry[]
    return parsed
      .filter((item) => item.id && item.date && item.text && item.person && item.category)
      .map((item) => ({
        ...item,
        text: item.category === 'quick' ? LEGACY_QUICK_TEXT_MAP[item.text] ?? item.text : item.text,
        time:
          typeof item.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(item.time)
            ? item.time
            : undefined,
        notifyMode: (item.notifyMode && ['off', 'time', '15min', '30min', '1h', '2h'].includes(item.notifyMode))
          ? item.notifyMode as 'off' | 'time' | '15min' | '30min' | '1h' | '2h'
          : 'off',
        notifyTo: Array.isArray(item.notifyTo)
          ? (item.notifyTo as string[]).filter((p): p is Person => ['tarchin', 'yacchin'].includes(p))
          : [],
      }))
  } catch {
    return []
  }
}

function isQuickEntry(entry: CalendarEntry): boolean {
  return entry.category === 'quick'
}

function loadPerson(): Person {
  const raw = localStorage.getItem(STORAGE_PERSON)
  return raw === 'yacchin' ? 'yacchin' : 'tarchin'
}

function loadRemovedIds(): string[] {
  const raw = localStorage.getItem(STORAGE_REMOVED_IDS)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id) => typeof id === 'string')
  } catch {
    return []
  }
}

function actionKey(person: Person, action: string): string {
  return `${person}:${action}`
}

function loadColorSettings(): ColorSettings {
  const raw = localStorage.getItem(STORAGE_COLORS)
  if (!raw) return { ...DEFAULT_COLORS }
  try {
    const parsed = JSON.parse(raw) as ColorSettings
    return normalizeColorSettings(parsed)
  } catch {
    return { ...DEFAULT_COLORS }
  }
}

function normalizeColorSettings(raw: Record<string, unknown> | null | undefined): ColorSettings {
  const normalized: ColorSettings = { ...DEFAULT_COLORS }
  if (!raw) return normalized
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'string') continue
    const [person, action] = key.split(':')
    if ((person === 'tarchin' || person === 'yacchin') && action) {
      normalized[actionKey(person, LEGACY_QUICK_TEXT_MAP[action] ?? action)] = value
    } else {
      normalized[key] = value
    }
  }
  return normalized
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '')
  const safe =
    normalized.length === 3
      ? normalized
          .split('')
          .map((c) => `${c}${c}`)
          .join('')
      : normalized
  const value = Number.parseInt(safe, 16)
  if (Number.isNaN(value) || safe.length !== 6) return `rgba(120, 120, 120, ${alpha})`
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function shiftDate(date: string, diffDays: number): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + diffDays)
  return toISODate(d)
}

function weekdayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  return WEEK_LABELS[d.getDay()]
}

function createId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    cryptoApi.getRandomValues(bytes)
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function modalIconByKind(kind: ConfirmModalKind): string {
  if (kind === 'warning') return '⚠'
  if (kind === 'success') return '✓'
  if (kind === 'error') return '⛔'
  return 'ℹ'
}

function notifyModeLabel(mode: 'off' | 'time' | '15min' | '30min' | '1h' | '2h'): string {
  const labels: Record<string, string> = {
    off: '通知なし',
    time: '予定時刻',
    '15min': '15分前',
    '30min': '30分前',
    '1h': '1時間前',
    '2h': '2時間前',
  }
  return labels[mode] ?? '通知なし'
}

export default function App() {
  const isLocalMode = useMemo(() => isLocalModeQuery(), [])
  const [authState, setAuthState] = useState<AuthState>('checking')
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [authError, setAuthError] = useState('')
  const [authBlockedUntil, setAuthBlockedUntil] = useState<number | null>(null)
  const [activeMonth, setActiveMonth] = useState(initialMonth)
  const [entries, setEntries] = useState<CalendarEntry[]>(() => loadEntries())
  const [selectedPerson, setSelectedPerson] = useState<Person>(() => loadPerson())
  const [colorSettings, setColorSettings] = useState<ColorSettings>(() => loadColorSettings())
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [activeColorTarget, setActiveColorTarget] = useState<string | null>(null)
  const serverSyncUrl = DEFAULT_SYNC_URL
  const [serverSyncMessage, setServerSyncMessage] = useState('')
  const [isServerSyncing, setIsServerSyncing] = useState(false)
  const [isServerClearing, setIsServerClearing] = useState(false)
  const [isApplyingQuickAction, setIsApplyingQuickAction] = useState(false)
  const [backupDates, setBackupDates] = useState<string[]>([])
  const [selectedBackupDate, setSelectedBackupDate] = useState('')
  const [isRestoring, setIsRestoring] = useState(false)
  const [syncedYears, setSyncedYears] = useState<number[]>([])
  const [exportYear, setExportYear] = useState(today.getFullYear())
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [excelMessage, setExcelMessage] = useState('')
  const importFileRef = useRef<HTMLInputElement | null>(null)
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null)
  const [, setRemovedEntryIds] = useState<string[]>(() => loadRemovedIds())
  const [isSyncReminderDismissed, setIsSyncReminderDismissed] = useState(false)
  const [modalPosition, setModalPosition] = useState<ModalPosition | null>(null)
  const hasAutoSyncedRef = useRef(false)
  const visibilitySyncRef = useRef<() => void>(() => {})
  const lastVisibilitySyncTimeRef = useRef<number>(0)
  const [holidays, setHolidays] = useState<Record<string, string>>({})
  const [slideDirection, setSlideDirection] = useState<-1 | 1 | 0>(0)
  const [slidePhase, setSlidePhase] = useState<'idle' | 'prep' | 'run'>('idle')
  const [slideTargetMonth, setSlideTargetMonth] = useState<Date | null>(null)
  const swipeRef = useRef<SwipeState | null>(null)
  const suppressClickRef = useRef(false)
  const [dayEditor, setDayEditor] = useState<DayEditor>({
    isOpen: false,
    date: toISODate(today),
    inputs: [{ rowId: createId(), value: '', memo: '', color: DEFAULT_FREE_TEXT_COLOR, time: '', notifyMode: 'off', notifyTo: [] }],
  })
  const [freeInputModal, setFreeInputModal] = useState<FreeInputModalState | null>(null)
  const dayMenuRef = useRef<HTMLDivElement | null>(null)
  const modalDragRef = useRef<ModalDragState | null>(null)

  const entriesByDate = useMemo(() => {
    const quickRank = (entry: CalendarEntry): number => {
      if (entry.category !== 'quick') return Infinity
      const tarchinList = QUICK_ACTIONS['tarchin']
      const yacchinList = QUICK_ACTIONS['yacchin']
      if (entry.person === 'tarchin') {
        const idx = tarchinList.indexOf(entry.text)
        return idx >= 0 ? idx : tarchinList.length
      }
      const idx = yacchinList.indexOf(entry.text)
      return tarchinList.length + (idx >= 0 ? idx : yacchinList.length)
    }

    const grouped = entries.reduce<Record<string, CalendarEntry[]>>((acc, entry) => {
      if (!acc[entry.date]) acc[entry.date] = []
      acc[entry.date].push(entry)
      return acc
    }, {})

    for (const date of Object.keys(grouped)) {
      grouped[date].sort((a, b) => quickRank(a) - quickRank(b))
    }

    return grouped
  }, [entries])

  const saveEntries = (nextEntries: CalendarEntry[]) => {
    const normalized = nextEntries.map((entry) =>
      entry.category === 'quick' ? { ...entry, text: LEGACY_QUICK_TEXT_MAP[entry.text] ?? entry.text } : entry,
    )
    setEntries(normalized)
    localStorage.setItem(STORAGE_ENTRIES, JSON.stringify(normalized))
  }

  const markEntriesRemoved = (ids: string[]) => {
    if (ids.length === 0) return
    setRemovedEntryIds((prev) => {
      const next = Array.from(new Set([...prev, ...ids]))
      localStorage.setItem(STORAGE_REMOVED_IDS, JSON.stringify(next))
      return next
    })
  }

  const clearRemovedEntries = (ids: string[]) => {
    if (ids.length === 0) return
    setRemovedEntryIds((prev) => {
      const removedSet = new Set(ids)
      const next = prev.filter((id) => !removedSet.has(id))
      localStorage.setItem(STORAGE_REMOVED_IDS, JSON.stringify(next))
      return next
    })
  }

  const applySyncedColorSettings = (next: ColorSettings | undefined) => {
    if (!next) return
    const normalized = normalizeColorSettings(next)
    setColorSettings(normalized)
    localStorage.setItem(STORAGE_COLORS, JSON.stringify(normalized))
  }

  const postServerSync = async (startYear: number, endYear: number, targetEntries: CalendarEntry[]) => {
    const baseUrl = serverSyncUrl.trim()
    const removedIdsSnapshot = loadRemovedIds()
    const payload: ServerSyncPayload = {
      startYear,
      endYear,
      entries: targetEntries,
      removedIds: removedIdsSnapshot,
      colorSettings,
    }

    const endpoint = `${baseUrl.replace(/\/$/, '')}/sync-range`
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': localStorage.getItem(STORAGE_API_KEY) ?? '' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`HTTP ${response.status}: ${text}`)
    }
    return (await response.json()) as ServerSyncResponse
  }

  const syncSingleDayWithServer = async (date: string) => {
    if (isLocalMode) return
    const baseUrl = serverSyncUrl.trim()
    if (!baseUrl || isServerSyncing || isServerClearing) return

    const year = new Date(`${date}T00:00:00`).getFullYear()
    if (Number.isNaN(year)) return

    try {
      const snapshot = loadEntries()
      const dayEntries = snapshot.filter((entry) => entry.date === date)
      const data = await postServerSync(year, year, dayEntries)
      clearRemovedEntries(data.removedIds ?? [])
      applySyncedColorSettings(data.colorSettings)
      setSyncedYears((prev) => Array.from(new Set([...prev, year])).sort((a, b) => a - b))
    } catch (error) {
      const message = error instanceof Error ? error.message : '日次同期に失敗しました'
      setServerSyncMessage(`エラー: ${message}`)
    }
  }

  const syncYearBeforeQuickAction = async (date: string): Promise<CalendarEntry[]> => {
    const snapshot = loadEntries()
    if (isLocalMode) return snapshot

    const baseUrl = serverSyncUrl.trim()
    if (!baseUrl) {
      throw new Error('同期サーバーURLが未設定のため、登録前同期を実行できません')
    }
    if (isServerSyncing || isServerClearing) {
      throw new Error('サーバー同期中のため、完了後に再試行してください')
    }

    const year = new Date(`${date}T00:00:00`).getFullYear()
    if (Number.isNaN(year)) {
      throw new Error('日付が不正です')
    }

    const endpoint = `${baseUrl.replace(/\/$/, '')}/sync-range`
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': localStorage.getItem(STORAGE_API_KEY) ?? '' },
      body: JSON.stringify({
        startYear: year,
        endYear: year,
        entries: [],
        removedIds: [],
      } satisfies ServerSyncPayload),
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`HTTP ${response.status}: ${text}`)
    }
    const data = (await response.json()) as ServerSyncResponse
    const merged = [
      ...snapshot.filter((entry) => new Date(`${entry.date}T00:00:00`).getFullYear() !== year),
      ...data.entries,
    ]

    saveEntries(merged)
    applySyncedColorSettings(data.colorSettings)
    setSyncedYears((prev) => Array.from(new Set([...prev, year])).sort((a, b) => a - b))
    return merged
  }

  const changePerson = (person: Person) => {
    setSelectedPerson(person)
    setActiveColorTarget(null)
    localStorage.setItem(STORAGE_PERSON, person)
  }

  const jumpMonth = (diff: number) => {
    if (slidePhase !== 'idle') return
    const direction: -1 | 1 = diff > 0 ? 1 : -1
    const target = new Date(activeMonth.getFullYear(), activeMonth.getMonth() + direction, 1)
    setSlideDirection(direction)
    setSlideTargetMonth(target)
    setSlidePhase('prep')
  }

  const openDayEditor = (date: string) => {
    const existingRows = entries
      .filter(
        (entry) =>
          entry.date === date &&
          !isQuickEntry(entry),
      )
      .map((entry) => ({
        rowId: createId(),
        value: entry.text,
        memo: entry.memo ?? '',
        color: entry.color ?? DEFAULT_FREE_TEXT_COLOR,
        time: entry.time ?? '',
        notifyMode: entry.notifyMode ?? 'off',
        notifyTo: entry.notifyTo ?? [],
        entryId: entry.id,
      }))

    setDayEditor({
      isOpen: true,
      date,
      inputs: existingRows,
    })
  }

  const closeDayEditor = (syncCurrentDay = true) => {
    const targetDate = dayEditor.date
    modalDragRef.current = null
    setModalPosition(null)
    setFreeInputModal(null)
    setDayEditor((prev) => ({ ...prev, isOpen: false }))
    if (syncCurrentDay) {
      void syncSingleDayWithServer(targetDate)
    }
  }

  const clampModalPosition = (x: number, y: number, width: number, height: number): ModalPosition => {
    const padding = 8
    const maxX = Math.max(padding, window.innerWidth - width - padding)
    const maxY = Math.max(padding, window.innerHeight - height - padding)
    return {
      x: Math.min(Math.max(padding, x), maxX),
      y: Math.min(Math.max(padding, y), maxY),
    }
  }

  const onDayMenuHeadPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('button,input,textarea,select,label,a')) return
    if (!dayMenuRef.current) return

    const rect = dayMenuRef.current.getBoundingClientRect()
    const start = modalPosition ?? { x: rect.left, y: rect.top }
    const clamped = clampModalPosition(start.x, start.y, rect.width, rect.height)

    modalDragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - clamped.x,
      offsetY: event.clientY - clamped.y,
      width: rect.width,
      height: rect.height,
    }
    setModalPosition(clamped)
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const onCalendarPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (slidePhase !== 'idle') return
    const target = event.target as HTMLElement
    if (target.closest('input,textarea,select,label,a')) return
    swipeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      isSwiping: false,
      pointerType: event.pointerType,
    }
    console.log('[swipe] down', {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      target: target.tagName,
    })
    if (event.pointerType !== 'mouse') {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
  }

  const onCalendarPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const swipe = swipeRef.current
    if (!swipe || swipe.pointerId !== event.pointerId) return
    const deltaX = event.clientX - swipe.startX
    const deltaY = event.clientY - swipe.startY
    if (swipe.isSwiping) {
      console.log('[swipe] move', { deltaX, deltaY, swiping: true })
      event.preventDefault()
      return
    }
    const startThreshold = swipe.pointerType === 'mouse' ? 22 : 12
    if (Math.abs(deltaX) > startThreshold && Math.abs(deltaX) > Math.abs(deltaY) * 1.15) {
      swipe.isSwiping = true
      console.log('[swipe] start', { deltaX, deltaY })
      event.preventDefault()
    } else {
      console.log('[swipe] move', { deltaX, deltaY, swiping: false })
    }
  }

  const onCalendarPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const swipe = swipeRef.current
    if (!swipe || swipe.pointerId !== event.pointerId) return
    const deltaX = event.clientX - swipe.startX
    const deltaY = event.clientY - swipe.startY
    const threshold = swipe.pointerType === 'mouse' ? 55 : 35
    const passes = Math.abs(deltaX) >= threshold && Math.abs(deltaX) > Math.abs(deltaY) * 1.2
    console.log('[swipe] up', { deltaX, deltaY, threshold, passes })
    if (passes) {
      if (deltaX < 0) {
        console.log('[swipe] trigger next')
        jumpMonth(1)
      } else {
        console.log('[swipe] trigger prev')
        jumpMonth(-1)
      }
      suppressClickRef.current = true
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
    } else if (swipe.isSwiping) {
      suppressClickRef.current = true
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
    }
    swipeRef.current = null
  }

  const onCalendarPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    const swipe = swipeRef.current
    if (!swipe || swipe.pointerId !== event.pointerId) return
    console.log('[swipe] cancel')
    swipeRef.current = null
  }

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const dragging = modalDragRef.current
      if (!dragging || event.pointerId !== dragging.pointerId) return

      const next = clampModalPosition(
        event.clientX - dragging.offsetX,
        event.clientY - dragging.offsetY,
        dragging.width,
        dragging.height,
      )
      setModalPosition(next)
    }

    const onPointerUp = (event: PointerEvent) => {
      if (!modalDragRef.current || event.pointerId !== modalDragRef.current.pointerId) return
      modalDragRef.current = null
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [])

  useEffect(() => {
    const onResize = () => {
      const menu = dayMenuRef.current
      if (!menu) return
      const rect = menu.getBoundingClientRect()
      setModalPosition((prev) => {
        if (!prev) return prev
        return clampModalPosition(prev.x, prev.y, rect.width, rect.height)
      })
    }

    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    visibilitySyncRef.current = () => {
      if (isLocalMode || isServerSyncing || isServerClearing) return
      const now = Date.now()
      if (now - lastVisibilitySyncTimeRef.current < 60 * 1000) return
      lastVisibilitySyncTimeRef.current = now
      void syncWithServerRange()
    }
  })

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') visibilitySyncRef.current()
    }
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) visibilitySyncRef.current()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [])

  useEffect(() => {
    if (slidePhase !== 'prep') return
    const frame = window.requestAnimationFrame(() => {
      setSlidePhase('run')
    })
    return () => window.cancelAnimationFrame(frame)
  }, [slidePhase])

  const moveDayEditor = (diffDays: number) => {
    void syncSingleDayWithServer(dayEditor.date)
    const next = shiftDate(dayEditor.date, diffDays)
    openDayEditor(next)
  }

  const applyQuickAction = async (text: string) => {
    if (isApplyingQuickAction) return
    setIsApplyingQuickAction(true)

    const targetDate = dayEditor.date
    const targetPerson = selectedPerson

    try {
      const baseEntries = await syncYearBeforeQuickAction(targetDate)
      const exists = baseEntries.some(
        (entry) => entry.date === targetDate && entry.person === targetPerson && entry.text === text,
      )

      let nextEntries: CalendarEntry[]
      let removedIds: string[] = []

      if (targetPerson === 'tarchin' && text === TARCHIN_VACATION) {
        if (exists) {
          removedIds = baseEntries
            .filter((entry) => entry.date === targetDate && entry.person === 'tarchin' && entry.text === TARCHIN_VACATION)
            .map((entry) => entry.id)
          nextEntries = baseEntries.filter(
            (entry) => !(entry.date === targetDate && entry.person === 'tarchin' && entry.text === TARCHIN_VACATION),
          )
        } else {
          const withoutVacation = baseEntries.filter(
            (entry) => !(entry.date === targetDate && entry.person === 'tarchin' && entry.text === TARCHIN_VACATION),
          )
          nextEntries = [
            ...withoutVacation,
            {
              id: createId(),
              date: targetDate,
              text: TARCHIN_VACATION,
              person: 'tarchin',
              category: 'quick',
              color: colorSettings[actionKey('tarchin', TARCHIN_VACATION)],
            },
          ]
        }
      } else {
        if (targetPerson === 'yacchin') {
          const yacchinActions = new Set(QUICK_ACTIONS.yacchin)
          if (exists) {
            removedIds = baseEntries
              .filter((entry) => entry.date === targetDate && entry.person === 'yacchin' && entry.text === text)
              .map((entry) => entry.id)
            nextEntries = baseEntries.filter(
              (entry) => !(entry.date === targetDate && entry.person === 'yacchin' && entry.text === text),
            )
          } else {
            removedIds = baseEntries
              .filter(
                (entry) => entry.date === targetDate && entry.person === 'yacchin' && yacchinActions.has(entry.text),
              )
              .map((entry) => entry.id)
            const withoutOtherShift = baseEntries.filter(
              (entry) => !(entry.date === targetDate && entry.person === 'yacchin' && yacchinActions.has(entry.text)),
            )
            nextEntries = [
              ...withoutOtherShift,
              {
                id: createId(),
                date: targetDate,
                text,
                person: 'yacchin',
                category: 'quick',
                color: colorSettings[actionKey('yacchin', text)],
              },
            ]
          }
        } else if (exists) {
          removedIds = baseEntries
            .filter((entry) => entry.date === targetDate && entry.person === targetPerson && entry.text === text)
            .map((entry) => entry.id)
          nextEntries = baseEntries.filter(
            (entry) => !(entry.date === targetDate && entry.person === targetPerson && entry.text === text),
          )
        } else {
          nextEntries = [
            ...baseEntries,
            {
              id: createId(),
              date: targetDate,
              text,
              person: targetPerson,
              category: 'quick',
              color: colorSettings[actionKey(targetPerson, text)],
            },
          ]
        }
      }

      markEntriesRemoved(removedIds)
      saveEntries(nextEntries)
      void syncSingleDayWithServer(targetDate)
    } catch (error) {
      const message = error instanceof Error ? error.message : '登録前同期に失敗しました'
      setServerSyncMessage(`エラー: ${message}`)
    } finally {
      setIsApplyingQuickAction(false)
    }
  }

  const openAddEntryModal = () => {
    setFreeInputModal({
      rowId: null,
      text: '',
      memo: '',
      color: DEFAULT_FREE_TEXT_COLOR,
      time: '',
      notifyMode: 'off',
      notifyTo: [],
      isReadOnly: false,
    })
  }

  const openFreeInputModal = (rowId: string) => {
    const row = dayEditor.inputs.find((r) => r.rowId === rowId)
    if (!row) return
    setFreeInputModal({
      rowId,
      text: row.value,
      memo: row.memo,
      color: row.color,
      time: row.time,
      notifyMode: row.notifyMode,
      notifyTo: row.notifyTo,
      isReadOnly: true,
    })
  }

  const confirmFreeInputModal = () => {
    if (!freeInputModal || freeInputModal.isReadOnly) return
    const { text, memo, color, time, notifyMode, notifyTo } = freeInputModal
    const trimmed = text.trim()
    if (!trimmed) return

    const newEntry: CalendarEntry = {
      id: createId(),
      date: dayEditor.date,
      text: trimmed,
      memo: memo.trim() || undefined,
      person: selectedPerson,
      category: 'free',
      color,
      time: time || undefined,
      notifyMode,
      notifyTo: notifyTo.length > 0 ? notifyTo : undefined,
    }

    saveEntries([...entries, newEntry])
    setDayEditor((prev) => ({
      ...prev,
      inputs: [
        ...prev.inputs,
        { rowId: createId(), value: trimmed, memo, color, time, notifyMode, notifyTo, entryId: newEntry.id },
      ],
    }))
    setFreeInputModal(null)
  }

  const deleteInputRowEntry = (rowId: string) => {
    const targetRow = dayEditor.inputs.find((row) => row.rowId === rowId)
    if (!targetRow?.entryId) return

    markEntriesRemoved([targetRow.entryId])
    saveEntries(entries.filter((entry) => entry.id !== targetRow.entryId))
    setDayEditor((prev) => ({
      ...prev,
      inputs: prev.inputs.filter((row) => row.rowId !== rowId),
    }))
  }

  const updateActionColor = (action: string, color: string) => {
    const key = actionKey(selectedPerson, action)
    setColorSettings((prev) => {
      const next = { ...prev, [key]: color }
      localStorage.setItem(STORAGE_COLORS, JSON.stringify(next))
      return next
    })
  }

  const applyColorToAllEntries = (action: string) => {
    const color = colorSettings[actionKey(selectedPerson, action)]
    if (!color) return
    const updated = entries.map((entry) =>
      entry.person === selectedPerson && entry.text === action ? { ...entry, color } : entry,
    )
    saveEntries(updated)
    void syncWithServerRange(updated)
  }

  const syncWithServerRange = async (entriesOverride?: CalendarEntry[]) => {
    if (isLocalMode) {
      setServerSyncMessage('ローカルモードのためサーバー同期は無効です')
      return
    }
    const baseUrl = serverSyncUrl.trim()
    if (!baseUrl) {
      setServerSyncMessage('同期サーバーURLを入力してください')
      return
    }

    const centerYear = activeMonth.getFullYear()
    const startYear = centerYear - 1
    const endYear = centerYear + 1

    setIsServerSyncing(true)
    setServerSyncMessage(`同期中: ${startYear}年〜${endYear}年`)

    try {
      const baseEntries = entriesOverride ?? entries
      const rangeEntries = baseEntries.filter((entry) => {
        const year = new Date(`${entry.date}T00:00:00`).getFullYear()
        return year >= startYear && year <= endYear
      })

      const data = await postServerSync(startYear, endYear, rangeEntries)
      const years = new Set(data.years ?? [])
      const merged = [
        ...baseEntries.filter((entry) => {
          const year = new Date(`${entry.date}T00:00:00`).getFullYear()
          return year < startYear || year > endYear
        }),
        ...data.entries,
      ]

      saveEntries(merged)
      clearRemovedEntries(data.removedIds ?? [])
      applySyncedColorSettings(data.colorSettings)
      setSyncedYears((prev) => Array.from(new Set([...prev, ...Array.from(years)])).sort((a, b) => a - b))
      setServerSyncMessage(`同期完了: ${startYear}年〜${endYear}年 (${data.entries.length}件)`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '同期に失敗しました'
      setServerSyncMessage(`エラー: ${message}`)
    } finally {
      setIsServerSyncing(false)
    }
  }

  const syncWithServerRangeOnStartup = async () => {
    if (isLocalMode) {
      setServerSyncMessage('ローカルモードのためサーバー同期は無効です')
      return
    }
    const baseUrl = serverSyncUrl.trim()
    if (!baseUrl) {
      setServerSyncMessage('同期サーバーURLを入力してください')
      return
    }

    const centerYear = activeMonth.getFullYear()
    const startYear = centerYear - 1
    const endYear = centerYear + 1

    setIsServerSyncing(true)
    setServerSyncMessage(`起動時同期中: ${startYear}年〜${endYear}年`)

    try {
      const endpoint = `${baseUrl.replace(/\/$/, '')}/sync-range`
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': localStorage.getItem(STORAGE_API_KEY) ?? '' },
        body: JSON.stringify({
          startYear,
          endYear,
          entries: [],
          removedIds: [],
        } satisfies ServerSyncPayload),
      })
      if (!response.ok) {
        const text = await response.text()
        throw new Error(`HTTP ${response.status}: ${text}`)
      }

      const data = (await response.json()) as ServerSyncResponse
      const years = new Set(data.years ?? [])
      const replaced = [
        ...entries.filter((entry) => {
          const year = new Date(`${entry.date}T00:00:00`).getFullYear()
          return year < startYear || year > endYear
        }),
        ...data.entries,
      ]

      saveEntries(replaced)
      applySyncedColorSettings(data.colorSettings)
      setRemovedEntryIds([])
      localStorage.setItem(STORAGE_REMOVED_IDS, JSON.stringify([]))
      setSyncedYears((prev) => Array.from(new Set([...prev, ...Array.from(years)])).sort((a, b) => a - b))
      setServerSyncMessage(`起動時同期完了: ${startYear}年〜${endYear}年 (${data.entries.length}件)`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '起動時同期に失敗しました'
      setServerSyncMessage(`エラー: ${message}`)
    } finally {
      setIsServerSyncing(false)
    }
  }

  const executeClearServerEntries = async () => {
    if (isLocalMode) {
      setServerSyncMessage('ローカルモードのためサーバー同期は無効です')
      return
    }
    const baseUrl = serverSyncUrl.trim()
    if (!baseUrl) {
      setServerSyncMessage('同期サーバーURLを入力してください')
      return
    }

    setIsServerClearing(true)
    setServerSyncMessage('サーバー予定を削除中...')
    try {
      const endpoint = `${baseUrl.replace(/\/$/, '')}/clear-all`
      const response = await fetch(endpoint, { method: 'POST', headers: { 'X-API-Key': localStorage.getItem(STORAGE_API_KEY) ?? '' } })
      if (!response.ok) {
        const text = await response.text()
        throw new Error(`HTTP ${response.status}: ${text}`)
      }
      const data = (await response.json()) as ServerClearResponse
      closeDayEditor(false)
      saveEntries([])
      setRemovedEntryIds([])
      localStorage.setItem(STORAGE_REMOVED_IDS, JSON.stringify([]))
      setSyncedYears([])
      setServerSyncMessage(`サーバーとローカルの予定を削除しました（${data.deletedFiles}ファイル）`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '削除に失敗しました'
      setServerSyncMessage(`エラー: ${message}`)
    } finally {
      setIsServerClearing(false)
    }
  }

  const fetchBackupDates = async () => {
    try {
      const res = await fetch(`${serverSyncUrl}/backups`, {
        headers: { 'X-API-Key': localStorage.getItem(STORAGE_API_KEY) ?? '' },
      })
      if (!res.ok) return
      const data = (await res.json()) as { dates: string[] }
      setBackupDates(data.dates ?? [])
      if (data.dates?.length > 0 && !selectedBackupDate) setSelectedBackupDate(data.dates[0])
    } catch {}
  }

  const restoreFromBackup = () => {
    if (!selectedBackupDate) return
    setConfirmModal({
      kind: 'warning',
      title: 'バックアップから回復',
      message: `${selectedBackupDate} のバックアップでサーバーを上書きします。現在のデータは失われます。続行しますか？`,
      confirmLabel: '回復する',
      cancelLabel: 'キャンセル',
      onConfirm: async () => {
        setIsRestoring(true)
        setServerSyncMessage('バックアップから回復中...')
        try {
          const res = await fetch(`${serverSyncUrl}/restore`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': localStorage.getItem(STORAGE_API_KEY) ?? '',
            },
            body: JSON.stringify({ date: selectedBackupDate }),
          })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          setServerSyncMessage(`${selectedBackupDate} から回復しました。同期中...`)
          await syncWithServerRangeOnStartup()
        } catch (error) {
          const message = error instanceof Error ? error.message : '回復に失敗しました'
          setServerSyncMessage(`エラー: ${message}`)
        } finally {
          setIsRestoring(false)
        }
      },
    })
  }

  const handleExport = async () => {
    setIsExporting(true)
    setExcelMessage('')
    try {
      const { exportToExcel } = await import('./excel')
      await exportToExcel(exportYear, entries)
      setExcelMessage(`${exportYear}年をエクスポートしました`)
    } catch (err) {
      setExcelMessage(`エクスポート失敗: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsExporting(false)
    }
  }

  const handleImport = async (file: File) => {
    setIsImporting(true)
    setExcelMessage('')
    try {
      const { importFromExcel } = await import('./excel')
      const { entries: imported } = await importFromExcel(file)
      if (imported.length === 0) {
        setExcelMessage('インポートできる予定が見つかりませんでした')
        return
      }

      // 既存と重複しない予定だけ追加（日付+内容+person が一致するものはスキップ）
      const existing = loadEntries()
      const existingKeys = new Set(existing.map((e) => `${e.date}|${e.text}|${e.person}`))
      const newEntries = imported.filter((e) => !existingKeys.has(`${e.date}|${e.text}|${e.person}`))
      const skipped = imported.length - newEntries.length

      if (newEntries.length === 0) {
        setExcelMessage(`全て重複のためスキップ（${skipped}件）`)
        return
      }

      const merged = [...existing, ...newEntries]
      localStorage.setItem(STORAGE_ENTRIES, JSON.stringify(merged))
      setEntries(merged)

      // サーバーと同期
      const years = Array.from(new Set(newEntries.map((e) => Number(e.date.slice(0, 4)))))
      for (const year of years) {
        await postServerSync(year, year, merged.filter((e) => Number(e.date.slice(0, 4)) === year))
      }

      const msg = skipped > 0
        ? `${newEntries.length}件をインポートしました（重複${skipped}件スキップ）`
        : `${newEntries.length}件をインポートしました`
      setExcelMessage(msg)
    } catch (err) {
      setExcelMessage(`インポート失敗: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsImporting(false)
      if (importFileRef.current) importFileRef.current.value = ''
    }
  }

  const clearServerEntries = () => {
    setConfirmModal({
      kind: 'warning',
      title: '予定の全削除',
      message: 'サーバーとローカルの予定を全て削除します。続行しますか？',
      confirmLabel: 'OK',
      cancelLabel: 'キャンセル',
      onConfirm: async () => {
        await executeClearServerEntries()
      },
    })
  }

  const forceReloadApp = async () => {
    try {
      // Service Worker のキャッシュをクリア
      if ('caches' in window) {
        const cacheNames = await caches.keys()
        await Promise.all(cacheNames.map((name) => caches.delete(name)))
      }

      // localStorage から認証キーをバックアップ
      const authKey = localStorage.getItem(STORAGE_API_KEY)

      // localStorage全削除
      localStorage.clear()

      // 認証キーだけ復元
      if (authKey) {
        localStorage.setItem(STORAGE_API_KEY, authKey)
      }

      // 強制リロード
      window.location.reload()
    } catch (error) {
      const message = error instanceof Error ? error.message : '強制リロード中にエラーが発生しました'
      console.error('Force reload error:', message)
      // エラーでもリロードを実行
      window.location.reload()
    }
  }

  useEffect(() => {
    if (isLocalMode) {
      setAuthState('authenticated')
      return
    }
    const storedKey = localStorage.getItem(STORAGE_API_KEY) ?? ''
    if (!storedKey) {
      setAuthState('need_key')
      return
    }

    const baseUrl = serverSyncUrl.trim() || DEFAULT_SYNC_URL
    const verifyEndpoint = `${baseUrl.replace(/\/$/, '')}/verify-key`
    fetch(verifyEndpoint, { headers: { 'X-API-Key': storedKey } })
      .then((res) => {
        if (res.ok) {
          setAuthState('authenticated')
          if (!hasAutoSyncedRef.current) {
            hasAutoSyncedRef.current = true
            void syncWithServerRangeOnStartup()
          }
        } else if (res.status === 429) {
          return res.json().then((data: { blockedUntil?: number }) => {
            setAuthBlockedUntil(data.blockedUntil ?? null)
            setAuthState('blocked')
          })
        } else {
          localStorage.removeItem(STORAGE_API_KEY)
          setAuthState('need_key')
        }
      })
      .catch(() => {
        setAuthState('authenticated')
        if (!hasAutoSyncedRef.current) {
          hasAutoSyncedRef.current = true
          void syncWithServerRangeOnStartup()
        }
      })
  }, [isLocalMode])

  useEffect(() => {
    const STORAGE_HOLIDAYS = 'futari-calendar-holidays'
    const cached = localStorage.getItem(STORAGE_HOLIDAYS)
    if (cached) {
      try {
        const { year, data } = JSON.parse(cached) as { year: number; data: Record<string, string> }
        if (year === new Date().getFullYear()) {
          setHolidays(data)
          return
        }
      } catch {}
    }
    fetch('https://holidays-jp.github.io/api/v1/date.json')
      .then((res) => res.json())
      .then((data: Record<string, string>) => {
        setHolidays(data)
        localStorage.setItem(STORAGE_HOLIDAYS, JSON.stringify({ year: new Date().getFullYear(), data }))
      })
      .catch(() => {})
  }, [])

  const todayLabel = toISODate(today)
  const activeYear = activeMonth.getFullYear()
  const needsYearSync = !isLocalMode && !syncedYears.includes(activeYear)
  const editorDayEntries = entriesByDate[dayEditor.date] ?? []
  const isSliding = slidePhase !== 'idle' && slideTargetMonth !== null
  const slideBaseMonth = slideTargetMonth ?? activeMonth
  const slideMonths =
    slideDirection === -1
      ? [slideBaseMonth, activeMonth]
      : [activeMonth, slideBaseMonth]
  const sliderTransform =
    slidePhase === 'run'
      ? slideDirection === -1
        ? 'translateX(0%)'
        : 'translateX(-50%)'
      : slideDirection === -1
        ? 'translateX(-50%)'
        : 'translateX(0%)'
  const sliderTransition = slidePhase === 'run' ? 'transform 320ms ease' : 'none'
  const renderMonthGrid = (month: Date, keyPrefix: string) => (
    <div className="calendar-grid">
      {buildMonthGrid(month).map((date) => {
        const iso = toISODate(date)
        const isCurrentMonth = date.getMonth() === month.getMonth()
        const isEditing = dayEditor.isOpen && iso === dayEditor.date
        const dayEntries = entriesByDate[iso] ?? []
        const dow = date.getDay()
        const isHoliday = Boolean(holidays[iso])
        const isSun = dow === 0 || isHoliday
        const isSat = dow === 6 && !isHoliday

        return (
          <button
            key={`${keyPrefix}-${iso}`}
            className={`day-cell ${isCurrentMonth ? '' : 'is-outside'} ${iso === todayLabel ? 'is-today' : ''} ${isEditing ? 'is-editing' : ''} ${isSun ? 'is-sun' : ''} ${isSat ? 'is-sat' : ''}`}
            onClick={() => openDayEditor(iso)}
          >
            <span className="day-number">{date.getDate()}</span>
            <div className="day-lines">
              {dayEntries.slice(0, 3).map((entry) => (
                <span
                  key={entry.id}
                  className={`line-tag ${entry.person} ${entry.category === 'free' ? 'is-free' : 'is-quick'}`}
                  style={
                    isQuickEntry(entry)
                      ? {
                          color: entry.color ?? colorSettings[actionKey(entry.person, entry.text)],
                          borderColor: entry.color ?? colorSettings[actionKey(entry.person, entry.text)],
                          backgroundColor: hexToRgba(
                            entry.color ?? colorSettings[actionKey(entry.person, entry.text)],
                            0.18,
                          ),
                        }
                      : entry.color
                        ? {
                            color: entry.color,
                            borderColor: entry.color,
                            backgroundColor: hexToRgba(entry.color, 0.18),
                          }
                        : undefined
                  }
                >
                  {entry.text}
                </span>
              ))}
              {dayEntries.length > 3 ? (
                <span className="day-more">+{dayEntries.length - 3}</span>
              ) : null}
            </div>
          </button>
        )
      })}
    </div>
  )
  const dayMenuStyle = modalPosition
    ? {
        position: 'fixed' as const,
        left: `${modalPosition.x}px`,
        top: `${modalPosition.y}px`,
        margin: 0,
      }
    : undefined
  const isQuickActionActive = (action: string) =>
    editorDayEntries.some((entry) => entry.person === selectedPerson && entry.text === action)

  useEffect(() => {
    setIsSyncReminderDismissed(false)
  }, [activeYear])

  const handleAuthSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (isLocalMode) {
      setAuthState('authenticated')
      return
    }
    const trimmed = apiKeyInput.trim()
    if (!trimmed) return

    setAuthError('')
    const baseUrl = serverSyncUrl.trim() || DEFAULT_SYNC_URL
    const verifyEndpoint = `${baseUrl.replace(/\/$/, '')}/verify-key`

    try {
      const res = await fetch(verifyEndpoint, { headers: { 'X-API-Key': trimmed } })
      if (res.ok) {
        localStorage.setItem(STORAGE_API_KEY, trimmed)
        setAuthState('authenticated')
        if (!hasAutoSyncedRef.current) {
          hasAutoSyncedRef.current = true
          void syncWithServerRangeOnStartup()
        }
      } else if (res.status === 429) {
        const data = (await res.json()) as { blockedUntil?: number }
        setAuthBlockedUntil(data.blockedUntil ?? null)
        setAuthState('blocked')
      } else {
        const data = (await res.json()) as { remainingAttempts?: number }
        const remaining = data.remainingAttempts ?? 0
        setAuthError(`APIキーが正しくありません（残り${remaining}回）`)
      }
    } catch {
      setAuthError('サーバーに接続できません')
    }
  }

  if (authState === 'checking') {
    return (
      <div className="auth-screen">
        <div className="auth-card auth-loading">
          <p>読み込み中...</p>
        </div>
      </div>
    )
  }

  if (authState === 'blocked') {
    const blockedDate = authBlockedUntil ? new Date(authBlockedUntil).toLocaleString('ja-JP') : ''
    return (
      <div className="auth-screen">
        <div className="auth-card auth-blocked">
          <h2>アクセスがブロックされています</h2>
          <p>認証の試行回数を超えました。</p>
          {blockedDate ? <p>解除予定: {blockedDate}</p> : null}
        </div>
      </div>
    )
  }

  if (authState === 'need_key') {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h2>認証が必要です</h2>
          <p>APIキーを入力してください。</p>
          {authError ? <p className="auth-error">{authError}</p> : null}
          <form onSubmit={handleAuthSubmit} style={{ display: 'grid', gap: '0.6rem' }}>
            <input
              className="auth-input"
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="APIキー"
              autoFocus
            />
            <button className="auth-submit" type="submit">
              認証
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="header-main-row">
          <div className="month-nav">
            <button
              className="nav-button"
              onClick={() => jumpMonth(-1)}
              aria-label="前の月"
              disabled={slidePhase !== 'idle'}
            >
              前の月
            </button>
            <p
              className={`month-label ${activeMonth.getFullYear() !== today.getFullYear() || activeMonth.getMonth() !== today.getMonth() ? 'is-navigable' : ''}`}
              onClick={() => {
                if (slidePhase !== 'idle') return
                if (activeMonth.getFullYear() === today.getFullYear() && activeMonth.getMonth() === today.getMonth()) return
                setActiveMonth(initialMonth)
              }}
            >{formatMonth(activeMonth)}</p>
            <button
              className="nav-button"
              onClick={() => jumpMonth(1)}
              aria-label="次の月"
              disabled={slidePhase !== 'idle'}
            >
              次の月
            </button>
          </div>

          <button className="menu-button" aria-label="メニュー" onClick={() => { setIsMenuOpen((prev) => !prev); if (!isMenuOpen) void fetchBackupDates() }}>
            ☰
          </button>
        </div>

        {isMenuOpen ? (
          <>
            <div className="menu-overlay" onClick={() => setIsMenuOpen(false)} />
            <div className="menu-panel" onClick={(e) => e.stopPropagation()}>
            <div className="person-buttons">
              <button
                className={`person-button ${selectedPerson === 'tarchin' ? 'is-active' : ''}`}
                onClick={() => changePerson('tarchin')}
              >
                たーちん
              </button>
              <button
                className={`person-button ${selectedPerson === 'yacchin' ? 'is-active' : ''}`}
                onClick={() => changePerson('yacchin')}
              >
                やっちん
              </button>
            </div>

            <div className="color-section">
              <p>色選択</p>
              <div className="color-targets">
                {QUICK_ACTIONS[selectedPerson].map((action) => (
                  <button
                    key={`color-${action}`}
                    className={`color-target-button ${activeColorTarget === action ? 'is-active' : ''}`}
                    onClick={() => setActiveColorTarget((prev) => (prev === action ? null : action))}
                    style={{ borderColor: colorSettings[actionKey(selectedPerson, action)] }}
                  >
                    {action}
                  </button>
                ))}
              </div>
              {activeColorTarget ? (
                <div className="color-picker-row">
                  <span>{activeColorTarget}の色</span>
                  <div className="color-picker-controls">
                    <input
                      type="color"
                      value={colorSettings[actionKey(selectedPerson, activeColorTarget)]}
                      onChange={(event) => updateActionColor(activeColorTarget, event.target.value)}
                    />
                    <button
                      type="button"
                      className="apply-color-all-button"
                      title={`全期間の${activeColorTarget}にこの色を適用`}
                      onClick={() => applyColorToAllEntries(activeColorTarget)}
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" width="1.1em" height="1.1em">
                        <path d="M16.56 8.94L7.62 0 6.21 1.41l2.38 2.38-5.15 5.15c-.59.59-.59 1.54 0 2.12l5.5 5.5c.29.29.68.44 1.06.44s.77-.15 1.06-.44l5.5-5.5c.59-.58.59-1.53 0-2.12zM5.21 10L10 5.21 14.79 10H5.21zM19 11.5s-2 2.17-2 3.5c0 1.1.9 2 2 2s2-.9 2-2c0-1.33-2-3.5-2-3.5z" />
                      </svg>
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="excel-section">
              <p className="excel-label">Excelエクスポート</p>
              <div className="excel-row">
                <select
                  className="backup-select"
                  value={exportYear}
                  onChange={(e) => setExportYear(Number(e.target.value))}
                >
                  {[today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1, today.getFullYear() + 2].map((y) => (
                    <option key={y} value={y}>{y}年</option>
                  ))}
                </select>
                <button className="sync-button" onClick={handleExport} disabled={isExporting}>
                  {isExporting ? '出力中...' : 'ダウンロード'}
                </button>
              </div>
              <p className="excel-label" style={{ marginTop: '0.75rem' }}>Excelインポート</p>
              <input
                ref={importFileRef}
                type="file"
                accept=".xlsx"
                className="excel-file-input"
                disabled={isImporting}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void handleImport(file)
                }}
              />
              {excelMessage ? <p className="sync-message">{excelMessage}</p> : null}
            </div>

            <button className="sync-button" onClick={() => syncWithServerRange()} disabled={isServerSyncing}>
              {isServerSyncing ? '3年分 同期中...' : '前後１年をサーバーと同期'}
            </button>

            {serverSyncMessage ? <p className="sync-message">{serverSyncMessage}</p> : null}

            <details className="developer-panel">
              <summary>開発者用</summary>
              <p className="sync-message">Version: {APP_VERSION}</p>
              <button className="sync-button" onClick={forceReloadApp}>
                強制リロード
              </button>
              <button className="sync-button" onClick={clearServerEntries} disabled={isServerClearing}>
                {isServerClearing ? '削除中...' : 'サーバー予定を全削除'}
              </button>
              <div className="backup-restore-section">
                <p className="backup-restore-label">バックアップから回復</p>
                {backupDates.length === 0 ? (
                  <p className="sync-message">バックアップなし</p>
                ) : (
                  <div className="backup-restore-row">
                    <select
                      className="backup-select"
                      value={selectedBackupDate}
                      onChange={(e) => setSelectedBackupDate(e.target.value)}
                    >
                      {backupDates.map((date) => (
                        <option key={date} value={date}>{date}</option>
                      ))}
                    </select>
                    <button className="sync-button" onClick={restoreFromBackup} disabled={isRestoring || !selectedBackupDate}>
                      {isRestoring ? '回復中...' : '決定'}
                    </button>
                  </div>
                )}
              </div>
            </details>
            </div>
          </>
        ) : null}
      </header>

      <section className="calendar-area">
        <div className="week-header">
          {WEEK_LABELS.map((label, idx) => (
            <span key={label} className={idx === 0 ? 'sun' : idx === 6 ? 'sat' : ''}>
              {label}
            </span>
          ))}
        </div>

        <div
          className="calendar-viewport"
          onPointerDown={onCalendarPointerDown}
          onPointerMove={onCalendarPointerMove}
          onPointerUp={onCalendarPointerUp}
          onPointerCancel={onCalendarPointerCancel}
          onClickCapture={(event) => {
            if (!suppressClickRef.current) return
            event.preventDefault()
            event.stopPropagation()
            suppressClickRef.current = false
          }}
        >
          {isSliding ? (
            <div
              className="month-slider"
              style={{ transform: sliderTransform, transition: sliderTransition }}
              onTransitionEnd={(event) => {
                if (event.propertyName !== 'transform' || slidePhase !== 'run' || !slideTargetMonth) return
                setActiveMonth(slideTargetMonth)
                setSlidePhase('idle')
                setSlideDirection(0)
                setSlideTargetMonth(null)
              }}
            >
              {slideMonths.map((month, idx) => (
                <div className="month-panel" key={`${month.getFullYear()}-${month.getMonth()}-${idx}`}>
                  {renderMonthGrid(month, `slide-${idx}`)}
                </div>
              ))}
            </div>
          ) : (
            renderMonthGrid(activeMonth, 'base')
          )}
        </div>
      </section>

      {needsYearSync && !isSyncReminderDismissed ? (
        <div
          className="sync-reminder-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="未同期の通知"
          onClick={() => setIsSyncReminderDismissed(true)}
        >
          <div className="sync-reminder-modal" onClick={(event) => event.stopPropagation()}>
            <div className="sync-reminder-head">
              <p>未同期の通知</p>
              <button className="close-button" onClick={() => setIsSyncReminderDismissed(true)}>
                ×
              </button>
            </div>
            <p>{activeYear}年は未同期です。</p>
            <p>前後1年を同期してから編集してください。</p>
            <button className="sync-button" onClick={() => syncWithServerRange()} disabled={isServerSyncing}>
              {isServerSyncing ? '3年分 同期中...' : '前後１年をサーバーと同期'}
            </button>
            {serverSyncMessage ? <p className="sync-message">{serverSyncMessage}</p> : null}
          </div>
        </div>
      ) : null}

      {confirmModal ? (
        <div className="confirm-modal-backdrop" role="dialog" aria-modal="true" onClick={() => setConfirmModal(null)}>
          <div className="confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className={`confirm-modal-icon ${confirmModal.kind}`} aria-hidden="true">
              {modalIconByKind(confirmModal.kind)}
            </div>
            <h3>{confirmModal.title}</h3>
            <p>{confirmModal.message}</p>
            <div className="confirm-modal-actions">
              {confirmModal.cancelLabel ? (
                <button className="nav-button" onClick={() => setConfirmModal(null)}>
                  {confirmModal.cancelLabel}
                </button>
              ) : null}
              <button
                className="sync-button"
                onClick={async () => {
                  const confirmAction = confirmModal.onConfirm
                  setConfirmModal(null)
                  await confirmAction()
                }}
              >
                {confirmModal.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {dayEditor.isOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => closeDayEditor()}>
          <div className="day-menu" ref={dayMenuRef} style={dayMenuStyle} onClick={(event) => event.stopPropagation()}>
            <div className="day-menu-head" onPointerDown={onDayMenuHeadPointerDown}>
              <div className="day-nav">
                <button className="day-move-button" onClick={() => moveDayEditor(-1)}>
                  前日
                </button>
                <h2>
                  {`${dayEditor.date}（${weekdayLabel(dayEditor.date)}）`}
                  {holidays[dayEditor.date] ? <span className="holiday-label">{holidays[dayEditor.date]}</span> : null}
                </h2>
                <button className="day-move-button" onClick={() => moveDayEditor(1)}>
                  翌日
                </button>
              </div>
              <button className="close-button" onClick={() => closeDayEditor()}>
                ×
              </button>
            </div>

            <div className="quick-row">
              {QUICK_ACTIONS[selectedPerson].map((action) => (
                <button
                  key={action}
                  className={`quick-button ${isQuickActionActive(action) ? 'is-active' : ''}`}
                  onClick={() => applyQuickAction(action)}
                  disabled={isApplyingQuickAction}
                  style={{
                    color: colorSettings[actionKey(selectedPerson, action)],
                    borderColor: colorSettings[actionKey(selectedPerson, action)],
                    backgroundColor: hexToRgba(
                      colorSettings[actionKey(selectedPerson, action)],
                      isQuickActionActive(action) ? 0.26 : 0.14,
                    ),
                    boxShadow: isQuickActionActive(action)
                      ? `0 0 0 1px ${colorSettings[actionKey(selectedPerson, action)]} inset`
                      : undefined,
                  }}
                >
                  {action}
                </button>
              ))}
            </div>

            <div className="free-entries-area">
              {dayEditor.inputs.map((row) => (
                <div key={row.rowId} className="free-entry-row">
                  <button
                    type="button"
                    className="free-entry-text"
                    onClick={() => openFreeInputModal(row.rowId)}
                    style={row.color ? {
                      borderColor: row.color,
                      borderWidth: '2px',
                      backgroundColor: hexToRgba(row.color, 0.08),
                      color: row.color,
                      fontWeight: 600,
                    } : undefined}
                  >
                    {row.value}
                  </button>
                  <span className="free-entry-time">
                    <svg viewBox="0 0 24 24" fill="currentColor" width="1.1em" height="1.1em" style={{ verticalAlign: 'text-top', marginRight: '0.2em' }}>
                      <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/>
                    </svg>
                    {row.time || '--:--'}
                  </span>
                  <span className={`free-entry-notify${row.notifyMode !== 'off' ? ' is-active' : ''}`}>
                    {row.notifyMode !== 'off' ? (
                      <svg viewBox="0 0 24 24" fill="currentColor" width="1.1em" height="1.1em" style={{ verticalAlign: 'text-top', marginRight: '0.2em' }}>
                        <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6V11c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
                      </svg>
                    ) : null}
                    {notifyModeLabel(row.notifyMode)}
                  </span>
                  <button
                    className="row-action-button is-delete"
                    title="予定を削除"
                    onClick={() =>
                      setConfirmModal({
                        kind: 'warning',
                        title: '予定を削除',
                        message: '本当に削除しますか？',
                        confirmLabel: 'はい',
                        cancelLabel: 'いいえ',
                        onConfirm: () => deleteInputRowEntry(row.rowId),
                      })
                    }
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" width="1.1em" height="1.1em">
                      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                    </svg>
                  </button>
                </div>
              ))}
              <div className="free-add-row">
                <span className="free-add-label">予定なし</span>
                <span className="free-add-time">--:--</span>
                <span className="free-add-notify">通知なし</span>
                <button className="free-add-button" title="予定を追加" onClick={openAddEntryModal}>
                  <svg viewBox="0 0 24 24" fill="currentColor" width="1.1em" height="1.1em">
                    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.21a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                  </svg>
                </button>
              </div>
            </div>

            {freeInputModal ? (
              <div className="free-input-modal-backdrop" onClick={() => setFreeInputModal(null)}>
                <div className="free-input-modal" onClick={(event) => event.stopPropagation()}>
                  <div className="free-input-modal-head">
                    <h3>{freeInputModal.isReadOnly ? '予定の確認' : '予定の入力'}</h3>
                  </div>
                  <div className="free-input-modal-body">
                    <label className="free-input-modal-label">
                      <span>予定</span>
                      <input
                        type="text"
                        className="free-input-modal-text"
                        value={freeInputModal.text}
                        readOnly={freeInputModal.isReadOnly}
                        placeholder="予定を入力"
                        autoFocus
                        style={freeInputModal.color ? {
                          borderColor: freeInputModal.color,
                          borderWidth: '2px',
                          backgroundColor: hexToRgba(freeInputModal.color, 0.08),
                          color: freeInputModal.color,
                          fontWeight: 600,
                        } : undefined}
                        onChange={(e) => setFreeInputModal((prev) => (prev ? { ...prev, text: e.target.value } : null))}
                      />
                    </label>
                    <div className="free-input-modal-label">
                      <span>時間</span>
                      <div className="free-input-time-row">
                        {freeInputModal.isReadOnly ? (
                          <span className="free-input-modal-text free-input-modal-text-readonly">
                            {freeInputModal.time || '--:--'}
                          </span>
                        ) : (
                          <input
                            type="time"
                            className="free-input-modal-time"
                            value={freeInputModal.time}
                            onChange={(e) =>
                              setFreeInputModal((prev) =>
                                prev ? { ...prev, time: e.target.value, notifyMode: e.target.value ? prev.notifyMode : 'off', notifyTo: e.target.value ? prev.notifyTo : [] } : null,
                              )
                            }
                          />
                        )}
                        {!freeInputModal.isReadOnly && freeInputModal.time ? (
                          <button
                            type="button"
                            className="row-action-button is-delete"
                            title="時間をクリア"
                            onClick={() =>
                              setFreeInputModal((prev) =>
                                prev ? { ...prev, time: '', notifyMode: 'off', notifyTo: [] } : null
                              )
                            }
                          >
                            <svg viewBox="0 0 24 24" fill="currentColor" width="1.1em" height="1.1em">
                              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                            </svg>
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {(freeInputModal.time || freeInputModal.isReadOnly) ? (
                    <div className="free-input-modal-label">
                      <span>通知</span>
                      <select
                        className="free-input-notify-select"
                        value={freeInputModal.notifyMode}
                        disabled={freeInputModal.isReadOnly}
                        onChange={(e) =>
                          setFreeInputModal((prev) =>
                            prev ? { ...prev, notifyMode: e.target.value as FreeInputModalState['notifyMode'] } : null
                          )
                        }
                      >
                        {(['off', 'time', '15min', '30min', '1h', '2h'] as const).map((mode) => (
                          <option key={mode} value={mode}>
                            {notifyModeLabel(mode)}
                          </option>
                        ))}
                      </select>
                      {freeInputModal.notifyMode !== 'off' ? (
                        <div className="free-input-notify-to">
                          {(['tarchin', 'yacchin'] as Person[]).map((person) => (
                            <label key={person} className="notify-to-option">
                              <input
                                type="checkbox"
                                checked={freeInputModal.notifyTo.includes(person)}
                                disabled={freeInputModal.isReadOnly}
                                onChange={(e) =>
                                  setFreeInputModal((prev) => {
                                    if (!prev) return null
                                    return {
                                      ...prev,
                                      notifyTo: e.target.checked
                                        ? [...prev.notifyTo, person]
                                        : prev.notifyTo.filter((p) => p !== person),
                                    }
                                  })
                                }
                              />
                              {person === 'tarchin' ? 'たーちん' : 'やっちん'}
                            </label>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    ) : null}
                    {!freeInputModal.isReadOnly ? (
                      <label className="free-input-modal-label free-input-modal-color-row">
                        <span>色</span>
                        <input
                          type="color"
                          value={freeInputModal.color}
                          onChange={(e) => setFreeInputModal((prev) => (prev ? { ...prev, color: e.target.value } : null))}
                        />
                      </label>
                    ) : null}
                    <label className="free-input-modal-label">
                      <span>メモ</span>
                      <textarea
                        className="free-input-modal-textarea"
                        value={freeInputModal.memo}
                        readOnly={freeInputModal.isReadOnly}
                        placeholder="メモ（任意）"
                        rows={4}
                        onChange={(e) => setFreeInputModal((prev) => (prev ? { ...prev, memo: e.target.value } : null))}
                      />
                    </label>
                  </div>
                  <div className="free-input-modal-actions">
                    {freeInputModal.isReadOnly ? (
                      <>
                        {freeInputModal.notifyMode !== 'off' && freeInputModal.notifyTo.length > 0 ? (
                          <button
                            className="line-notify-test-button"
                            title="LINE通知テスト"
                            onClick={async () => {
                              try {
                                const res = await fetch('/line-webhook/notify-test', {
                                  method: 'POST',
                                  headers: {
                                    'Content-Type': 'application/json',
                                    'X-API-Key': localStorage.getItem(STORAGE_API_KEY) ?? '',
                                  },
                                  body: JSON.stringify({
                                    text: freeInputModal.text,
                                    time: freeInputModal.time,
                                    notifyMode: freeInputModal.notifyMode,
                                    notifyTo: freeInputModal.notifyTo,
                                    memo: freeInputModal.memo,
                                    person: selectedPerson,
                                  }),
                                })
                                if (!res.ok) throw new Error(`${res.status}`)
                                setConfirmModal({
                                  kind: 'success',
                                  title: 'テスト通知を送信',
                                  message: 'LINEに通知を送信しました。',
                                  confirmLabel: 'OK',
                                  cancelLabel: '',
                                  onConfirm: async () => {},
                                })
                              } catch (err) {
                                setConfirmModal({
                                  kind: 'error',
                                  title: '送信失敗',
                                  message: `通知の送信に失敗しました: ${err instanceof Error ? err.message : '不明なエラー'}`,
                                  confirmLabel: 'OK',
                                  cancelLabel: '',
                                  onConfirm: async () => {},
                                })
                              }
                            }}
                          >
                            <svg viewBox="0 0 24 24" fill="currentColor" width="1.1em" height="1.1em" style={{ verticalAlign: 'text-top', marginRight: '0.3em' }}>
                              <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.070 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/>
                            </svg>
                            通知テスト
                          </button>
                        ) : null}
                        <button className="nav-button" onClick={() => setFreeInputModal(null)}>
                          戻る
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="nav-button" onClick={() => setFreeInputModal(null)}>
                          キャンセル
                        </button>
                        <button className="sync-button" onClick={confirmFreeInputModal}>
                          決定
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  )
}
