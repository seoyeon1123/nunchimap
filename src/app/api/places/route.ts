import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/db';
import { readSession } from '@/lib/auth';
import { countActiveCheckInsByPlace } from '@/lib/live';

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

  // 3) 진행 중 체크인 수 일괄 조회 → 마커 뱃지에 사용
  const activeCounts = await countActiveCheckInsByPlace(
    supabase,
    places.map((p) => p.id),
  );
  const enriched = places.map((p) => ({
    ...p,
    active_count: activeCounts.get(p.id) ?? 0,
  }));

  return NextResponse.json({ places: enriched });
}

/**
 * POST /api/places
 *
 * 사용자가 검색에서 카페를 찾지 못했을 때, 카카오 keyword 검색 결과(또는 직접 입력)로
 * 새 카페를 등록한다.
 *
 * Body: {
 *   kakao_place_id: string,  // 카카오 place id (중복 방지 키)
 *   name: string,
 *   address?: string,
 *   road_address?: string,
 *   lat: number,
 *   lng: number,
 * }
 *
 * 이미 등록된 kakao_place_id 면 기존 row 의 id 를 그대로 반환 (idempotent).
 */
export async function POST(req: NextRequest) {
  const session = await readSession(req);
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    kakao_place_id?: string;
    name?: string;
    address?: string;
    road_address?: string;
    lat?: number;
    lng?: number;
  };

  const kakaoId = body.kakao_place_id?.trim();
  const name = body.name?.trim();
  const lat = typeof body.lat === 'number' ? body.lat : NaN;
  const lng = typeof body.lng === 'number' ? body.lng : NaN;

  if (!kakaoId) {
    return NextResponse.json(
      { error: 'kakao_place_id 가 필요해요.' },
      { status: 400 },
    );
  }
  if (!name) {
    return NextResponse.json({ error: 'name 이 필요해요.' }, { status: 400 });
  }
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < 33 || lat > 39 ||
    lng < 124 || lng > 132
  ) {
    return NextResponse.json(
      { error: '좌표가 한국 범위를 벗어났어요.' },
      { status: 400 },
    );
  }

  const supabase = getServiceClient();

  // 중복 — 이미 있으면 그 id 그대로 반환
  const { data: existing } = await supabase
    .from('places')
    .select('id')
    .eq('kakao_place_id', kakaoId)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ id: existing.id, created: false });
  }

  // GEOGRAPHY 컬럼은 POINT(lng lat) 순서 — PostGIS 표준
  const wkt = `POINT(${lng} ${lat})`;

  const { data: inserted, error: insErr } = await supabase
    .from('places')
    .insert({
      kakao_place_id: kakaoId,
      name,
      address: body.address?.trim() || null,
      road_address: body.road_address?.trim() || null,
      location: wkt,
      cached_signal: 'gray',
      external_seed_data: { source: 'user_added_via_app', by_uid: session.uid },
    })
    .select('id')
    .single();

  if (insErr || !inserted) {
    console.error('[/api/places POST] insert failed', insErr);
    return NextResponse.json(
      { error: insErr?.message ?? 'insert failed' },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: inserted.id, created: true });
}
