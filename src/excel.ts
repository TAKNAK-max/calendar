import ExcelJS from 'exceljs'

type Person = 'tarchin' | 'yacchin'

type CalendarEntry = {
  id: string
  date: string
  text: string
  person: Person
  category: 'quick' | 'free'
  color?: string
  time?: string
  notifyMode?: 'off' | 'time' | '15min' | '30min' | '1h' | '2h'
  notifyTo?: Person[]
}

const WEEK_LABELS = ['日', '月', '火', '水', '木', '金', '土']
const MAX_FREE_ENTRIES = 5

const NOTIFY_MODE_LABELS: Record<string, string> = {
  off: '通知OFF',
  time: '予定時刻',
  '15min': '15分前',
  '30min': '30分前',
  '1h': '1時間前',
  '2h': '2時間前',
}

const NOTIFY_MODE_FROM_LABEL: Record<string, CalendarEntry['notifyMode']> = {
  通知OFF: 'off',
  予定時刻: 'time',
  '15分前': '15min',
  '30分前': '30min',
  '1時間前': '1h',
  '2時間前': '2h',
}

function notifyModeLabel(mode: CalendarEntry['notifyMode']): string {
  return mode ? (NOTIFY_MODE_LABELS[mode] ?? '') : ''
}

function notifyToLabel(notifyTo: Person[] | undefined): string {
  if (!notifyTo || notifyTo.length === 0) return ''
  if (notifyTo.length === 2) return '2人とも'
  return notifyTo[0] === 'tarchin' ? 'たーちん' : 'やっちん'
}

function parseNotifyMode(val: string): CalendarEntry['notifyMode'] {
  return NOTIFY_MODE_FROM_LABEL[val?.trim()] ?? undefined
}

function parseNotifyTo(val: string): Person[] | undefined {
  const v = val?.trim()
  if (v === '2人とも') return ['tarchin', 'yacchin']
  if (v === 'たーちん') return ['tarchin']
  if (v === 'やっちん') return ['yacchin']
  return undefined
}

function createId(): string {
  return crypto.randomUUID()
}

function padTwo(n: number): string {
  return String(n).padStart(2, '0')
}

function applyDropdown(ws: ExcelJS.Worksheet, colNumber: number, startRow: number, endRow: number, options: string[]) {
  const formula = `"${options.join(',')}"`
  for (let row = startRow; row <= endRow; row++) {
    ws.getCell(row, colNumber).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [formula],
      showErrorMessage: true,
      error: '選択肢から選んでください',
      errorTitle: '入力エラー',
    }
  }
}

const COL_DAY = 1
const COL_WEEKDAY = 2
const COL_TARCHIN = 3
const COL_YACCHIN = 4
const COL_FREE_START = 5 // 内容1 = 5, then +5 per entry

const HEADER_ROW = 2
const DATA_START_ROW = 3

const NOTIFY_OPTIONS = ['通知OFF', '予定時刻', '15分前', '30分前', '1時間前', '2時間前']
const NOTIFY_TO_OPTIONS = ['たーちん', 'やっちん', '2人とも']
const PERSON_OPTIONS = ['たーちん', 'やっちん']
const TOTAL_COLS = 4 + MAX_FREE_ENTRIES * 5

