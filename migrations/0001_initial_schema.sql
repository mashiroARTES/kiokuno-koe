-- 記憶の声 - 初期スキーマ

-- キャラクター（AIの人格プロファイル）
CREATE TABLE IF NOT EXISTS characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  age INTEGER,
  birthplace TEXT,
  description TEXT,
  voice_id TEXT,              -- MiniMax カスタムボイスID
  voice_sample_url TEXT,      -- アップロードされた音声サンプルURL
  model_adapter_path TEXT,    -- LoRAアダプタパス（将来用）
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 記憶データ（エピソード・思い出）
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  period TEXT,                -- 例: "1960年代", "子供の頃"
  location TEXT,              -- 例: "東京", "故郷の村"
  emotion TEXT,               -- 例: "懐かしい", "嬉しい", "悲しい"
  source_type TEXT DEFAULT 'text', -- 'text' | 'audio' | 'photo'
  audio_url TEXT,             -- 音声データURL
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

-- 会話履歴
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL,
  role TEXT NOT NULL,         -- 'user' | 'assistant'
  content TEXT NOT NULL,
  audio_url TEXT,             -- TTSで生成した音声URL
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

-- ボイスクローンジョブ管理
CREATE TABLE IF NOT EXISTS voice_clone_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',  -- 'pending' | 'processing' | 'done' | 'error'
  minimax_voice_id TEXT,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_memories_character_id ON memories(character_id);
CREATE INDEX IF NOT EXISTS idx_conversations_character_id ON conversations(character_id);
CREATE INDEX IF NOT EXISTS idx_voice_clone_jobs_character_id ON voice_clone_jobs(character_id);
