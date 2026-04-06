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

// ── ヘルスチェック ────────────────────────────────────────────
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    service: '記憶の声 API',
    version: '1.0.0',
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
    .chat-bubble-ai { background: linear-gradient(135deg, #fdf8ed, #f9f0d6); }
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
        class="flex-1 py-3 text-xs font-medium tab-active transition-colors" >
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
      <!-- 初期状態 -->
      <div id="empty-state" class="flex flex-col items-center justify-center h-full text-center">
        <div class="w-20 h-20 rounded-full bg-navy-800 border border-gold-500/30 flex items-center justify-center mb-4">
          <i class="fas fa-dove text-gold-500 text-3xl"></i>
        </div>
        <h3 class="font-serif-jp text-xl text-gold-400 mb-2">記憶の声へようこそ</h3>
        <p class="text-gray-400 text-sm max-w-xs">
          左のサイドバーからキャラクターを選択するか、新しいキャラクターを作成してください。
        </p>
      </div>
      <!-- メッセージはここに挿入 -->
    </div>

    <!-- 入力エリア -->
    <div class="bg-navy-800 border-t border-white/10 p-4">
      <div class="flex items-end gap-3 max-w-4xl mx-auto">

        <!-- マイクボタン (音声入力) -->
        <button id="btn-mic" onclick="toggleRecording()"
          class="w-12 h-12 rounded-full bg-navy-700 border border-white/20 flex items-center justify-center hover:border-red-400 transition-all flex-shrink-0 disabled:opacity-40"
          title="音声入力 (クリックで録音開始/停止)">
          <i id="mic-icon" class="fas fa-microphone text-gray-400"></i>
        </button>

        <!-- テキスト入力 -->
        <div class="flex-1 relative">
          <textarea id="chat-input"
            class="w-full bg-navy-900 border border-white/20 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:border-gold-500/50 transition-colors leading-relaxed"
            placeholder="メッセージを入力…（Enterで送信、Shift+Enterで改行）"
            rows="1"
            onkeydown="handleInputKeydown(event)"
            oninput="autoResize(this)"></textarea>
          <!-- 録音中インジケーター -->
          <div id="recording-indicator" class="hidden absolute inset-0 rounded-xl bg-red-500/10 border border-red-500/50 flex items-center justify-center">
            <span class="text-red-400 text-sm wave-anim">
              <span>●</span><span>●</span><span>●</span>
            </span>
            <span class="text-red-400 text-sm ml-2">録音中...</span>
          </div>
        </div>

        <!-- TTS トグル -->
        <button id="btn-tts-toggle" onclick="toggleTTS()"
          class="w-12 h-12 rounded-full bg-navy-700 border border-white/20 flex items-center justify-center hover:border-gold-500/40 transition-all flex-shrink-0"
          title="音声読み上げ ON/OFF">
          <i id="tts-icon" class="fas fa-volume-up text-gold-400"></i>
        </button>

        <!-- 送信ボタン -->
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

<!-- ═══════════════════════════════════════════════════════ -->
<!-- モーダル群 -->
<!-- ═══════════════════════════════════════════════════════ -->

<!-- 新規キャラクター作成モーダル -->
<div id="modal-new-character" class="hidden fixed inset-0 modal-overlay z-50 flex items-center justify-center p-4">
  <div class="bg-navy-800 rounded-2xl border border-white/20 w-full max-w-md shadow-2xl">
    <div class="flex items-center justify-between p-5 border-b border-white/10">
      <h3 class="font-serif-jp text-gold-400 font-semibold text-lg">新しいキャラクター</h3>
      <button onclick="closeModal('modal-new-character')" class="text-gray-400 hover:text-white">
        <i class="fas fa-times"></i>
      </button>
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
        <textarea id="new-char-desc" rows="3" placeholder="例: 織物が好きで穏やかな語り口の女性。昔の京都の風景をよく語る。"
          class="w-full bg-navy-900 border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gold-500/50 resize-none"></textarea>
      </div>
    </div>
    <div class="flex gap-3 p-5 pt-0">
      <button onclick="closeModal('modal-new-character')"
        class="flex-1 py-2 rounded-lg border border-white/20 text-sm text-gray-400 hover:text-white transition-colors">
        キャンセル
      </button>
      <button onclick="createCharacter()"
        class="flex-1 py-2 rounded-lg bg-gold-500 text-navy-900 text-sm font-semibold hover:bg-gold-400 transition-colors">
        作成する
      </button>
    </div>
  </div>
</div>

<!-- 新規記憶追加モーダル -->
<div id="modal-new-memory" class="hidden fixed inset-0 modal-overlay z-50 flex items-center justify-center p-4">
  <div class="bg-navy-800 rounded-2xl border border-white/20 w-full max-w-lg shadow-2xl">
    <div class="flex items-center justify-between p-5 border-b border-white/10">
      <h3 class="font-serif-jp text-gold-400 font-semibold text-lg">記憶を追加</h3>
      <button onclick="closeModal('modal-new-memory')" class="text-gray-400 hover:text-white">
        <i class="fas fa-times"></i>
      </button>
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
        class="flex-1 py-2 rounded-lg border border-white/20 text-sm text-gray-400 hover:text-white transition-colors">
        キャンセル
      </button>
      <button onclick="addMemory()"
        class="flex-1 py-2 rounded-lg bg-gold-500 text-navy-900 text-sm font-semibold hover:bg-gold-400 transition-colors">
        追加する
      </button>
    </div>
  </div>
</div>

<!-- 記憶編集モーダル -->
<div id="modal-edit-memory" class="hidden fixed inset-0 modal-overlay z-50 flex items-center justify-center p-4">
  <div class="bg-navy-800 rounded-2xl border border-white/20 w-full max-w-lg shadow-2xl">
    <div class="flex items-center justify-between p-5 border-b border-white/10">
      <h3 class="font-serif-jp text-gold-400 font-semibold text-lg"><i class="fas fa-pen mr-2 text-base"></i>記憶を編集</h3>
      <button onclick="closeModal('modal-edit-memory')" class="text-gray-400 hover:text-white">
        <i class="fas fa-times"></i>
      </button>
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
        class="flex-1 py-2 rounded-lg border border-white/20 text-sm text-gray-400 hover:text-white transition-colors">
        キャンセル
      </button>
      <button onclick="saveEditMemory()"
        class="flex-1 py-2 rounded-lg bg-gold-500 text-navy-900 text-sm font-semibold hover:bg-gold-400 transition-colors">
        <i class="fas fa-save mr-1"></i>保存する
      </button>
    </div>
  </div>
</div>

<!-- ボイスクローンモーダル -->
<div id="modal-voice-clone" class="hidden fixed inset-0 modal-overlay z-50 flex items-center justify-center p-4">
  <div class="bg-navy-800 rounded-2xl border border-white/20 w-full max-w-md shadow-2xl">
    <div class="flex items-center justify-between p-5 border-b border-white/10">
      <h3 class="font-serif-jp text-gold-400 font-semibold text-lg">ボイスクローン</h3>
      <button onclick="closeModal('modal-voice-clone')" class="text-gray-400 hover:text-white">
        <i class="fas fa-times"></i>
      </button>
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
        class="flex-1 py-2 rounded-lg border border-white/20 text-sm text-gray-400 hover:text-white transition-colors">
        キャンセル
      </button>
      <button onclick="startVoiceClone()" id="btn-clone-start"
        class="flex-1 py-2 rounded-lg bg-gold-500 text-navy-900 text-sm font-semibold hover:bg-gold-400 transition-colors flex items-center justify-center gap-2">
        <i class="fas fa-microphone-alt"></i> クローン開始
      </button>
    </div>
  </div>
</div>

<!-- トースト通知 -->
<div id="toast" class="hidden fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl shadow-2xl text-sm font-medium transition-all"></div>

<!-- ═══════════════════════════════════════════════════════ -->
<!-- JavaScript -->
<!-- ═══════════════════════════════════════════════════════ -->
<script>
// ── 状態管理 ──────────────────────────────────────────────
let state = {
  characters: [],
  selectedCharId: null,
  memories: [],
  chatHistory: [],
  isRecording: false,
  mediaRecorder: null,
  audioChunks: [],
  ttsEnabled: true,
  isLoading: false,
}

// ── API ───────────────────────────────────────────────────
const api = {
  async get(path) {
    const r = await fetch(path)
    return r.json()
  },
  async post(path, body) {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return r.json()
  },
  async delete(path) {
    const r = await fetch(path, { method: 'DELETE' })
    return r.json()
  },
}

// ── 初期化 ────────────────────────────────────────────────
async function init() {
  await checkHealth()
  await loadCharacters()
}

async function checkHealth() {
  try {
    const data = await api.get('/api/health')
    const el = document.getElementById('api-status')
    if (data.status === 'ok') {
      el.innerHTML = '<i class="fas fa-circle text-green-400 text-xs mr-1"></i>オンライン'
      el.className = 'text-xs px-2 py-1 rounded-full bg-green-500/10 text-green-400'
    }
  } catch(e) {
    const el = document.getElementById('api-status')
    el.innerHTML = '<i class="fas fa-circle text-red-400 text-xs mr-1"></i>オフライン'
    el.className = 'text-xs px-2 py-1 rounded-full bg-red-500/10 text-red-400'
  }
}

// ── キャラクター ──────────────────────────────────────────
async function loadCharacters() {
  const data = await api.get('/api/characters')
  state.characters = data.data || []
  renderCharacterList()
}

function renderCharacterList() {
  const container = document.getElementById('character-list')
  if (state.characters.length === 0) {
    container.innerHTML = '<div class="text-center py-6 text-gray-500 text-xs">キャラクターがいません</div>'
    return
  }
  container.innerHTML = state.characters.map(c => \`
    <div class="character-item rounded-xl border cursor-pointer transition-all p-3 \${
      state.selectedCharId === c.id
        ? 'border-gold-500/60 bg-gold-500/10'
        : 'border-white/10 bg-navy-900/50 hover:border-gold-500/30'
    }" onclick="selectCharacter(\${c.id})">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 rounded-full bg-gold-500/20 flex items-center justify-center text-sm">\${c.age > 70 ? '👵' : c.age > 50 ? '👩' : '🧑'}</div>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium text-white truncate">\${c.name}</div>
          <div class="text-xs text-gray-400">\${c.age ? c.age + '歳' : ''}\${c.birthplace ? ' · ' + c.birthplace : ''}</div>
        </div>
        \${c.voice_id ? '<i class="fas fa-waveform-lines text-gold-400 text-xs flex-shrink-0"></i>' : ''}
      </div>
    </div>
  \`).join('')
}

async function selectCharacter(id) {
  state.selectedCharId = id
  const char = state.characters.find(c => c.id === id)
  if (!char) return

  // UI更新
  renderCharacterList()
  document.getElementById('character-bar').classList.remove('hidden')
  document.getElementById('char-name').textContent = char.name
  document.getElementById('char-desc').textContent = [
    char.age ? char.age + '歳' : '',
    char.birthplace,
    char.description ? char.description.slice(0, 40) + '…' : ''
  ].filter(Boolean).join(' · ')
  document.getElementById('char-avatar').textContent = char.age > 70 ? '👵' : '👩'

  const voiceBadge = document.getElementById('voice-badge')
  if (char.voice_id) voiceBadge.classList.remove('hidden')
  else voiceBadge.classList.add('hidden')

  // ツールボタン有効化
  ['btn-add-memory','btn-voice-clone','btn-export','btn-script','btn-inf-script','btn-clear-history'].forEach(id => {
    const el = document.getElementById(id)
    if (el) el.disabled = false
  })

  // 記憶・会話履歴読み込み
  await loadMemories(id)
  await loadChatHistory(id)
  document.getElementById('empty-state').style.display = 'none'
}

async function createCharacter() {
  const name = document.getElementById('new-char-name').value.trim()
  if (!name) return showToast('名前を入力してください', 'error')

  const data = await api.post('/api/characters', {
    name,
    age: parseInt(document.getElementById('new-char-age').value) || null,
    birthplace: document.getElementById('new-char-birthplace').value.trim() || null,
    description: document.getElementById('new-char-desc').value.trim() || null,
  })

  if (data.success) {
    closeModal('modal-new-character')
    showToast('キャラクターを作成しました', 'success')
    await loadCharacters()
    selectCharacter(data.data.id)
    // フォームリセット
    ['new-char-name','new-char-age','new-char-birthplace','new-char-desc'].forEach(id => {
      document.getElementById(id).value = ''
    })
  } else {
    showToast(data.error || 'エラーが発生しました', 'error')
  }
}

async function deleteCharacter(id, event) {
  event.stopPropagation()
  if (!confirm('このキャラクターを削除しますか？')) return
  await api.delete(\`/api/characters/\${id}\`)
  showToast('削除しました', 'success')
  if (state.selectedCharId === id) {
    state.selectedCharId = null
    document.getElementById('character-bar').classList.add('hidden')
    document.getElementById('empty-state').style.display = 'flex'
    document.getElementById('chat-area').innerHTML = document.getElementById('empty-state').outerHTML
  }
  await loadCharacters()
}

// ── 記憶 ─────────────────────────────────────────────────
async function loadMemories(characterId) {
  const data = await api.get(\`/api/memories/character/\${characterId}\`)
  state.memories = data.data || []
  renderMemoryList()
}

function renderMemoryList() {
  const container = document.getElementById('memory-list')
  if (state.memories.length === 0) {
    container.innerHTML = '<div class="text-center py-6 text-gray-500 text-xs">記憶がありません</div>'
    return
  }
  container.innerHTML = state.memories.map(m => \`
    <div class="rounded-xl border border-white/10 bg-navy-900/50 p-3 hover:border-gold-500/30 transition-all">
      <div class="flex items-start justify-between gap-2">
        <div class="flex-1 min-w-0 cursor-pointer" onclick="openEditMemory(\${m.id})">
          <div class="text-sm font-medium text-white truncate">\${m.title}</div>
          <div class="text-xs text-gray-400 mt-0.5">\${[m.period, m.location, m.emotion].filter(Boolean).join(' · ')}</div>
          <div class="text-xs text-gray-500 mt-1 line-clamp-2">\${m.content}</div>
        </div>
        <div class="flex flex-col gap-1.5 flex-shrink-0 pt-0.5">
          <button onclick="openEditMemory(\${m.id})" class="text-gray-500 hover:text-gold-400 transition-colors" title="編集">
            <i class="fas fa-pen text-xs"></i>
          </button>
          <button onclick="deleteMemory(\${m.id})" class="text-gray-500 hover:text-red-400 transition-colors" title="削除">
            <i class="fas fa-trash text-xs"></i>
          </button>
        </div>
      </div>
    </div>
  \`).join('')
}

async function addMemory() {
  const title = document.getElementById('new-mem-title').value.trim()
  const content = document.getElementById('new-mem-content').value.trim()
  if (!title || !content) return showToast('タイトルと内容は必須です', 'error')

  const data = await api.post('/api/memories', {
    character_id: state.selectedCharId,
    title,
    content,
    period: document.getElementById('new-mem-period').value.trim() || null,
    location: document.getElementById('new-mem-location').value.trim() || null,
    emotion: document.getElementById('new-mem-emotion').value.trim() || null,
  })

  if (data.success) {
    closeModal('modal-new-memory')
    showToast('記憶を追加しました', 'success')
    await loadMemories(state.selectedCharId)
    ;['new-mem-title','new-mem-period','new-mem-location','new-mem-emotion','new-mem-content'].forEach(id => {
      document.getElementById(id).value = ''
    })
  } else {
    showToast(data.error || 'エラーが発生しました', 'error')
  }
}

async function deleteMemory(id) {
  if (!confirm('この記憶を削除しますか？')) return
  await api.delete(\`/api/memories/\${id}\`)
  showToast('削除しました', 'success')
  await loadMemories(state.selectedCharId)
}

function openEditMemory(id) {
  const m = state.memories.find(x => x.id === id)
  if (!m) return
  document.getElementById('edit-mem-id').value = id
  document.getElementById('edit-mem-title').value = m.title || ''
  document.getElementById('edit-mem-period').value = m.period || ''
  document.getElementById('edit-mem-location').value = m.location || ''
  document.getElementById('edit-mem-emotion').value = m.emotion || ''
  document.getElementById('edit-mem-content').value = m.content || ''
  openModal('modal-edit-memory')
}

async function saveEditMemory() {
  const id = document.getElementById('edit-mem-id').value
  const title = document.getElementById('edit-mem-title').value.trim()
  const content = document.getElementById('edit-mem-content').value.trim()
  if (!title || !content) return showToast('タイトルと内容は必須です', 'error')

  const r = await fetch(\`/api/memories/\${id}\`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      content,
      period:   document.getElementById('edit-mem-period').value.trim()   || null,
      location: document.getElementById('edit-mem-location').value.trim() || null,
      emotion:  document.getElementById('edit-mem-emotion').value.trim()  || null,
    }),
  })
  const data = await r.json()
  if (data.success) {
    closeModal('modal-edit-memory')
    showToast('記憶を更新しました', 'success')
    await loadMemories(state.selectedCharId)
  } else {
    showToast(data.error || 'エラーが発生しました', 'error')
  }
}

// ── チャット ─────────────────────────────────────────────
async function loadChatHistory(characterId) {
  const data = await api.get(\`/api/chat/history/\${characterId}\`)
  const messages = data.data || []
  const chatArea = document.getElementById('chat-area')
  chatArea.innerHTML = ''
  messages.forEach(m => appendMessage(m.role, m.content, null, false))
  scrollToBottom()
}

async function sendMessage() {
  if (!state.selectedCharId) return showToast('キャラクターを選択してください', 'error')
  if (state.isLoading) return

  const input = document.getElementById('chat-input')
  const message = input.value.trim()
  if (!message) return

  input.value = ''
  autoResize(input)
  appendMessage('user', message)

  setLoading(true)
  const thinkingEl = appendThinking()

  try {
    const data = await api.post('/api/chat', {
      character_id: state.selectedCharId,
      message,
      use_tts: state.ttsEnabled,
    })

    thinkingEl.remove()

    if (data.success) {
      appendMessage('assistant', data.data.reply, data.data.audio_hex)
    } else {
      appendMessage('assistant', \`⚠️ \${data.error || 'エラーが発生しました'}\`)
    }
  } catch(e) {
    thinkingEl.remove()
    appendMessage('assistant', '⚠️ 通信エラーが発生しました')
  } finally {
    setLoading(false)
  }
}

function appendMessage(role, content, audioHex = null, scroll = true) {
  const chatArea = document.getElementById('chat-area')
  const isUser = role === 'user'
  const char = state.characters.find(c => c.id === state.selectedCharId)
  const charName = char ? char.name : 'AI'

  const div = document.createElement('div')
  div.className = \`flex gap-3 \${isUser ? 'flex-row-reverse' : 'flex-row'}\`
  div.innerHTML = \`
    <div class="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-sm \${
      isUser ? 'bg-blue-500/30' : 'bg-gold-500/20 border border-gold-500/30'
    }">
      \${isUser ? '🧑' : (char?.age > 70 ? '👵' : '👩')}
    </div>
    <div class="max-w-[75%]">
      <div class="text-xs text-gray-500 mb-1 \${isUser ? 'text-right' : 'text-left'}">
        \${isUser ? 'あなた' : charName}
      </div>
      <div class="rounded-2xl px-4 py-3 text-sm leading-relaxed \${
        isUser
          ? 'chat-bubble-user text-white rounded-tr-sm'
          : 'chat-bubble-ai text-navy-900 rounded-tl-sm'
      }">
        \${content.replace(/\\n/g, '<br>')}
      </div>
      \${audioHex ? \`
        <div class="mt-2 flex items-center gap-2">
          <button onclick="playAudio('\${audioHex}')"
            class="flex items-center gap-1.5 text-xs text-gold-400 hover:text-gold-300 transition-colors bg-gold-500/10 border border-gold-500/30 rounded-full px-3 py-1">
            <i class="fas fa-play text-xs"></i> 再生
          </button>
        </div>
      \` : ''}
    </div>
  \`
  chatArea.appendChild(div)
  if (scroll) scrollToBottom()

  // 音声自動再生
  if (audioHex && state.ttsEnabled) {
    playAudio(audioHex)
  }
  return div
}

function appendThinking() {
  const chatArea = document.getElementById('chat-area')
  const div = document.createElement('div')
  div.className = 'flex gap-3'
  div.id = 'thinking-bubble'
  div.innerHTML = \`
    <div class="w-8 h-8 rounded-full bg-gold-500/20 border border-gold-500/30 flex items-center justify-center text-sm">👵</div>
    <div class="chat-bubble-ai rounded-2xl rounded-tl-sm px-4 py-3 text-navy-900">
      <span class="wave-anim text-navy-700">
        <span>●</span><span>●</span><span>●</span>
      </span>
    </div>
  \`
  chatArea.appendChild(div)
  scrollToBottom()
  return div
}

function scrollToBottom() {
  const chatArea = document.getElementById('chat-area')
  chatArea.scrollTop = chatArea.scrollHeight
}

function setLoading(val) {
  state.isLoading = val
  document.getElementById('btn-send').disabled = val
  document.getElementById('chat-input').disabled = val
}

// ── 音声再生 (TTS) ────────────────────────────────────────
function playAudio(audioHex) {
  try {
    const bytes = hexToBytes(audioHex)
    const blob = new Blob([bytes], { type: 'audio/mpeg' })
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audio.play()
    audio.onended = () => URL.revokeObjectURL(url)
  } catch(e) {
    console.error('Audio play error:', e)
  }
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16)
  }
  return bytes
}

function toggleTTS() {
  state.ttsEnabled = !state.ttsEnabled
  const icon = document.getElementById('tts-icon')
  const btn = document.getElementById('btn-tts-toggle')
  if (state.ttsEnabled) {
    icon.className = 'fas fa-volume-up text-gold-400'
    btn.className = btn.className.replace('border-white/20', 'border-gold-500/40')
    showToast('音声読み上げ: ON', 'info')
  } else {
    icon.className = 'fas fa-volume-mute text-gray-500'
    btn.className = btn.className.replace('border-gold-500/40', 'border-white/20')
    showToast('音声読み上げ: OFF', 'info')
  }
}

// ── 音声録音 (STT) ────────────────────────────────────────
async function toggleRecording() {
  if (!state.isRecording) {
    await startRecording()
  } else {
    stopRecording()
  }
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    state.audioChunks = []
    state.mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })

    state.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) state.audioChunks.push(e.data)
    }

    state.mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(state.audioChunks, { type: 'audio/webm' })
      stream.getTracks().forEach(t => t.stop())
      await transcribeAudio(audioBlob)
    }

    state.mediaRecorder.start()
    state.isRecording = true

    document.getElementById('mic-icon').className = 'fas fa-stop text-red-400'
    document.getElementById('btn-mic').classList.add('recording-pulse', 'border-red-400')
    document.getElementById('recording-indicator').classList.remove('hidden')
    document.getElementById('chat-input').classList.add('hidden')
  } catch(e) {
    showToast('マイクへのアクセスが拒否されました', 'error')
  }
}

function stopRecording() {
  if (state.mediaRecorder && state.isRecording) {
    state.mediaRecorder.stop()
    state.isRecording = false

    document.getElementById('mic-icon').className = 'fas fa-microphone text-gray-400'
    document.getElementById('btn-mic').classList.remove('recording-pulse', 'border-red-400')
    document.getElementById('recording-indicator').classList.add('hidden')
    document.getElementById('chat-input').classList.remove('hidden')
  }
}

async function transcribeAudio(audioBlob) {
  // まずブラウザ内 Web Speech API を試みる
  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    showToast('音声を認識しています…', 'info')
    // Web Speech APIは非同期録音後には使えないため、サーバーSTTを使用
  }

  // サーバーサイド STT (MiniMax API)
  const formData = new FormData()
  formData.append('audio_file', audioBlob, 'speech.webm')

  try {
    showToast('音声を文字起こし中…', 'info')
    const response = await fetch('/api/chat/stt', { method: 'POST', body: formData })
    const data = await response.json()

    if (data.success && data.data.transcript) {
      document.getElementById('chat-input').value = data.data.transcript
      autoResize(document.getElementById('chat-input'))
      showToast('音声認識完了', 'success')
    } else {
      showToast('音声認識できませんでした。テキストで入力してください。', 'error')
    }
  } catch(e) {
    showToast('STTエラー: ' + e.message, 'error')
  }
}

// Web Speech API リアルタイム認識（録音中）
let speechRecognition = null
function startWebSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!SpeechRecognition) return false

  speechRecognition = new SpeechRecognition()
  speechRecognition.lang = 'ja-JP'
  speechRecognition.continuous = true
  speechRecognition.interimResults = true

  speechRecognition.onresult = (event) => {
    let transcript = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript
    }
    document.getElementById('chat-input').value = transcript
    autoResize(document.getElementById('chat-input'))
  }

  speechRecognition.start()
  return true
}

// ── ボイスクローン ────────────────────────────────────────
function onVoiceFileSelected(input) {
  const file = input.files[0]
  if (file) {
    document.getElementById('voice-file-label').textContent = file.name
  }
}

async function startVoiceClone() {
  const fileInput = document.getElementById('voice-file-input')
  const file = fileInput.files[0]
  if (!file) return showToast('音声ファイルを選択してください', 'error')
  if (!state.selectedCharId) return showToast('キャラクターを選択してください', 'error')

  const char = state.characters.find(c => c.id === state.selectedCharId)
  const btn = document.getElementById('btn-clone-start')
  btn.disabled = true
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>処理中...'

  const formData = new FormData()
  formData.append('audio_file', file)
  formData.append('character_id', state.selectedCharId)
  formData.append('voice_name', char?.name || 'キャラクター')

  try {
    const response = await fetch('/api/minimax/voice-clone-upload', { method: 'POST', body: formData })
    const data = await response.json()

    if (data.success) {
      closeModal('modal-voice-clone')
      showToast('ボイスクローンが完了しました！', 'success')
      document.getElementById('voice-badge').classList.remove('hidden')
      await loadCharacters()
    } else {
      showToast(data.error || 'クローン失敗', 'error')
    }
  } catch(e) {
    showToast('エラー: ' + e.message, 'error')
  } finally {
    btn.disabled = false
    btn.innerHTML = '<i class="fas fa-microphone-alt mr-2"></i>クローン開始'
  }
}

// ── エクスポート・スクリプト ──────────────────────────────
function exportDataset() {
  if (!state.selectedCharId) return
  window.location.href = \`/api/finetune/export/\${state.selectedCharId}\`
}
function downloadTrainScript() {
  if (!state.selectedCharId) return
  window.location.href = \`/api/finetune/script/\${state.selectedCharId}\`
}
function downloadInferenceScript() {
  if (!state.selectedCharId) return
  window.location.href = \`/api/finetune/inference-script/\${state.selectedCharId}\`
}

async function clearHistory() {
  if (!state.selectedCharId) return
  if (!confirm('会話履歴をすべて削除しますか？')) return
  await api.delete(\`/api/chat/history/\${state.selectedCharId}\`)
  await loadChatHistory(state.selectedCharId)
  showToast('会話履歴を削除しました', 'success')
}

// ── UI ヘルパー ───────────────────────────────────────────
function switchSideTab(tab) {
  const tabs = ['characters', 'memories', 'tools']
  tabs.forEach(t => {
    document.getElementById(\`panel-\${t}\`).classList.toggle('hidden', t !== tab)
    const tabEl = document.getElementById(\`tab-\${t}\`)
    if (t === tab) {
      tabEl.classList.add('tab-active')
      tabEl.classList.remove('text-gray-400')
    } else {
      tabEl.classList.remove('tab-active')
      tabEl.classList.add('text-gray-400')
    }
  })
}

function openModal(id) { document.getElementById(id).classList.remove('hidden') }
function closeModal(id) { document.getElementById(id).classList.add('hidden') }

function handleInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}

function autoResize(el) {
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 120) + 'px'
}

let toastTimer
function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast')
  const colors = {
    success: 'bg-green-500/90 text-white',
    error:   'bg-red-500/90 text-white',
    info:    'bg-navy-700 text-gold-400 border border-gold-500/30',
  }
  toast.className = \`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl shadow-2xl text-sm font-medium transition-all \${colors[type] || colors.info}\`
  toast.textContent = msg
  toast.classList.remove('hidden')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3000)
}

// クリックでモーダルを閉じる
['modal-new-character','modal-new-memory','modal-edit-memory','modal-voice-clone'].forEach(id => {
  document.getElementById(id).addEventListener('click', (e) => {
    if (e.target.id === id) closeModal(id)
  })
})

// ── 起動 ─────────────────────────────────────────────────
init()
</script>
</body>
</html>`
}

export default app
