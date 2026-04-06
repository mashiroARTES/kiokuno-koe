import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { serveStatic } from 'hono/cloudflare-workers'

import characters from './routes/characters'
import memories from './routes/memories'
import minimaxRoutes from './routes/minimax'
import chat from './routes/chat'
import finetune from './routes/finetune'
import auth, { validateSession } from './routes/auth'

type Bindings = {
  DB: D1Database
  MINIMAX_API_KEY: string
}

const app = new Hono<{ Bindings: Bindings }>()

// ── ミドルウェア ──────────────────────────────────────────────
app.use('*', logger())
app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// ── 静的ファイル ─────────────────────────────────────────────
app.use('/static/*', serveStatic({ root: './' }))

// ── APIルーティング ───────────────────────────────────────────
app.route('/api/auth', auth)
app.route('/api/characters', characters)
app.route('/api/memories', memories)
app.route('/api/minimax', minimaxRoutes)
app.route('/api/chat', chat)
app.route('/api/finetune', finetune)

// ── 記憶エイリアス API（/memories/ パス非使用） ──────────────
function getToken(c: any): string | undefined {
  return c.req.header('Authorization')?.replace('Bearer ', '')
}

// GET  /api/mem-list/:characterId  → 記憶一覧
app.get('/api/mem-list/:characterId', async (c) => {
  const user = await validateSession(c.env.DB, getToken(c))
  if (!user) return c.json({ success: false, error: '認証が必要です' }, 401)
  const characterId = c.req.param('characterId')
  const { results } = await c.env.DB.prepare(
    `SELECT m.* FROM memories m JOIN characters ch ON m.character_id = ch.id
     WHERE m.character_id = ? AND ch.user_id = ? ORDER BY m.created_at DESC`
  ).bind(characterId, user.id).all()
  return c.json({ success: true, data: results })
})

