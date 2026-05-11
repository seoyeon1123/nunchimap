import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/db';
import { loadLiveForPlace } from '@/lib/live';

/**
 * GET /api/places/:id/live
 * 카페별 활성 라이브 글 목록 + 좌석 요약.
 * 인증 불필요 — 누구나 조회 가능.
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
  const { posts, summary } = await loadLiveForPlace(supabase, id, 10);

  return NextResponse.json({
    posts,
    summary,
  });
}
