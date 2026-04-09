# 記憶の声（Kioku no Koe）

> 大切な人の声と記憶を AI に宿す ── 認知症介護・遠距離介護・グリーフケアに向けた音声会話 Web サービス

[![Cloudflare Pages](https://img.shields.io/badge/Deployed%20on-Cloudflare%20Pages-F38020?logo=cloudflare&logoColor=white)](https://kiokuno-koe-ai.pages.dev)
[![Hono](https://img.shields.io/badge/Framework-Hono-E36002?logo=hono)](https://hono.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 🌐 公開 URL

| 環境 | URL |
|---|---|
| **本番** | https://kiokuno-koe-ai.pages.dev |
| API ヘルスチェック | https://kiokuno-koe-ai.pages.dev/api/health |

---

## 📖 概要

「記憶の声」は、家族・知人の**声・言葉・思い出のエピソード**を AI に学習させ、まるで本人と話しているような対話体験を提供するサービスです。

- 🧠 **記憶登録**：過去のエピソードや好きなもの・嫌いなものなどを登録
- 🎙️ **ボイスクローン**：声のサンプルから AI がその人の声を再現
- 💬 **音声チャット**：登録した記憶と声で AI キャラクターと自然な会話
- 🗂️ **マルチ会話スレッド**：テーマ別に会話を分け、引き継ぎも可能
- 🔐 **アカウント管理**：メール・パスワードによるユーザー認証

---

## ✨ 主な機能

### 👤 AIキャラクター管理
- キャラクターの作成・編集・削除
- プロフィール設定：名前・年齢・出身地・人物像（性格・口調・特徴など）

### 🧠 記憶データ管理
- テキスト形式で過去のエピソード・思い出を登録
- 各記憶に**タイトル・時期・場所・感情タグ**を付与
- 登録した記憶は AI の会話に自動で反映される

### 💬 会話セッション（スレッド）機能
- キャラクターごとに**複数の会話を作成**（テーマ別管理が可能）
- 会話タイトルを後からインライン編集
- 会話を**「覚えておく」（ピン留め）**すると AI が自動でサマリーを生成し、他の会話に引き継がれる
- 引き継ぎサマリーは会話画面にリアルタイム表示

### 🎙️ 音声機能
| 機能 | 詳細 |
|---|---|
| **TTS（読み上げ）** | MiniMax speech-02-hd による高品質音声合成 |
| **プリセットボイス** | 日本語対応 7 種類から選択可能 |
| **ボイスクローン** | MP3/WAV/M4A をアップロードしてカスタムボイス生成 |
| **STT（音声入力）** | マイクで話しかけてテキスト入力（MiniMax STT） |
| **TTS ON/OFF** | 会話ごとに読み上げのオン・オフを切替 |

### 🔬 LoRA ファインチューニング支援
- 会話・記憶データから**JSONLデータセット**を自動エクスポート
- Gemma 4 向け QLoRA 学習スクリプト自動生成
- ローカル GPU 環境向けの推論スクリプト自動生成

### 🔐 認証・マルチユーザー
- メールアドレス＋パスワードによるユーザー登録・ログイン
- キャラクター・記憶・会話データはアカウントに紐付けて管理

---

## 🖥️ 操作方法

### 1. アカウント登録・ログイン

1. https://kiokuno-koe-ai.pages.dev にアクセス
2. 「アカウント登録」タブでメールアドレス・パスワード・名前を入力して登録
3. 登録後は自動でログインされる
4. 次回以降は「ログイン」タブからメールアドレス・パスワードでサインイン

---

### 2. キャラクターの作成

1. ログイン後、左サイドバーの「**＋ キャラクター追加**」ボタンをクリック
2. 以下の情報を入力：
   - **名前**（必須）：キャラクターの呼び名
   - **年齢**：数値で入力
   - **出身地**：出身の都道府県・地域
   - **人物像**：性格・口調・話し方の特徴などを自由記述
3. 「保存」で作成完了 → サイドバーにキャラクターが表示される

---

### 3. 記憶を登録する

1. サイドバーからキャラクターを選択し、右パネルの「**記憶**」タブをクリック
2. 「**＋ 記憶を追加**」ボタンをクリック
3. 以下の項目を入力：
   | 項目 | 説明 |
   |---|---|
   | タイトル | エピソードの短い見出し |
   | 内容 | 詳細なエピソード・思い出を自由記述 |
   | 時期 | いつ頃の記憶か（例：「1960年代」「幼少期」） |
   | 場所 | どこでの出来事か |
   | 感情 | そのときの感情（例：「嬉しい」「懐かしい」） |
4. 「保存」で登録 → 以降の会話に自動で反映される
5. 登録済みの記憶は鉛筆アイコンで編集、ゴミ箱アイコンで削除可能

---

### 4. 会話する

#### 会話の開始
1. キャラクターを選択すると右パネルに「**チャット**」タブが表示される
2. セッションバーの「**＋ 新しい会話**」ボタンで新しい会話スレッドを作成
3. 下部テキストボックスにメッセージを入力して「**送信**」または `Enter`

#### 音声で話しかける
1. テキストボックス左の🎙️（マイク）ボタンを押して録音開始
2. 話し終わったら再度押して録音停止 → 自動的に文字起こし→送信

#### 読み上げのオン・オフ
- 「🔊 TTS」トグルで AI の返答を音声で読み上げるか切り替え
- 各メッセージの▶ボタンで個別に音声再生

---

### 5. 会話セッション（スレッド）を管理する

```
キャラクターの会話エリア上部にセッションバーが表示されます
```

#### 新しい会話を作る
- 「**＋ 新しい会話**」ボタン → タイトルを入力 → 作成

#### セッションを切り替える
- セッションバーの各タブをクリックするだけで切り替わる

#### タイトルを変更する
- セッションタブの✏️（鉛筆）アイコンをクリック
- テキストボックスが表示されるので編集 → `Enter` で保存、`Esc` でキャンセル

#### 会話を「覚えておく」（他の会話に引き継ぐ）
1. セッションタブの📌アイコン、または会話エリア下部の「**この会話を覚えておく**」チェックボックスをオン
2. AI が会話内容を自動的にサマリー化
3. サマリーは会話エリア上部に表示され、**他の会話セッションでも自動的に参照**される
4. チェックをオフにすると引き継ぎが解除される

#### セッションを削除する
- セッションタブの🗑️アイコンをクリック → 確認ダイアログで「OK」

---

### 6. ボイスクローンを使う

1. キャラクター選択後、右パネルの「**ボイスクローン**」タブをクリック
2. 音声ファイル（MP3 / WAV / M4A、10秒〜3分推奨）をアップロード
3. 「クローン実行」→ 処理完了後、そのキャラクターの TTS にクローンボイスが使われる

---

### 7. LoRA ファインチューニング（上級者向け）

1. キャラクター選択後、「**ツール**」タブをクリック
2. **JSONL エクスポート**：会話・記憶データをデータセットとしてダウンロード
3. **学習スクリプト生成**：Gemma 4 向け QLoRA トレーニングスクリプトをダウンロード
4. ローカル GPU 環境で実行：
   ```bash
   pip install transformers peft trl datasets accelerate bitsandbytes
   python train_キャラクター名.py
   ```
5. **推論スクリプト生成**：学習済みアダプタを使った推論スクリプトをダウンロード

---

## 🗂️ データモデル

```sql
users                 -- アカウント（メール・パスワードハッシュ）
sessions              -- ログインセッショントークン
characters            -- AIキャラクタープロファイル（user_id 紐付け）
memories              -- 記憶・エピソードデータ（character_id 紐付け）
conversation_sessions -- 会話スレッド（タイトル・サマリー・引き継ぎフラグ）
conversations         -- 各メッセージ（session_id 紐付け）
voice_clone_jobs      -- ボイスクローンジョブ管理
```

### `conversation_sessions` テーブル（主要カラム）

| カラム | 型 | 説明 |
|---|---|---|
| `id` | INTEGER | セッションID |
| `character_id` | INTEGER | 対象キャラクター |
| `title` | TEXT | 会話タイトル（編集可） |
| `summary` | TEXT | AI生成サマリー（引き継ぎ用） |
| `is_pinned` | INTEGER | 1=覚えておく / 0=引き継がない |

---

## 🔌 API エンドポイント一覧

### 認証
```
POST /api/auth/register   ユーザー登録
POST /api/auth/login      ログイン
POST /api/auth/logout     ログアウト
GET  /api/auth/me         ログインユーザー情報
```

### キャラクター
```
GET    /api/characters          キャラクター一覧
POST   /api/characters          キャラクター作成
GET    /api/characters/:id      キャラクター詳細
PUT    /api/characters/:id      キャラクター更新
DELETE /api/characters/:id      キャラクター削除
```

### 記憶
```
GET    /api/memories/character/:charId   記憶一覧
POST   /api/memories                     記憶追加
PUT    /api/memories/:id                 記憶更新
DELETE /api/memories/:id                 記憶削除
GET    /api/memories/context/:charId     記憶コンテキスト取得（AI用）
```

### 会話・チャット
```
GET    /api/chat/sessions/:charId              セッション一覧
POST   /api/chat/sessions                      セッション作成
DELETE /api/chat/sessions/:sessionId           セッション削除
PUT    /api/chat/sessions/:sessionId/title     タイトル更新
PUT    /api/chat/sessions/:sessionId/pin       覚えておく ON/OFF（サマリー自動生成）
POST   /api/chat/sessions/:sessionId/summarize サマリー手動生成

POST   /api/chat                               メッセージ送信（AI返答・TTS生成）
POST   /api/chat/stt                           音声→テキスト変換
GET    /api/chat/history/:charId               会話履歴取得
DELETE /api/chat/history/:charId               会話履歴クリア
```

### 音声・MiniMax
```
POST /api/minimax/tts               テキスト→音声生成
POST /api/minimax/voice-clone       ボイスクローン（URL指定）
POST /api/minimax/voice-clone-upload ボイスクローン（ファイルアップロード）
GET  /api/minimax/voices            利用可能ボイス一覧
GET  /api/minimax/job/:jobId        クローンジョブステータス確認
```

### LoRA ファインチューニング
```
GET /api/finetune/export/:charId           JSONLデータセットエクスポート
GET /api/finetune/script/:charId           QLoRA学習スクリプト生成
GET /api/finetune/inference-script/:charId 推論スクリプト生成
```

---

## 🛠️ 技術スタック

| レイヤー | 技術 |
|---|---|
| **バックエンド** | [Hono](https://hono.dev) v4（TypeScript） |
| **デプロイ** | Cloudflare Pages + Workers |
| **データベース** | Cloudflare D1（SQLite） |
| **AI チャット** | Google Gemini 2.5 Flash Preview（gemini-2.5-flash-preview-04-17） |
| **TTS / STT** | MiniMax Audio API（speech-02-hd） |
| **ボイスクローン** | MiniMax Voice Cloning API |
| **フロントエンド** | Vanilla JS + Tailwind CSS（CDN） |
| **LoRA 学習** | Gemma 4 26B + QLoRA（PEFT / TRL） |

---

## 🚀 開発環境セットアップ

### 前提条件
- Node.js 18 以上
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) （`npm install -g wrangler`）
- MiniMax API キー（https://www.minimaxi.com/）
- Google Gemini API キー（https://aistudio.google.com/）

### インストール

```bash
git clone https://github.com/<your-username>/kiokuno-koe-ai.git
cd kiokuno-koe-ai
npm install
```

### 環境変数の設定

`.dev.vars` ファイルを作成（git には含まれません）：

```env
MINIMAX_API_KEY=your_minimax_api_key_here
GEMINI_API_KEY=your_gemini_api_key_here
```

### データベースの初期化

```bash
# ローカル D1 データベースにマイグレーション適用
npm run db:migrate:local

# サンプルデータを投入（任意）
npm run db:seed
```

### 起動

```bash
# ビルド
npm run build

# ローカルサーバー起動（wrangler pages dev）
npm run dev:sandbox
# → http://localhost:3000 でアクセス可能
```

---

## ☁️ Cloudflare へのデプロイ

```bash
# 1. Cloudflare にログイン
npx wrangler login

# 2. D1 データベース作成（初回のみ）
npx wrangler d1 create kiokuno-koe-ai-production
# → 出力された database_id を wrangler.jsonc の "database_id" に記入

# 3. 本番DBにマイグレーション適用
npm run db:migrate:prod

# 4. ビルド＆デプロイ
npm run build
npx wrangler pages deploy dist --project-name kiokuno-koe-ai

# 5. シークレット環境変数を登録
npx wrangler pages secret put MINIMAX_API_KEY --project-name kiokuno-koe-ai
npx wrangler pages secret put GEMINI_API_KEY --project-name kiokuno-koe-ai
```

---

## 📁 ディレクトリ構成

```
kiokuno-koe-ai/
├── src/
│   ├── index.tsx              # Hono アプリ エントリポイント
│   └── routes/
│       ├── auth.ts            # 認証（登録・ログイン・セッション）
│       ├── characters.ts      # キャラクター CRUD
│       ├── memories.ts        # 記憶 CRUD
│       ├── chat.ts            # チャット・会話セッション管理
│       ├── minimax.ts         # MiniMax TTS / STT / ボイスクローン
│       └── finetune.ts        # LoRA データセット・スクリプト生成
├── public/
│   └── static/
│       ├── app.js             # フロントエンド JavaScript
│       └── styles.css         # カスタム CSS
├── migrations/
│   ├── 0001_initial_schema.sql
│   ├── 0002_add_audio_hex_to_conversations.sql
│   ├── 0003_add_users_and_sessions.sql
│   └── 0004_add_conversation_sessions.sql
├── .dev.vars                  # ローカル環境変数（git 除外）
├── ecosystem.config.cjs       # PM2 設定
├── wrangler.jsonc             # Cloudflare 設定
├── vite.config.ts             # Vite ビルド設定
├── tsconfig.json
└── package.json
```

---

## 🔮 今後の予定

- [ ] 写真・画像からの記憶入力（マルチモーダル）
- [ ] LoRA アダプタをクラウドで実行するエンドポイント
- [ ] リアルタイム音声ストリーミング TTS
- [ ] 記憶のカテゴリ分類・タグ検索
- [ ] アバター映像生成（将来フェーズ）
- [ ] Cloudflare R2 による音声ファイル永続保存

---

## 👤 開発者

- **開発者**: 坂本義志
- **連絡先**: elixir2761@gmail.com

---

## 📄 ライセンス

MIT License

---

*記憶の声 v1.2.0 ─ 2026-04-09*
