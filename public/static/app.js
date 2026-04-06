// ── 音声データストア（IDで参照してHexをHTML属性に埋め込まない）──
const audioStore = {}
let audioStoreSeq = 0
function storeAudio(hex) {
  const id = 'aud_' + (++audioStoreSeq)
  audioStore[id] = hex
  return id
}

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
  // 認証
  sessionToken: null,
  currentUser: null,
}

// ── API（認証トークン付き） ──────────────────────────────
const api = {
  _headers(extra = {}) {
    const h = { 'Content-Type': 'application/json', ...extra }
    if (state.sessionToken) h['Authorization'] = 'Bearer ' + state.sessionToken
    return h
  },
  async get(path) {
    const r = await fetch(path, { headers: this._headers({ 'Content-Type': undefined }) })
    return r.json()
  },
  async post(path, body) {
    const r = await fetch(path, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(body),
    })
    return r.json()
  },
  async put(path, body) {
    const r = await fetch(path, {
      method: 'PUT',
      headers: this._headers(),
      body: JSON.stringify(body),
    })
    return r.json()
  },
  async delete(path) {
    const r = await fetch(path, {
      method: 'DELETE',
      headers: this._headers({ 'Content-Type': undefined }),
    })
    return r.json()
  },
}

// ── 認証：セッション復元 ──────────────────────────────────
async function restoreSession() {
  const token = localStorage.getItem('kioku_session_token')
  if (!token) return false
  state.sessionToken = token
  try {
    const data = await api.get('/api/auth/me')
    if (data.success) {
      state.currentUser = data.data
      return true
    }
  } catch (e) {}
  localStorage.removeItem('kioku_session_token')
  state.sessionToken = null
  return false
}

// ── 認証画面の表示切替 ────────────────────────────────────
function showAuthScreen() {
  document.getElementById('auth-screen').style.display = 'flex'
}
function hideAuthScreen() {
  document.getElementById('auth-screen').style.display = 'none'
}

function switchAuthTab(tab) {
  const isLogin = tab === 'login'
  document.getElementById('auth-tab-login').className = isLogin
    ? 'flex-1 py-2 text-sm font-medium rounded-md bg-gold-500 text-navy-900 transition-colors'
    : 'flex-1 py-2 text-sm font-medium text-gray-400 hover:text-white rounded-md transition-colors'
  document.getElementById('auth-tab-register').className = !isLogin
    ? 'flex-1 py-2 text-sm font-medium rounded-md bg-gold-500 text-navy-900 transition-colors'
    : 'flex-1 py-2 text-sm font-medium text-gray-400 hover:text-white rounded-md transition-colors'
  document.getElementById('auth-form-login').classList.toggle('hidden', !isLogin)
  document.getElementById('auth-form-register').classList.toggle('hidden', isLogin)
}

async function doLogin() {
  const email = document.getElementById('login-email').value.trim()
  const password = document.getElementById('login-password').value
  const errEl = document.getElementById('login-error')
  errEl.classList.add('hidden')
  if (!email || !password) { errEl.textContent = 'メールアドレスとパスワードを入力してください'; errEl.classList.remove('hidden'); return }
  try {
    const data = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    }).then(r => r.json())
    if (!data.success) { errEl.textContent = data.error || 'ログインに失敗しました'; errEl.classList.remove('hidden'); return }
    state.sessionToken = data.data.session_token
    state.currentUser = data.data.user
    localStorage.setItem('kioku_session_token', state.sessionToken)
    onLoginSuccess()
  } catch(e) {
    errEl.textContent = '通信エラーが発生しました'; errEl.classList.remove('hidden')
  }
}

