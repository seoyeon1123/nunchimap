import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/db';
import { readSession } from '@/lib/auth';

const MAX_BYTES = 3 * 1024 * 1024; // 3MB — 버킷 설정과 동일
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * POST /api/uploads/live-photo
 *
 * 멀티파트 폼: { photo: File }
 *
 * 라이브 글에 첨부할 이미지 1장을 Supabase Storage 의 `live-photos` 버킷에 업로드.
 * 응답: { url, path }
 *  - url 은 public URL → 그대로 live_posts.photo_url 에 넣어 POST /api/live-posts 호출.
 */
export async function POST(req: NextRequest) {
  const session = await readSession(req);
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: '잘못된 multipart 본문이에요.' },
      { status: 400 },
    );
  }

  const photo = form.get('photo');
  if (!(photo instanceof Blob)) {
    return NextResponse.json(
      { error: 'photo 파일이 필요해요.' },
      { status: 400 },
    );
  }
  if (photo.size === 0) {
    return NextResponse.json({ error: '빈 파일이에요.' }, { status: 400 });
  }
  if (photo.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `파일이 너무 커요 (최대 ${Math.floor(MAX_BYTES / 1024 / 1024)}MB).` },
      { status: 413 },
    );
  }
  const mime = photo.type || 'image/jpeg';
  if (!ALLOWED_MIMES.has(mime)) {
    return NextResponse.json(
      { error: `지원하지 않는 형식: ${mime}` },
      { status: 415 },
    );
  }

  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `${session.uid}/${stamp}_${rand}.${ext}`;

  const supabase = getServiceClient();
  const arrayBuf = await photo.arrayBuffer();

  const { error: upErr } = await supabase.storage
    .from('live-photos')
    .upload(path, new Uint8Array(arrayBuf), {
      contentType: mime,
      cacheControl: '3600',
      upsert: false,
    });

  if (upErr) {
    console.error('[uploads/live-photo] upload failed', upErr);
    return NextResponse.json(
      { error: upErr.message ?? 'upload failed' },
      { status: 500 },
    );
  }

  const { data: pub } = supabase.storage
    .from('live-photos')
    .getPublicUrl(path);

  return NextResponse.json({ url: pub.publicUrl, path });
}
