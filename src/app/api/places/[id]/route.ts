import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/db';
import { loadPlaceDetail } from '@/lib/places';

/**
 * GET /api/places/:id
 * 카페 상세 + 최근 리뷰 5건 + 태그 집계 + 검증 카운트.
 */
export async function GET(
  _req: NextRequest,
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

  return NextResponse.json({
    place: data.place,
    recent_reviews: data.reviews,
    tags: data.tags,
    verified_count: data.verifiedCount,
  });
}
