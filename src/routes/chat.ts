import { Hono } from 'hono'
import { validateSession } from './auth'

type Bindings = {
  DB: D1Database
  MINIMAX_API_KEY: string
  GEMINI_API_KEY: string
}

const chat = new Hono<{ Bindings: Bindings }>()

const MINIMAX_BASE_URL = 'https://api.minimax.io/v1'
// Gemma 4 31B IT（テキスト生成用）
const GEMINI_MODEL = 'gemma-4-31b-it'
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

function getToken(c: any): string | undefined {
  return c.req.header('Authorization')?.replace('Bearer ', '')
}

// ── Gemma 4 テキスト生成ヘルパー ─────────────────────────────
// Gemma 4 31B IT を Gemini API (generateContent) 経由で呼び出す
// Gemma 4 はthinkingタグ <|channel>thought\n...<channel|> を出力する場合があるため除去する
function stripThinkingTags(text: string): string {
  // <|channel>thought\n...<channel|> 形式のthinkingブロックを除去
  return text
    .replace(/<\|channel>thought\n[\s\S]*?<channel\|>/g, '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim()
}

async function callGemini(
  apiKey: string,
  systemInstruction: string,
  history: { role: string; content: string }[],
  userMessage: string,
  options: { maxTokens?: number; temperature?: number } = {}
): Promise<string> {
  const { maxTokens = 400, temperature = 1.0 } = options

  // Gemini API は role が 'user' / 'model'
  const contents = [
    ...history.map(h => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }],
    })),
    { role: 'user', parts: [{ text: userMessage }] },
  ]

  const body = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents,
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature,
      topP: 0.95,
      topK: 64,
    },
  }

  const resp = await fetch(
    `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )

  if (!resp.ok) {
    const errText = await resp.text()
    console.error('Gemma API error:', resp.status, errText)
    throw new Error(`Gemma APIエラー: ${resp.status} - ${errText.slice(0, 200)}`)
  }

  const data: any = await resp.json()

  const parts = data.candidates?.[0]?.content?.parts || []

  // Gemma 4 は thought=true（内部推論）と thought=false（実際の返答）の 2 種類の part を返す
  // thought=false の part だけを取り出す。なければ全 part を使う
  const answerParts = parts.filter((p: any) => p.thought !== true)
  const rawText = answerParts.length > 0
    ? answerParts.map((p: any) => p.text || '').join('')
    : parts.map((p: any) => p.text || '').join('')

  if (!rawText) {
    console.error('Gemma empty response:', JSON.stringify(data).slice(0, 500))
    throw new Error('Gemma から空の応答が返されました')
  }

  // 念のため残存 thinking タグも除去して返す
  const cleaned = stripThinkingTags(rawText)
  return cleaned || rawText.trim()
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
// セッションのタイトル更新
// PUT /api/chat/sessions/:sessionId/title
// body: { title: string }
// ─────────────────────────────────────────────────────────
chat.put('/sessions/:sessionId/title', async (c) => {
  const user = await validateSession(c.env.DB, getToken(c))
  if (!user) return c.json({ success: false, error: '認証が必要です' }, 401)

  const sessionId = c.req.param('sessionId')
  const body = await c.req.json()
  const title = (body.title || '').trim()
  if (!title) return c.json({ success: false, error: 'タイトルを入力してください' }, 400)
  if (title.length > 50) return c.json({ success: false, error: 'タイトルは50文字以内で入力してください' }, 400)

  const session = await c.env.DB.prepare(
    `SELECT cs.id FROM conversation_sessions cs
     JOIN characters ch ON cs.character_id = ch.id
     WHERE cs.id = ? AND ch.user_id = ?`
  ).bind(sessionId, user.id).first()
  if (!session) return c.json({ success: false, error: 'セッションが見つかりません' }, 404)

  await c.env.DB.prepare(
    'UPDATE conversation_sessions SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(title, sessionId).run()

  const updated = await c.env.DB.prepare(
    'SELECT * FROM conversation_sessions WHERE id = ?'
  ).bind(sessionId).first()

  return c.json({ success: true, data: updated })
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
    `SELECT cs.id, cs.character_id, cs.summary FROM conversation_sessions cs
     JOIN characters ch ON cs.character_id = ch.id
     WHERE cs.id = ? AND ch.user_id = ?`
  ).bind(sessionId, user.id).first() as any
  if (!session) return c.json({ success: false, error: 'セッションが見つかりません' }, 404)

  // pinにする場合はサマリーが未生成なら自動生成
  if (is_pinned && !session.summary) {
    await generateSessionSummary(c.env.DB, c.env.GEMINI_API_KEY, sessionId, session.character_id)
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

  const summary = await generateSessionSummary(c.env.DB, c.env.GEMINI_API_KEY, sessionId, session.character_id)
  return c.json({ success: true, data: { summary } })
})

// ── サマリー生成ヘルパー（Gemini使用）────────────────────
async function generateSessionSummary(
  db: D1Database,
  geminiApiKey: string,
  sessionId: string | number,
  characterId: number
): Promise<string> {
  const { results: msgs } = await db.prepare(
    `SELECT role, content FROM conversations
     WHERE session_id = ?
     ORDER BY created_at ASC LIMIT 30`
  ).bind(sessionId).all() as any

  if (!msgs || msgs.length === 0) return ''

  const transcript = msgs
    .map((m: any) => `${m.role === 'user' ? 'ユーザー' : 'キャラクター'}: ${m.content}`)
    .join('\n')
  const char: any = await db.prepare('SELECT name FROM characters WHERE id = ?').bind(characterId).first()
  const charName = char?.name || 'キャラクター'

  try {
    const summary = await callGemini(
      geminiApiKey,
      `あなたは会話記録を要約するアシスタントです。必ず日本語のみで出力してください。説明・注釈・英語は一切不要です。会話の要点だけを3〜5文の日本語で簡潔にまとめてください。`,
      [],
      `以下は${charName}との会話記録です。話題・感情・重要な出来事を含めて要点を日本語でまとめてください:\n\n${transcript}`,
      { maxTokens: 250, temperature: 0.5 }
    )
    if (summary) {
      // summary も 1000 文字に切り詰めて SQLITE_TOOBIG を防ぐ
      const summaryForDb = summary.slice(0, 1000)
      await db.prepare(
        'UPDATE conversation_sessions SET summary = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).bind(summaryForDb, sessionId).run()
      return summaryForDb
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

  const geminiApiKey = c.env?.GEMINI_API_KEY || ''
  const minimaxApiKey = c.env?.MINIMAX_API_KEY || ''
  if (!geminiApiKey) return c.json({ success: false, error: 'GEMINI_API_KEY が設定されていません' }, 500)

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

  // システムプロンプト構築（Gemma 4向けに明確な指示形式）
  const systemPrompt = `あなたは今から「${character.name}」という人物を演じてください。

【キャラクター情報】
名前: ${character.name}
${character.age ? `年齢: ${character.age}歳` : ''}
${character.birthplace ? `出身: ${character.birthplace}` : ''}
${character.description ? `人物像: ${character.description}` : ''}

【あなたの記憶】
${memoryContext || '（記憶は登録されていません）'}
${pinnedContext}

【厳守するルール】
- 必ず日本語のみで返答する
- 絶対にキャラクターの台詞だけを出力する（説明や注釈は一切不要）
- 「${character.name}:」「キャラクター:」などのプレフィックスは付けない
- 一人称は「私」または「わたし」を使う
- 記憶にある内容を会話に自然に織り交ぜる
- 記憶にないことは「そうですねぇ、よく覚えておりませんが…」と答える
- 高齢者らしい丁寧で温かみのある語り口
- 返答は150文字以内で、簡潔に1〜3文でまとめる`

  // Gemma 4 でテキスト生成
  let aiReplyText = ''
  try {
    aiReplyText = await callGemini(
      geminiApiKey,
      systemPrompt,
      historyMessages,
      message,
      { maxTokens: 300, temperature: 1.0 }
    )
  } catch (e: any) {
    console.error('Gemini chat error:', e)
    return c.json({ success: false, error: e.message || 'AI応答の生成に失敗しました' }, 500)
  }

  if (!aiReplyText) {
    aiReplyText = 'うまく聞き取れませんでした。もう一度お話しいただけますか？'
  }

  // 会話履歴を保存（session_id付き、2000文字に切り詰めてSQLITE_TOOBIGを防ぐ）
  await c.env.DB.prepare(
    'INSERT INTO conversations (character_id, session_id, role, content) VALUES (?, ?, ?, ?)'
  ).bind(character_id, currentSessionId, 'user', message.slice(0, 2000)).run()

  // TTS生成（MiniMaxのまま維持）
  let audioHex: string | null = null
  if (use_tts && aiReplyText && minimaxApiKey) {
    try {
      const voiceId = character.voice_id || 'Wise_Woman'
      const ttsResponse = await fetch(`${MINIMAX_BASE_URL}/t2a_v2`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${minimaxApiKey}`,
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

  // AIの返答を会話履歴に保存（audio_hexはSQLITE_TOOBIGを防ぐためDBに保存しない）
  // aiReplyTextも念のため2000文字に切り詰め
  const replyForDb = aiReplyText.slice(0, 2000)
  const assistantRow = await c.env.DB.prepare(
    'INSERT INTO conversations (character_id, session_id, role, content) VALUES (?, ?, ?, ?)'
  ).bind(character_id, currentSessionId, 'assistant', replyForDb).run()
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
// 音声入力 (STT) - Gemini API (インライン base64)
// ─────────────────────────────────────────────────────────
chat.post('/stt', async (c) => {
  const user = await validateSession(c.env.DB, getToken(c))
  if (!user) return c.json({ success: false, error: '認証が必要です' }, 401)

  const geminiApiKey = c.env?.GEMINI_API_KEY || ''
  if (!geminiApiKey) return c.json({ success: false, error: 'GEMINI_API_KEY が設定されていません' }, 500)

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
    // File → ArrayBuffer → base64
    const arrayBuffer = await audioFile.arrayBuffer()
    const uint8 = new Uint8Array(arrayBuffer)
    let binary = ''
    for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i])
    const base64Audio = btoa(binary)

    // MIME タイプ判定（WebM / WAV / MP3 / AAC / OGG / FLAC 対応）
    const fileName = audioFile.name || ''
    const fileType = audioFile.type || ''
    let mimeType = fileType || 'audio/webm'
    if (!mimeType.startsWith('audio/')) {
      if (fileName.endsWith('.wav')) mimeType = 'audio/wav'
      else if (fileName.endsWith('.mp3')) mimeType = 'audio/mp3'
      else if (fileName.endsWith('.ogg')) mimeType = 'audio/ogg'
      else if (fileName.endsWith('.flac')) mimeType = 'audio/flac'
      else if (fileName.endsWith('.aac')) mimeType = 'audio/aac'
      else mimeType = 'audio/webm'
    }

    // Gemini API へ送信（gemini-2.0-flash はマルチモーダル音声対応）
    const geminiRes = await fetch(
      `${GEMINI_API_BASE}/gemini-2.0-flash:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                text: '以下の音声を日本語で文字起こしして。発話内容のテキストのみ返して。説明や注釈は不要。発話がない場合は空文字列だけ返して。',
              },
              {
                inlineData: { mimeType, data: base64Audio },
              },
            ],
          }],
          generationConfig: { temperature: 0 },
        }),
      }
    )

    if (!geminiRes.ok) {
      const errText = await geminiRes.text()
      console.error('Gemini STT error:', errText)
      return c.json({ success: false, error: 'STT APIエラー' }, 500)
    }

    const geminiData: any = await geminiRes.json()
    const rawText: string = geminiData.candidates?.[0]?.content?.parts
      ?.map((p: any) => p.text || '')
      .join('') || ''
    const transcript = rawText.trim()

    return c.json({ success: true, data: { transcript } })
  } catch (e: any) {
    console.error('STT exception:', e.message)
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
    const r = await c.env.DB.prepare(
      'SELECT id, character_id, session_id, role, content, audio_hex, created_at FROM conversations WHERE character_id = ? AND session_id = ? ORDER BY created_at ASC LIMIT ?'
    ).bind(characterId, sessionId, limit).all()
    results = r.results
  } else {
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
