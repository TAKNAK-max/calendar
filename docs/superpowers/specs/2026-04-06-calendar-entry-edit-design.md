# Calendar Entry Edit Feature — Design Spec

**Date:** 2026-04-06

## Overview

Add editing capability to confirmed free-text calendar entries. Currently, tapping an existing entry opens a read-only confirmation modal. This feature adds an "編集" button that switches the modal into edit mode, allowing in-place updates.

## Scope

- **In scope:** Edit text, memo, color, time, notifyMode, notifyTo of existing free entries on the same date.
- **Out of scope:** Date change (handled separately via copy & paste feature), quick-action entries editing.

## State Change

`FreeInputModalState.isReadOnly: boolean` → `mode: 'readonly' | 'edit' | 'new'`

```ts
type FreeInputModalState = {
  rowId: string | null
  text: string
  memo: string
  color: string
  time: string
  notifyMode: 'off' | 'time' | '15min' | '30min' | '1h' | '2h'
  notifyTo: Person[]
  mode: 'readonly' | 'edit' | 'new'
}
```

All existing `isReadOnly` references are replaced with `mode !== 'new'` (for field disabling) and `mode === 'readonly'` (for button switching).

## UI Flow

1. Tap existing entry → modal opens with `mode: 'readonly'` ("予定の確認")
2. Tap "編集" → `mode` switches to `'edit'` in-place, all fields become editable
3. Tap "保存" → `updateFreeInputModal()` saves and closes
4. Tap "戻る" → discard changes and close modal (no intermediate step back to readonly)

## New Function: updateFreeInputModal()

```
- Guard: mode must be 'edit' and rowId must exist
- Locate the row in dayEditor.inputs by rowId
- Get entryId from that row (must exist for edit mode)
- Update entries[] by mapping: match by id, replace fields with modal values
- Update dayEditor.inputs row with new display values
- Close modal (setFreeInputModal(null))
- Trigger syncSingleDayWithServer(dayEditor.date) (same as closeDayEditor)
```

## Button Layout

| mode       | Left area                        | Right area                     |
|------------|----------------------------------|--------------------------------|
| `readonly` | Notification test button (existing) | "編集" button + "戻る" button |
| `edit`     | —                                | "保存" button + "戻る" button  |
| `new`      | (unchanged)                      | "追加" button + "キャンセル"   |

## Files Changed

- `calendar/src/App.tsx` — only file modified