async function doRegister() {
  const email = document.getElementById('reg-email').value.trim()
  const password = document.getElementById('reg-password').value
  const password2 = document.getElementById('reg-password2').value
  const agree = document.getElementById('reg-agree').checked
  const errEl = document.getElementById('reg-error')
  errEl.classList.add('hidden')
  if (!email || !password || !password2) { errEl.textContent = 'すべての項目を入力してください'; errEl.classList.remove('hidden'); return }
  if (password !== password2) { errEl.textContent = 'パスワードが一致しません'; errEl.classList.remove('hidden'); return }
  if (password.length < 8) { errEl.textContent = 'パスワードは8文字以上で設定してください'; errEl.classList.remove('hidden'); return }
  if (!agree) { errEl.textContent = '利用規約とプライバシーポリシーに同意してください'; errEl.classList.remove('hidden'); return }
  try {
    const data = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    }).then(r => r.json())
    if (!data.success) { errEl.textContent = data.error || '登録に失敗しました'; errEl.classList.remove('hidden'); return }
    state.sessionToken = data.data.session_token
    state.currentUser = data.data.user
    localStorage.setItem('kioku_session_token', state.sessionToken)
    showToast('アカウントを作成しました！', 'success')
    onLoginSuccess()
  } catch(e) {
    errEl.textContent = '通信エラーが発生しました'; errEl.classList.remove('hidden')
  }
}

function onLoginSuccess() {
  hideAuthScreen()
  // ユーザー情報をヘッダーに表示
  document.getElementById('btn-show-login').classList.add('hidden')
  document.getElementById('user-info').classList.remove('hidden')
  document.getElementById('user-info').style.display = 'flex'
  document.getElementById('user-email-display').textContent = state.currentUser.email
  // データ読み込み開始
  loadCharacters()
}

async function logout() {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + state.sessionToken }
    })
  } catch(e) {}
  state.sessionToken = null
  state.currentUser = null
  state.characters = []
  state.selectedCharId = null
  state.memories = []
  localStorage.removeItem('kioku_session_token')
  // UI リセット
  document.getElementById('user-info').classList.add('hidden')
  document.getElementById('btn-show-login').classList.remove('hidden')
  document.getElementById('character-list').innerHTML = ''
  document.getElementById('character-bar').classList.add('hidden')
  document.getElementById('chat-area').innerHTML = `<div id="empty-state" class="flex flex-col items-center justify-center h-full text-center">
    <div class="w-20 h-20 rounded-full bg-navy-800 border border-gold-500/30 flex items-center justify-center mb-4">
      <i class="fas fa-dove text-gold-500 text-3xl"></i>
    </div>
    <h3 class="font-serif-jp text-xl text-gold-400 mb-2">記憶の声へようこそ</h3>
    <p class="text-gray-400 text-sm max-w-xs">左のサイドバーからキャラクターを選択するか、新しいキャラクターを作成してください。</p>
  </div>`
  showToast('ログアウトしました')
  showAuthScreen()
}

// ── 初期化 ────────────────────────────────────────────────
async function init() {
  await checkHealth()
  // セッション復元を試みる
  const restored = await restoreSession()
  if (restored) {
    onLoginSuccess()
  } else {
    // 未ログイン: ログイン画面を表示
    document.getElementById('btn-show-login').classList.remove('hidden')
    showAuthScreen()
  }
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
  container.innerHTML = state.characters.map(c => {
    const emoji = c.age > 70 ? '👵' : c.age > 50 ? '👩' : '🧑'
    const selected = state.selectedCharId === c.id
    const borderClass = selected ? 'border-gold-500/60 bg-gold-500/10' : 'border-white/10 bg-navy-900/50 hover:border-gold-500/30'
    const voiceIcon = c.voice_id ? '<i class="fas fa-waveform-lines text-gold-400 text-xs flex-shrink-0"></i>' : ''
    const age = c.age ? c.age + '歳' : ''
    const place = c.birthplace ? ' · ' + c.birthplace : ''
    return `<div class="character-item rounded-xl border cursor-pointer transition-all p-3 ${borderClass}" onclick="selectCharacter(${c.id})">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 rounded-full bg-gold-500/20 flex items-center justify-center text-sm">${emoji}</div>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium text-white truncate">${c.name}</div>
          <div class="text-xs text-gray-400">${age}${place}</div>
        </div>
        ${voiceIcon}
      </div>
    </div>`
  }).join('')
}

