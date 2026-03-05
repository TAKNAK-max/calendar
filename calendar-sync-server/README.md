# calendar-sync-server

`calendar` 用の軽量同期 API です。データは年単位で JSON 保存します。

## API

- `GET /health`
- `POST /sync-range`
  - request:
    - `startYear`: number
    - `endYear`: number
    - `entries`: `CalendarEntry[]`
    - `removedIds`: string[]
    - `colorSettings?`: `Record<string, string>`
  - response:
    - `years`: number[]
    - `entries`: `CalendarEntry[]`
    - `removedIds`: string[]
    - `colorSettings`: `Record<string, string>`
- `POST /clear-all`
  - response:
    - `deletedFiles`: number

## ローカル起動

```bash
npm install
npm start
```

デフォルト:
- `PORT=8787`
- `DATA_DIR=/data`（ローカル実行時は存在しなければ作成）

## Docker

```bash
docker build -t calendar-sync-server .
docker run --rm -p 8787:8787 -v /srv/calendar-sync-data:/data calendar-sync-server
```
