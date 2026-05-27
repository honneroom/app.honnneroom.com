-- ========================================
-- 本音ルーム 利用制限セットアップSQL
-- Supabase Dashboard > SQL Editor で実行
-- ========================================
-- 制限値:
--   ゲスト（未ログイン）: 1日3回（IPアドレスベース）
--   無料アカウント:       月間20回（エントリー数ベース）
--   Standardプラン:       無制限

-- 1. ゲスト利用制限テーブル
CREATE TABLE IF NOT EXISTS guest_rate_limits (
  ip_hash  TEXT NOT NULL,
  period   TEXT NOT NULL,  -- YYYY-MM-DD
  count    INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (ip_hash, period)
);

-- RLS有効化（service_roleのみアクセス可／ユーザーから不可視）
ALTER TABLE guest_rate_limits ENABLE ROW LEVEL SECURITY;
-- ユーザー向けポリシーなし → service_roleのみ操作可能

-- 2. カウントをアトミックにインクリメントして返す関数
-- Edge Functionから呼び出し: supabase.rpc("guest_rate_limit_increment", {...})
CREATE OR REPLACE FUNCTION guest_rate_limit_increment(
  p_ip_hash TEXT,
  p_period  TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  INSERT INTO guest_rate_limits (ip_hash, period, count)
  VALUES (p_ip_hash, p_period, 1)
  ON CONFLICT (ip_hash, period) DO UPDATE
    SET count = guest_rate_limits.count + 1
  RETURNING guest_rate_limits.count INTO v_count;

  RETURN v_count;
END;
$$;

-- 3. 古いレコードのクリーンアップ（任意）
-- pg_cronが有効な場合は以下のコメントを外して定期実行:
-- SELECT cron.schedule(
--   'cleanup-guest-rate-limits',
--   '0 3 * * *',
--   $$DELETE FROM guest_rate_limits
--     WHERE period < TO_CHAR(NOW() - INTERVAL '30 days', 'YYYY-MM-DD')$$
-- );

-- 手動クリーンアップが必要な場合:
-- DELETE FROM guest_rate_limits
--   WHERE period < TO_CHAR(NOW() - INTERVAL '30 days', 'YYYY-MM-DD');
