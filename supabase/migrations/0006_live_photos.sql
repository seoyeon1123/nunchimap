-- ─────────────────────────────────────────────
-- 라이브 글 사진 저장 — Supabase Storage 버킷
-- (실제 photo_url 컬럼은 0005 에서 이미 추가됨)
-- ─────────────────────────────────────────────

-- 공개 읽기, 인증 사용자만 업로드 (RLS 는 storage.objects 에 별도 적용)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'live-photos',
  'live-photos',
  TRUE,
  3 * 1024 * 1024, -- 3MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types,
    public = TRUE;

-- 누구나 읽기 (public 버킷이라 사실상 필요 없지만 명시)
DROP POLICY IF EXISTS "live_photos_read" ON storage.objects;
CREATE POLICY "live_photos_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'live-photos');

-- 업로드는 service role 만 (앱은 API 경유로만)
-- 별도 INSERT 정책 미작성 → service role 외에는 차단
