import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/db';
import { loadPlaceDetail } from '@/lib/places';
import { readSession } from '@/lib/auth';
import { findEligibleCheckIn } from '@/lib/live';

// 항상 fresh — Vercel/Next.js 의 route handler 캐싱 우회
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/places/:id
 * 카페 상세 + 최근 리뷰 5건 + 태그 집계 + 검증 카운트 + (로그인 시) 즐겨찾기 여부 + 라이브 작성 자격.
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

  // 로그인 사용자면 즐겨찾기 여부 + 라이브 작성 자격(진행 중 체크인 OR 30분 grace) 도 같이 반환
  let isFavorited = false;
  let canPostLive = false;
  let hasActiveCheckin = false;
  const session = await readSession(req);
  if (session) {
    const [favRes, eligible] = await Promise.all([
      supabase
        .from('place_favorites')
        .select('id')
        .eq('user_id', session.uid)
        .eq('place_id', id)
        .maybeSingle(),
      findEligibleCheckIn(supabase, session.uid, id),
    ]);
    isFavorited = !!favRes.data;
    canPostLive = !!eligible;
    hasActiveCheckin = !!eligible && eligible.ended_at === null;
  }

  return NextResponse.json({
    place: data.place,
    recent_reviews: data.reviews,
    tags: data.tags,
    verified_count: data.verifiedCount,
    is_favorited: isFavorited,
    can_post_live: canPostLive,
    has_active_checkin: hasActiveCheckin,
    live_summary: data.liveSummary,
  });
}
