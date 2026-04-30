-- 사용자별 카페 즐겨찾기
-- (user_id, place_id) UNIQUE — 같은 사용자가 같은 카페 중복 즐겨찾기 불가

CREATE TABLE IF NOT EXISTS place_favorites (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  place_id BIGINT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, place_id)
);

CREATE INDEX IF NOT EXISTS idx_place_favorites_user
  ON place_favorites(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_place_favorites_place
  ON place_favorites(place_id);