async function selectCharacter(charId) {
  state.selectedCharId = charId
  const char = state.characters.find(c => c.id === charId)
  if (!char) return

  renderCharacterList()
  document.getElementById('character-bar').classList.remove('hidden')
  document.getElementById('char-name').textContent = char.name
  document.getElementById('char-desc').textContent = [
    char.age ? char.age + '歳' : '',
    char.birthplace,
    char.description ? char.description.slice(0, 40) + '…' : ''
  ].filter(Boolean).join(' · ')
  document.getElementById('char-avatar').textContent = char.age > 70 ? '👵' : '👩'

  updateVoiceBadge(char)

  // ツールボタン有効化
  const btnIds = ['btn-add-memory','btn-voice-clone','btn-export','btn-script','btn-inf-script','btn-clear-history']
  btnIds.forEach(btnId => {
    const el = document.getElementById(btnId)
    if (el) el.disabled = false
  })

  await loadMemories(charId)
  await loadChatHistory(charId)
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
    ;['new-char-name','new-char-age','new-char-birthplace','new-char-desc'].forEach(fid => {
      document.getElementById(fid).value = ''
    })
  } else {
    showToast(data.error || 'エラーが発生しました', 'error')
  }
}

async function deleteCharacter(charId, event) {
  event.stopPropagation()
  if (!confirm('このキャラクターを削除しますか？')) return
  await api.delete('/api/characters/' + charId)
  showToast('削除しました', 'success')
  if (state.selectedCharId === charId) {
    state.selectedCharId = null
    document.getElementById('character-bar').classList.add('hidden')
    const chatArea = document.getElementById('chat-area')
    chatArea.innerHTML = ''
    document.getElementById('empty-state').style.display = 'flex'
    chatArea.appendChild(document.getElementById('empty-state'))
  }
  await loadCharacters()
}

// ── 記憶 ─────────────────────────────────────────────────
async function loadMemories(characterId) {
  const data = await api.get('/api/mem-list/' + characterId)
  state.memories = data.data || []
  renderMemoryList()
}

function renderMemoryList() {
  const container = document.getElementById('memory-list')
  if (state.memories.length === 0) {
    container.innerHTML = '<div class="text-center py-6 text-gray-500 text-xs">記憶がありません</div>'
    return
  }
  container.innerHTML = state.memories.map(m => {
    const tags = [m.period, m.location, m.emotion].filter(Boolean).join(' · ')
    const shortContent = m.content ? m.content.slice(0, 60) + (m.content.length > 60 ? '…' : '') : ''
    return `<div class="rounded-xl border border-white/10 bg-navy-900/50 p-3 hover:border-gold-500/30 transition-all">
      <div class="flex items-start justify-between gap-2">
        <div class="flex-1 min-w-0 cursor-pointer" onclick="openEditMemory(${m.id})">
          <div class="text-sm font-medium text-white truncate">${m.title}</div>
          <div class="text-xs text-gray-400 mt-0.5">${tags}</div>
          <div class="text-xs text-gray-500 mt-1">${shortContent}</div>
        </div>
        <div class="flex flex-col gap-1.5 flex-shrink-0 pt-0.5">
          <button onclick="openEditMemory(${m.id})" class="text-gray-500 hover:text-gold-400 transition-colors" title="編集">
            <i class="fas fa-pen text-xs"></i>
          </button>
          <button onclick="deleteMemory(${m.id})" class="text-gray-500 hover:text-red-400 transition-colors" title="削除">
            <i class="fas fa-trash text-xs"></i>
          </button>
        </div>
      </div>
    </div>`
  }).join('')
}

