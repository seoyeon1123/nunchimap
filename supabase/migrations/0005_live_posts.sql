-- ─────────────────────────────────────────────
-- 라이브 보드 (Live Board)
-- 카페 안에 있는 사용자만 작성, 30분 후 자동 만료
-- ─────────────────────────────────────────────

-- ── live_posts ──────────────────────────────
CREATE TABLE IF NOT EXISTS live_posts (
  id            BIGSERIAL PRIMARY KEY,
  place_id      BIGINT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  check_in_id   BIGINT REFERENCES check_ins(id) ON DELETE SET NULL,
  text          VARCHAR(60),
  occupancy     SMALLINT NOT NULL CHECK (occupancy BETWEEN 1 AND 3),  -- 1=널널, 2=보통, 3=만석
  photo_url     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  hidden_at     TIMESTAMPTZ,
  hidden_reason TEXT CHECK (hidden_reason IN ('expired','reported','admin','user'))
);

-- 카페별 활성 라이브 조회 (가장 빈번한 쿼리)
CREATE INDEX IF NOT EXISTS idx_live_posts_place_active
  ON live_posts (place_id, created_at DESC)
  WHERE hidden_at IS NULL;

-- 만료 cron 용
CREATE INDEX IF NOT EXISTS idx_live_posts_expires
  ON live_posts (expires_at)
  WHERE hidden_at IS NULL;

-- 카페당 1인 1라이브 (활성 상태에서만)
CREATE UNIQUE INDEX IF NOT EXISTS idx_live_posts_one_per_user_place
  ON live_posts (place_id, user_id)
  WHERE hidden_at IS NULL;

-- ── live_post_reports ───────────────────────
CREATE TABLE IF NOT EXISTS live_post_reports (
  id            BIGSERIAL PRIMARY KEY,
  live_post_id  BIGINT NOT NULL REFERENCES live_posts(id) ON DELETE CASCADE,
  reporter_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reason        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_live_post_reports_post
  ON live_post_reports (live_post_id);

-- 동일 사용자가 같은 글 중복 신고 방지
CREATE UNIQUE INDEX IF NOT EXISTS idx_live_post_reports_unique
  ON live_post_reports (live_post_id, reporter_id)
  WHERE reporter_id IS NOT NULL;

-- ── RLS ─────────────────────────────────────
ALTER TABLE live_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_post_reports ENABLE ROW LEVEL SECURITY;

-- 활성 라이브만 공개 읽기 — 만료/숨김된 글은 응답에서 제외
CREATE POLICY "live_posts_public_read"
  ON live_posts FOR SELECT
  USING (hidden_at IS NULL AND expires_at > NOW());

-- 작성/수정/삭제는 service role 만 (앱은 API 경유로만 접근)
-- (별도 INSERT/UPDATE 정책 안 만들면 service role 외에는 차단됨)

-- 신고 테이블: 누구도 직접 read 불가, service role 만
-- (정책 미작성 = 일반 사용자 차단)

-- ── 만료 함수 (cron 또는 수동 호출용) ────────
-- expires_at 이 지난 활성 글을 hidden_at='expired' 로 마킹
CREATE OR REPLACE FUNCTION expire_live_posts()
RETURNS INT AS $$
DECLARE
  affected INT;
BEGIN
  UPDATE live_posts
     SET hidden_at = NOW(), hidden_reason = 'expired'
   WHERE hidden_at IS NULL
     AND expires_at <= NOW();
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$ LANGUAGE plpgsql;