// POST /api/mem-save  → 記憶追加
app.post('/api/mem-save', async (c) => {
  const user = await validateSession(c.env.DB, getToken(c))
  if (!user) return c.json({ success: false, error: '認証が必要です' }, 401)
  const body = await c.req.json()
  const { character_id, title, content, period, location, emotion, source_type } = body
  if (!character_id || !title || !content) {
    return c.json({ success: false, error: 'character_id, title, content は必須です' }, 400)
  }
  const ch = await c.env.DB.prepare('SELECT id FROM characters WHERE id = ? AND user_id = ?').bind(character_id, user.id).first()
  if (!ch) return c.json({ success: false, error: 'キャラクターが見つかりません' }, 404)
  const result = await c.env.DB.prepare(
    `INSERT INTO memories (character_id, title, content, period, location, emotion, source_type)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    character_id, title, content,
    period || null, location || null, emotion || null,
    source_type || 'text'
  ).run()
  const newRow = await c.env.DB.prepare(
    'SELECT * FROM memories WHERE id = ?'
  ).bind(result.meta.last_row_id).first()
  return c.json({ success: true, data: newRow }, 201)
})

// PUT /api/mem-update/:id  → 記憶更新
app.put('/api/mem-update/:id', async (c) => {
  const user = await validateSession(c.env.DB, getToken(c))
  if (!user) return c.json({ success: false, error: '認証が必要です' }, 401)
  const id = c.req.param('id')
  const body = await c.req.json()
  const { title, content, period, location, emotion } = body
  await c.env.DB.prepare(
    `UPDATE memories SET
      title    = COALESCE(?, title),
      content  = COALESCE(?, content),
      period   = COALESCE(?, period),
      location = COALESCE(?, location),
      emotion  = COALESCE(?, emotion)
    WHERE id = ? AND character_id IN (SELECT id FROM characters WHERE user_id = ?)`
  ).bind(title || null, content || null, period || null, location || null, emotion || null, id, user.id).run()
  const updated = await c.env.DB.prepare('SELECT * FROM memories WHERE id = ?').bind(id).first()
  return c.json({ success: true, data: updated })
})

// DELETE /api/mem-delete/:id  → 記憶削除
app.delete('/api/mem-delete/:id', async (c) => {
  const user = await validateSession(c.env.DB, getToken(c))
  if (!user) return c.json({ success: false, error: '認証が必要です' }, 401)
  const id = c.req.param('id')
  await c.env.DB.prepare(
    'DELETE FROM memories WHERE id = ? AND character_id IN (SELECT id FROM characters WHERE user_id = ?)'
  ).bind(id, user.id).run()
  return c.json({ success: true, message: '削除しました' })
})

// ── ヘルスチェック ────────────────────────────────────────────
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    service: '記憶の声 API',
    version: '1.1.0',
    timestamp: new Date().toISOString(),
  })
})

// ── 利用規約・プライバシーポリシー ────────────────────────────
app.get('/terms', (c) => c.html(getTermsHTML()))
app.get('/privacy', (c) => c.html(getPrivacyHTML()))

// ── フロントエンド（SPA） ─────────────────────────────────────
app.get('*', (c) => {
  return c.html(getIndexHTML())
})

function getIndexHTML(): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>記憶の声 - AI記憶継承システム</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700&family=Noto+Serif+JP:wght@300;400;600&display=swap" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: { 'jp': ['"Noto Serif JP"', 'serif'], 'jp-sans': ['"Noto Sans JP"', 'sans-serif'] },
          colors: {
            navy: { 900: '#0f1a2e', 800: '#1a2540', 700: '#243357', 600: '#2e4170' },
            gold: { 500: '#d4a853', 400: '#ddb96a', 300: '#e6ca88' },
            cream: { 50: '#fefdf8', 100: '#fdf8ed', 200: '#f9f0d6' },
          }
        }
      }
    }
  </script>
  <style>
    body { font-family: 'Noto Sans JP', sans-serif; }
    .font-serif-jp { font-family: 'Noto Serif JP', serif; }
    .scrollbar-thin::-webkit-scrollbar { width: 4px; }
    .scrollbar-thin::-webkit-scrollbar-track { background: #1a2540; }
    .scrollbar-thin::-webkit-scrollbar-thumb { background: #d4a853; border-radius: 2px; }
    .chat-bubble-user { background: linear-gradient(135deg, #2e4170, #1a2540); }
    .chat-bubble-ai   { background: linear-gradient(135deg, #fdf8ed, #f9f0d6); }
    .wave-anim span { animation: wave 1.2s linear infinite; display: inline-block; }
    .wave-anim span:nth-child(2) { animation-delay: 0.2s; }
    .wave-anim span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes wave { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-6px); } }
    .recording-pulse { animation: pulse-red 1s infinite; }
    @keyframes pulse-red { 0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.4); } 50% { box-shadow: 0 0 0 10px rgba(239,68,68,0); } }
    .modal-overlay { background: rgba(15,26,46,0.85); backdrop-filter: blur(4px); }
    .tab-active { border-bottom: 2px solid #d4a853; color: #d4a853; }
    .vtab-active { border-bottom: 2px solid #d4a853; color: #d4a853; }
    input, textarea, select { font-family: 'Noto Sans JP', sans-serif; }
  </style>
</head>
<body class="bg-navy-900 text-white min-h-screen">

<!-- ── ヘッダー ── -->
<header class="bg-navy-800 border-b border-gold-500/30 px-6 py-3 flex items-center justify-between sticky top-0 z-40">
  <div class="flex items-center gap-3">
    <div class="w-9 h-9 rounded-full bg-gold-500/20 border border-gold-500/50 flex items-center justify-center">
      <i class="fas fa-dove text-gold-500 text-sm"></i>
    </div>
    <div>
      <h1 class="font-serif-jp text-lg font-semibold text-gold-400 leading-none">記憶の声</h1>
      <p class="text-xs text-gray-400">AI記憶継承システム</p>
    </div>
  </div>
  <div class="flex items-center gap-3">
    <span id="api-status" class="text-xs px-2 py-1 rounded-full bg-gray-700 text-gray-400">
      <i class="fas fa-circle text-xs mr-1"></i>確認中
    </span>
    <!-- ログイン前 -->
    <button id="btn-show-login" onclick="showAuthScreen()" class="text-xs px-3 py-1.5 rounded-lg bg-gold-500 text-navy-900 font-semibold hover:bg-gold-400 transition-colors hidden">
      <i class="fas fa-sign-in-alt mr-1"></i>ログイン
    </button>
    <!-- ログイン後 -->
    <div id="user-info" class="hidden flex items-center gap-2">
      <span id="user-email-display" class="text-xs text-gray-400 max-w-[140px] truncate"></span>
      <button onclick="logout()" class="text-xs px-3 py-1.5 rounded-lg bg-navy-700 border border-white/10 text-gray-300 hover:text-white hover:border-white/30 transition-colors">
        <i class="fas fa-sign-out-alt mr-1"></i>ログアウト
      </button>
    </div>
  </div>
</header>

<!-- ── 認証画面オーバーレイ ── -->
<div id="auth-screen" class="fixed inset-0 z-50 bg-navy-900 flex items-center justify-center p-4">
  <div class="w-full max-w-md">
    <!-- ロゴ -->
    <div class="text-center mb-8">
      <div class="w-16 h-16 rounded-full bg-gold-500/20 border border-gold-500/50 flex items-center justify-center mx-auto mb-4">
        <i class="fas fa-dove text-gold-500 text-2xl"></i>
      </div>
      <h1 class="font-serif-jp text-2xl font-semibold text-gold-400">記憶の声</h1>
      <p class="text-sm text-gray-400 mt-1">AI記憶継承システム</p>
    </div>

    <!-- タブ切替 -->
    <div class="flex rounded-lg bg-navy-800 border border-white/10 p-1 mb-6">
      <button id="auth-tab-login" onclick="switchAuthTab('login')"
        class="flex-1 py-2 text-sm font-medium rounded-md bg-gold-500 text-navy-900 transition-colors">ログイン</button>
      <button id="auth-tab-register" onclick="switchAuthTab('register')"
        class="flex-1 py-2 text-sm font-medium text-gray-400 hover:text-white rounded-md transition-colors">新規登録</button>
    </div>

    <!-- ログインフォーム -->
    <div id="auth-form-login">
      <div class="space-y-4">
        <div>
          <label class="block text-xs text-gray-400 mb-1">メールアドレス</label>
          <input id="login-email" type="email" placeholder="example@email.com"
            class="w-full px-4 py-2.5 rounded-lg bg-navy-800 border border-white/10 text-white text-sm focus:border-gold-500/50 focus:outline-none">
        </div>
        <div>
          <label class="block text-xs text-gray-400 mb-1">パスワード</label>
          <input id="login-password" type="password" placeholder="パスワードを入力"
            class="w-full px-4 py-2.5 rounded-lg bg-navy-800 border border-white/10 text-white text-sm focus:border-gold-500/50 focus:outline-none"
            onkeydown="if(event.key==='Enter')doLogin()">
        </div>
        <p id="login-error" class="text-red-400 text-xs hidden"></p>
        <button onclick="doLogin()"
          class="w-full py-2.5 rounded-lg bg-gold-500 text-navy-900 font-semibold text-sm hover:bg-gold-400 transition-colors flex items-center justify-center gap-2">
          <i class="fas fa-sign-in-alt"></i>ログイン
        </button>
      </div>
    </div>

    <!-- 新規登録フォーム -->
    <div id="auth-form-register" class="hidden">
      <div class="space-y-4">
        <div>
          <label class="block text-xs text-gray-400 mb-1">メールアドレス</label>
          <input id="reg-email" type="email" placeholder="example@email.com"
            class="w-full px-4 py-2.5 rounded-lg bg-navy-800 border border-white/10 text-white text-sm focus:border-gold-500/50 focus:outline-none">
        </div>
        <div>
          <label class="block text-xs text-gray-400 mb-1">パスワード（8文字以上）</label>
          <input id="reg-password" type="password" placeholder="パスワードを設定"
            class="w-full px-4 py-2.5 rounded-lg bg-navy-800 border border-white/10 text-white text-sm focus:border-gold-500/50 focus:outline-none">
        </div>
        <div>
          <label class="block text-xs text-gray-400 mb-1">パスワード（確認）</label>
          <input id="reg-password2" type="password" placeholder="パスワードを再入力"
            class="w-full px-4 py-2.5 rounded-lg bg-navy-800 border border-white/10 text-white text-sm focus:border-gold-500/50 focus:outline-none"
            onkeydown="if(event.key==='Enter')doRegister()">
        </div>
        <!-- 規約同意 -->
        <div class="bg-navy-800 border border-white/10 rounded-lg p-3 text-xs text-gray-400 leading-relaxed">
          アカウントを作成することで、
          <a href="/terms" target="_blank" class="text-gold-400 hover:underline">利用規約</a>
          および
          <a href="/privacy" target="_blank" class="text-gold-400 hover:underline">プライバシーポリシー</a>
          に同意したものとみなします。
        </div>
        <label class="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" id="reg-agree"
            class="mt-0.5 w-4 h-4 rounded border-gray-400 text-gold-500 focus:ring-gold-500">
          <span class="text-xs text-gray-300">
            <a href="/terms" target="_blank" class="text-gold-400 hover:underline">利用規約</a>および
            <a href="/privacy" target="_blank" class="text-gold-400 hover:underline">プライバシーポリシー</a>に同意します
          </span>
        </label>
        <p id="reg-error" class="text-red-400 text-xs hidden"></p>
        <button onclick="doRegister()"
          class="w-full py-2.5 rounded-lg bg-gold-500 text-navy-900 font-semibold text-sm hover:bg-gold-400 transition-colors flex items-center justify-center gap-2">
          <i class="fas fa-user-plus"></i>アカウントを作成
        </button>
      </div>
    </div>
  </div>
</div>

<!-- ── メインレイアウト ── -->
<div class="flex h-[calc(100vh-57px)]">

  <!-- サイドバー -->
  <aside class="w-72 bg-navy-800 border-r border-white/10 flex flex-col">
    <!-- タブ -->
    <div class="flex border-b border-white/10">
      <button onclick="switchSideTab('characters')" id="tab-characters"
        class="flex-1 py-3 text-xs font-medium tab-active transition-colors">
        <i class="fas fa-user-circle mr-1"></i>キャラクター
      </button>
      <button onclick="switchSideTab('memories')" id="tab-memories"
        class="flex-1 py-3 text-xs font-medium text-gray-400 hover:text-white transition-colors">
        <i class="fas fa-book-open mr-1"></i>記憶
      </button>
      <button onclick="switchSideTab('tools')" id="tab-tools"
        class="flex-1 py-3 text-xs font-medium text-gray-400 hover:text-white transition-colors">
        <i class="fas fa-tools mr-1"></i>ツール
      </button>
    </div>

    <!-- キャラクタータブ -->
    <div id="panel-characters" class="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-2">
      <button onclick="openModal('modal-new-character')"
        class="w-full py-2 px-3 rounded-lg border border-gold-500/40 text-gold-400 text-sm hover:bg-gold-500/10 transition-colors flex items-center gap-2">
        <i class="fas fa-plus"></i> 新しいキャラクター
      </button>
      <div id="character-list" class="space-y-2">
        <div class="text-center py-8 text-gray-500 text-sm">
          <i class="fas fa-spinner fa-spin text-2xl mb-2 block"></i>読み込み中...
        </div>
      </div>
    </div>

    <!-- 記憶タブ -->
    <div id="panel-memories" class="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-2 hidden">
      <button onclick="openModal('modal-new-memory')" id="btn-add-memory" disabled
        class="w-full py-2 px-3 rounded-lg border border-gold-500/40 text-gold-400 text-sm hover:bg-gold-500/10 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed">
        <i class="fas fa-plus"></i> 記憶を追加
      </button>
      <div id="memory-list" class="space-y-2">
        <div class="text-center py-8 text-gray-500 text-sm">キャラクターを選択してください</div>
      </div>
    </div>

    <!-- ツールタブ -->
    <div id="panel-tools" class="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-3 hidden">
      <div class="text-xs text-gray-400 uppercase tracking-wider mb-2">声の設定</div>
      <button onclick="openVoiceModal()" id="btn-voice-clone" disabled
        class="w-full py-2.5 px-3 rounded-lg bg-navy-700 border border-white/10 text-sm hover:border-gold-500/40 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed">
        <i class="fas fa-microphone-alt text-gold-400"></i>
        <div class="text-left">
          <div class="text-white text-xs font-medium">声を設定する</div>
          <div class="text-gray-400 text-xs">プリセット・ID入力・クローン</div>
        </div>
      </button>

      <div class="text-xs text-gray-400 uppercase tracking-wider mt-4 mb-2">学習データ</div>
      <button onclick="exportDataset()" id="btn-export" disabled
        class="w-full py-2.5 px-3 rounded-lg bg-navy-700 border border-white/10 text-sm hover:border-gold-500/40 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed">
        <i class="fas fa-file-export text-blue-400"></i>
        <div class="text-left">
          <div class="text-white text-xs font-medium">JSONLエクスポート</div>
          <div class="text-gray-400 text-xs">LoRA学習用データセット</div>
        </div>
      </button>
      <button onclick="downloadTrainScript()" id="btn-script" disabled
        class="w-full py-2.5 px-3 rounded-lg bg-navy-700 border border-white/10 text-sm hover:border-gold-500/40 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed">
        <i class="fas fa-code text-purple-400"></i>
        <div class="text-left">
          <div class="text-white text-xs font-medium">学習スクリプト生成</div>
          <div class="text-gray-400 text-xs">Gemma 4 QLoRA用Pythonコード</div>
        </div>
      </button>
      <button onclick="downloadInferenceScript()" id="btn-inf-script" disabled
        class="w-full py-2.5 px-3 rounded-lg bg-navy-700 border border-white/10 text-sm hover:border-gold-500/40 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed">
        <i class="fas fa-terminal text-green-400"></i>
        <div class="text-left">
          <div class="text-white text-xs font-medium">推論スクリプト生成</div>
          <div class="text-gray-400 text-xs">LoRAアダプタで会話実行</div>
        </div>
      </button>

      <div class="text-xs text-gray-400 uppercase tracking-wider mt-4 mb-2">会話管理</div>
      <button onclick="clearHistory()" id="btn-clear-history" disabled
        class="w-full py-2.5 px-3 rounded-lg bg-navy-700 border border-white/10 text-sm hover:border-red-500/40 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed text-red-400">
        <i class="fas fa-trash"></i>
        <div class="text-left">
          <div class="text-xs font-medium">会話履歴をクリア</div>
        </div>
      </button>
    </div>
  </aside>

  <!-- メインコンテンツ -->
  <main class="flex-1 flex flex-col overflow-hidden">

    <!-- キャラクター情報バー -->
    <div id="character-bar" class="bg-navy-800 border-b border-white/10 px-6 py-3 hidden">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div id="char-avatar" class="w-10 h-10 rounded-full bg-gold-500/20 border-2 border-gold-500/50 flex items-center justify-center text-lg">👵</div>
          <div>
            <h2 id="char-name" class="font-serif-jp font-semibold text-gold-400"></h2>
            <p id="char-desc" class="text-xs text-gray-400"></p>
          </div>
        </div>
        <div id="voice-badge" class="hidden text-xs px-3 py-1 rounded-full bg-gold-500/20 border border-gold-500/40 text-gold-400 cursor-pointer hover:bg-gold-500/30 transition-colors" onclick="openModal('modal-voice-clone')" title="声の設定を変更">
          <i class="fas fa-microphone-alt mr-1"></i><span id="voice-badge-text">声設定済み</span>
        </div>
      </div>
    </div>

    <!-- チャット画面 -->
    <div id="chat-area" class="flex-1 overflow-y-auto scrollbar-thin p-6 space-y-4 bg-navy-900">
      <div id="empty-state" class="flex flex-col items-center justify-center h-full text-center">
        <div class="w-20 h-20 rounded-full bg-navy-800 border border-gold-500/30 flex items-center justify-center mb-4">
          <i class="fas fa-dove text-gold-500 text-3xl"></i>
        </div>
        <h3 class="font-serif-jp text-xl text-gold-400 mb-2">記憶の声へようこそ</h3>
        <p class="text-gray-400 text-sm max-w-xs">
          左のサイドバーからキャラクターを選択するか、新しいキャラクターを作成してください。
        </p>
      </div>
    </div>

    <!-- 入力エリア -->
    <div class="bg-navy-800 border-t border-white/10 p-4">
      <div class="flex items-end gap-3 max-w-4xl mx-auto">
        <button id="btn-mic" onclick="toggleRecording()"
          class="w-12 h-12 rounded-full bg-navy-700 border border-white/20 flex items-center justify-center hover:border-red-400 transition-all flex-shrink-0"
          title="音声入力">
          <i id="mic-icon" class="fas fa-microphone text-gray-400"></i>
        </button>
        <div class="flex-1 relative">
          <textarea id="chat-input"
            class="w-full bg-navy-900 border border-white/20 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:border-gold-500/50 transition-colors leading-relaxed"
            placeholder="メッセージを入力…（Enterで送信、Shift+Enterで改行）"
            rows="1"
            onkeydown="handleInputKeydown(event)"
            oninput="autoResize(this)"></textarea>
          <div id="recording-indicator" class="hidden absolute inset-0 rounded-xl bg-red-500/10 border border-red-500/50 flex items-center justify-center">
            <span class="text-red-400 text-sm wave-anim">
              <span>●</span><span>●</span><span>●</span>
            </span>
            <span class="text-red-400 text-sm ml-2">録音中...</span>
          </div>
        </div>
        <button id="btn-tts-toggle" onclick="toggleTTS()"
          class="h-12 rounded-full bg-navy-700 border border-gold-500/40 flex items-center justify-center gap-1.5 hover:border-gold-400 transition-all flex-shrink-0 px-3"
          title="チャット時の自動再生 ON/OFF">
          <i id="tts-icon" class="fas fa-volume-up text-gold-400 text-sm"></i>
          <span id="tts-label" class="text-xs text-gold-400 whitespace-nowrap">自動再生 ON</span>
        </button>
        <button id="btn-send" onclick="sendMessage()"
          class="w-12 h-12 rounded-full bg-gold-500 flex items-center justify-center hover:bg-gold-400 transition-colors flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          title="送信">
          <i class="fas fa-paper-plane text-navy-900"></i>
        </button>
      </div>
      <p class="text-center text-xs text-gray-600 mt-2">
        <i class="fas fa-shield-alt mr-1"></i>会話内容はローカルに保存されます
      </p>
    </div>
  </main>
</div>

<!-- ═══════════════ モーダル群 ═══════════════ -->

<!-- 新規キャラクター作成 -->
<div id="modal-new-character" class="hidden fixed inset-0 modal-overlay z-50 flex items-center justify-center p-4">
  <div class="bg-navy-800 rounded-2xl border border-white/20 w-full max-w-md shadow-2xl">
    <div class="flex items-center justify-between p-5 border-b border-white/10">
      <h3 class="font-serif-jp text-gold-400 font-semibold text-lg">新しいキャラクター</h3>
      <button onclick="closeModal('modal-new-character')" class="text-gray-400 hover:text-white"><i class="fas fa-times"></i></button>
    </div>
    <div class="p-5 space-y-4">
      <div>
        <label class="block text-xs text-gray-400 mb-1">名前 <span class="text-red-400">*</span></label>
        <input id="new-char-name" type="text" placeholder="例: 田中ハナ"
          class="w-full bg-navy-900 border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gold-500/50">
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs text-gray-400 mb-1">年齢</label>
          <input id="new-char-age" type="number" placeholder="例: 82"
            class="w-full bg-navy-900 border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gold-500/50">
        </div>
        <div>
          <label class="block text-xs text-gray-400 mb-1">出身地</label>
          <input id="new-char-birthplace" type="text" placeholder="例: 京都府"
            class="w-full bg-navy-900 border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gold-500/50">
        </div>
      </div>
      <div>
        <label class="block text-xs text-gray-400 mb-1">人物像・特徴</label>
        <textarea id="new-char-desc" rows="3" placeholder="例: 織物が好きで穏やかな語り口の女性。"
          class="w-full bg-navy-900 border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gold-500/50 resize-none"></textarea>
      </div>
    </div>
    <div class="flex gap-3 p-5 pt-0">
      <button onclick="closeModal('modal-new-character')"
        class="flex-1 py-2 rounded-lg border border-white/20 text-sm text-gray-400 hover:text-white transition-colors">キャンセル</button>
      <button onclick="createCharacter()"
        class="flex-1 py-2 rounded-lg bg-gold-500 text-navy-900 text-sm font-semibold hover:bg-gold-400 transition-colors">作成する</button>
    </div>
  </div>
</div>

<!-- 新規記憶追加 -->
<div id="modal-new-memory" class="hidden fixed inset-0 modal-overlay z-50 flex items-center justify-center p-4">
  <div class="bg-navy-800 rounded-2xl border border-white/20 w-full max-w-lg shadow-2xl">
    <div class="flex items-center justify-between p-5 border-b border-white/10">
      <h3 class="font-serif-jp text-gold-400 font-semibold text-lg">記憶を追加</h3>
      <button onclick="closeModal('modal-new-memory')" class="text-gray-400 hover:text-white"><i class="fas fa-times"></i></button>
    </div>
    <div class="p-5 space-y-4">
      <div>
        <label class="block text-xs text-gray-400 mb-1">タイトル <span class="text-red-400">*</span></label>
        <input id="new-mem-title" type="text" placeholder="例: 父の機織り機"
          class="w-full bg-navy-900 border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gold-500/50">
      </div>
      <div class="grid grid-cols-3 gap-3">
        <div>
          <label class="block text-xs text-gray-400 mb-1">時期</label>
          <input id="new-mem-period" type="text" placeholder="例: 1960年代"
            class="w-full bg-navy-900 border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gold-500/50">
        </div>
        <div>
          <label class="block text-xs text-gray-400 mb-1">場所</label>
          <input id="new-mem-location" type="text" placeholder="例: 実家"
            class="w-full bg-navy-900 border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gold-500/50">
        </div>
        <div>
          <label class="block text-xs text-gray-400 mb-1">感情</label>
          <input id="new-mem-emotion" type="text" placeholder="例: 懐かしい"
            class="w-full bg-navy-900 border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gold-500/50">
        </div>
      </div>
      <div>
        <label class="block text-xs text-gray-400 mb-1">内容 <span class="text-red-400">*</span></label>
        <textarea id="new-mem-content" rows="5" placeholder="記憶・エピソードの詳細を書いてください"
          class="w-full bg-navy-900 border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gold-500/50 resize-none"></textarea>
      </div>
    </div>
    <div class="flex gap-3 p-5 pt-0">
      <button onclick="closeModal('modal-new-memory')"
        class="flex-1 py-2 rounded-lg border border-white/20 text-sm text-gray-400 hover:text-white transition-colors">キャンセル</button>
      <button onclick="addMemory()"
        class="flex-1 py-2 rounded-lg bg-gold-500 text-navy-900 text-sm font-semibold hover:bg-gold-400 transition-colors">追加する</button>
    </div>
  </div>
</div>

<!-- 記憶編集 -->
<div id="modal-edit-memory" class="hidden fixed inset-0 modal-overlay z-50 flex items-center justify-center p-4">
  <div class="bg-navy-800 rounded-2xl border border-white/20 w-full max-w-lg shadow-2xl">
    <div class="flex items-center justify-between p-5 border-b border-white/10">
      <h3 class="font-serif-jp text-gold-400 font-semibold text-lg"><i class="fas fa-pen mr-2 text-base"></i>記憶を編集</h3>
      <button onclick="closeModal('modal-edit-memory')" class="text-gray-400 hover:text-white"><i class="fas fa-times"></i></button>
    </div>
    <div class="p-5 space-y-4">
      <input type="hidden" id="edit-mem-id">
      <div>
        <label class="block text-xs text-gray-400 mb-1">タイトル <span class="text-red-400">*</span></label>
        <input id="edit-mem-title" type="text" placeholder="例: 父の機織り機"
          class="w-full bg-navy-900 border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gold-500/50">
      </div>
      <div class="grid grid-cols-3 gap-3">
        <div>
          <label class="block text-xs text-gray-400 mb-1">時期</label>
          <input id="edit-mem-period" type="text" placeholder="例: 1960年代"
            class="w-full bg-navy-900 border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gold-500/50">
        </div>
        <div>
          <label class="block text-xs text-gray-400 mb-1">場所</label>
          <input id="edit-mem-location" type="text" placeholder="例: 実家"
            class="w-full bg-navy-900 border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gold-500/50">
        </div>
        <div>
          <label class="block text-xs text-gray-400 mb-1">感情</label>
          <input id="edit-mem-emotion" type="text" placeholder="例: 懐かしい"
            class="w-full bg-navy-900 border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gold-500/50">
        </div>
      </div>
      <div>
        <label class="block text-xs text-gray-400 mb-1">内容 <span class="text-red-400">*</span></label>
        <textarea id="edit-mem-content" rows="6" placeholder="記憶・エピソードの詳細"
          class="w-full bg-navy-900 border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gold-500/50 resize-none leading-relaxed"></textarea>
      </div>
    </div>
    <div class="flex gap-3 p-5 pt-0">
      <button onclick="closeModal('modal-edit-memory')"
        class="flex-1 py-2 rounded-lg border border-white/20 text-sm text-gray-400 hover:text-white transition-colors">キャンセル</button>
      <button onclick="saveEditMemory()"
        class="flex-1 py-2 rounded-lg bg-gold-500 text-navy-900 text-sm font-semibold hover:bg-gold-400 transition-colors">
        <i class="fas fa-save mr-1"></i>保存する</button>
    </div>
  </div>
</div>

<!-- 声設定モーダル（プリセット / Voice ID直接入力 / ボイスクローン） -->
<div id="modal-voice-clone" class="hidden fixed inset-0 modal-overlay z-50 flex items-center justify-center p-4">
  <div class="bg-navy-800 rounded-2xl border border-white/20 w-full max-w-lg shadow-2xl">
    <div class="flex items-center justify-between p-5 border-b border-white/10">
      <h3 class="font-serif-jp text-gold-400 font-semibold text-lg"><i class="fas fa-microphone-alt mr-2 text-base"></i>声の設定</h3>
      <button onclick="closeModal('modal-voice-clone')" class="text-gray-400 hover:text-white"><i class="fas fa-times"></i></button>
    </div>

    <!-- 現在の設定表示 -->
    <div class="px-5 pt-4 pb-0">
      <div class="flex items-center gap-2 bg-navy-900/60 rounded-lg px-3 py-2 text-xs text-gray-400 border border-white/10">
        <i class="fas fa-info-circle text-gold-400"></i>
        現在のVoice ID:
        <span id="current-voice-display" class="text-gold-300 font-mono ml-1">未設定</span>
        <button onclick="clearVoiceId()" class="ml-auto text-red-400 hover:text-red-300 text-xs" title="声設定をクリア">
          <i class="fas fa-times-circle mr-1"></i>クリア
        </button>
      </div>
    </div>

    <!-- タブ -->
    <div class="flex border-b border-white/10 mx-5 mt-4">
      <button onclick="switchVoiceTab('preset')" id="vtab-preset"
        class="flex-1 py-2.5 text-xs font-medium vtab-active transition-colors">
        <i class="fas fa-list mr-1"></i>プリセット
      </button>
      <button onclick="switchVoiceTab('custom')" id="vtab-custom"
        class="flex-1 py-2.5 text-xs font-medium text-gray-400 hover:text-white transition-colors">
        <i class="fas fa-keyboard mr-1"></i>ID直接入力
      </button>
      <button onclick="switchVoiceTab('clone')" id="vtab-clone"
        class="flex-1 py-2.5 text-xs font-medium text-gray-400 hover:text-white transition-colors">
        <i class="fas fa-clone mr-1"></i>ボイスクローン
      </button>
    </div>

    <!-- プリセット選択パネル -->
    <div id="vpanel-preset" class="p-5">
      <p class="text-xs text-gray-400 mb-3">MiniMax標準ボイスから選択してください。</p>
      <div id="preset-voice-list" class="grid grid-cols-1 gap-2">
        <!-- JS で生成 -->
      </div>
    </div>

    <!-- Voice ID 直接入力パネル -->
    <div id="vpanel-custom" class="p-5 hidden">
      <p class="text-xs text-gray-400 mb-3">
        MiniMaxのVoice IDを直接入力します。プリセットID（例: <code class="text-gold-300">Wise_Woman</code>）やクローン済みID（例: <code class="text-gold-300">clone_1_...</code>）が使用できます。
      </p>
      <div>
        <label class="block text-xs text-gray-400 mb-1">Voice ID <span class="text-red-400">*</span></label>
        <input id="custom-voice-id-input" type="text" placeholder="例: Wise_Woman  /  clone_1_1234567890"
          class="w-full bg-navy-900 border border-white/20 rounded-lg px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-gold-500/50 placeholder-gray-600">
      </div>
      <div class="mt-4 flex gap-3">
        <button onclick="closeModal('modal-voice-clone')"
          class="flex-1 py-2 rounded-lg border border-white/20 text-sm text-gray-400 hover:text-white transition-colors">キャンセル</button>
        <button onclick="saveCustomVoiceId()"
          class="flex-1 py-2 rounded-lg bg-gold-500 text-navy-900 text-sm font-semibold hover:bg-gold-400 transition-colors">
          <i class="fas fa-save mr-1"></i>保存する
        </button>
      </div>
    </div>

    <!-- ボイスクローンパネル -->
    <div id="vpanel-clone" class="p-5 hidden">
      <div class="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 text-xs text-blue-300 mb-4">
        <i class="fas fa-info-circle mr-1"></i>
        10〜60秒以上の音声サンプル（MP3/WAV/M4A）をアップロードすると、その声色を再現したVoice IDが自動生成・設定されます。
      </div>
      <div>
        <label class="block text-xs text-gray-400 mb-1">音声サンプルファイル <span class="text-red-400">*</span></label>
        <label class="w-full flex flex-col items-center justify-center py-6 border-2 border-dashed border-white/20 rounded-xl cursor-pointer hover:border-gold-500/40 transition-colors">
          <i class="fas fa-cloud-upload-alt text-3xl text-gray-500 mb-2"></i>
          <span class="text-sm text-gray-400" id="voice-file-label">クリックしてファイルを選択</span>
          <span class="text-xs text-gray-600 mt-1">MP3, WAV, M4A（最大50MB）</span>
          <input type="file" id="voice-file-input" accept="audio/*" class="hidden" onchange="onVoiceFileSelected(this)">
        </label>
      </div>
      <div class="mt-4 flex gap-3">
        <button onclick="closeModal('modal-voice-clone')"
          class="flex-1 py-2 rounded-lg border border-white/20 text-sm text-gray-400 hover:text-white transition-colors">キャンセル</button>
        <button onclick="startVoiceClone()" id="btn-clone-start"
          class="flex-1 py-2 rounded-lg bg-gold-500 text-navy-900 text-sm font-semibold hover:bg-gold-400 transition-colors flex items-center justify-center gap-2">
          <i class="fas fa-microphone-alt"></i>クローン開始
        </button>
      </div>
    </div>
  </div>
</div>

<!-- トースト通知 -->
<div id="toast" class="hidden fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl shadow-2xl text-sm font-medium transition-all"></div>

<!-- JSは外部ファイルから読み込み（テンプレートリテラルのエスケープ問題を回避） -->
<script src="/static/app.js"></script>
</body>
</html>`
}

// ── 利用規約 HTML ──────────────────────────────────────────
function getTermsHTML(): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>利用規約 - 記憶の声</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700&family=Noto+Serif+JP:wght@400;600&display=swap" rel="stylesheet">
  <style>body { font-family: 'Noto Sans JP', sans-serif; } .font-serif-jp { font-family: 'Noto Serif JP', serif; }</style>
</head>
<body class="bg-gray-50 text-gray-800 min-h-screen">
  <header class="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
    <a href="/" class="font-serif-jp text-xl font-semibold text-indigo-800">記憶の声</a>
    <a href="/" class="text-sm text-indigo-600 hover:underline">← トップへ戻る</a>
  </header>
  <main class="max-w-3xl mx-auto px-6 py-12">
    <h1 class="font-serif-jp text-3xl font-bold text-gray-900 mb-2">利用規約</h1>
    <p class="text-sm text-gray-500 mb-10">最終更新日: 2026年4月6日</p>

    <section class="mb-8">
      <h2 class="text-lg font-bold text-gray-800 mb-3 border-l-4 border-indigo-500 pl-3">第1条（目的）</h2>
      <p class="text-sm leading-7 text-gray-700">本利用規約（以下「本規約」）は、坂本義志（以下「運営者」）が提供する「記憶の声」（以下「本サービス」）の利用条件を定めるものです。ユーザーは本規約に同意のうえ、本サービスをご利用ください。</p>
    </section>

    <section class="mb-8">
      <h2 class="text-lg font-bold text-gray-800 mb-3 border-l-4 border-indigo-500 pl-3">第2条（サービスの内容）</h2>
      <p class="text-sm leading-7 text-gray-700">本サービスは、ユーザーが登録したキャラクター情報および記憶データをもとに、AIが対話を行う「AI記憶継承システム」です。音声合成・音声認識機能を含みます。</p>
    </section>

    <section class="mb-8">
      <h2 class="text-lg font-bold text-gray-800 mb-3 border-l-4 border-indigo-500 pl-3">第3条（アカウント登録）</h2>
      <ul class="text-sm leading-7 text-gray-700 list-disc list-inside space-y-1">
        <li>ユーザーは正確な情報を用いてアカウントを登録するものとします。</li>
        <li>アカウントの管理はユーザー自身の責任とします。</li>
        <li>パスワードの管理を怠ったことによる損害について、運営者は責任を負いません。</li>
        <li>1人につき1アカウントを原則とします。</li>
      </ul>
    </section>

    <section class="mb-8">
      <h2 class="text-lg font-bold text-gray-800 mb-3 border-l-4 border-indigo-500 pl-3">第4条（禁止事項）</h2>
      <p class="text-sm leading-7 text-gray-700 mb-2">ユーザーは以下の行為を行ってはなりません。</p>
      <ul class="text-sm leading-7 text-gray-700 list-disc list-inside space-y-1">
        <li>他者のなりすましや虚偽情報の登録</li>
        <li>本サービスの不正アクセス・リバースエンジニアリング</li>
        <li>他のユーザーや第三者への迷惑行為</li>
        <li>違法なコンテンツの登録・送信</li>
        <li>本サービスの商業的無断利用</li>
        <li>その他、運営者が不適切と判断する行為</li>
      </ul>
    </section>

    <section class="mb-8">
      <h2 class="text-lg font-bold text-gray-800 mb-3 border-l-4 border-indigo-500 pl-3">第5条（サービスの変更・中断）</h2>
      <p class="text-sm leading-7 text-gray-700">運営者は、ユーザーへの事前通知なく、本サービスの内容を変更・中断・終了することができます。これにより生じた損害について、運営者は責任を負いません。</p>
    </section>

    <section class="mb-8">
      <h2 class="text-lg font-bold text-gray-800 mb-3 border-l-4 border-indigo-500 pl-3">第6条（免責事項）</h2>
      <ul class="text-sm leading-7 text-gray-700 list-disc list-inside space-y-1">
        <li>AIが生成するコンテンツの正確性・適切性について、運営者は保証しません。</li>
        <li>本サービスの利用によって生じた損害について、運営者は責任を負いません。</li>
        <li>外部API（MiniMax等）の障害による損害についても同様です。</li>
      </ul>
    </section>

    <section class="mb-8">
      <h2 class="text-lg font-bold text-gray-800 mb-3 border-l-4 border-indigo-500 pl-3">第7条（準拠法・管轄）</h2>
      <p class="text-sm leading-7 text-gray-700">本規約は日本法に準拠し、紛争が生じた場合は運営者の所在地を管轄する裁判所を専属的合意管轄とします。</p>
    </section>

    <section class="mb-8">
      <h2 class="text-lg font-bold text-gray-800 mb-3 border-l-4 border-indigo-500 pl-3">第8条（お問い合わせ）</h2>
      <p class="text-sm leading-7 text-gray-700">本規約に関するお問い合わせは下記までご連絡ください。</p>
      <div class="mt-3 bg-white border border-gray-200 rounded-lg p-4 text-sm text-gray-700">
        <p class="font-medium">運営者: 坂本義志</p>
        <p>メールアドレス: <a href="mailto:elixir2761@gmail.com" class="text-indigo-600 hover:underline">elixir2761@gmail.com</a></p>
      </div>
    </section>
  </main>
  <footer class="border-t border-gray-200 text-center py-6 text-xs text-gray-400">
    © 2026 坂本義志 / 記憶の声
  </footer>
</body>
</html>`
}

// ── プライバシーポリシー HTML ──────────────────────────────
function getPrivacyHTML(): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>プライバシーポリシー - 記憶の声</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700&family=Noto+Serif+JP:wght@400;600&display=swap" rel="stylesheet">
  <style>body { font-family: 'Noto Sans JP', sans-serif; } .font-serif-jp { font-family: 'Noto Serif JP', serif; }</style>
</head>
<body class="bg-gray-50 text-gray-800 min-h-screen">
  <header class="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
    <a href="/" class="font-serif-jp text-xl font-semibold text-indigo-800">記憶の声</a>
    <a href="/" class="text-sm text-indigo-600 hover:underline">← トップへ戻る</a>
  </header>
  <main class="max-w-3xl mx-auto px-6 py-12">
    <h1 class="font-serif-jp text-3xl font-bold text-gray-900 mb-2">プライバシーポリシー</h1>
    <p class="text-sm text-gray-500 mb-10">最終更新日: 2026年4月6日</p>

    <section class="mb-8">
      <h2 class="text-lg font-bold text-gray-800 mb-3 border-l-4 border-indigo-500 pl-3">1. 収集する情報</h2>
      <p class="text-sm leading-7 text-gray-700 mb-2">本サービスでは以下の情報を収集します。</p>
      <ul class="text-sm leading-7 text-gray-700 list-disc list-inside space-y-1">
        <li><strong>アカウント情報:</strong> メールアドレス・パスワード（ハッシュ化して保存）</li>
        <li><strong>コンテンツ情報:</strong> キャラクター情報、記憶データ、会話履歴</li>
        <li><strong>音声データ:</strong> 音声認識のために送信された音声ファイル（一時処理のみ、保存なし）</li>
        <li><strong>利用ログ:</strong> アクセス日時、利用状況（個人を特定しない形式）</li>
      </ul>
    </section>

    <section class="mb-8">
      <h2 class="text-lg font-bold text-gray-800 mb-3 border-l-4 border-indigo-500 pl-3">2. 情報の利用目的</h2>
      <ul class="text-sm leading-7 text-gray-700 list-disc list-inside space-y-1">
        <li>本サービスの提供・運営・改善</li>
        <li>ユーザー認証・アカウント管理</li>
        <li>AI会話機能の実現（外部AI APIへの必要最小限の送信）</li>
        <li>不正利用の防止・セキュリティ確保</li>
      </ul>
    </section>

    <section class="mb-8">
      <h2 class="text-lg font-bold text-gray-800 mb-3 border-l-4 border-indigo-500 pl-3">3. 第三者への提供</h2>
      <p class="text-sm leading-7 text-gray-700 mb-2">ユーザーの個人情報を第三者に販売・提供することはありません。ただし、以下の場合は除きます。</p>
      <ul class="text-sm leading-7 text-gray-700 list-disc list-inside space-y-1">
        <li>ユーザーの同意がある場合</li>
        <li>法令に基づく場合</li>
        <li>サービス提供に必要な業務委託先（MiniMax API等）への提供（必要最小限）</li>
      </ul>
    </section>

    <section class="mb-8">
      <h2 class="text-lg font-bold text-gray-800 mb-3 border-l-4 border-indigo-500 pl-3">4. 外部サービスの利用</h2>
      <p class="text-sm leading-7 text-gray-700 mb-2">本サービスは以下の外部サービスを利用します。</p>
      <ul class="text-sm leading-7 text-gray-700 list-disc list-inside space-y-1">
        <li><strong>MiniMax API:</strong> AI会話・音声合成・音声認識の処理。テキスト・音声データが送信されます。</li>
        <li><strong>Cloudflare:</strong> サービスのホスティング・データベース管理。</li>
      </ul>
    </section>

    <section class="mb-8">
      <h2 class="text-lg font-bold text-gray-800 mb-3 border-l-4 border-indigo-500 pl-3">5. データの保管・セキュリティ</h2>
      <ul class="text-sm leading-7 text-gray-700 list-disc list-inside space-y-1">
        <li>パスワードはSHA-256でハッシュ化し、平文では保存しません。</li>
        <li>通信はHTTPS（TLS）で暗号化されます。</li>
        <li>データはCloudflare D1データベースに保管されます。</li>
      </ul>
    </section>

    <section class="mb-8">
      <h2 class="text-lg font-bold text-gray-800 mb-3 border-l-4 border-indigo-500 pl-3">6. ユーザーの権利</h2>
      <p class="text-sm leading-7 text-gray-700">ユーザーは自身のデータについて、開示・訂正・削除を求める権利を有します。ご希望の場合は下記のお問い合わせ先までご連絡ください。</p>
    </section>

    <section class="mb-8">
      <h2 class="text-lg font-bold text-gray-800 mb-3 border-l-4 border-indigo-500 pl-3">7. Cookieおよびローカルストレージ</h2>
      <p class="text-sm leading-7 text-gray-700">本サービスはセッション管理のためにブラウザのlocalStorageを利用します。セッショントークンはサーバー側でも検証されます。</p>
    </section>

    <section class="mb-8">
      <h2 class="text-lg font-bold text-gray-800 mb-3 border-l-4 border-indigo-500 pl-3">8. 改定</h2>
      <p class="text-sm leading-7 text-gray-700">本ポリシーは予告なく改定する場合があります。重要な変更の場合はサービス上でお知らせします。</p>
    </section>

    <section class="mb-8">
      <h2 class="text-lg font-bold text-gray-800 mb-3 border-l-4 border-indigo-500 pl-3">9. お問い合わせ</h2>
      <div class="bg-white border border-gray-200 rounded-lg p-4 text-sm text-gray-700">
        <p class="font-medium">運営者: 坂本義志</p>
        <p>メールアドレス: <a href="mailto:elixir2761@gmail.com" class="text-indigo-600 hover:underline">elixir2761@gmail.com</a></p>
      </div>
    </section>
  </main>
  <footer class="border-t border-gray-200 text-center py-6 text-xs text-gray-400">
    © 2026 坂本義志 / 記憶の声
  </footer>
</body>
</html>`
}

export default app
