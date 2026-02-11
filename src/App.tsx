import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

type Person = 'tarchin' | 'yacchin'

type CalendarEntry = {
  id: string
  date: string
  text: string
  person: Person
  category: 'quick' | 'free'
  color?: string
  googleEventId?: string
}

type GoogleSettings = {
  clientId: string
  calendarId: string
}

type ServerSyncPayload = {
  startYear: number
  endYear: number
  entries: CalendarEntry[]
  removedIds: string[]
}

type ServerSyncResponse = {
  years: number[]
  entries: CalendarEntry[]
  removedIds: string[]
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

type ColorSettings = Record<string, string>

type DayEditor = {
  isOpen: boolean
  date: string
  inputs: { rowId: string; value: string; color: string; entryId?: string }[]
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

type TokenCache = {
  clientId: string
  accessToken: string
  expiresAt: number
}

type GoogleEvent = {
  id: string
  summary?: string
  start?: { date?: string }
  extendedProperties?: {
    private?: {
      appSource?: string
      localId?: string
      person?: Person
      category?: 'quick' | 'free'
      color?: string
    }
  }
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string
            scope: string
            callback: (response: { access_token?: string; error?: string; expires_in?: number }) => void
          }) => { requestAccessToken: (options?: { prompt?: string }) => void }
        }
      }
    }
  }
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

const STORAGE_ENTRIES = 'futari-calendar-entries'
const STORAGE_PERSON = 'futari-calendar-person'
const STORAGE_GOOGLE = 'futari-calendar-google'
const STORAGE_COLORS = 'futari-calendar-colors'
const STORAGE_SYNC_URL = 'futari-calendar-sync-url'
const STORAGE_REMOVED_IDS = 'futari-calendar-removed-ids'
const APP_SOURCE = 'futari-calendar-web'
const DEFAULT_GOOGLE_CLIENT_ID = '719425138729-jo1krmiqsvlopbhc3ibome39degm61d9.apps.googleusercontent.com'
const DEFAULT_SYNC_URL = '/calendar-api'
const DEFAULT_FREE_TEXT_COLOR = '#7a869a'
const DEFAULT_COLORS: ColorSettings = {
  'tarchin:休': '#f39a7a',
  'yacchin:早': '#78aad8',
  'yacchin:中': '#8d95d6',
  'yacchin:遅': '#6dc99a',
}

const today = new Date()
const initialMonth = new Date(today.getFullYear(), today.getMonth(), 1)

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

function loadGoogleSettings(): GoogleSettings {
  const raw = localStorage.getItem(STORAGE_GOOGLE)
  if (!raw) return { clientId: DEFAULT_GOOGLE_CLIENT_ID, calendarId: 'primary' }
  try {
    const parsed = JSON.parse(raw) as GoogleSettings
    return {
      clientId: parsed.clientId?.trim() ? parsed.clientId : DEFAULT_GOOGLE_CLIENT_ID,
      calendarId: parsed.calendarId ?? 'primary',
    }
  } catch {
    return { clientId: DEFAULT_GOOGLE_CLIENT_ID, calendarId: 'primary' }
  }
}

function loadSyncUrl(): string {
  const raw = localStorage.getItem(STORAGE_SYNC_URL)
  if (!raw) return DEFAULT_SYNC_URL
  const normalized = raw.trim()
  return normalized || DEFAULT_SYNC_URL
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
    const normalized: ColorSettings = { ...DEFAULT_COLORS }
    for (const [key, value] of Object.entries(parsed)) {
      const [person, action] = key.split(':')
      if ((person === 'tarchin' || person === 'yacchin') && action) {
        normalized[actionKey(person, LEGACY_QUICK_TEXT_MAP[action] ?? action)] = value
      } else {
        normalized[key] = value
      }
    }
    return normalized
  } catch {
    return { ...DEFAULT_COLORS }
  }
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

function monthRange(baseMonth: Date): { timeMin: string; timeMax: string } {
  const start = new Date(baseMonth.getFullYear(), baseMonth.getMonth(), 1)
  const end = new Date(baseMonth.getFullYear(), baseMonth.getMonth() + 1, 1)
  return {
    timeMin: `${toISODate(start)}T00:00:00Z`,
    timeMax: `${toISODate(end)}T00:00:00Z`,
  }
}

