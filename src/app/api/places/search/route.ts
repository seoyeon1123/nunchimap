import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/db';
import { countActiveCheckInsByPlace } from '@/lib/live';

export const dynamic = 'force-dynamic';

interface SearchPlace {
  id: number;
  [k: string]: unknown;
}

async function attachActiveCount(
  supabase: ReturnType<typeof getServiceClient>,
  places: SearchPlace[],
): Promise<Array<SearchPlace & { active_count: number }>> {
  const counts = await countActiveCheckInsByPlace(
    supabase,
    places.map((p) => p.id),
  );
  return places.map((p) => ({ ...p, active_count: counts.get(p.id) ?? 0 }));
}

/**
 * GET /api/places/search?q=&near=lat,lng&limit=20
 * 카페 이름/주소 텍스트 검색.
 * - q: 검색어 (최소 1자)
 * - near: "lat,lng" 주어지면 해당 좌표 근처 우선
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = sp.get('q')?.trim() ?? '';
  const near = sp.get('near');
  const limit = Math.min(Number(sp.get('limit')) || 20, 50);

  if (!q || q.length < 1) {
    return NextResponse.json({ places: [] });
  }

  const supabase = getServiceClient();

  // 모두 파라미터 바인딩 RPC 로 처리 — q 에 ,()% 같은 PostgREST 메타문자 들어와도 안전.
  if (near) {
    const [latStr, lngStr] = near.split(',');
    const lat = Number(latStr);
    const lng = Number(lngStr);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const rpcRes = await supabase.rpc('search_places_near', {
        q,
        center_lat: lat,
        center_lng: lng,
        max_results: limit,
      });
      if (!rpcRes.error) {
        return NextResponse.json({
          places: await attachActiveCount(supabase, rpcRes.data ?? []),
        });
      }
      console.error('[/api/places/search] search_places_near failed:', rpcRes.error);
      // 폴백: q-only RPC
    }
  }

  const rpcRes = await supabase.rpc('search_places', {
    q,
    max_results: limit,
  });
  if (rpcRes.error) {
    console.error('[/api/places/search] search_places failed:', rpcRes.error);
    return NextResponse.json({ error: rpcRes.error.message }, { status: 500 });
  }
  return NextResponse.json({
    places: await attachActiveCount(supabase, rpcRes.data ?? []),
  });
}
