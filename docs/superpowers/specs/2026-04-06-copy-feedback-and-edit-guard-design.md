# Copy Feedback & Other-Person Edit Guard — Design Spec

**Date:** 2026-04-06

## Feature 1: Copy Feedback

### Copy button
- Add `copiedRowId: string | null` state (default null)
- On `copyEntry(rowId)`: set `copiedRowId = rowId`, then `setTimeout(() => setCopiedRowId(null), 1000)`
- While `copiedRowId === row.rowId`: show checkmark icon (✓) instead of copy icon, apply green color class `is-copy-done`

### Paste button
- `title` attribute:
  - `clipboardEntry !== null`: `「${clipboardEntry.text}」を貼り付け`
  - `clipboardEntry === null`: `コピーされた予定がありません`

## Feature 2: Other-Person Edit Guard

### Data change
Add `person: Person` to each row in `DayEditor.inputs`:
```ts
inputs: { rowId: string; value: string; memo: string; color: string; time: string; notifyMode: ...; notifyTo: Person[]; entryId?: string; person: Person }[]
```
Populate from `entry.person` in `openDayEditor`.

### Delete button guard
When `row.person !== selectedPerson`, change the confirm modal:
- kind: `'warning'`
- message: `「これは${personLabel}の予定です。本当に削除しますか？」`
- (personLabel: 'たーちん' | 'やっちん')

### Edit button guard (in readonly modal)
When the "編集" button is clicked and `row.person !== selectedPerson` (looked up via `freeInputModal.rowId` → `dayEditor.inputs`):
1. Show a confirm modal: `「これは${personLabel}の予定です。編集を続けますか？」`
2. On confirm: `setFreeInputModal(prev => ({ ...prev, mode: 'edit' }))`
3. On cancel: do nothing (stay in readonly)

## Files Changed
- `calendar/src/App.tsx` only
