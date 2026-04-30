import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/db';

const VALID_SIGNALS = ['green', 'yellow', 'red', 'gray'] as const;
const VALID_TAGS = ['outlet', 'wifi', 'quiet', 'spacious', 'long_stay', 'open_24h'] as const;

/**
 * GET /api/places?bbox=lng1,lat1,lng2,lat2&signal=green,yellow,red,gray&tags=outlet,quiet
 *
 * 지도 영역(bbox) 안의 카페 목록.
 * - bbox: SW(lng1,lat1) ~ NE(lng2,lat2)
 * - signal: 콤마 구분, 미지정 시 green,yellow,red
 * - tags: 콤마 구분. AND 조건 (모든 태그에 yes 투표 1건 이상 있어야 통과)
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const bbox = sp.get('bbox');
  const signalParam = sp.get('signal');
  const tagsParam = sp.get('tags');

  if (!bbox) {
    return NextResponse.json({ error: 'bbox is required' }, { status: 400 });
  }

  const parts = bbox.split(',').map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) {
    return NextResponse.json(
      { error: 'bbox must be lng1,lat1,lng2,lat2' },
      { status: 400 },
    );
  }
  const [lng1, lat1, lng2, lat2] = parts;

  const signals = signalParam
    ? signalParam.split(',').filter((s): s is typeof VALID_SIGNALS[number] =>
        (VALID_SIGNALS as readonly string[]).includes(s))
    : ['green', 'yellow', 'red'];

  const tags = tagsParam
    ? tagsParam.split(',').filter((t): t is typeof VALID_TAGS[number] =>
        (VALID_TAGS as readonly string[]).includes(t))
    : [];

  const supabase = getServiceClient();

  // 1) bbox 안 카페
  const bboxRes = await supabase.rpc('places_in_bbox', {
    sw_lng: lng1,
    sw_lat: lat1,
    ne_lng: lng2,
    ne_lat: lat2,
    signals,
  });

  let places: Array<{
    id: number;
    name: string;
    address: string | null;
    lat: number;
    lng: number;
    cached_signal: string | null;
    cached_median_duration: number | null;
    cached_checkin_count: number | null;
  }>;

  if (bboxRes.error) {
    console.error('[/api/places] places_in_bbox RPC failed:', bboxRes.error);
    const fallback = await supabase
      .from('places_view')
      .select('id,name,address,lat,lng,cached_signal,cached_median_duration,cached_checkin_count')
      .gte('lat', Math.min(lat1, lat2))
      .lte('lat', Math.max(lat1, lat2))
      .gte('lng', Math.min(lng1, lng2))
      .lte('lng', Math.max(lng1, lng2))
      .in('cached_signal', signals.length > 0 ? signals : VALID_SIGNALS as unknown as string[])
      .eq('is_closed', false)
      .limit(2000);
    if (fallback.error) {
      console.error('[/api/places] places_view fallback failed:', fallback.error);
      return NextResponse.json({ error: fallback.error.message }, { status: 500 });
    }
    places = fallback.data ?? [];
  } else {
    places = bboxRes.data ?? [];
  }

  // 2) 태그 필터 (모든 태그에 yes 투표 1건 이상)
  if (tags.length > 0 && places.length > 0) {
    const placeIds = places.map((p) => p.id);
    const { data: votes } = await supabase
      .from('place_tag_votes')
      .select('place_id, tags!inner(code)')
      .in('place_id', placeIds)
      .in('tags.code', tags as unknown as string[])
      .eq('vote', true);

    type VoteRow = { place_id: number; tags: { code: string } | { code: string }[] | null };
    // place_id → 매칭된 태그 코드 set
    const matched = new Map<number, Set<string>>();
    for (const v of (votes ?? []) as unknown as VoteRow[]) {
      const t = Array.isArray(v.tags) ? v.tags[0] : v.tags;
      if (!t) continue;
      const set = matched.get(v.place_id) ?? new Set<string>();
      set.add(t.code);
      matched.set(v.place_id, set);
    }
    places = places.filter((p) => {
      const set = matched.get(p.id);
      if (!set) return false;
      return tags.every((t) => set.has(t));
    });
  }

  return NextResponse.json({ places });
}
