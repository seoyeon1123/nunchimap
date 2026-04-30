import { NextRequest, NextResponse } from 'next/server';
import { readSession } from '@/lib/auth';
import { getServiceClient } from '@/lib/db';

/**
 * GET /api/me/favorites
 * 현재 사용자의 즐겨찾기 카페 목록 (최신순).
 * 응답: { places: PlaceMarker[] } 형태로 지도 마커 / 검색결과와 호환되게.
 */
export async function GET(req: NextRequest) {
  const session = await readSession(req);
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('place_favorites')
    .select(
      'created_at, places!inner(id, name, address, lat, lng, cached_signal, cached_median_duration, cached_checkin_count)',
    )
    .eq('user_id', session.uid)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = {
    created_at: string;
    places:
      | {
          id: number;
          name: string;
          address: string | null;
          lat: number;
          lng: number;
          cached_signal: string | null;
          cached_median_duration: number | null;
          cached_checkin_count: number | null;
        }
      | null;
  };

  const places = (data as unknown as Row[])
    .map((r) => r.places)
    .filter((p): p is NonNullable<Row['places']> => p != null);

  return NextResponse.json({ places });
}
