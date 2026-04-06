import { Hono } from 'hono'
import { validateSession } from './auth'

type Bindings = {
  DB: D1Database
  MINIMAX_API_KEY: string
}

const chat = new Hono<{ Bindings: Bindings }>()

const MINIMAX_BASE_URL = 'https://api.minimax.io/v1'

function getToken(c: any): string | undefined {
  return c.req.header('Authorization')?.replace('Bearer ', '')
}

// ─────────────────────────────────────────────────────────
// セッション一覧取得
// GET /api/chat/sessions/:characterId
// ─────────────────────────────────────────────────────────
chat.get('/sessions/:characterId', async (c) => {
  const user = await validateSession(c.env.DB, getToken(c))
  if (!user) return c.json({ success: false, error: '認証が必要です' }, 401)

  const characterId = c.req.param('characterId')
  const ch = await c.env.DB.prepare(
    'SELECT id FROM characters WHERE id = ? AND user_id = ?'
  ).bind(characterId, user.id).first()
  if (!ch) return c.json({ success: false, error: 'キャラクターが見つかりません' }, 404)

  const { results } = await c.env.DB.prepare(
    `SELECT cs.id, cs.title, cs.summary, cs.is_pinned, cs.created_at,
      (SELECT COUNT(*) FROM conversations WHERE session_id = cs.id) as message_count
     FROM conversation_sessions cs
     WHERE cs.character_id = ?
     ORDER BY cs.created_at DESC`
  ).bind(characterId).all()

  return c.json({ success: true, data: results })
})

// ─────────────────────────────────────────────────────────
// 新規セッション作成
// POST /api/chat/sessions
// body: { character_id, title? }
// ─────────────────────────────────────────────────────────
chat.post('/sessions', async (c) => {
  const user = await validateSession(c.env.DB, getToken(c))
  if (!user) return c.json({ success: false, error: '認証が必要です' }, 401)

  const body = await c.req.json()
  const { character_id, title } = body
  if (!character_id) return c.json({ success: false, error: 'character_id は必須です' }, 400)

  const ch = await c.env.DB.prepare(
    'SELECT id FROM characters WHERE id = ? AND user_id = ?'
  ).bind(character_id, user.id).first()
  if (!ch) return c.json({ success: false, error: 'キャラクターが見つかりません' }, 404)

  const sessionTitle = title || `会話 ${new Date().toLocaleDateString('ja-JP')}`
  const result = await c.env.DB.prepare(
    'INSERT INTO conversation_sessions (character_id, title) VALUES (?, ?)'
  ).bind(character_id, sessionTitle).run()

  const session = await c.env.DB.prepare(
    'SELECT * FROM conversation_sessions WHERE id = ?'
  ).bind(result.meta.last_row_id).first()

  return c.json({ success: true, data: session })
})

// ─────────────────────────────────────────────────────────
// セッション削除
// DELETE /api/chat/sessions/:sessionId
// ─────────────────────────────────────────────────────────
chat.delete('/sessions/:sessionId', async (c) => {
  const user = await validateSession(c.env.DB, getToken(c))
  if (!user) return c.json({ success: false, error: '認証が必要です' }, 401)

  const sessionId = c.req.param('sessionId')
  const session = await c.env.DB.prepare(
    `SELECT cs.id FROM conversation_sessions cs
     JOIN characters ch ON cs.character_id = ch.id
     WHERE cs.id = ? AND ch.user_id = ?`
  ).bind(sessionId, user.id).first()
  if (!session) return c.json({ success: false, error: 'セッションが見つかりません' }, 404)

  await c.env.DB.prepare('DELETE FROM conversation_sessions WHERE id = ?').bind(sessionId).run()
  return c.json({ success: true, message: '会話を削除しました' })
})

