# 記憶の声（Kioku no Koe）

大切な人の声と記憶を AI に宿す ── 認知症介護・遠距離介護・グリーフケアに向けた音声会話 Web サービス

[![Cloudflare Pages](https://img.shields.io/badge/Deployed%20on-Cloudflare%20Pages-F38020?logo=cloudflare&logoColor=white)](https://kiokuno-koe-ai.pages.dev)
[![Hono](https://img.shields.io/badge/Framework-Hono-E36002)](https://hono.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 公開 URL

| 環境 | URL |
|---|---|
| 本番 | https://kiokuno-koe-ai.pages.dev |
| API ヘルスチェック | https://kiokuno-koe-ai.pages.dev/api/health |
| 利用規約 | https://kiokuno-koe-ai.pages.dev/terms |
| プライバシーポリシー | https://kiokuno-koe-ai.pages.dev/privacy |
| GitHub | https://github.com/mashiroARTES/kiokuno-koe |

---

## 技術スタック

| 項目 | 採用技術 |
|---|---|
| バックエンド | Hono v4（TypeScript） |
| デプロイ | Cloudflare Pages + Workers |
| データベース | Cloudflare D1（SQLite） |
| AI チャット | Google Gemma 4 31B IT（`gemma-4-31b-it`）via Gemini API |
| TTS（読み上げ） | MiniMax Audio API `t2a_v2`（モデル: `speech-2.8-turbo`） |
| STT（音声入力） | MiniMax Audio API `speech/transcriptions`（モデル: `speech-2.8-turbo`） |
| ボイスクローン | MiniMax Voice Cloning API `voice_clone` |
| フロントエンド | Vanilla JS + Tailwind CSS（CDN） |
| フォント | Noto Sans JP / Noto Serif JP（Google Fonts） |

---

## 実装済み機能

### アカウント管理
- メールアドレス＋パスワード（8文字以上）によるユーザー登録・ログイン・ログアウト
- セッショントークン（有効期限 30 日）による認証
- 全データはログインユーザーに紐付けて管理

### AI キャラクター管理
- キャラクターの作成・詳細取得・更新・削除
- 設定項目: 名前、年齢、出身地、人物像（性格・口調など）
- キャラクターへのカスタムボイス ID 紐付け（`voice_id`）

### 記憶データ管理
- テキスト形式で過去のエピソード・思い出を登録
- 各記憶に タイトル・内容・時期・場所・感情タグ を付与
- 記憶は AI のシステムプロンプトに自動で組み込まれ会話に反映される

### 会話セッション（スレッド）機能
- キャラクターごとに複数の会話スレッドを作成・切り替え
- 会話タイトルをインライン編集（50 文字制限）
- 「覚えておく」（ピン留め）機能: ON にすると Gemma 4 がサマリーを自動生成し、他の会話セッションのシステムプロンプトに引き継がれる
- サマリーは会話画面の上部に常時表示

### AI チャット
- Gemma 4 31B IT による日本語キャラクター対話
- システムプロンプトに キャラクター情報・記憶データ・引き継ぎサマリー を自動組み込み
- 会話履歴（直近 20 件）を context として毎回送信
- Gemma 4 の内部推論（`thought=true` の part）は自動除去し、最終返答のみを返す
- 会話テキストは DB 保存前に 2000 文字に切り詰め（SQLITE_TOOBIG 対策）

### TTS（テキスト読み上げ）
- MiniMax `t2a_v2` エンドポイント、モデル `speech-2.8-turbo` を使用
- プリセットボイス 7 種（Wise_Woman / Gentle_Man / Warm_Woman / Deep_Voice_Man / Caring_Lady / Friendly_Person / Narrator）
- カスタムクローンボイスを登録済みの場合はそちらを優先使用
- 生成された音声は hex 文字列として返却（DB には保存しない）
- TTS の ON / OFF をチャット画面でトグル切り替え可能
- 過去メッセージの再生ボタンから後から TTS 生成して再生可能（`/api/minimax/tts-for-message`）

### STT（音声入力）
- ブラウザ内 MediaRecorder API でマイク録音（WebM 形式）
- MiniMax `speech/transcriptions` エンドポイント、モデル `speech-2.8-turbo` を使用
- 言語設定: 日本語（`language: ja`）
- 文字起こし結果を入力欄に自動セットして送信

### ボイスクローン
- 音声ファイルをアップロードしてカスタムボイスを生成
- ファイルアップロード方式: MiniMax Files API `files/upload`（purpose: `voice_clone`）→ `voice_clone` API
- URL 指定方式: `file_url` で直接クローン
- 生成されたボイス ID をキャラクターの `voice_id` に自動保存
- 処理はジョブ（`voice_clone_jobs` テーブル）で管理

---

## API エンドポイント一覧

### 認証（`/api/auth`）

| メソッド | パス | 説明 |
|---|---|---|
| POST | `/api/auth/register` | ユーザー登録。body: `{ email, password }`。成功時に `session_token` を返す |
| POST | `/api/auth/login` | ログイン。body: `{ email, password }`。成功時に `session_token` を返す |
| POST | `/api/auth/logout` | ログアウト。`Authorization: Bearer <token>` が必要 |
| GET | `/api/auth/me` | 認証中ユーザー情報取得。`Authorization: Bearer <token>` が必要 |

### キャラクター（`/api/characters`）

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/characters` | 自分のキャラクター一覧 |
| GET | `/api/characters/:id` | キャラクター詳細 |
| POST | `/api/characters` | キャラクター作成。body: `{ name, age?, birthplace?, description? }` |
| PUT | `/api/characters/:id` | キャラクター更新 |
| PUT | `/api/characters/:id/voice` | ボイス ID のみ更新。body: `{ voice_id }` |
| DELETE | `/api/characters/:id` | キャラクター削除 |

### 記憶（`/api/memories`）

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/memories/character/:characterId` | キャラクターの記憶一覧 |
| GET | `/api/memories/:id` | 記憶詳細 |
| POST | `/api/memories` | 記憶追加。body: `{ character_id, title, content, period?, location?, emotion?, source_type? }` |
| PUT | `/api/memories/:id` | 記憶更新 |
| DELETE | `/api/memories/:id` | 記憶削除 |
| GET | `/api/memories/context/:characterId` | AIプロンプト用の記憶コンテキスト文字列を返す |

### 記憶エイリアス（`/api/mem-*`、フロントエンドが実際に使用するパス）

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/mem-list/:characterId` | 記憶一覧（`/api/memories/character/:id` の別パス） |
| POST | `/api/mem-save` | 記憶追加（`/api/memories` の別パス） |
| PUT | `/api/mem-update/:id` | 記憶更新（`/api/memories/:id` の別パス） |
| DELETE | `/api/mem-delete/:id` | 記憶削除（`/api/memories/:id` の別パス） |

### チャット・会話セッション（`/api/chat`）

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/chat/sessions/:characterId` | セッション一覧（メッセージ件数付き） |
| POST | `/api/chat/sessions` | セッション作成。body: `{ character_id, title? }` |
| DELETE | `/api/chat/sessions/:sessionId` | セッション削除 |
| PUT | `/api/chat/sessions/:sessionId/title` | タイトル更新（50文字以内）。body: `{ title }` |
| PUT | `/api/chat/sessions/:sessionId/pin` | 覚えておく ON/OFF。body: `{ is_pinned: 0|1 }`。ON 時にサマリーを自動生成 |
| POST | `/api/chat/sessions/:sessionId/summarize` | サマリーを手動で再生成 |
| POST | `/api/chat` | チャット送信。body: `{ character_id, message, session_id?, tts?: boolean }`。AI返答と `audio_hex`（TTS ON 時）を返す |
| POST | `/api/chat/stt` | 音声認識。`multipart/form-data` で `audio_file` を送信。`transcript` を返す |
| GET | `/api/chat/history/:characterId` | 会話履歴。クエリ: `session_id=<id>&limit=<n>` |
| DELETE | `/api/chat/history/:characterId` | 会話履歴全削除 |

### MiniMax 音声（`/api/minimax`）

| メソッド | パス | 説明 |
|---|---|---|
| POST | `/api/minimax/tts` | TTS生成。body: `{ text, voice_id?, speed?, vol?, pitch?, emotion? }`。`audio_hex` を返す |
| POST | `/api/minimax/tts-for-message` | 過去メッセージを後から TTS 変換。body: `{ message_id, character_id }` |
| POST | `/api/minimax/voice-clone` | ボイスクローン（URL指定）。body: `{ character_id, audio_url, voice_name }` |
| POST | `/api/minimax/voice-clone-upload` | ボイスクローン（ファイルアップロード）。`multipart/form-data`: `audio_file, character_id, voice_name` |
| GET | `/api/minimax/voices` | プリセットボイス一覧 + DB登録済みクローンボイス一覧 |
| GET | `/api/minimax/job/:jobId` | クローンジョブの処理状況確認 |

### その他

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/health` | ヘルスチェック。`{ status, service, version, timestamp }` を返す |
| GET | `/terms` | 利用規約ページ（HTML） |
| GET | `/privacy` | プライバシーポリシーページ（HTML） |

---

## データモデル

### テーブル一覧

```
users                   ユーザーアカウント
sessions                ログインセッション（トークン）
characters              AI キャラクタープロファイル
memories                記憶・エピソードデータ
conversations           会話メッセージ履歴
conversation_sessions   会話スレッド
voice_clone_jobs        ボイスクローンジョブ管理
```

### 主要カラム

`characters`

| カラム | 型 | 説明 |
|---|---|---|
| id | INTEGER | PK |
| user_id | INTEGER | 所有ユーザー（FK: users） |
| name | TEXT | キャラクター名 |
| age | INTEGER | 年齢 |
| birthplace | TEXT | 出身地 |
| description | TEXT | 人物像・性格・口調 |
| voice_id | TEXT | MiniMax ボイス ID（プリセットまたはクローン） |
| voice_sample_url | TEXT | ボイスサンプル URL |
| model_adapter_path | TEXT | 将来の拡張用フィールド |

`conversation_sessions`

| カラム | 型 | 説明 |
|---|---|---|
| id | INTEGER | PK |
| character_id | INTEGER | FK: characters |
| title | TEXT | 会話タイトル（編集可、50文字以内） |
| summary | TEXT | AI 生成サマリー（最大 1000 文字、引き継ぎ用） |
| is_pinned | INTEGER | 1=覚えておく / 0=引き継がない |

`conversations`

| カラム | 型 | 説明 |
|---|---|---|
| id | INTEGER | PK |
| character_id | INTEGER | FK: characters |
| session_id | INTEGER | FK: conversation_sessions |
| role | TEXT | `user` または `assistant` |
| content | TEXT | メッセージ本文（最大 2000 文字で保存） |
| audio_hex | TEXT | TTS 音声データ（キャッシュ、`tts-for-message` 用） |

`memories`

| カラム | 型 | 説明 |
|---|---|---|
| id | INTEGER | PK |
| character_id | INTEGER | FK: characters |
| title | TEXT | 記憶タイトル |
| content | TEXT | 記憶の詳細内容 |
| period | TEXT | 時期（例: 1960年代、子供の頃） |
| location | TEXT | 場所 |
| emotion | TEXT | 感情タグ（例: 懐かしい、嬉しい） |
| source_type | TEXT | `text` / `audio` / `photo` |

---

## 操作方法

### 1. アカウント登録・ログイン

1. https://kiokuno-koe-ai.pages.dev にアクセス
2. 「アカウント登録」タブでメールアドレスとパスワード（8文字以上）を入力して登録
3. 登録後は自動でログインされる
4. 次回以降は「ログイン」タブからメールアドレスとパスワードでサインイン

### 2. キャラクターの作成

1. ログイン後、左サイドバーの「＋ キャラクター追加」ボタンをクリック
2. 名前（必須）、年齢、出身地、人物像を入力
3. 「保存」で作成 → サイドバーにキャラクターが表示される

### 3. 記憶の登録

1. キャラクターを選択し、右パネルの「記憶」タブをクリック
2. 「＋ 記憶を追加」ボタンをクリック
3. タイトル・内容・時期・場所・感情を入力して保存
4. 登録した記憶は AI との会話に自動で反映される

### 4. 会話する

1. キャラクター選択後、セッションバーの「＋ 新しい会話」ボタンで会話スレッドを作成
2. 下部テキストボックスにメッセージを入力して送信（Enter または送信ボタン）
3. AI からの返答が表示される

音声で話しかける場合はテキストボックス左のマイクボタンを押して録音し、停止すると自動で文字起こしして送信される。

TTS（読み上げ）の ON / OFF は「🔊 TTS」トグルで切り替え。各メッセージの再生ボタンで個別に音声再生も可能。

### 5. 会話セッションの管理

- 「＋ 新しい会話」ボタンで新しいスレッドを作成
- セッションタブをクリックして切り替え
- 鉛筆アイコンでタイトルをインライン編集（Enter で保存、Esc でキャンセル）
- 📌 アイコンまたは「この会話を覚えておく」チェックボックスで引き継ぎ設定。ON にすると AI が自動でサマリーを生成し、他の会話にも引き継がれる
- ゴミ箱アイコンでセッションを削除

### 6. ボイスクローン

1. キャラクター選択後、「ボイスクローン」タブをクリック
2. MP3 / WAV / M4A（10秒〜3分推奨）をアップロード
3. 処理完了後、そのキャラクターの TTS にクローンボイスが使われる

## 開発環境セットアップ

### 前提条件

- Node.js 18 以上
- Wrangler CLI（`npm install -g wrangler`）
- MiniMax API キー（https://www.minimaxi.com/）
- Google Gemini API キー（https://aistudio.google.com/）

### インストール

```
git clone https://github.com/mashiroARTES/kiokuno-koe.git
cd kiokuno-koe
npm install
```

### 環境変数の設定

`.dev.vars` ファイルを作成（git には含まれません）:

```
MINIMAX_API_KEY=your_minimax_api_key_here
GEMINI_API_KEY=your_gemini_api_key_here
```

### データベースの初期化

```
npx wrangler d1 migrations apply kioku-no-koe-production --local
```

### 起動

```
npm run build
npm run dev:sandbox
```

http://localhost:3000 でアクセスできる。

---

## Cloudflare へのデプロイ

```
npx wrangler login

npx wrangler d1 create kioku-no-koe-ai-production
# 出力された database_id を wrangler.jsonc の "database_id" に記入

npx wrangler d1 migrations apply kioku-no-koe-ai-production

npm run build
npx wrangler pages deploy dist --project-name kiokuno-koe-ai

npx wrangler pages secret put MINIMAX_API_KEY --project-name kiokuno-koe-ai
npx wrangler pages secret put GEMINI_API_KEY --project-name kiokuno-koe-ai
```

---

## ディレクトリ構成

```
kiokuno-koe/
├── src/
│   ├── index.tsx                   Hono エントリポイント・静的ページ HTML
│   └── routes/
│       ├── auth.ts                 認証（登録・ログイン・セッション検証）
│       ├── characters.ts           キャラクター CRUD
│       ├── memories.ts             記憶 CRUD
│       ├── chat.ts                 チャット・STT・会話セッション管理
│       └── minimax.ts              TTS・ボイスクローン
├── public/static/
│   ├── app.js                      フロントエンド JavaScript
│   └── styles.css                  カスタム CSS
├── migrations/
│   ├── 0001_initial_schema.sql     初期テーブル（characters, memories, conversations, voice_clone_jobs）
│   ├── 0002_add_audio_hex_to_conversations.sql  conversations.audio_hex 追加
│   ├── 0003_add_users_and_sessions.sql          users, sessions, characters.user_id 追加
│   └── 0004_add_conversation_sessions.sql       conversation_sessions, conversations.session_id 追加
├── .dev.vars                       ローカル環境変数（git 除外）
├── ecosystem.config.cjs            PM2 設定
├── wrangler.jsonc                  Cloudflare 設定
├── vite.config.ts                  Vite ビルド設定
├── tsconfig.json
└── package.json
```

---

## 今後の予定

- 写真・画像からの記憶入力（マルチモーダル）
- リアルタイム音声ストリーミング TTS
- 記憶のカテゴリ分類・タグ検索
- Cloudflare R2 による音声ファイル永続保存

---

## 開発者

- 開発者: 坂本義志
- 連絡先: elixir2761@gmail.com

---

## ライセンス

MIT License

---

記憶の声 v1.4.0 ── 2026-04-09
