# 記憶の声 (Kioku no Koe)

> 認知症高齢者の過去の記憶を学習した AI キャラクターとの音声会話 Web サービス

## プロジェクト概要

| 項目 | 内容 |
|---|---|
| **言語モデル** | Gemma 4 26B A4B (MoE) + QLoRA ファインチューニング |
| **TTS/ボイスクローン** | MiniMax Audio API (speech-02-hd) |
| **STT (音声入力)** | MiniMax Speech API + Web Speech API (フォールバック) |
| **チャット AI** | MiniMax Text API (MiniMax-Text-01) |
| **バックエンド** | Hono + Cloudflare Pages (Workers) |
| **データベース** | Cloudflare D1 (SQLite) |
| **フロントエンド** | Vanilla JS + Tailwind CSS (CDN) |

## 現在実装済みの機能

### ✅ AIキャラクター管理
- キャラクター作成・編集・削除
- 名前・年齢・出身地・人物像の設定

### ✅ 記憶データ管理
- テキスト形式での記憶・エピソード登録
- タイトル・時期・場所・感情タグの設定
- 記憶一覧・削除

### ✅ 音声チャット
- MiniMax Chat API によるキャラクター人格会話
- 記憶データを自動でシステムプロンプトに組み込み
- 会話履歴の永続化 (D1)

### ✅ TTS (テキスト → 音声)
- MiniMax Audio speech-02-hd による高品質 TTS
- プリセットボイス 7 種 (日本語対応)
- TTS ON/OFF トグル
- 音声自動再生 / 手動再生ボタン

### ✅ ボイスクローン
- 音声ファイルアップロード (MP3/WAV/M4A)
- MiniMax Voice Cloning API によるカスタムボイス生成
- クローンボイスをキャラクターに紐付け

### ✅ 音声入力 (STT)
- ブラウザ内マイク録音 (MediaRecorder API)
- MiniMax STT API による文字起こし
- Web Speech API フォールバック対応

### ✅ LoRA ファインチューニングパイプライン
- 会話・記憶データから JSONL データセット自動生成
- Gemma 4 26B A4B 向け QLoRA 学習スクリプト自動生成
- 推論スクリプト自動生成

## API エンドポイント一覧

```
GET  /api/health                          ヘルスチェック

GET  /api/characters                      キャラクター一覧
POST /api/characters                      キャラクター作成
GET  /api/characters/:id                  キャラクター詳細
PUT  /api/characters/:id                  キャラクター更新
DEL  /api/characters/:id                  キャラクター削除

GET  /api/memories/character/:charId      記憶一覧
POST /api/memories                        記憶追加
PUT  /api/memories/:id                    記憶更新
DEL  /api/memories/:id                    記憶削除
GET  /api/memories/context/:charId        記憶コンテキスト取得

POST /api/chat                            チャット送信 (TTS付き)
POST /api/chat/stt                        音声→テキスト
GET  /api/chat/history/:charId            会話履歴取得
DEL  /api/chat/history/:charId            会話履歴クリア

POST /api/minimax/tts                     TTS生成
POST /api/minimax/voice-clone             ボイスクローン (URL)
POST /api/minimax/voice-clone-upload      ボイスクローン (ファイル)
GET  /api/minimax/voices                  ボイス一覧
GET  /api/minimax/job/:jobId              ジョブステータス

GET  /api/finetune/export/:charId         JSONL データセット出力
GET  /api/finetune/script/:charId         QLoRA 学習スクリプト生成
GET  /api/finetune/inference-script/:charId  推論スクリプト生成
```

## データモデル

```sql
characters        -- AIキャラクタープロファイル
memories          -- 記憶・エピソードデータ
conversations     -- 会話履歴
voice_clone_jobs  -- ボイスクローンジョブ管理
```

## 開発環境

```bash
# 依存関係インストール
npm install

# DBマイグレーション
npm run db:migrate:local

# シードデータ投入
npm run db:seed

# ビルド
npm run build

# 起動 (PM2)
pm2 start ecosystem.config.cjs
```

## 環境変数 (.dev.vars)

```
MINIMAX_API_KEY=your_minimax_api_key
```

## LoRA ファインチューニング手順

1. サイドバー「ツール」タブ → 「JSONLエクスポート」でデータセット取得
2. 「学習スクリプト生成」で `train_*.py` をダウンロード
3. GPU 環境で実行:
   ```bash
   pip install transformers peft trl datasets accelerate bitsandbytes
   python train_キャラクター名.py
   ```
4. 生成された `lora_adapter_*/` をサーバーに配置

## 未実装 / 今後の課題

- [ ] LoRA アダプタをサーバー上で実行する推論エンドポイント
- [ ] 写真・画像からのマルチモーダル記憶入力 (Gemma 4 Vision 活用)
- [ ] リアルタイム音声ストリーミング TTS
- [ ] アバター映像生成 (将来フェーズ)
- [ ] 認証・マルチユーザー対応
- [ ] Cloudflare R2 による音声ファイルストレージ

## 技術スタック

- **Hono** v4 - 超軽量 Edge Web フレームワーク
- **Cloudflare Pages + Workers** - エッジデプロイ
- **Cloudflare D1** - SQLite ベース分散データベース
- **MiniMax Audio API** - TTS/ボイスクローン/STT
- **Gemma 4** (Google DeepMind) - Apache 2.0, 256K コンテキスト
- **LoRA/QLoRA** (PEFT) - 効率的ファインチューニング

---
*記憶の声 v1.0.0 | 2026-04-06*