async function addMemory() {
  const title = document.getElementById('new-mem-title').value.trim()
  const content = document.getElementById('new-mem-content').value.trim()
  if (!title || !content) return showToast('タイトルと内容は必須です', 'error')

  const data = await api.post('/api/mem-save', {
    character_id: state.selectedCharId,
    title,
    content,
    period:   document.getElementById('new-mem-period').value.trim()   || null,
    location: document.getElementById('new-mem-location').value.trim() || null,
    emotion:  document.getElementById('new-mem-emotion').value.trim()  || null,
  })

  if (data.success) {
    closeModal('modal-new-memory')
    showToast('記憶を追加しました', 'success')
    await loadMemories(state.selectedCharId)
    ;['new-mem-title','new-mem-period','new-mem-location','new-mem-emotion','new-mem-content'].forEach(fid => {
      document.getElementById(fid).value = ''
    })
  } else {
    showToast(data.error || 'エラーが発生しました', 'error')
  }
}

async function deleteMemory(memId) {
  if (!confirm('この記憶を削除しますか？')) return
  await api.delete('/api/mem-delete/' + memId)
  showToast('削除しました', 'success')
  await loadMemories(state.selectedCharId)
}

function openEditMemory(memId) {
  const m = state.memories.find(x => x.id === memId)
  if (!m) return
  document.getElementById('edit-mem-id').value = memId
  document.getElementById('edit-mem-title').value = m.title || ''
  document.getElementById('edit-mem-period').value = m.period || ''
  document.getElementById('edit-mem-location').value = m.location || ''
  document.getElementById('edit-mem-emotion').value = m.emotion || ''
  document.getElementById('edit-mem-content').value = m.content || ''
  openModal('modal-edit-memory')
}

async function saveEditMemory() {
  const memId = document.getElementById('edit-mem-id').value
  const title = document.getElementById('edit-mem-title').value.trim()
  const content = document.getElementById('edit-mem-content').value.trim()
  if (!title || !content) return showToast('タイトルと内容は必須です', 'error')

  const data = await api.put('/api/mem-update/' + memId, {
    title,
    content,
    period:   document.getElementById('edit-mem-period').value.trim()   || null,
    location: document.getElementById('edit-mem-location').value.trim() || null,
    emotion:  document.getElementById('edit-mem-emotion').value.trim()  || null,
  })

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
  const data = await api.get('/api/chat/history/' + characterId)
  const messages = data.data || []
  const chatArea = document.getElementById('chat-area')
  chatArea.innerHTML = ''
  // 履歴読み込み: message_id と audio_hex を渡す
  messages.forEach(m => appendMessage(m.role, m.content, m.audio_hex || null, false, m.id))
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
      use_tts: true,  // TTS生成は常に行う（自動再生ON/OFFとは独立）
    })
    thinkingEl.remove()

    if (data.success) {
      // message_id を渡して再生ボタンに結び付ける
      appendMessage('assistant', data.data.reply, data.data.audio_hex, true, data.data.message_id)
    } else {
      appendMessage('assistant', '⚠️ ' + (data.error || 'エラーが発生しました'))
    }
  } catch(e) {
    thinkingEl.remove()
    appendMessage('assistant', '⚠️ 通信エラーが発生しました')
  } finally {
    setLoading(false)
  }
}

