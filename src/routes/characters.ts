import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
  MINIMAX_API_KEY: string
}

const characters = new Hono<{ Bindings: Bindings }>()

// キャラクター一覧取得
characters.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM characters ORDER BY created_at DESC'
  ).all()
  return c.json({ success: true, data: results })
})

// キャラクター詳細取得
characters.get('/:id', async (c) => {
  const id = c.req.param('id')
  const character = await c.env.DB.prepare(
    'SELECT * FROM characters WHERE id = ?'
  ).bind(id).first()

  if (!character) {
    return c.json({ success: false, error: 'キャラクターが見つかりません' }, 404)
  }
  return c.json({ success: true, data: character })
})

// キャラクター作成
characters.post('/', async (c) => {
  const body = await c.req.json()
  const { name, age, birthplace, description } = body

  if (!name) {
    return c.json({ success: false, error: '名前は必須です' }, 400)
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO characters (name, age, birthplace, description) VALUES (?, ?, ?, ?)'
  ).bind(name, age || null, birthplace || null, description || null).run()

  const newCharacter = await c.env.DB.prepare(
    'SELECT * FROM characters WHERE id = ?'
  ).bind(result.meta.last_row_id).first()

  return c.json({ success: true, data: newCharacter }, 201)
})

// キャラクター更新
characters.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const { name, age, birthplace, description, voice_id } = body

  // voice_id は空文字列でクリア可能にするため、undefined かどうかで判定
  const voiceIdValue = voice_id !== undefined ? (voice_id || null) : undefined

  await c.env.DB.prepare(
    `UPDATE characters SET 
      name = COALESCE(?, name),
      age = COALESCE(?, age),
      birthplace = COALESCE(?, birthplace),
      description = COALESCE(?, description),
      voice_id = CASE WHEN ? IS NOT NULL THEN ? ELSE voice_id END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`
  ).bind(
    name || null,
    age || null,
    birthplace || null,
    description || null,
    voiceIdValue !== undefined ? voiceIdValue : null,
    voiceIdValue !== undefined ? voiceIdValue : null,
    id
  ).run()

  const updated = await c.env.DB.prepare(
    'SELECT * FROM characters WHERE id = ?'
  ).bind(id).first()

  return c.json({ success: true, data: updated })
})

// Voice ID 設定（プリセット選択・直接入力・クリア）
// PUT /api/characters/:id/voice
// body: { voice_id }  ← 空文字列でクリア
characters.put('/:id/voice', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const { voice_id } = body  // 空文字列 '' → null でクリア

  await c.env.DB.prepare(
    `UPDATE characters SET voice_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(voice_id || null, id).run()

  const updated = await c.env.DB.prepare(
    'SELECT * FROM characters WHERE id = ?'
  ).bind(id).first()

  return c.json({ success: true, data: updated })
})

// キャラクター削除
characters.delete('/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM characters WHERE id = ?').bind(id).run()
  return c.json({ success: true, message: '削除しました' })
})

export default characters
