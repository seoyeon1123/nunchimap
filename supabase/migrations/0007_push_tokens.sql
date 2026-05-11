-- ─────────────────────────────────────────────
-- 푸시 알림 토큰 — Expo Push Service 용
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS push_tokens (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL,                                  -- ExponentPushToken[...]
  platform    TEXT CHECK (platform IN ('ios','android','web')),
  device_id   TEXT,                                           -- 같은 기기 재등록 dedup 용 (선택)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 같은 사용자 + 같은 토큰 중복 등록 방지
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_tokens_user_token
  ON push_tokens (user_id, token);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user
  ON push_tokens (user_id);

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
-- 정책 없음 → service role 만 접근 (앱은 API 경유)

-- 푸시 발송 로그 — 쿨다운 / 디버깅 용
CREATE TABLE IF NOT EXISTS push_log (
  id        BIGSERIAL PRIMARY KEY,
  user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  place_id  BIGINT REFERENCES places(id) ON DELETE SET NULL,
  reason    TEXT NOT NULL,
  sent_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_log_user_place_time
  ON push_log (user_id, place_id, sent_at DESC);

ALTER TABLE push_log ENABLE ROW LEVEL SECURITY;
