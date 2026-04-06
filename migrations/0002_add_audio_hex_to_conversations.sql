-- conversations テーブルに audio_hex カラムを追加
-- TTS生成済みの音声データをキャッシュし、履歴から再生できるようにする
ALTER TABLE conversations ADD COLUMN audio_hex TEXT;