function appendMessage(role, content, audioHex, scroll, messageId) {
  if (scroll === undefined) scroll = true
  const chatArea = document.getElementById('chat-area')
  const isUser = role === 'user'
  const char = state.characters.find(c => c.id === state.selectedCharId)
  const charName = char ? char.name : 'AI'
  const emoji = isUser ? '🧑' : (char && char.age > 70 ? '👵' : '👩')

  const bubbleClass = isUser
    ? 'chat-bubble-user text-white rounded-tr-sm'
    : 'chat-bubble-ai text-navy-900 rounded-tl-sm'
  const alignClass = isUser ? 'text-right' : 'text-left'
  const labelName = isUser ? 'あなた' : charName
  const avatarClass = isUser ? 'bg-blue-500/30' : 'bg-gold-500/20 border border-gold-500/30'

  // assistant のみ音声ボタンを表示
  let audioBtn = ''
  let audioStoreKey = null
  if (!isUser) {
    if (audioHex) {
      // Hexをstoreに保存してキーをonclickに渡す（大量データをHTML属性に入れない）
      audioStoreKey = storeAudio(audioHex)
      audioBtn = `<div class="msg-audio-area mt-2 flex items-center gap-2">
        <button onclick="playAudio('${audioStoreKey}')"
          class="flex items-center gap-1.5 text-xs text-gold-400 hover:text-gold-300 transition-colors bg-gold-500/10 border border-gold-500/30 rounded-full px-3 py-1">
          <i class="fas fa-play text-xs"></i> 再生
        </button>
      </div>`
    } else if (messageId) {
      // 未生成: 「音声を生成」ボタン
      audioBtn = `<div class="msg-audio-area mt-2 flex items-center gap-2">
        <button id="tts-btn-${messageId}" onclick="generateTtsForMessage(${messageId}, this)"
          class="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gold-400 transition-colors bg-white/5 hover:bg-gold-500/10 border border-white/20 hover:border-gold-500/30 rounded-full px-3 py-1">
          <i class="fas fa-volume-up text-xs"></i> 音声を生成
        </button>
      </div>`
    }
  }

  const div = document.createElement('div')
  div.className = 'flex gap-3 ' + (isUser ? 'flex-row-reverse' : 'flex-row')
  if (messageId) div.dataset.messageId = messageId
  div.innerHTML = `
    <div class="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-sm ${avatarClass}">${emoji}</div>
    <div class="max-w-[75%]">
      <div class="text-xs text-gray-500 mb-1 ${alignClass}">${labelName}</div>
      <div class="rounded-2xl px-4 py-3 text-sm leading-relaxed ${bubbleClass}">
        ${content.replace(/\n/g, '<br>')}
      </div>
      ${audioBtn}
    </div>`

  chatArea.appendChild(div)
  if (scroll) scrollToBottom()

  // 自動再生フラグが ON かつ audioHex がある場合のみ自動再生
  // （再生ボタン自体は ttsEnabled に関わらず常に表示される）
  if (audioStoreKey && state.ttsEnabled) playAudio(audioStoreKey)
  return div
}

// 履歴メッセージを後からTTS変換して再生
async function generateTtsForMessage(messageId, btn) {
  if (!state.selectedCharId) return
  const origHTML = btn.innerHTML
  btn.disabled = true
  btn.innerHTML = '<i class="fas fa-spinner fa-spin text-xs"></i> 生成中…'

  try {
    const data = await api.post('/api/minimax/tts-for-message', {
      message_id: messageId,
      character_id: state.selectedCharId,
    })

    if (data.success && data.data.audio_hex) {
      const key = storeAudio(data.data.audio_hex)
      // ボタン領域を「再生」に切り替え
      const area = btn.closest('.msg-audio-area')
      area.innerHTML = `<button onclick="playAudio('${key}')"
        class="flex items-center gap-1.5 text-xs text-gold-400 hover:text-gold-300 transition-colors bg-gold-500/10 border border-gold-500/30 rounded-full px-3 py-1">
        <i class="fas fa-play text-xs"></i> 再生
      </button>`
      // 即座に再生
      playAudio(key)
    } else {
      btn.disabled = false
      btn.innerHTML = origHTML
      showToast(data.error || 'TTS生成に失敗しました', 'error')
    }
  } catch(e) {
    btn.disabled = false
    btn.innerHTML = origHTML
    showToast('通信エラー: ' + e.message, 'error')
  }
}

