-- 会話セッション管理
-- キャラクターごとに複数の「会話」（スレッド）を持てるようにする

CREATE TABLE IF NOT EXISTS conversation_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '新しい会話',
  summary TEXT,               -- AI生成サマリー（引き継ぎ用）
  is_pinned INTEGER DEFAULT 0, -- 1=記憶として引き継ぐ / 0=引き継がない
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

-- conversations テーブルに session_id カラムを追加
ALTER TABLE conversations ADD COLUMN session_id INTEGER REFERENCES conversation_sessions(id) ON DELETE CASCADE;

-- インデックス
CREATE INDEX IF NOT EXISTS idx_conversation_sessions_character_id ON conversation_sessions(character_id);
CREATE INDEX IF NOT EXISTS idx_conversations_session_id ON conversations(session_id);
