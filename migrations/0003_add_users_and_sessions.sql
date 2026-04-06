-- ユーザーアカウント
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,   -- SHA-256 hex
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- セッション
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,           -- UUID v4 (セッショントークン)
  user_id INTEGER NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- characters に user_id カラムを追加
ALTER TABLE characters ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

-- インデックス
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_characters_user_id ON characters(user_id);
