-- ─────────────────────────────────────────────
-- RPC 함수: 지도 영역 조회, 근거리 검색
-- 0001_init.sql 실행 후 같은 SQL Editor 에 복붙
-- ─────────────────────────────────────────────

-- 박스 안 카페 조회 (PostGIS ST_Within)
CREATE OR REPLACE FUNCTION places_in_bbox(
  sw_lng DOUBLE PRECISION,
  sw_lat DOUBLE PRECISION,
  ne_lng DOUBLE PRECISION,
  ne_lat DOUBLE PRECISION,
  signals TEXT[]
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
    AND ST_Within(
      p.location::geometry,
      ST_MakeEnvelope(sw_lng, sw_lat, ne_lng, ne_lat, 4326)
    )
    AND (
      array_length(signals, 1) IS NULL
      OR COALESCE(p.cached_signal, 'gray') = ANY(signals)
    )
  LIMIT 2000;
$$;

-- 검색어 + 근거리 결합
CREATE OR REPLACE FUNCTION search_places_near(
  q TEXT,
  center_lat DOUBLE PRECISION,
  center_lng DOUBLE PRECISION,
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
  cached_checkin_count INT,
  distance_m DOUBLE PRECISION
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
    p.cached_checkin_count,
    ST_Distance(
      p.location,
      ST_SetSRID(ST_MakePoint(center_lng, center_lat), 4326)::geography
    ) AS distance_m
  FROM places p
  WHERE
    p.is_closed = FALSE
    AND p.location IS NOT NULL
    AND (p.name ILIKE '%' || q || '%' OR p.address ILIKE '%' || q || '%')
  ORDER BY distance_m ASC
  LIMIT max_results;
$$;
