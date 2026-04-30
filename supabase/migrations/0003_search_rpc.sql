-- ─────────────────────────────────────────────
-- 일반 검색 RPC (near 좌표 없이 q 만 — 파라미터 바인딩으로 안전)
-- 0002 이후 SQL Editor 에 붙여넣기
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION search_places(
  q TEXT,
  max_results INT DEFAULT 20
)
RETURNS TABLE (
  id BIGINT,
  name TEXT,
  address TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  cached_signal TEXT,
  cached_median_duration INT,
  cached_checkin_count INT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    p.id,
    p.name,
    p.address,
    ST_Y(p.location::geometry) AS lat,
    ST_X(p.location::geometry) AS lng,
    p.cached_signal,
    p.cached_median_duration,
    p.cached_checkin_count
  FROM places p
  WHERE
    p.is_closed = FALSE
    AND p.location IS NOT NULL
    AND (p.name ILIKE '%' || q || '%' OR p.address ILIKE '%' || q || '%')
  ORDER BY similarity(p.name, q) DESC NULLS LAST
  LIMIT max_results;
$$;