// ─────────────────────────────────────────────────────────
// セッションのpin切り替え（記憶に引き継ぐ）
// PUT /api/chat/sessions/:sessionId/pin
// body: { is_pinned: 0|1 }
// ─────────────────────────────────────────────────────────
chat.put('/sessions/:sessionId/pin', async (c) => {
  const user = await validateSession(c.env.DB, getToken(c))
  if (!user) return c.json({ success: false, error: '認証が必要です' }, 401)

  const sessionId = c.req.param('sessionId')
  const body = await c.req.json()
  const is_pinned = body.is_pinned ? 1 : 0

  const session = await c.env.DB.prepare(
    `SELECT cs.id, cs.character_id FROM conversation_sessions cs
     JOIN characters ch ON cs.character_id = ch.id
     WHERE cs.id = ? AND ch.user_id = ?`
  ).bind(sessionId, user.id).first() as any
  if (!session) return c.json({ success: false, error: 'セッションが見つかりません' }, 404)

  // pinにする場合はサマリーが未生成なら自動生成
  if (is_pinned && !session.summary) {
    await generateSessionSummary(c.env.DB, c.env.MINIMAX_API_KEY, sessionId, session.character_id)
  }

  await c.env.DB.prepare(
    'UPDATE conversation_sessions SET is_pinned = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(is_pinned, sessionId).run()

  const updated = await c.env.DB.prepare(
    'SELECT * FROM conversation_sessions WHERE id = ?'
  ).bind(sessionId).first()

  return c.json({ success: true, data: updated })
})

// ─────────────────────────────────────────────────────────
// セッションのサマリーを手動生成
// POST /api/chat/sessions/:sessionId/summarize
// ─────────────────────────────────────────────────────────
chat.post('/sessions/:sessionId/summarize', async (c) => {
  const user = await validateSession(c.env.DB, getToken(c))
  if (!user) return c.json({ success: false, error: '認証が必要です' }, 401)

  const sessionId = c.req.param('sessionId')
  const session = await c.env.DB.prepare(
    `SELECT cs.id, cs.character_id FROM conversation_sessions cs
     JOIN characters ch ON cs.character_id = ch.id
     WHERE cs.id = ? AND ch.user_id = ?`
  ).bind(sessionId, user.id).first() as any
  if (!session) return c.json({ success: false, error: 'セッションが見つかりません' }, 404)

  const summary = await generateSessionSummary(c.env.DB, c.env.MINIMAX_API_KEY, sessionId, session.character_id)
  return c.json({ success: true, data: { summary } })
})

// ── サマリー生成ヘルパー ──────────────────────────────────
async function generateSessionSummary(db: D1Database, apiKey: string, sessionId: string | number, characterId: number): Promise<string> {
  const { results: msgs } = await db.prepare(
    `SELECT role, content FROM conversations
     WHERE session_id = ?
     ORDER BY created_at ASC LIMIT 30`
  ).bind(sessionId).all() as any

  if (!msgs || msgs.length === 0) return ''

  const transcript = msgs.map((m: any) => `${m.role === 'user' ? 'ユーザー' : 'キャラクター'}: ${m.content}`).join('\n')
  const char: any = await db.prepare('SELECT name FROM characters WHERE id = ?').bind(characterId).first()
  const charName = char?.name || 'キャラクター'

  try {
    const resp = await fetch(`${MINIMAX_BASE_URL}/text/chatcompletion_v2`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'MiniMax-Text-01',
        messages: [
          {
            role: 'system',
            content: `以下の会話録を読み、${charName}との会話の要点を3〜5文で日本語でまとめてください。話題・感情・重要な出来事を含めてください。`,
          },
          { role: 'user', content: transcript },
        ],
        max_tokens: 200,
        temperature: 0.5,
      }),
    })

    if (resp.ok) {
      const data: any = await resp.json()
      const summary = data.choices?.[0]?.message?.content || ''
      if (summary) {
        await db.prepare(
          'UPDATE conversation_sessions SET summary = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
        ).bind(summary, sessionId).run()
        return summary
      }
    }
  } catch (e) {
    console.error('Summary generation error:', e)
  }
  return ''
}

