-- ========================================
-- 記録タイトルカラム追加 + UPDATE ポリシー追加
-- Supabase Dashboard > SQL Editor で実行
-- ========================================

-- 1. title カラム追加
ALTER TABLE entries ADD COLUMN IF NOT EXISTS title TEXT;

-- 2. UPDATE ポリシー追加（これがないとタイトル保存がサイレントに失敗する）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'entries' AND policyname = 'entries_update'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "entries_update"
        ON entries FOR UPDATE
        USING (auth.uid() = user_id)
        WITH CHECK (auth.uid() = user_id)
    $policy$;
  END IF;
END $$;

-- 3. タイトルの検索インデックス（任意・高速化）
CREATE INDEX IF NOT EXISTS entries_title_idx ON entries USING gin(to_tsvector('simple', coalesce(title, '')));