function appendThinking() {
  const chatArea = document.getElementById('chat-area')
  const div = document.createElement('div')
  div.className = 'flex gap-3'
  div.id = 'thinking-bubble'
  div.innerHTML = `
    <div class="w-8 h-8 rounded-full bg-gold-500/20 border border-gold-500/30 flex items-center justify-center text-sm">👵</div>
    <div class="chat-bubble-ai rounded-2xl rounded-tl-sm px-4 py-3 text-navy-900">
      <span class="wave-anim text-navy-700"><span>●</span><span>●</span><span>●</span></span>
    </div>`
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

// ── TTS 音声再生 ──────────────────────────────────────────
// audioRef: audioStoreのキー('aud_xxx') または直接のHex文字列（後方互換）
function playAudio(audioRef) {
  try {
    // storeキーならストアから取得、そうでなければ直接Hexとして扱う
    const hex = audioStore[audioRef] || audioRef
    if (!hex || hex.length < 4) {
      showToast('音声データがありません', 'error')
      return
    }
    // Hex → Uint8Array 高速変換
    const len = Math.floor(hex.length / 2)
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
      bytes[i] = (parseInt(hex[i * 2], 16) << 4) | parseInt(hex[i * 2 + 1], 16)
    }
    const blob = new Blob([bytes], { type: 'audio/mpeg' })
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audio.play().catch(e => {
      console.error('Audio play failed:', e)
      // autoplay policy（ユーザー操作なしの自動再生）は黙って無視
      if (e.name !== 'NotAllowedError') {
        showToast('再生に失敗しました: ' + e.message, 'error')
      }
    })
    audio.onended = () => URL.revokeObjectURL(url)
  } catch(e) {
    console.error('Audio play error:', e)
    showToast('再生エラー: ' + e.message, 'error')
  }
}

function toggleTTS() {
  state.ttsEnabled = !state.ttsEnabled
  const icon = document.getElementById('tts-icon')
  const btn  = document.getElementById('btn-tts-toggle')
  const label = document.getElementById('tts-label')
  if (state.ttsEnabled) {
    icon.className = 'fas fa-volume-up text-gold-400'
    btn.classList.remove('border-white/20', 'bg-navy-900/60')
    btn.classList.add('border-gold-500/40')
    if (label) label.textContent = '自動再生 ON'
    showToast('自動再生: ON', 'info')
  } else {
    icon.className = 'fas fa-volume-mute text-gray-500'
    btn.classList.remove('border-gold-500/40')
    btn.classList.add('border-white/20', 'bg-navy-900/60')
    if (label) label.textContent = '自動再生 OFF'
    showToast('自動再生: OFF', 'info')
  }
}

