import { Hono } from 'hono'
import { validateSession } from './auth'

type Bindings = {
  DB: D1Database
  MINIMAX_API_KEY: string
}

const characters = new Hono<{ Bindings: Bindings }>()

// ── セッション取得ヘルパー ─────────────────────────────────
function getToken(c: any): string | undefined {
  return c.req.header('Authorization')?.replace('Bearer ', '')
}

// キャラクター一覧取得（自分のもののみ）
characters.get('/', async (c) => {
  const user = await validateSession(c.env.DB, getToken(c))
  if (!user) return c.json({ success: false, error: '認証が必要です' }, 401)

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM characters WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(user.id).all()
  return c.json({ success: true, data: results })
})

// キャラクター詳細取得
characters.get('/:id', async (c) => {
  const user = await validateSession(c.env.DB, getToken(c))
  if (!user) return c.json({ success: false, error: '認証が必要です' }, 401)

  const id = c.req.param('id')
  const character = await c.env.DB.prepare(
    'SELECT * FROM characters WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first()

  if (!character) {
    return c.json({ success: false, error: 'キャラクターが見つかりません' }, 404)
  }
  return c.json({ success: true, data: character })
})

// キャラクター作成
characters.post('/', async (c) => {
  const user = await validateSession(c.env.DB, getToken(c))
  if (!user) return c.json({ success: false, error: '認証が必要です' }, 401)

  const body = await c.req.json()
  const { name, age, birthplace, description } = body

  if (!name) {
    return c.json({ success: false, error: '名前は必須です' }, 400)
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO characters (name, age, birthplace, description, user_id) VALUES (?, ?, ?, ?, ?)'
  ).bind(name, age || null, birthplace || null, description || null, user.id).run()

  const newCharacter = await c.env.DB.prepare(
    'SELECT * FROM characters WHERE id = ?'
  ).bind(result.meta.last_row_id).first()

  return c.json({ success: true, data: newCharacter }, 201)
})

// キャラクター更新
characters.put('/:id', async (c) => {
  const user = await validateSession(c.env.DB, getToken(c))
  if (!user) return c.json({ success: false, error: '認証が必要です' }, 401)

  const id = c.req.param('id')
  const body = await c.req.json()
  const { name, age, birthplace, description, voice_id } = body

  const voiceIdValue = voice_id !== undefined ? (voice_id || null) : undefined

  await c.env.DB.prepare(
    `UPDATE characters SET 
      name = COALESCE(?, name),
      age = COALESCE(?, age),
      birthplace = COALESCE(?, birthplace),
      description = COALESCE(?, description),
      voice_id = CASE WHEN ? IS NOT NULL THEN ? ELSE voice_id END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?`
  ).bind(
    name || null,
    age || null,
    birthplace || null,
    description || null,
    voiceIdValue !== undefined ? voiceIdValue : null,
    voiceIdValue !== undefined ? voiceIdValue : null,
    id,
    user.id
  ).run()

  const updated = await c.env.DB.prepare(
    'SELECT * FROM characters WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first()

  return c.json({ success: true, data: updated })
})

// Voice ID 設定
characters.put('/:id/voice', async (c) => {
  const user = await validateSession(c.env.DB, getToken(c))
  if (!user) return c.json({ success: false, error: '認証が必要です' }, 401)

  const id = c.req.param('id')
  const body = await c.req.json()
  const { voice_id } = body

  await c.env.DB.prepare(
    `UPDATE characters SET voice_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`
  ).bind(voice_id || null, id, user.id).run()

  const updated = await c.env.DB.prepare(
    'SELECT * FROM characters WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first()

  return c.json({ success: true, data: updated })
})

// キャラクター削除
characters.delete('/:id', async (c) => {
  const user = await validateSession(c.env.DB, getToken(c))
  if (!user) return c.json({ success: false, error: '認証が必要です' }, 401)

  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM characters WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  return c.json({ success: true, message: '削除しました' })
})

export default characters