// ─────────────────────────────────────────────────────────
// チャットメッセージ送信
// POST /api/chat
// body: { character_id, message, use_tts?, session_id? }
// ─────────────────────────────────────────────────────────
chat.post('/', async (c) => {
  const user = await validateSession(c.env.DB, getToken(c))
  if (!user) return c.json({ success: false, error: '認証が必要です' }, 401)

  const apiKey = c.env?.MINIMAX_API_KEY || ''
  if (!apiKey) return c.json({ success: false, error: 'APIキーが設定されていません' }, 500)

  const body = await c.req.json()
  const { character_id, message, use_tts = true, session_id } = body

  if (!character_id || !message) {
    return c.json({ success: false, error: 'character_id と message は必須です' }, 400)
  }

  // キャラクター情報取得（所有権確認込み）
  const character: any = await c.env.DB.prepare(
    'SELECT * FROM characters WHERE id = ? AND user_id = ?'
  ).bind(character_id, user.id).first()

  if (!character) {
    return c.json({ success: false, error: 'キャラクターが見つかりません' }, 404)
  }

  // セッション確認/作成
  let currentSessionId = session_id
  if (currentSessionId) {
    const sess = await c.env.DB.prepare(
      `SELECT cs.id FROM conversation_sessions cs
       JOIN characters ch ON cs.character_id = ch.id
       WHERE cs.id = ? AND ch.user_id = ?`
    ).bind(currentSessionId, user.id).first()
    if (!sess) {
      return c.json({ success: false, error: 'セッションが見つかりません' }, 404)
    }
  } else {
    // session_id未指定なら自動作成
    const newSess = await c.env.DB.prepare(
      'INSERT INTO conversation_sessions (character_id, title) VALUES (?, ?)'
    ).bind(character_id, `会話 ${new Date().toLocaleDateString('ja-JP')}`).run()
    currentSessionId = newSess.meta.last_row_id
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

  // pinされた過去会話のサマリーを引き継ぎコンテキストとして追加
  const { results: pinnedSessions } = await c.env.DB.prepare(
    `SELECT title, summary FROM conversation_sessions
     WHERE character_id = ? AND is_pinned = 1 AND id != ? AND summary IS NOT NULL AND summary != ''
     ORDER BY created_at DESC LIMIT 5`
  ).bind(character_id, currentSessionId).all()

  const pinnedContext = pinnedSessions.length > 0
    ? '\n=== 過去の会話の引き継ぎ ===\n' +
      pinnedSessions.map((s: any) => `【${s.title}】\n${s.summary}`).join('\n\n') +
      '\n==========================='
    : ''

  // 現在のセッションの会話履歴（直近10件）
  const { results: history } = await c.env.DB.prepare(
    'SELECT role, content FROM conversations WHERE session_id = ? ORDER BY created_at DESC LIMIT 10'
  ).bind(currentSessionId).all()

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
===================${pinnedContext}

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

  // 会話履歴を保存（session_id付き）
  await c.env.DB.prepare(
    'INSERT INTO conversations (character_id, session_id, role, content) VALUES (?, ?, ?, ?)'
  ).bind(character_id, currentSessionId, 'user', message).run()

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
          model: 'speech-2.8-turbo',
          text: aiReplyText,
          stream: false,
          voice_setting: {
            voice_id: voiceId,
            speed: 0.85,
            vol: 1.0,
            pitch: 0,
            emotion: 'neutral',
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
        } else {
          console.error('TTS status error:', ttsData.base_resp)
        }
      } else {
        const errBody = await ttsResponse.text()
        console.error('TTS HTTP error:', ttsResponse.status, errBody)
      }
    } catch (ttsErr) {
      console.error('TTS error (non-fatal):', ttsErr)
    }
  }

  // AIの返答を会話履歴に保存（session_id付き）
  const assistantRow = await c.env.DB.prepare(
    'INSERT INTO conversations (character_id, session_id, role, content, audio_hex) VALUES (?, ?, ?, ?, ?)'
  ).bind(character_id, currentSessionId, 'assistant', aiReplyText, audioHex).run()
  const assistantMsgId = assistantRow.meta.last_row_id

  // セッションの updated_at を更新
  await c.env.DB.prepare(
    'UPDATE conversation_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(currentSessionId).run()

  const userRow = await c.env.DB.prepare(
    'SELECT id FROM conversations WHERE session_id = ? AND role = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(currentSessionId, 'user').first() as any
  const userMsgId = userRow?.id || null

  return c.json({
    success: true,
    data: {
      reply: aiReplyText,
      audio_hex: audioHex,
      character_name: character.name,
      message_id: assistantMsgId,
      user_message_id: userMsgId,
      session_id: currentSessionId,
    }
  })
})