function nextDate(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + 1)
  return toISODate(d)
}

function shiftDate(date: string, diffDays: number): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + diffDays)
  return toISODate(d)
}

function ensureGoogleScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()

  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity="1"]')
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Google Identity script load error')))
      return
    }

    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.dataset.googleIdentity = '1'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Google Identity script load error'))
    document.head.appendChild(script)
  })
}

function requestAccessToken(
  clientId: string,
  prompt: '' | 'consent' = 'consent',
): Promise<{ accessToken: string; expiresAt: number }> {
  return new Promise((resolve, reject) => {
    const oauth = window.google?.accounts?.oauth2
    if (!oauth) {
      reject(new Error('Google Identityが読み込まれていません'))
      return
    }

    const tokenClient = oauth.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/calendar',
      callback: (response) => {
        if (response.access_token) {
          const expiresInSeconds = response.expires_in ?? 3600
          const expiresAt = Date.now() + Math.max(60, expiresInSeconds - 60) * 1000
          resolve({ accessToken: response.access_token, expiresAt })
        } else {
          reject(new Error(response.error ?? 'アクセストークン取得に失敗しました'))
        }
      },
    })

    tokenClient.requestAccessToken({ prompt })
  })
}

async function googleFetch<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Google API error ${response.status}: ${text}`)
  }

  return (await response.json()) as T
}

async function listGoogleEvents(token: string, calendarId: string, targetMonth: Date): Promise<GoogleEvent[]> {
  const { timeMin, timeMax } = monthRange(targetMonth)
  const query = new URLSearchParams({
    singleEvents: 'true',
    maxResults: '2500',
    orderBy: 'startTime',
    timeMin,
    timeMax,
    privateExtendedProperty: `appSource=${APP_SOURCE}`,
  })

  const data = await googleFetch<{ items?: GoogleEvent[] }>(
    token,
    `/calendars/${encodeURIComponent(calendarId)}/events?${query.toString()}`,
  )

  return data.items ?? []
}

function googleEventPayload(entry: CalendarEntry) {
  return {
    summary: entry.text,
    start: { date: entry.date },
    end: { date: nextDate(entry.date) },
    extendedProperties: {
      private: {
        appSource: APP_SOURCE,
        localId: entry.id,
        person: entry.person,
        category: entry.category,
        color: entry.color,
      },
    },
  }
}

function modalIconByKind(kind: ConfirmModalKind): string {
  if (kind === 'warning') return '⚠'
  if (kind === 'success') return '✓'
  if (kind === 'error') return '⛔'
  return 'ℹ'
}

export default function App() {
  const [activeMonth, setActiveMonth] = useState(initialMonth)
  const [entries, setEntries] = useState<CalendarEntry[]>(() => loadEntries())
  const [selectedPerson, setSelectedPerson] = useState<Person>(() => loadPerson())
  const [googleSettings, setGoogleSettings] = useState<GoogleSettings>(() => loadGoogleSettings())
  const [colorSettings, setColorSettings] = useState<ColorSettings>(() => loadColorSettings())
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [activeColorTarget, setActiveColorTarget] = useState<string | null>(null)
  const [syncMessage, setSyncMessage] = useState('')
  const [isSyncing, setIsSyncing] = useState(false)
  const [serverSyncUrl, setServerSyncUrl] = useState(() => loadSyncUrl())
  const [serverSyncMessage, setServerSyncMessage] = useState('')
  const [isServerSyncing, setIsServerSyncing] = useState(false)
  const [isServerClearing, setIsServerClearing] = useState(false)
  const [syncedYears, setSyncedYears] = useState<number[]>([])
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null)
  const [, setRemovedEntryIds] = useState<string[]>(() => loadRemovedIds())
  const [isSyncReminderDismissed, setIsSyncReminderDismissed] = useState(false)
  const [modalPosition, setModalPosition] = useState<ModalPosition | null>(null)
  const tokenCacheRef = useRef<TokenCache | null>(null)
  const hasAutoSyncedRef = useRef(false)
  const [dayEditor, setDayEditor] = useState<DayEditor>({
    isOpen: false,
    date: toISODate(today),
    inputs: [{ rowId: crypto.randomUUID(), value: '', color: DEFAULT_FREE_TEXT_COLOR }],
  })
  const dayMenuRef = useRef<HTMLDivElement | null>(null)
  const modalDragRef = useRef<ModalDragState | null>(null)

  const cells = useMemo(() => buildMonthGrid(activeMonth), [activeMonth])

  const entriesByDate = useMemo(() => {
    return entries.reduce<Record<string, CalendarEntry[]>>((acc, entry) => {
      if (!acc[entry.date]) acc[entry.date] = []
      acc[entry.date].push(entry)
      return acc
    }, {})
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

  const updateGoogleSettings = (nextSettings: GoogleSettings) => {
    if (nextSettings.clientId.trim() !== googleSettings.clientId.trim()) {
      tokenCacheRef.current = null
    }
    setGoogleSettings(nextSettings)
    localStorage.setItem(STORAGE_GOOGLE, JSON.stringify(nextSettings))
  }

  const updateServerSyncUrl = (url: string) => {
    setServerSyncUrl(url)
    localStorage.setItem(STORAGE_SYNC_URL, url)
  }

  const postServerSync = async (startYear: number, endYear: number, targetEntries: CalendarEntry[]) => {
    const baseUrl = serverSyncUrl.trim()
    const removedIdsSnapshot = loadRemovedIds()
    const payload: ServerSyncPayload = {
      startYear,
      endYear,
      entries: targetEntries,
      removedIds: removedIdsSnapshot,
    }

    const endpoint = `${baseUrl.replace(/\/$/, '')}/sync-range`
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`HTTP ${response.status}: ${text}`)
    }
    return (await response.json()) as ServerSyncResponse
  }

  const syncSingleDayWithServer = async (date: string) => {
    const baseUrl = serverSyncUrl.trim()
    if (!baseUrl || isServerSyncing || isServerClearing) return

    const year = new Date(`${date}T00:00:00`).getFullYear()
    if (Number.isNaN(year)) return

    try {
      const snapshot = loadEntries()
      const dayEntries = snapshot.filter((entry) => entry.date === date)
      const data = await postServerSync(year, year, dayEntries)
      clearRemovedEntries(data.removedIds ?? [])
      setSyncedYears((prev) => Array.from(new Set([...prev, year])).sort((a, b) => a - b))
    } catch (error) {
      const message = error instanceof Error ? error.message : '日次同期に失敗しました'
      setServerSyncMessage(`エラー: ${message}`)
    }
  }

  const changePerson = (person: Person) => {
    setSelectedPerson(person)
    setActiveColorTarget(null)
    localStorage.setItem(STORAGE_PERSON, person)
  }

  const jumpMonth = (diff: number) => {
    setActiveMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + diff, 1))
  }

  const openDayEditor = (date: string) => {
    const existingRows = entries
      .filter(
        (entry) =>
          entry.date === date &&
          !isQuickEntry(entry),
      )
      .map((entry) => ({
        rowId: crypto.randomUUID(),
        value: entry.text,
        color: entry.color ?? DEFAULT_FREE_TEXT_COLOR,
        entryId: entry.id,
      }))

    setDayEditor({
      isOpen: true,
      date,
      inputs:
        existingRows.length > 0
          ? existingRows
          : [{ rowId: crypto.randomUUID(), value: '', color: DEFAULT_FREE_TEXT_COLOR }],
    })
  }

  const closeDayEditor = (syncCurrentDay = true) => {
    const targetDate = dayEditor.date
    modalDragRef.current = null
    setModalPosition(null)
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

  const moveDayEditor = (diffDays: number) => {
    void syncSingleDayWithServer(dayEditor.date)
    const next = shiftDate(dayEditor.date, diffDays)
    openDayEditor(next)
  }

  const applyQuickAction = (text: string) => {
    setEntries((prev) => {
      const exists = prev.some(
        (entry) => entry.date === dayEditor.date && entry.person === selectedPerson && entry.text === text,
      )

      let nextEntries: CalendarEntry[]
      let removedIds: string[] = []

      if (selectedPerson === 'tarchin' && text === TARCHIN_VACATION) {
        if (exists) {
          removedIds = prev
            .filter(
              (entry) =>
                entry.date === dayEditor.date && entry.person === 'tarchin' && entry.text === TARCHIN_VACATION,
            )
            .map((entry) => entry.id)
          nextEntries = prev.filter(
            (entry) => !(entry.date === dayEditor.date && entry.person === 'tarchin' && entry.text === TARCHIN_VACATION),
          )
        } else {
          const withoutVacation = prev.filter(
            (entry) => !(entry.date === dayEditor.date && entry.person === 'tarchin' && entry.text === TARCHIN_VACATION),
          )
          nextEntries = [
            ...withoutVacation,
            {
              id: crypto.randomUUID(),
              date: dayEditor.date,
              text: TARCHIN_VACATION,
              person: 'tarchin',
              category: 'quick',
              color: colorSettings[actionKey('tarchin', TARCHIN_VACATION)],
            },
          ]
        }
      } else {
        if (selectedPerson === 'yacchin') {
          const yacchinActions = new Set(QUICK_ACTIONS.yacchin)
          if (exists) {
            removedIds = prev
              .filter((entry) => entry.date === dayEditor.date && entry.person === 'yacchin' && entry.text === text)
              .map((entry) => entry.id)
            nextEntries = prev.filter(
              (entry) => !(entry.date === dayEditor.date && entry.person === 'yacchin' && entry.text === text),
            )
          } else {
            removedIds = prev
              .filter(
                (entry) =>
                  entry.date === dayEditor.date && entry.person === 'yacchin' && yacchinActions.has(entry.text),
              )
              .map((entry) => entry.id)
            const withoutOtherShift = prev.filter(
              (entry) =>
                !(
                  entry.date === dayEditor.date &&
                  entry.person === 'yacchin' &&
                  yacchinActions.has(entry.text)
                ),
            )
            nextEntries = [
              ...withoutOtherShift,
              {
                id: crypto.randomUUID(),
                date: dayEditor.date,
                text,
                person: 'yacchin',
                category: 'quick',
                color: colorSettings[actionKey('yacchin', text)],
              },
            ]
          }
        } else if (exists) {
          removedIds = prev
            .filter((entry) => entry.date === dayEditor.date && entry.person === selectedPerson && entry.text === text)
            .map((entry) => entry.id)
          nextEntries = prev.filter(
            (entry) => !(entry.date === dayEditor.date && entry.person === selectedPerson && entry.text === text),
          )
        } else {
          nextEntries = [
            ...prev,
            {
              id: crypto.randomUUID(),
              date: dayEditor.date,
              text,
              person: selectedPerson,
              category: 'quick',
              color: colorSettings[actionKey(selectedPerson, text)],
            },
          ]
        }
      }

      markEntriesRemoved(removedIds)
      localStorage.setItem(STORAGE_ENTRIES, JSON.stringify(nextEntries))
      return nextEntries
    })
  }

  const addInputBox = () => {
    setDayEditor((prev) => ({
      ...prev,
      inputs: [...prev.inputs, { rowId: crypto.randomUUID(), value: '', color: DEFAULT_FREE_TEXT_COLOR }],
    }))
  }

  const removeInputBox = () => {
    setDayEditor((prev) => {
      if (prev.inputs.length <= 1) return prev
      const removableIndex = [...prev.inputs]
        .map((row, index) => ({ row, index }))
        .reverse()
        .find((item) => !item.row.entryId)?.index

      if (removableIndex === undefined) return prev
      return { ...prev, inputs: prev.inputs.filter((_, index) => index !== removableIndex) }
    })
  }

  const updateInput = (rowId: string, value: string) => {
    setDayEditor((prev) => ({
      ...prev,
      inputs: prev.inputs.map((item) => (item.rowId === rowId ? { ...item, value } : item)),
    }))
  }

  const updateInputColor = (rowId: string, color: string) => {
    setDayEditor((prev) => ({
      ...prev,
      inputs: prev.inputs.map((item) => (item.rowId === rowId ? { ...item, color } : item)),
    }))

    const targetRow = dayEditor.inputs.find((row) => row.rowId === rowId)
    if (!targetRow?.entryId) return
    saveEntries(entries.map((entry) => (entry.id === targetRow.entryId ? { ...entry, color } : entry)))
  }

  const submitInputRow = (rowId: string) => {
    const targetRow = dayEditor.inputs.find((row) => row.rowId === rowId)
    if (!targetRow || targetRow.entryId) return

    const trimmed = targetRow.value.trim()
    if (!trimmed) return

    const newEntry: CalendarEntry = {
      id: crypto.randomUUID(),
      date: dayEditor.date,
      text: trimmed,
      person: selectedPerson,
      category: 'free',
      color: targetRow.color,
    }

    saveEntries([...entries, newEntry])
    setDayEditor((prev) => ({
      ...prev,
      inputs: prev.inputs.map((row) =>
        row.rowId === rowId ? { ...row, value: trimmed, entryId: newEntry.id } : row,
      ),
    }))
  }

  const deleteInputRowEntry = (rowId: string) => {
    const targetRow = dayEditor.inputs.find((row) => row.rowId === rowId)
    if (!targetRow?.entryId) return

    markEntriesRemoved([targetRow.entryId])
    saveEntries(entries.filter((entry) => entry.id !== targetRow.entryId))
    setDayEditor((prev) => ({
      ...prev,
      inputs: prev.inputs.map((row) =>
        row.rowId === rowId ? { ...row, value: '', color: DEFAULT_FREE_TEXT_COLOR, entryId: undefined } : row,
      ),
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

  const syncWithGoogle = async () => {
    if (!googleSettings.clientId.trim()) {
      setSyncMessage('Google OAuth Client IDを入力してください')
      return
    }

    setIsSyncing(true)
    setSyncMessage('同期中...')

    try {
      await ensureGoogleScript()
      const clientId = googleSettings.clientId.trim()
      let token = ''
      const cached = tokenCacheRef.current
      if (cached && cached.clientId === clientId && cached.expiresAt > Date.now()) {
        token = cached.accessToken
      } else {
        let issued
        try {
          issued = await requestAccessToken(clientId, '')
        } catch {
          issued = await requestAccessToken(clientId, 'consent')
        }
        tokenCacheRef.current = {
          clientId,
          accessToken: issued.accessToken,
          expiresAt: issued.expiresAt,
        }
        token = issued.accessToken
      }
      const calendarId = googleSettings.calendarId.trim() || 'primary'

      const monthEntries = entries.filter(
        (entry) =>
          new Date(`${entry.date}T00:00:00`).getFullYear() === activeMonth.getFullYear() &&
          new Date(`${entry.date}T00:00:00`).getMonth() === activeMonth.getMonth(),
      )

      const googleEvents = await listGoogleEvents(token, calendarId, activeMonth)
      const googleById = new Map(googleEvents.map((item) => [item.id, item]))

      const syncedMonthEntries: CalendarEntry[] = []

      for (const entry of monthEntries) {
        const payload = googleEventPayload(entry)
        if (entry.googleEventId && googleById.has(entry.googleEventId)) {
          const updated = await googleFetch<GoogleEvent>(
            token,
            `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(entry.googleEventId)}`,
            {
              method: 'PATCH',
              body: JSON.stringify(payload),
            },
          )
          syncedMonthEntries.push({ ...entry, googleEventId: updated.id })
        } else {
          const created = await googleFetch<GoogleEvent>(
            token,
            `/calendars/${encodeURIComponent(calendarId)}/events`,
            {
              method: 'POST',
              body: JSON.stringify(payload),
            },
          )
          syncedMonthEntries.push({ ...entry, googleEventId: created.id })
        }
      }

      const latestGoogleEvents = await listGoogleEvents(token, calendarId, activeMonth)
      const latestLocalFromGoogle: CalendarEntry[] = latestGoogleEvents
        .filter((event) => event.start?.date && event.summary)
        .map((event) => {
          const privateProps = event.extendedProperties?.private
          const person: Person = privateProps?.person === 'yacchin' ? 'yacchin' : 'tarchin'
          return {
            id: privateProps?.localId ?? `google-${event.id}`,
            date: event.start!.date!,
            text: event.summary!,
            person,
            category: privateProps?.category === 'quick' ? 'quick' : 'free',
            color: privateProps?.color,
            googleEventId: event.id,
          }
        })

      const nextEntries = [
        ...entries.filter(
          (entry) =>
            !(
              new Date(`${entry.date}T00:00:00`).getFullYear() === activeMonth.getFullYear() &&
              new Date(`${entry.date}T00:00:00`).getMonth() === activeMonth.getMonth()
            ),
        ),
        ...latestLocalFromGoogle,
      ]

      saveEntries(nextEntries)
      setSyncMessage(`同期完了: ${formatMonth(activeMonth)} (${latestLocalFromGoogle.length}件)`)

      if (syncedMonthEntries.length === 0 && latestLocalFromGoogle.length === 0) {
        setSyncMessage(`同期完了: ${formatMonth(activeMonth)} は空でした`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '同期に失敗しました'
      setSyncMessage(`エラー: ${message}`)
    } finally {
      setIsSyncing(false)
    }
  }

  const syncWithServerRange = async () => {
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
      const rangeEntries = entries.filter((entry) => {
        const year = new Date(`${entry.date}T00:00:00`).getFullYear()
        return year >= startYear && year <= endYear
      })

      const data = await postServerSync(startYear, endYear, rangeEntries)
      const years = new Set(data.years ?? [])
      const merged = [
        ...entries.filter((entry) => {
          const year = new Date(`${entry.date}T00:00:00`).getFullYear()
          return year < startYear || year > endYear
        }),
        ...data.entries,
      ]

      saveEntries(merged)
      clearRemovedEntries(data.removedIds ?? [])
      setSyncedYears((prev) => Array.from(new Set([...prev, ...Array.from(years)])).sort((a, b) => a - b))
      setServerSyncMessage(`同期完了: ${startYear}年〜${endYear}年 (${data.entries.length}件)`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '同期に失敗しました'
      setServerSyncMessage(`エラー: ${message}`)
    } finally {
      setIsServerSyncing(false)
    }
  }

  const executeClearServerEntries = async () => {
    const baseUrl = serverSyncUrl.trim()
    if (!baseUrl) {
      setServerSyncMessage('同期サーバーURLを入力してください')
      return
    }

    setIsServerClearing(true)
    setServerSyncMessage('サーバー予定を削除中...')
    try {
      const endpoint = `${baseUrl.replace(/\/$/, '')}/clear-all`
      const response = await fetch(endpoint, { method: 'POST' })
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

  useEffect(() => {
    if (hasAutoSyncedRef.current) return
    hasAutoSyncedRef.current = true
    void syncWithServerRange()
  }, [])

  const todayLabel = toISODate(today)
  const activeYear = activeMonth.getFullYear()
  const needsYearSync = !syncedYears.includes(activeYear)
  const editorDayEntries = entriesByDate[dayEditor.date] ?? []
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

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="header-main-row">
          <div className="month-nav">
            <button className="nav-button" onClick={() => jumpMonth(-1)} aria-label="前の月">
              前の月
            </button>
            <p>{formatMonth(activeMonth)}</p>
            <button className="nav-button" onClick={() => jumpMonth(1)} aria-label="次の月">
              次の月
            </button>
          </div>

          <button className="menu-button" aria-label="メニュー" onClick={() => setIsMenuOpen((prev) => !prev)}>
            ☰
          </button>
        </div>

        {isMenuOpen ? (
          <div className="menu-panel">
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
                <label className="color-picker-row">
                  <span>{activeColorTarget}の色</span>
                  <input
                    type="color"
                    value={colorSettings[actionKey(selectedPerson, activeColorTarget)]}
                    onChange={(event) => updateActionColor(activeColorTarget, event.target.value)}
                  />
                </label>
              ) : null}
            </div>

            <label>
              同期サーバーURL
              <input
                type="text"
                value={serverSyncUrl}
                onChange={(event) => updateServerSyncUrl(event.target.value)}
                placeholder="/calendar-api"
              />
            </label>

            <button className="sync-button" onClick={syncWithServerRange} disabled={isServerSyncing}>
              {isServerSyncing ? '3年分 同期中...' : '前後1年を同期'}
            </button>

            {serverSyncMessage ? <p className="sync-message">{serverSyncMessage}</p> : null}

            <details className="developer-panel">
              <summary>開発者用</summary>
              <button className="sync-button" onClick={clearServerEntries} disabled={isServerClearing}>
                {isServerClearing ? '削除中...' : 'サーバー予定を全削除'}
              </button>
            </details>

            <details className="google-sync-panel">
              <summary>Google同期（必要時のみ）</summary>

              <label>
                Google OAuth Client ID
                <input
                  type="text"
                  value={googleSettings.clientId}
                  onChange={(event) =>
                    updateGoogleSettings({
                      ...googleSettings,
                      clientId: event.target.value,
                    })
                  }
                  placeholder="xxxx.apps.googleusercontent.com"
                />
              </label>

              <label>
                Calendar ID
                <input
                  type="text"
                  value={googleSettings.calendarId}
                  onChange={(event) =>
                    updateGoogleSettings({
                      ...googleSettings,
                      calendarId: event.target.value,
                    })
                  }
                  placeholder="primary"
                />
              </label>

              <button className="sync-button" onClick={syncWithGoogle} disabled={isSyncing}>
                {isSyncing ? '同期中...' : 'Google同期'}
              </button>

              {syncMessage ? <p className="sync-message">{syncMessage}</p> : null}
            </details>
          </div>
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

        <div className="calendar-grid">
          {cells.map((date) => {
            const iso = toISODate(date)
            const isCurrentMonth = date.getMonth() === activeMonth.getMonth()
            const isEditing = dayEditor.isOpen && iso === dayEditor.date
            const dayEntries = entriesByDate[iso] ?? []

            return (
              <button
                key={iso}
                className={`day-cell ${isCurrentMonth ? '' : 'is-outside'} ${iso === todayLabel ? 'is-today' : ''} ${isEditing ? 'is-editing' : ''}`}
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
                </div>
              </button>
            )
          })}
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
            <button className="sync-button" onClick={syncWithServerRange} disabled={isServerSyncing}>
              {isServerSyncing ? '3年分 同期中...' : '前後1年を同期'}
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
              <button className="nav-button" onClick={() => setConfirmModal(null)}>
                {confirmModal.cancelLabel}
              </button>
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
                <h2>{dayEditor.date}</h2>
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

            <div className="inputs-area">
              {dayEditor.inputs.map((row) => (
                <div key={row.rowId} className="input-row">
                  <input
                    type="text"
                    value={row.value}
                    placeholder="自由入力"
                    readOnly={Boolean(row.entryId)}
                    onChange={(event) => updateInput(row.rowId, event.target.value)}
                  />
                  <input
                    type="color"
                    className="row-color-picker"
                    value={row.color}
                    onChange={(event) => updateInputColor(row.rowId, event.target.value)}
                  />
                  <button
                    className={`row-action-button ${row.entryId ? 'is-delete' : 'is-decide'}`}
                    onClick={() => (row.entryId ? deleteInputRowEntry(row.rowId) : submitInputRow(row.rowId))}
                  >
                    {row.entryId ? '削除' : '決定'}
                  </button>
                </div>
              ))}
            </div>

            <div className="actions-row">
              <button className="plus-minus" onClick={addInputBox}>
                ＋
              </button>
              {dayEditor.inputs.length > 1 && dayEditor.inputs.some((row) => !row.entryId) ? (
                <button className="plus-minus" onClick={removeInputBox}>
                  －
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}
