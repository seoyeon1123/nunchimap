-- ─────────────────────────────────────────────
-- 눈치맵 초기 스키마
-- Supabase SQL Editor에 그대로 붙여넣어 실행
-- ─────────────────────────────────────────────

-- PostGIS (좌표 기반 쿼리용)
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- 이름 검색용 trigram

-- ── users ────────────────────────────────────
CREATE TABLE users (
  id              BIGSERIAL PRIMARY KEY,
  kakao_id        TEXT UNIQUE NOT NULL,
  nickname        TEXT NOT NULL,
  profile_image   TEXT,
  badge_level     INT  NOT NULL DEFAULT 0,
  trust_modifier  REAL NOT NULL DEFAULT 1.0,
  report_count    INT  NOT NULL DEFAULT 0,
  is_banned       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── places ───────────────────────────────────
CREATE TABLE places (
  id                        BIGSERIAL PRIMARY KEY,
  kakao_place_id            TEXT UNIQUE,
  business_no               TEXT,                 -- 사업자등록번호 (LOCALDATA)
  name                      TEXT NOT NULL,
  address                   TEXT,
  road_address              TEXT,
  location                  GEOGRAPHY(POINT, 4326),
  has_outlet                BOOLEAN,
  has_wifi                  BOOLEAN,
  is_quiet                  BOOLEAN,
  cached_signal             TEXT CHECK (cached_signal IN ('green','yellow','red','gray')),
  cached_median_duration    INT,
  cached_checkin_count      INT NOT NULL DEFAULT 0,
  cached_updated_at         TIMESTAMPTZ,
  external_seed_data        JSONB,
  is_closed                 BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_places_location ON places USING GIST (location);
CREATE INDEX idx_places_name_trgm ON places USING GIN (name gin_trgm_ops);
CREATE INDEX idx_places_signal ON places (cached_signal) WHERE is_closed = FALSE;

-- ── check_ins (= 리뷰 통합) ───────────────────
CREATE TABLE check_ins (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  place_id        BIGINT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  method          TEXT NOT NULL CHECK (method IN ('gps','ocr','manual')),
  signal          TEXT NOT NULL CHECK (signal IN ('green','yellow','red')),
  started_at      TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ,
  duration_min    INT,
  text_review     TEXT,
  ocr_data        JSONB,                   -- 영수증 OCR 추출 데이터 (이미지 X)
  client_ip_hash  TEXT,                    -- 어뷰징 탐지용 SHA256 해시
  is_hidden       BOOLEAN NOT NULL DEFAULT FALSE,
  hidden_reason   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_checkins_place ON check_ins (place_id, created_at DESC) WHERE is_hidden = FALSE;
CREATE INDEX idx_checkins_user ON check_ins (user_id, created_at DESC);

-- ── tags ─────────────────────────────────────
CREATE TABLE tags (
  id     SERIAL PRIMARY KEY,
  code   TEXT UNIQUE NOT NULL,             -- 'outlet','wifi','quiet','spacious','open_24h'
  label  TEXT NOT NULL
);

INSERT INTO tags (code, label) VALUES
  ('outlet',    '콘센트 충분'),
  ('wifi',      '와이파이 빠름'),
  ('quiet',     '조용함'),
  ('spacious',  '자리 넉넉'),
  ('long_stay', '장시간 OK'),
  ('open_24h',  '24시간')
ON CONFLICT (code) DO NOTHING;

-- 카페-태그 투표 (한 사람당 한 표)
CREATE TABLE place_tag_votes (
  place_id   BIGINT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  tag_id     INT    NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vote       BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (place_id, tag_id, user_id)
);
CREATE INDEX idx_tag_votes_place ON place_tag_votes (place_id, tag_id);

-- ── owner_claims (사장 이의제기) ──────────────
CREATE TABLE owner_claims (
  id            BIGSERIAL PRIMARY KEY,
  place_id      BIGINT REFERENCES places(id) ON DELETE SET NULL,
  claimer_email TEXT NOT NULL,
  claim_type    TEXT NOT NULL CHECK (claim_type IN ('wrong_info','i_am_owner','unfair_red','close_request')),
  body          TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewing','resolved','rejected')),
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_claims_status ON owner_claims (status, created_at);

-- ── reports (사용자 신고) ────────────────────
CREATE TABLE reports (
  id            BIGSERIAL PRIMARY KEY,
  target_type   TEXT NOT NULL CHECK (target_type IN ('check_in','user','place')),
  target_id     BIGINT NOT NULL,
  reporter_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reason        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewing','resolved','rejected')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_reports_status ON reports (status, created_at);

-- ── view: places_view (lat/lng 평면화) ───────
CREATE OR REPLACE VIEW places_view AS
SELECT
  p.id,
  p.kakao_place_id,
  p.name,
  p.address,
  p.road_address,
  ST_Y(p.location::geometry) AS lat,
  ST_X(p.location::geometry) AS lng,
  p.has_outlet,
  p.has_wifi,
  p.is_quiet,
  p.cached_signal,
  p.cached_median_duration,
  p.cached_checkin_count,
  p.cached_updated_at,
  p.is_closed
FROM places p;

-- ── RLS (Row-Level Security) ─────────────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE place_tag_votes ENABLE ROW LEVEL SECURITY;

-- places는 누구나 읽기 가능, 쓰기는 service role만
ALTER TABLE places ENABLE ROW LEVEL SECURITY;
CREATE POLICY "places_public_read" ON places FOR SELECT USING (TRUE);

-- check_ins: 본인 것만 수정/삭제, 읽기는 숨김 안 된 것만 공개
CREATE POLICY "checkins_public_read" ON check_ins FOR SELECT USING (is_hidden = FALSE);
CREATE POLICY "checkins_own_write" ON check_ins FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);
CREATE POLICY "checkins_own_update" ON check_ins FOR UPDATE USING (auth.uid()::text = user_id::text);
