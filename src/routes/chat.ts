import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
  MINIMAX_API_KEY: string
}

const chat = new Hono<{ Bindings: Bindings }>()

const MINIMAX_BASE_URL = 'https://api.minimax.io/v1'

// ─────────────────────────────────────────────
// チャットメッセージ送信
// POST /api/chat
// body: { character_id, message, use_tts? }
// ─────────────────────────────────────────────
chat.post('/', async (c) => {
  const apiKey = c.env?.MINIMAX_API_KEY || ''
  if (!apiKey) return c.json({ success: false, error: 'APIキーが設定されていません' }, 500)

  const body = await c.req.json()
  const { character_id, message, use_tts = true } = body

  if (!character_id || !message) {
    return c.json({ success: false, error: 'character_id と message は必須です' }, 400)
  }

  // キャラクター情報取得
  const character: any = await c.env.DB.prepare(
    'SELECT * FROM characters WHERE id = ?'
  ).bind(character_id).first()

  if (!character) {
    return c.json({ success: false, error: 'キャラクターが見つかりません' }, 404)
  }

  // 記憶コンテキスト取得
  const { results: memoriesRaw } = await c.env.DB.prepare(
    'SELECT title, content, period, location, emotion FROM memories WHERE character_id = ? ORDER BY period ASC LIMIT 20'
  ).bind(character_id).all()

  const memoryContext = memoriesRaw.length > 0
    ? memoriesRaw.map((m: any) => {
        const parts = [`【${m.title}】`]
        if (m.period) parts.push(`時期: ${m.period}`)
        if (m.location) parts.push(`場所: ${m.location}`)
        parts.push(m.content)
        return parts.join(' / ')
      }).join('\n')
    : '（記憶データなし）'

  // 過去の会話履歴（直近10件）
  const { results: history } = await c.env.DB.prepare(
    'SELECT role, content FROM conversations WHERE character_id = ? ORDER BY created_at DESC LIMIT 10'
  ).bind(character_id).all()

  const historyMessages = history.reverse().map((h: any) => ({
    role: h.role,
    content: h.content,
  }))

  // システムプロンプト構築
  const systemPrompt = `あなたは${character.name}という人物です。
${character.age ? `年齢: ${character.age}歳` : ''}
${character.birthplace ? `出身: ${character.birthplace}` : ''}
${character.description ? `人物像: ${character.description}` : ''}

以下はあなた（${character.name}）の大切な記憶と思い出です。これらをもとに、その人物として自然に、温かく話してください。

=== あなたの記憶 ===
${memoryContext}
===================

会話のルール:
- 常に一人称「私」または「わたし」で話す
- 記憶に基づいて具体的なエピソードを語る
- 高齢者らしい丁寧で落ち着いた語り口
- 記憶にない内容を聞かれたら「よく覚えていないけれど…」と答える
- 感情豊かに、でも穏やかに話す
- 返答は200文字以内で簡潔に`

  // MiniMax Chat Completion API 呼び出し
  let aiReplyText = ''
  try {
    const chatMessages = [
      ...historyMessages,
      { role: 'user', content: message }
    ]

    const chatResponse = await fetch(`${MINIMAX_BASE_URL}/text/chatcompletion_v2`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'MiniMax-Text-01',
        messages: [
          { role: 'system', content: systemPrompt },
          ...chatMessages,
        ],
        max_tokens: 300,
        temperature: 0.8,
        top_p: 0.95,
      }),
    })

    if (!chatResponse.ok) {
      const errText = await chatResponse.text()
      console.error('Chat API error:', errText)
      return c.json({ success: false, error: `Chat APIエラー: ${chatResponse.status}` }, 500)
    }

    const chatData: any = await chatResponse.json()
    aiReplyText = chatData.choices?.[0]?.message?.content || 'うまく聞き取れませんでした。もう一度お話しいただけますか？'
  } catch (e: any) {
    console.error('Chat error:', e)
    return c.json({ success: false, error: e.message }, 500)
  }

  // 会話履歴を保存
  await c.env.DB.prepare(
    'INSERT INTO conversations (character_id, role, content) VALUES (?, ?, ?)'
  ).bind(character_id, 'user', message).run()

  // TTS生成（オプション）
  let audioHex: string | null = null
  if (use_tts && aiReplyText) {
    try {
      const voiceId = character.voice_id || 'Wise_Woman'
      const ttsResponse = await fetch(`${MINIMAX_BASE_URL}/t2a_v2`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'speech-02-hd',
          text: aiReplyText,
          stream: false,
          voice_setting: {
            voice_id: voiceId,
            speed: 0.85,
            vol: 1.0,
            pitch: 0,
            emotion: 'nostalgic',
          },
          audio_setting: {
            sample_rate: 32000,
            bitrate: 128000,
            format: 'mp3',
            channel: 1,
          },
        }),
      })

      if (ttsResponse.ok) {
        const ttsData: any = await ttsResponse.json()
        if (ttsData.base_resp?.status_code === 0) {
          audioHex = ttsData.data?.audio || null
        }
      }
    } catch (ttsErr) {
      console.error('TTS error (non-fatal):', ttsErr)
    }
  }

  // AIの返答を会話履歴に保存
  await c.env.DB.prepare(
    'INSERT INTO conversations (character_id, role, content) VALUES (?, ?, ?)'
  ).bind(character_id, 'assistant', aiReplyText).run()

  return c.json({
    success: true,
    data: {
      reply: aiReplyText,
      audio_hex: audioHex,
      character_name: character.name,
    }
  })
})

