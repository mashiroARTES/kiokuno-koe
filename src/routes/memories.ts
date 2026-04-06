import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
}

const memories = new Hono<{ Bindings: Bindings }>()

// 記憶一覧（キャラクター別）
memories.get('/character/:characterId', async (c) => {
  const characterId = c.req.param('characterId')
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM memories WHERE character_id = ? ORDER BY created_at DESC'
  ).bind(characterId).all()
  return c.json({ success: true, data: results })
})

// 記憶詳細
memories.get('/:id', async (c) => {
  const id = c.req.param('id')
  const memory = await c.env.DB.prepare(
    'SELECT * FROM memories WHERE id = ?'
  ).bind(id).first()

  if (!memory) {
    return c.json({ success: false, error: '記憶が見つかりません' }, 404)
  }
  return c.json({ success: true, data: memory })
})

// 記憶追加
memories.post('/', async (c) => {
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

  const newMemory = await c.env.DB.prepare(
    'SELECT * FROM memories WHERE id = ?'
  ).bind(result.meta.last_row_id).first()

  return c.json({ success: true, data: newMemory }, 201)
})

// 記憶更新
memories.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const { title, content, period, location, emotion } = body

  await c.env.DB.prepare(
    `UPDATE memories SET
      title = COALESCE(?, title),
      content = COALESCE(?, content),
      period = COALESCE(?, period),
      location = COALESCE(?, location),
      emotion = COALESCE(?, emotion)
    WHERE id = ?`
  ).bind(title || null, content || null, period || null, location || null, emotion || null, id).run()

  const updated = await c.env.DB.prepare(
    'SELECT * FROM memories WHERE id = ?'
  ).bind(id).first()

  return c.json({ success: true, data: updated })
})

// 記憶削除
memories.delete('/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM memories WHERE id = ?').bind(id).run()
  return c.json({ success: true, message: '削除しました' })
})

// キャラクターの全記憶をコンテキスト用に結合取得
memories.get('/context/:characterId', async (c) => {
  const characterId = c.req.param('characterId')
  const { results } = await c.env.DB.prepare(
    'SELECT title, content, period, location, emotion FROM memories WHERE character_id = ? ORDER BY period ASC'
  ).bind(characterId).all()

  const context = results.map((m: any) => {
    const parts = [`【${m.title}】`]
    if (m.period) parts.push(`時期: ${m.period}`)
    if (m.location) parts.push(`場所: ${m.location}`)
    if (m.emotion) parts.push(`気持ち: ${m.emotion}`)
    parts.push(m.content)
    return parts.join('\n')
  }).join('\n\n')

  return c.json({ success: true, data: { context, count: results.length } })
})

export default memories
