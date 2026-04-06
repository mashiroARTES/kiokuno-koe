import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { serveStatic } from 'hono/cloudflare-workers'

import characters from './routes/characters'
import memories from './routes/memories'
import minimaxRoutes from './routes/minimax'
import chat from './routes/chat'
import finetune from './routes/finetune'

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
app.route('/api/characters', characters)
app.route('/api/memories', memories)
app.route('/api/minimax', minimaxRoutes)
app.route('/api/chat', chat)
app.route('/api/finetune', finetune)

// ── 記憶エイリアス API（/memories/ パス非使用） ──────────────
// GET  /api/mem-list/:characterId  → 記憶一覧
app.get('/api/mem-list/:characterId', async (c) => {
  const characterId = c.req.param('characterId')
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM memories WHERE character_id = ? ORDER BY created_at DESC'
  ).bind(characterId).all()
  return c.json({ success: true, data: results })
})

// POST /api/mem-save  → 記憶追加
app.post('/api/mem-save', async (c) => {
  const body = await c.req.json()
  const { character_id, title, content, period, location, emotion, source_type } = body
  if (!character_id || !title || !content) {
    return c.json({ success: false, error: 'character_id, title, content は必須です' }, 400)
  }
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
    WHERE id = ?`
  ).bind(title || null, content || null, period || null, location || null, emotion || null, id).run()
  const updated = await c.env.DB.prepare('SELECT * FROM memories WHERE id = ?').bind(id).first()
  return c.json({ success: true, data: updated })
})

// DELETE /api/mem-delete/:id  → 記憶削除
app.delete('/api/mem-delete/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM memories WHERE id = ?').bind(id).run()
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
  <div class="flex items-center gap-2">
    <span id="api-status" class="text-xs px-2 py-1 rounded-full bg-gray-700 text-gray-400">
      <i class="fas fa-circle text-xs mr-1"></i>確認中
    </span>
  </div>
</header>

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
      <div class="text-xs text-gray-400 uppercase tracking-wider mb-2">音声クローン</div>
      <button onclick="openModal('modal-voice-clone')" id="btn-voice-clone" disabled
        class="w-full py-2.5 px-3 rounded-lg bg-navy-700 border border-white/10 text-sm hover:border-gold-500/40 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed">
        <i class="fas fa-microphone-alt text-gold-400"></i>
        <div class="text-left">
          <div class="text-white text-xs font-medium">ボイスクローン</div>
          <div class="text-gray-400 text-xs">音声サンプルから声を複製</div>
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
        <div id="voice-badge" class="hidden text-xs px-3 py-1 rounded-full bg-gold-500/20 border border-gold-500/40 text-gold-400">
          <i class="fas fa-waveform-lines mr-1"></i>声複製済み
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
          class="w-12 h-12 rounded-full bg-navy-700 border border-gold-500/40 flex items-center justify-center hover:border-gold-500/40 transition-all flex-shrink-0"
          title="音声読み上げ ON/OFF">
          <i id="tts-icon" class="fas fa-volume-up text-gold-400"></i>
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

<!-- ボイスクローン -->
<div id="modal-voice-clone" class="hidden fixed inset-0 modal-overlay z-50 flex items-center justify-center p-4">
  <div class="bg-navy-800 rounded-2xl border border-white/20 w-full max-w-md shadow-2xl">
    <div class="flex items-center justify-between p-5 border-b border-white/10">
      <h3 class="font-serif-jp text-gold-400 font-semibold text-lg">ボイスクローン</h3>
      <button onclick="closeModal('modal-voice-clone')" class="text-gray-400 hover:text-white"><i class="fas fa-times"></i></button>
    </div>
    <div class="p-5 space-y-4">
      <div class="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 text-xs text-blue-300">
        <i class="fas fa-info-circle mr-1"></i>
        10〜60秒以上の音声サンプル（mp3/wav/m4a）をアップロードすると、その声色を再現します。
      </div>
      <div>
        <label class="block text-xs text-gray-400 mb-1">音声サンプルファイル <span class="text-red-400">*</span></label>
        <label class="w-full flex flex-col items-center justify-center py-8 border-2 border-dashed border-white/20 rounded-xl cursor-pointer hover:border-gold-500/40 transition-colors">
          <i class="fas fa-cloud-upload-alt text-3xl text-gray-500 mb-2"></i>
          <span class="text-sm text-gray-400" id="voice-file-label">クリックしてファイルを選択</span>
          <span class="text-xs text-gray-600 mt-1">MP3, WAV, M4A (最大50MB)</span>
          <input type="file" id="voice-file-input" accept="audio/*" class="hidden" onchange="onVoiceFileSelected(this)">
        </label>
      </div>
    </div>
    <div class="flex gap-3 p-5 pt-0">
      <button onclick="closeModal('modal-voice-clone')"
        class="flex-1 py-2 rounded-lg border border-white/20 text-sm text-gray-400 hover:text-white transition-colors">キャンセル</button>
      <button onclick="startVoiceClone()" id="btn-clone-start"
        class="flex-1 py-2 rounded-lg bg-gold-500 text-navy-900 text-sm font-semibold hover:bg-gold-400 transition-colors flex items-center justify-center gap-2">
        <i class="fas fa-microphone-alt"></i> クローン開始
      </button>
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

export default app
