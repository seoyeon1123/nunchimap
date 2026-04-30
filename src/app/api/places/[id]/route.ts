import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/db';
import { loadPlaceDetail } from '@/lib/places';
import { readSession } from '@/lib/auth';

/**
 * GET /api/places/:id
 * 카페 상세 + 최근 리뷰 5건 + 태그 집계 + 검증 카운트 + (로그인 시) 즐겨찾기 여부.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const supabase = getServiceClient();
  const data = await loadPlaceDetail(supabase, id);
  if (!data) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // 로그인 사용자면 즐겨찾기 여부도 같이 반환
  let isFavorited = false;
  const session = await readSession(req);
  if (session) {
    const { data: fav } = await supabase
      .from('place_favorites')
      .select('id')
      .eq('user_id', session.uid)
      .eq('place_id', id)
      .maybeSingle();
    isFavorited = !!fav;
  }

  return NextResponse.json({
    place: data.place,
    recent_reviews: data.reviews,
    tags: data.tags,
    verified_count: data.verifiedCount,
    is_favorited: isFavorited,
  });
}
