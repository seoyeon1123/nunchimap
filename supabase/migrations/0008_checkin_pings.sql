-- ─────────────────────────────────────────────
-- GPS 체크인 진행 중인 사용자에게 1시간 단위 핑 알림 보내기 위한 컬럼
-- (서버 cron 이 매시간 active 체크인을 찾아 푸시 발송 후 시각 업데이트)
-- ─────────────────────────────────────────────

ALTER TABLE check_ins
  ADD COLUMN IF NOT EXISTS last_pinged_at TIMESTAMPTZ;

-- 활성 GPS 체크인 빠른 스캔용 부분 인덱스
CREATE INDEX IF NOT EXISTS idx_check_ins_active_gps_ping
  ON check_ins (started_at, last_pinged_at)
  WHERE ended_at IS NULL AND is_hidden = FALSE AND method = 'gps';