// ─────────────────────────────────────────────────────────
// 音声入力 (STT)
// ─────────────────────────────────────────────────────────
chat.post('/stt', async (c) => {
  const user = await validateSession(c.env.DB, getToken(c))
  if (!user) return c.json({ success: false, error: '認証が必要です' }, 401)

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
      return c.json({ success: false, error: 'STT APIエラー、ブラウザ音声認識をお使いください' }, 500)
    }

    const sttData: any = await sttResponse.json()
    const transcript = sttData.text || sttData.data?.text || ''

    return c.json({ success: true, data: { transcript } })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// 会話履歴取得（セッション別）
// GET /api/chat/history/:characterId?session_id=xxx
chat.get('/history/:characterId', async (c) => {
  const user = await validateSession(c.env.DB, getToken(c))
  if (!user) return c.json({ success: false, error: '認証が必要です' }, 401)

  const characterId = c.req.param('characterId')
  const sessionId = c.req.query('session_id')

  const ch = await c.env.DB.prepare(
    'SELECT id FROM characters WHERE id = ? AND user_id = ?'
  ).bind(characterId, user.id).first()
  if (!ch) return c.json({ success: false, error: 'キャラクターが見つかりません' }, 404)

  const limit = parseInt(c.req.query('limit') || '50')
  let results

  if (sessionId) {
    // 特定セッションの履歴
    const r = await c.env.DB.prepare(
      'SELECT id, character_id, session_id, role, content, audio_hex, created_at FROM conversations WHERE character_id = ? AND session_id = ? ORDER BY created_at ASC LIMIT ?'
    ).bind(characterId, sessionId, limit).all()
    results = r.results
  } else {
    // 最新セッションの履歴（後方互換）
    const latestSession: any = await c.env.DB.prepare(
      'SELECT id FROM conversation_sessions WHERE character_id = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(characterId).first()
    if (latestSession) {
      const r = await c.env.DB.prepare(
        'SELECT id, character_id, session_id, role, content, audio_hex, created_at FROM conversations WHERE character_id = ? AND session_id = ? ORDER BY created_at ASC LIMIT ?'
      ).bind(characterId, latestSession.id, limit).all()
      results = r.results
    } else {
      results = []
    }
  }

  return c.json({ success: true, data: results })
})

// 会話履歴クリア（セッション別）
chat.delete('/history/:characterId', async (c) => {
  const user = await validateSession(c.env.DB, getToken(c))
  if (!user) return c.json({ success: false, error: '認証が必要です' }, 401)

  const characterId = c.req.param('characterId')
  const sessionId = c.req.query('session_id')

  const ch = await c.env.DB.prepare(
    'SELECT id FROM characters WHERE id = ? AND user_id = ?'
  ).bind(characterId, user.id).first()
  if (!ch) return c.json({ success: false, error: 'キャラクターが見つかりません' }, 404)

  if (sessionId) {
    await c.env.DB.prepare('DELETE FROM conversations WHERE character_id = ? AND session_id = ?').bind(characterId, sessionId).run()
  } else {
    await c.env.DB.prepare('DELETE FROM conversations WHERE character_id = ?').bind(characterId).run()
  }
  return c.json({ success: true, message: '会話履歴を削除しました' })
})

export default chat
