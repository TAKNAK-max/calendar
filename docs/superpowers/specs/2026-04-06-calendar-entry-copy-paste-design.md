# Calendar Entry Copy & Paste Feature — Design Spec

**Date:** 2026-04-06

## Overview

Add copy/paste for free-text calendar entries. User copies an entry from one day, navigates to another day, and pastes it as a new entry (direct add, no modal). Intended as the workflow for "moving" an entry to a different date.

## Scope

- **In scope:** Copy any free-text entry row; paste as new entry on any day.
- **Out of scope:** Copying quick-action entries, persistent clipboard (resets on page reload), copying `person` from source (paste always uses `selectedPerson`).

## New State

```ts
type ClipboardEntry = {
  text: string
  memo: string
  color: string
  time: string
  notifyMode: 'off' | 'time' | '15min' | '30min' | '1h' | '2h'
  notifyTo: Person[]
}

const [clipboardEntry, setClipboardEntry] = useState<ClipboardEntry | null>(null)
```

## New Functions

### copyEntry(rowId: string)
- Find row in `dayEditor.inputs` by rowId
- Copy `{ text: row.value, memo, color, time, notifyMode, notifyTo }` to `clipboardEntry`

### pasteEntry()
- Guard: `clipboardEntry` must not be null
- Create new `CalendarEntry` with `createId()`, `dayEditor.date`, `selectedPerson`, `category: 'free'`, and all fields from `clipboardEntry`
- `saveEntries([...entries, newEntry])`
- Append new row to `dayEditor.inputs`
- Call `syncSingleDayWithServer(dayEditor.date)`

## UI Layout

**Existing entry row (`free-entry-row`):**
```
[予定テキスト] [時間] [通知] [コピーボタン] [削除ボタン]
```

**New entry row (`free-add-row`):**
```
[予定なし] [--:--] [通知なし] [ペンボタン] [ペーストボタン]
```

- Paste button: always visible; `disabled` + greyed out when `clipboardEntry === null`
- Copy button: uses clipboard/copy icon, same `row-action-button` style as delete

## Files Changed

- `calendar/src/App.tsx` — only file modified