// ── STT 音声入力 ──────────────────────────────────────────
async function toggleRecording() {
  if (!state.isRecording) await startRecording()
  else stopRecording()
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
  const formData = new FormData()
  formData.append('audio_file', audioBlob, 'speech.webm')
  try {
    showToast('音声を文字起こし中…', 'info')
    const response = await fetch('/api/chat/stt', {
      method: 'POST',
      headers: state.sessionToken ? { 'Authorization': 'Bearer ' + state.sessionToken } : {},
      body: formData
    })
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

// ── 声設定 ────────────────────────────────────────────────

// MiniMax 標準ボイス一覧
const PRESET_VOICES = [
  { id: 'Wise_Woman',      name: '知恵ある女性',   gender: 'female',  desc: '落ち着いた知恵ある女性の声' },
  { id: 'Gentle_Man',      name: '穏やかな男性',   gender: 'male',    desc: '温かい穏やかな男性の声' },
  { id: 'Warm_Woman',      name: '温かな女性',     gender: 'female',  desc: '温もりある母性的な声' },
  { id: 'Deep_Voice_Man',  name: '渋い男性',       gender: 'male',    desc: '落ち着きのある渋い声' },
  { id: 'Caring_Lady',     name: '優しい女性',     gender: 'female',  desc: '世話好きな心の温かい声' },
  { id: 'Friendly_Person', name: '親しみやすい',   gender: 'neutral', desc: '親しみやすい中性的な声' },
  { id: 'Narrator',        name: 'ナレーター',     gender: 'neutral', desc: '滑らかなナレーション向きの声' },
]

// ボイスバッジを更新
function updateVoiceBadge(char) {
  const badge = document.getElementById('voice-badge')
  const badgeText = document.getElementById('voice-badge-text')
  if (char && char.voice_id) {
    badge.classList.remove('hidden')
    const preset = PRESET_VOICES.find(v => v.id === char.voice_id)
    badgeText.textContent = preset ? preset.name : char.voice_id
  } else {
    badge.classList.add('hidden')
  }
}

// 声設定モーダルを開く
function openVoiceModal() {
  if (!state.selectedCharId) return showToast('キャラクターを選択してください', 'error')
  const char = state.characters.find(c => c.id === state.selectedCharId)

  // 現在のVoice IDを表示
  const display = document.getElementById('current-voice-display')
  if (char && char.voice_id) {
    const preset = PRESET_VOICES.find(v => v.id === char.voice_id)
    display.textContent = preset ? preset.name + ' (' + char.voice_id + ')' : char.voice_id
  } else {
    display.textContent = '未設定'
  }

  // カスタム入力欄に現在値をセット
  const customInput = document.getElementById('custom-voice-id-input')
  if (customInput && char) customInput.value = char.voice_id || ''

  // プリセットリストをレンダリング
  renderPresetVoiceList(char ? char.voice_id : null)

  // プリセットタブをデフォルトで開く
  switchVoiceTab('preset')
  openModal('modal-voice-clone')
}

// プリセットボイスリストを表示
function renderPresetVoiceList(currentVoiceId) {
  const container = document.getElementById('preset-voice-list')
  container.innerHTML = PRESET_VOICES.map(v => {
    const isSelected = v.id === currentVoiceId
    const borderCls = isSelected
      ? 'border-gold-500/80 bg-gold-500/10'
      : 'border-white/10 bg-navy-900/50 hover:border-gold-500/40'
    const checkIcon = isSelected
      ? '<i class="fas fa-check-circle text-gold-400 text-sm"></i>'
      : '<i class="far fa-circle text-gray-600 text-sm"></i>'
    const genderBadge = `<span class="text-xs px-1.5 py-0.5 rounded bg-white/10 text-gray-400">${v.gender}</span>`
    return `<div class="flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${borderCls}"
        onclick="selectPresetVoice('${v.id}')">
      ${checkIcon}
      <div class="flex-1">
        <div class="text-sm font-medium text-white">${v.name} ${genderBadge}</div>
        <div class="text-xs text-gray-400 mt-0.5">${v.desc}</div>
        <div class="text-xs font-mono text-gray-500 mt-0.5">${v.id}</div>
      </div>
    </div>`
  }).join('')
}

// プリセットボイスを選択して即座に保存
async function selectPresetVoice(voiceId) {
  if (!state.selectedCharId) return
  await applyVoiceId(voiceId)
}

// カスタム入力のVoice IDを保存
async function saveCustomVoiceId() {
  const input = document.getElementById('custom-voice-id-input')
  const voiceId = input ? input.value.trim() : ''
  if (!voiceId) return showToast('Voice IDを入力してください', 'error')
  await applyVoiceId(voiceId)
}

// Voice IDをキャラクターに適用
async function applyVoiceId(voiceId) {
  if (!state.selectedCharId) return
  try {
    const data = await api.put('/api/characters/' + state.selectedCharId + '/voice', { voice_id: voiceId })
    if (data.success) {
      const idx = state.characters.findIndex(c => c.id === state.selectedCharId)
      if (idx >= 0) state.characters[idx] = data.data
      const char = data.data
      updateVoiceBadge(char)
      // モーダル内の表示も更新
      const preset = PRESET_VOICES.find(v => v.id === voiceId)
      const display = document.getElementById('current-voice-display')
      display.textContent = preset ? preset.name + ' (' + voiceId + ')' : voiceId
      renderPresetVoiceList(voiceId)
      showToast('声を「' + (preset ? preset.name : voiceId) + '」に設定しました', 'success')
      closeModal('modal-voice-clone')
    } else {
      showToast(data.error || '保存に失敗しました', 'error')
    }
  } catch(e) {
    showToast('通信エラー: ' + e.message, 'error')
  }
}

// Voice IDをクリア
async function clearVoiceId() {
  if (!state.selectedCharId) return
  if (!confirm('声設定をクリアしますか？')) return
  try {
    const data = await api.put('/api/characters/' + state.selectedCharId + '/voice', { voice_id: '' })
    if (data.success) {
      const idx = state.characters.findIndex(c => c.id === state.selectedCharId)
      if (idx >= 0) state.characters[idx] = data.data
      updateVoiceBadge(data.data)
      document.getElementById('current-voice-display').textContent = '未設定'
      renderPresetVoiceList(null)
      showToast('声設定をクリアしました', 'info')
    }
  } catch(e) {
    showToast('エラー: ' + e.message, 'error')
  }
}

// 声設定モーダル内タブ切り替え
function switchVoiceTab(tab) {
  const tabs = ['preset', 'custom', 'clone']
  tabs.forEach(t => {
    document.getElementById('vpanel-' + t).classList.toggle('hidden', t !== tab)
    const tabEl = document.getElementById('vtab-' + t)
    if (t === tab) {
      tabEl.classList.add('vtab-active')
      tabEl.classList.remove('text-gray-400')
    } else {
      tabEl.classList.remove('vtab-active')
      tabEl.classList.add('text-gray-400')
    }
  })
}

function onVoiceFileSelected(input) {
  const file = input.files[0]
  if (file) document.getElementById('voice-file-label').textContent = file.name
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
  formData.append('voice_name', char ? char.name : 'キャラクター')

  try {
    const response = await fetch('/api/minimax/voice-clone-upload', {
      method: 'POST',
      headers: state.sessionToken ? { 'Authorization': 'Bearer ' + state.sessionToken } : {},
      body: formData
    })
    const data = await response.json()
    if (data.success) {
      // クローン成功: voice_id をキャラクターに自動適用
      const idx = state.characters.findIndex(c => c.id === state.selectedCharId)
      if (idx >= 0 && data.data && data.data.voice_id) {
        state.characters[idx].voice_id = data.data.voice_id
        updateVoiceBadge(state.characters[idx])
      }
      closeModal('modal-voice-clone')
      showToast('ボイスクローンが完了しました！', 'success')
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
  window.location.href = '/api/finetune/export/' + state.selectedCharId
}
function downloadTrainScript() {
  if (!state.selectedCharId) return
  window.location.href = '/api/finetune/script/' + state.selectedCharId
}
function downloadInferenceScript() {
  if (!state.selectedCharId) return
  window.location.href = '/api/finetune/inference-script/' + state.selectedCharId
}

async function clearHistory() {
  if (!state.selectedCharId) return
  if (!confirm('会話履歴をすべて削除しますか？')) return
  await api.delete('/api/chat/history/' + state.selectedCharId)
  await loadChatHistory(state.selectedCharId)
  showToast('会話履歴を削除しました', 'success')
}

// ── UI ヘルパー ───────────────────────────────────────────
function switchSideTab(tab) {
  ['characters','memories','tools'].forEach(t => {
    document.getElementById('panel-' + t).classList.toggle('hidden', t !== tab)
    const tabEl = document.getElementById('tab-' + t)
    if (t === tab) {
      tabEl.classList.add('tab-active')
      tabEl.classList.remove('text-gray-400')
    } else {
      tabEl.classList.remove('tab-active')
      tabEl.classList.add('text-gray-400')
    }
  })
}

function openModal(id)  { document.getElementById(id).classList.remove('hidden') }
function closeModal(id) { document.getElementById(id).classList.add('hidden')    }

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
function showToast(msg, type) {
  if (!type) type = 'info'
  const toast = document.getElementById('toast')
  const colors = {
    success: 'bg-green-500/90 text-white',
    error:   'bg-red-500/90 text-white',
    info:    'bg-navy-700 text-gold-400 border border-gold-500/30',
  }
  toast.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl shadow-2xl text-sm font-medium transition-all ' + (colors[type] || colors.info)
  toast.textContent = msg
  toast.classList.remove('hidden')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3000)
}

// クリックでモーダルを閉じる
document.addEventListener('DOMContentLoaded', () => {
  ['modal-new-character','modal-new-memory','modal-edit-memory','modal-voice-clone'].forEach(id => {
    const el = document.getElementById(id)
    if (el) el.addEventListener('click', (e) => { if (e.target.id === id) closeModal(id) })
  })
  init()
})
