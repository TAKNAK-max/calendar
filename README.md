# calendar

`calendar/` の開発・リリース用メモです。

## 開発手順

1. 依存関係をインストールする。
   ```bash
   npm install
   ```
2. 開発サーバーを起動する。
   ```bash
   npm run dev
   ```
3. ブラウザで表示されたローカル URL を開き、動作確認しながら実装する。
4. 作業完了前に本番ビルドが通ることを確認する。
   ```bash
   npm run build
   ```
5. 必要に応じてビルド成果物をローカル確認する。
   ```bash
   npm run preview
   ```

## リリース手順

1. `main` などリリース対象ブランチを最新化する。
2. 変更内容を確認し、必要な修正を取り込む。
3. リリースビルドを実行し、エラーがないことを確認する。
   ```bash
   npm run release
   ```
4. `calendar/` 配下の成果物をデプロイ先に反映する。
5. リリース後に画面表示・主要機能を本番環境で確認する。
6. 必要であれば Git タグを付与して履歴を残す（例: `v1.0.0`）。

## 自宅サーバー同期（前後1年の3年分）

`calendar-sync-server/` を同居させると、Google 連携なしで HTTP 同期できます。

## デバッグモード（ローカル）

クエリに `mode=local` を付けると、サーバー認証・同期の通信を行わずにカレンダー画面へ直接遷移します。

例: `http://localhost:5173/?mode=local`

### Calendar 側の動き

1. メニューの `同期サーバーURL`（初期値: `/calendar-api`）を設定する。
2. `前後1年を同期` を押すと、表示中の年を中心に `-1年〜+1年` の 3 年分を同期する。
3. 未同期の年を表示している間は、カレンダー上部に同期を促すメッセージを表示する。

### Docker 追加例

```yaml
services:
  calendar-sync:
    build:
      context: /path/to/home_git/calendar-sync-server
    container_name: calendar-sync
    restart: unless-stopped
    volumes:
      - /srv/calendar-sync-data:/data
    expose:
      - "8787"
```

### Nginx 追加例

```nginx
server {
    listen 80;
    server_name lancer-dev.com;

    client_max_body_size 100M;

    location / {
        root /usr/share/nginx/html;
        index index.html;
    }

    location /calendar-api/ {
        proxy_pass http://calendar-sync:8787/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /git/ {
        proxy_pass http://gitea:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