// ─────────────────────────────────────────────
// 音声入力 (STT) - ブラウザから音声Blobを受け取りテキスト化
// POST /api/chat/stt
// multipart form: audio_file
// ─────────────────────────────────────────────
chat.post('/stt', async (c) => {
  const apiKey = c.env?.MINIMAX_API_KEY || ''
  if (!apiKey) return c.json({ success: false, error: 'APIキーが設定されていません' }, 500)

  let formData: FormData
  try {
    formData = await c.req.formData()
  } catch {
    return c.json({ success: false, error: 'multipart/form-data で送信してください' }, 400)
  }

  const audioFile = formData.get('audio_file') as File | null
  if (!audioFile) {
    return c.json({ success: false, error: 'audio_file は必須です' }, 400)
  }

  // MiniMax Audio-to-Text API (Whisper互換)
  try {
    const sttForm = new FormData()
    sttForm.append('file', audioFile, audioFile.name || 'speech.webm')
    sttForm.append('model', 'speech-01-240228')
    sttForm.append('language', 'ja')

    const sttResponse = await fetch(`${MINIMAX_BASE_URL}/speech/transcriptions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: sttForm,
    })

    if (!sttResponse.ok) {
      // フォールバック: Web Speech APIでの認識をフロントに返す
      return c.json({ success: false, error: 'STT APIエラー、ブラウザ音声認識をお使いください' }, 500)
    }

    const sttData: any = await sttResponse.json()
    const transcript = sttData.text || sttData.data?.text || ''

    return c.json({ success: true, data: { transcript } })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// 会話履歴取得
chat.get('/history/:characterId', async (c) => {
  const characterId = c.req.param('characterId')
  const limit = parseInt(c.req.query('limit') || '50')

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM conversations WHERE character_id = ? ORDER BY created_at ASC LIMIT ?'
  ).bind(characterId, limit).all()

  return c.json({ success: true, data: results })
})

// 会話履歴クリア
chat.delete('/history/:characterId', async (c) => {
  const characterId = c.req.param('characterId')
  await c.env.DB.prepare(
    'DELETE FROM conversations WHERE character_id = ?'
  ).bind(characterId).run()
  return c.json({ success: true, message: '会話履歴を削除しました' })
})

export default chat
