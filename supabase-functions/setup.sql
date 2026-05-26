-- ========================================
-- 本音ルーム Supabase セットアップSQL
-- Supabase Dashboard > SQL Editor で実行
-- ========================================

-- 1. 不要テーブルを削除（threadsは既に削除済み）
DROP TABLE IF EXISTS replies CASCADE;
DROP TABLE IF EXISTS reactions CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS push_subscriptions CASCADE;
DROP TABLE IF EXISTS reports CASCADE;
DROP TABLE IF EXISTS report_details CASCADE;

-- 2. profilesテーブルの不要カラムを削除
ALTER TABLE profiles
  DROP COLUMN IF EXISTS age,
  DROP COLUMN IF EXISTS work_style,
  DROP COLUMN IF EXISTS marital_status,
  DROP COLUMN IF EXISTS has_children,
  DROP COLUMN IF EXISTS living_situation,
  DROP COLUMN IF EXISTS bio,
  DROP COLUMN IF EXISTS is_female_confirmed;

-- entry_count カラム追加（月間記録数管理用・将来利用）
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS entry_count INT DEFAULT 0;

-- 3. entriesテーブル新設
CREATE TABLE IF NOT EXISTS entries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- user_id は NULL 許容（未登録ユーザー対応、フロント側で user_id ありのみINSERT）

-- 4. analysesテーブル新設
CREATE TABLE IF NOT EXISTS analyses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_id UUID REFERENCES entries(id) ON DELETE CASCADE,
  core_emotion TEXT,
  emotion_wheel JSONB,
  cognitive_distortions JSONB,
  summary TEXT,
  reframe TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. RLS ポリシー設定

-- entries
ALTER TABLE entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "entries_select"
  ON entries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "entries_insert"
  ON entries FOR INSERT
  WITH CHECK (
    user_id IS NULL OR auth.uid() = user_id
  );

CREATE POLICY "entries_delete"
  ON entries FOR DELETE
  USING (auth.uid() = user_id);

-- analyses
ALTER TABLE analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "analyses_select"
  ON analyses FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM entries
      WHERE entries.id = analyses.entry_id
      AND entries.user_id = auth.uid()
    )
  );

-- Edge Function (service_role) からの挿入を許可
CREATE POLICY "analyses_insert"
  ON analyses FOR INSERT
  WITH CHECK (true);

CREATE POLICY "analyses_delete"
  ON analyses FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM entries
      WHERE entries.id = analyses.entry_id
      AND entries.user_id = auth.uid()
    )
  );