export async function exportToExcel(year: number, entries: CalendarEntry[]): Promise<void> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'ふたりカレンダー'
  wb.created = new Date()

  for (let month = 1; month <= 12; month++) {
    const ws = wb.addWorksheet(`${month}月`)
    const daysInMonth = new Date(year, month, 0).getDate()
    const lastDataRow = DATA_START_ROW + daysInMonth - 1

    // Title row
    ws.mergeCells(1, 1, 1, TOTAL_COLS)
    const titleCell = ws.getCell(1, 1)
    titleCell.value = `${year}年${month}月`
    titleCell.font = { bold: true, size: 13 }
    titleCell.alignment = { horizontal: 'center' }
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4F0' } }

    // Header row
    const headers: string[] = [
      '日', '曜日', 'たーちん（休）', 'やっちん',
      ...Array.from({ length: MAX_FREE_ENTRIES }, (_, i) => [
        `内容${i + 1}`, `誰${i + 1}`, `時間${i + 1}`, `通知${i + 1}`, `通知先${i + 1}`,
      ]).flat(),
    ]
    const headerRow = ws.getRow(HEADER_ROW)
    headerRow.values = [undefined, ...headers] // ExcelJS rows are 1-indexed, col 1 = index 1
    headers.forEach((_, idx) => {
      const cell = ws.getCell(HEADER_ROW, idx + 1)
      cell.font = { bold: true }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8ECF0' } }
      cell.alignment = { horizontal: 'center' }
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFB0BEC5' } },
      }
    })

    // Column widths
    ws.getColumn(COL_DAY).width = 5
    ws.getColumn(COL_WEEKDAY).width = 6
    ws.getColumn(COL_TARCHIN).width = 15
    ws.getColumn(COL_YACCHIN).width = 12
    for (let i = 0; i < MAX_FREE_ENTRIES; i++) {
      const base = COL_FREE_START + i * 5
      ws.getColumn(base).width = 20     // 内容
      ws.getColumn(base + 1).width = 12 // 誰
      ws.getColumn(base + 2).width = 8  // 時間
      ws.getColumn(base + 3).width = 12 // 通知
      ws.getColumn(base + 4).width = 12 // 通知先
    }

    // Data rows
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month - 1, day)
      const iso = `${year}-${padTwo(month)}-${padTwo(day)}`
      const dow = date.getDay()
      const weekday = WEEK_LABELS[dow]

      const dayEntries = entries.filter((e) => e.date === iso)
      const tarchinQuick = dayEntries.find((e) => e.person === 'tarchin' && e.category === 'quick')
      const yacchinQuick = dayEntries.find((e) => e.person === 'yacchin' && e.category === 'quick')
      const freeEntries = dayEntries.filter((e) => e.category === 'free').slice(0, MAX_FREE_ENTRIES)

      const rowNum = DATA_START_ROW + day - 1
      const row = ws.getRow(rowNum)

      row.getCell(COL_DAY).value = day
      row.getCell(COL_WEEKDAY).value = weekday
      row.getCell(COL_TARCHIN).value = tarchinQuick?.text ?? ''
      row.getCell(COL_YACCHIN).value = yacchinQuick?.text ?? ''

      for (let i = 0; i < MAX_FREE_ENTRIES; i++) {
        const base = COL_FREE_START + i * 5
        const entry = freeEntries[i]
        if (entry) {
          row.getCell(base).value = entry.text
          row.getCell(base + 1).value = entry.person === 'tarchin' ? 'たーちん' : 'やっちん'
          row.getCell(base + 2).value = entry.time ?? ''
          row.getCell(base + 3).value = notifyModeLabel(entry.notifyMode)
          row.getCell(base + 4).value = notifyToLabel(entry.notifyTo)
        }
      }

      // Weekend colors
      const isSun = dow === 0
      const isSat = dow === 6
      if (isSun) {
        row.getCell(COL_DAY).font = { color: { argb: 'FFC0392B' } }
        row.getCell(COL_WEEKDAY).font = { color: { argb: 'FFC0392B' } }
      } else if (isSat) {
        row.getCell(COL_DAY).font = { color: { argb: 'FF2563B8' } }
        row.getCell(COL_WEEKDAY).font = { color: { argb: 'FF2563B8' } }
      }

      // Alternating row background
      if (day % 2 === 0) {
        for (let col = 1; col <= TOTAL_COLS; col++) {
          const cell = row.getCell(col)
          if (!cell.fill || (cell.fill as ExcelJS.FillPattern).pattern === 'none') {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F9FC' } }
          }
        }
      }

      row.commit()
    }

    // Freeze panes: freeze title + header rows
    ws.views = [{ state: 'frozen', ySplit: 2 }]

    // Data validation (dropdowns)
    applyDropdown(ws, COL_TARCHIN, DATA_START_ROW, lastDataRow, ['休'])
    applyDropdown(ws, COL_YACCHIN, DATA_START_ROW, lastDataRow, ['早', '中', '遅'])
    for (let i = 0; i < MAX_FREE_ENTRIES; i++) {
      const base = COL_FREE_START + i * 5
      applyDropdown(ws, base + 1, DATA_START_ROW, lastDataRow, PERSON_OPTIONS)
      applyDropdown(ws, base + 3, DATA_START_ROW, lastDataRow, NOTIFY_OPTIONS)
      applyDropdown(ws, base + 4, DATA_START_ROW, lastDataRow, NOTIFY_TO_OPTIONS)
    }
  }

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${year}年カレンダー.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function importFromExcel(
  file: File,
): Promise<{ entries: CalendarEntry[]; skipped: number }> {
  const buffer = await file.arrayBuffer()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)

  const results: CalendarEntry[] = []

  for (let month = 1; month <= 12; month++) {
    const ws = wb.getWorksheet(`${month}月`)
    if (!ws) continue

    // Parse year from title cell
    const titleVal = ws.getCell(1, 1).value
    const titleStr = typeof titleVal === 'string' ? titleVal : String(titleVal ?? '')
    const yearMatch = titleStr.match(/(\d{4})年/)
    if (!yearMatch) continue
    const year = parseInt(yearMatch[1])

    const daysInMonth = new Date(year, month, 0).getDate()

    for (let day = 1; day <= daysInMonth; day++) {
      const rowNum = DATA_START_ROW + day - 1
      const row = ws.getRow(rowNum)
      const iso = `${year}-${padTwo(month)}-${padTwo(day)}`

      // たーちん（休）
      const tarchinVal = String(row.getCell(COL_TARCHIN).value ?? '').trim()
      if (tarchinVal === '休') {
        results.push({ id: createId(), date: iso, text: '休', person: 'tarchin', category: 'quick' })
      }

      // やっちん
      const yacchinVal = String(row.getCell(COL_YACCHIN).value ?? '').trim()
      if (['早', '中', '遅'].includes(yacchinVal)) {
        results.push({ id: createId(), date: iso, text: yacchinVal, person: 'yacchin', category: 'quick' })
      }

      // 自由入力
      for (let i = 0; i < MAX_FREE_ENTRIES; i++) {
        const base = COL_FREE_START + i * 5
        const text = String(row.getCell(base).value ?? '').trim()
        if (!text) continue

        const personVal = String(row.getCell(base + 1).value ?? '').trim()
        const person: Person = personVal === 'やっちん' ? 'yacchin' : 'tarchin'
        const time = String(row.getCell(base + 2).value ?? '').trim()
        const notifyModeVal = String(row.getCell(base + 3).value ?? '').trim()
        const notifyToVal = String(row.getCell(base + 4).value ?? '').trim()

        results.push({
          id: createId(),
          date: iso,
          text,
          person,
          category: 'free',
          time: time || undefined,
          notifyMode: parseNotifyMode(notifyModeVal),
          notifyTo: parseNotifyTo(notifyToVal),
        })
      }
    }
  }

  return { entries: results, skipped: 0 }
}
