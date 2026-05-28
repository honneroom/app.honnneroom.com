-- ========================================
-- 記録タイトルカラム追加
-- Supabase Dashboard > SQL Editor で実行
-- ========================================

ALTER TABLE entries ADD COLUMN IF NOT EXISTS title TEXT;

-- タイトルの検索インデックス（任意・高速化）
CREATE INDEX IF NOT EXISTS entries_title_idx ON entries USING gin(to_tsvector('simple', coalesce(title, '')));
