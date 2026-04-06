import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
  MINIMAX_API_KEY: string
}

const auth = new Hono<{ Bindings: Bindings }>()

// ── ユーティリティ ─────────────────────────────────────────
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

function generateSessionId(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

// セッション有効期限: 30日
const SESSION_TTL_DAYS = 30

// ── POST /api/auth/register ────────────────────────────────
auth.post('/register', async (c) => {
  const body = await c.req.json()
  const { email, password } = body

  if (!email || !password) {
    return c.json({ success: false, error: 'メールアドレスとパスワードは必須です' }, 400)
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ success: false, error: 'メールアドレスの形式が正しくありません' }, 400)
  }
  if (password.length < 8) {
    return c.json({ success: false, error: 'パスワードは8文字以上で設定してください' }, 400)
  }

  // 重複チェック
  const existing = await c.env.DB.prepare(
    'SELECT id FROM users WHERE email = ?'
  ).bind(email.toLowerCase()).first()
  if (existing) {
    return c.json({ success: false, error: 'このメールアドレスはすでに登録されています' }, 409)
  }

  const passwordHash = await hashPassword(password)
  const result = await c.env.DB.prepare(
    'INSERT INTO users (email, password_hash) VALUES (?, ?)'
  ).bind(email.toLowerCase(), passwordHash).run()

  const userId = result.meta.last_row_id

  // セッション発行
  const sessionId = generateSessionId()
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400 * 1000).toISOString()
  await c.env.DB.prepare(
    'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)'
  ).bind(sessionId, userId, expiresAt).run()

  return c.json({
    success: true,
    data: {
      session_token: sessionId,
      user: { id: userId, email: email.toLowerCase() },
    }
  }, 201)
})

// ── POST /api/auth/login ───────────────────────────────────
auth.post('/login', async (c) => {
  const body = await c.req.json()
  const { email, password } = body

  if (!email || !password) {
    return c.json({ success: false, error: 'メールアドレスとパスワードを入力してください' }, 400)
  }

  const user = await c.env.DB.prepare(
    'SELECT * FROM users WHERE email = ?'
  ).bind(email.toLowerCase()).first<{ id: number; email: string; password_hash: string }>()

  if (!user) {
    return c.json({ success: false, error: 'メールアドレスまたはパスワードが正しくありません' }, 401)
  }

  const passwordHash = await hashPassword(password)
  if (passwordHash !== user.password_hash) {
    return c.json({ success: false, error: 'メールアドレスまたはパスワードが正しくありません' }, 401)
  }

  // 古いセッションを削除して新規発行
  await c.env.DB.prepare(
    'DELETE FROM sessions WHERE user_id = ? AND expires_at < ?'
  ).bind(user.id, new Date().toISOString()).run()

  const sessionId = generateSessionId()
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400 * 1000).toISOString()
  await c.env.DB.prepare(
    'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)'
  ).bind(sessionId, user.id, expiresAt).run()

  return c.json({
    success: true,
    data: {
      session_token: sessionId,
      user: { id: user.id, email: user.email },
    }
  })
})

// ── POST /api/auth/logout ──────────────────────────────────
auth.post('/logout', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  if (token) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(token).run()
  }
  return c.json({ success: true })
})

// ── GET /api/auth/me ───────────────────────────────────────
auth.get('/me', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  if (!token) {
    return c.json({ success: false, error: '未認証' }, 401)
  }

  const session = await c.env.DB.prepare(
    'SELECT s.*, u.email FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ? AND s.expires_at > ?'
  ).bind(token, new Date().toISOString()).first<{ user_id: number; email: string; expires_at: string }>()

  if (!session) {
    return c.json({ success: false, error: 'セッションが無効または期限切れです' }, 401)
  }

  return c.json({
    success: true,
    data: { id: session.user_id, email: session.email }
  })
})

export default auth

// ── セッション検証ヘルパー（他ルートから利用） ───────────
export async function validateSession(
  db: D1Database,
  token: string | undefined
): Promise<{ id: number; email: string } | null> {
  if (!token) return null
  const session = await db.prepare(
    'SELECT s.user_id, u.email FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ? AND s.expires_at > ?'
  ).bind(token, new Date().toISOString()).first<{ user_id: number; email: string }>()
  if (!session) return null
  return { id: session.user_id, email: session.email }
}
