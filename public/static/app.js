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
  async put(path, body) {
    const r = await fetch(path, {
      method: 'PUT',
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

  const voiceBadge = document.getElementById('voice-badge')
  if (char.voice_id) voiceBadge.classList.remove('hidden')
  else voiceBadge.classList.add('hidden')

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
      use_tts: state.ttsEnabled,
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
  if (!isUser) {
    if (audioHex) {
      // TTS済み: 再生ボタン
      audioBtn = `<div class="msg-audio-area mt-2 flex items-center gap-2">
        <button onclick="playAudio('${audioHex}')"
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

  if (audioHex && state.ttsEnabled) playAudio(audioHex)
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
      const audioHex = data.data.audio_hex
      // ボタン領域を「再生」に切り替え
      const area = btn.closest('.msg-audio-area')
      area.innerHTML = `<button onclick="playAudio('${audioHex}')"
        class="flex items-center gap-1.5 text-xs text-gold-400 hover:text-gold-300 transition-colors bg-gold-500/10 border border-gold-500/30 rounded-full px-3 py-1">
        <i class="fas fa-play text-xs"></i> 再生
      </button>`
      // 即座に再生
      playAudio(audioHex)
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
function playAudio(audioHex) {
  try {
    const bytes = new Uint8Array(audioHex.length / 2)
    for (let i = 0; i < audioHex.length; i += 2) {
      bytes[i / 2] = parseInt(audioHex.substr(i, 2), 16)
    }
    const blob = new Blob([bytes], { type: 'audio/mpeg' })
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audio.play()
    audio.onended = () => URL.revokeObjectURL(url)
  } catch(e) {
    console.error('Audio play error:', e)
  }
}

function toggleTTS() {
  state.ttsEnabled = !state.ttsEnabled
  const icon = document.getElementById('tts-icon')
  const btn  = document.getElementById('btn-tts-toggle')
  if (state.ttsEnabled) {
    icon.className = 'fas fa-volume-up text-gold-400'
    btn.classList.remove('border-white/20')
    btn.classList.add('border-gold-500/40')
    showToast('音声読み上げ: ON', 'info')
  } else {
    icon.className = 'fas fa-volume-mute text-gray-500'
    btn.classList.remove('border-gold-500/40')
    btn.classList.add('border-white/20')
    showToast('音声読み上げ: OFF', 'info')
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

// ── ボイスクローン ────────────────────────────────────────
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
