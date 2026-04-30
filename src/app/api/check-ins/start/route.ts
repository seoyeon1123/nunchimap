import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/db';
import { readSession } from '@/lib/auth';
import { expireStaleCheckIns } from '@/lib/checkins';

const MAX_DISTANCE_M = 100;

function haversine(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(sa));
}

/**
 * POST /api/check-ins/start
 * Body: { place_id, gps_lat, gps_lng, accuracy_m? }
 *
 * 카페 100m 이내인지 검증 후 시작 시각만 기록한 check_in 레코드 생성.
 */
export async function POST(req: NextRequest) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as {
    place_id?: number;
    gps_lat?: number;
    gps_lng?: number;
    accuracy_m?: number;
  };
  const { place_id, gps_lat, gps_lng, accuracy_m } = body;
  if (
    typeof place_id !== 'number' ||
    typeof gps_lat !== 'number' ||
    typeof gps_lng !== 'number'
  ) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  if (typeof accuracy_m === 'number' && accuracy_m > 50) {
    return NextResponse.json(
      { error: 'GPS 정확도가 너무 낮습니다 (>50m). 야외에서 다시 시도해주세요.' },
      { status: 400 },
    );
  }

  const supabase = getServiceClient();
  const { data: place, error } = await supabase
    .from('places_view')
    .select('id, name, lat, lng')
    .eq('id', place_id)
    .maybeSingle();

  if (error || !place) {
    return NextResponse.json({ error: 'place not found' }, { status: 404 });
  }

  const distance = haversine(
    { lat: gps_lat, lng: gps_lng },
    { lat: place.lat, lng: place.lng },
  );
  if (distance > MAX_DISTANCE_M) {
    return NextResponse.json(
      {
        error: `카페에서 ${Math.round(distance)}m 떨어져있어요. 도착하신 후 체크인해주세요.`,
      },
      { status: 400 },
    );
  }

  // 직전 미완료(12h+) 체크인 자동 만료
  await expireStaleCheckIns(supabase, session.uid);

  const { data: created, error: insErr } = await supabase
    .from('check_ins')
    .insert({
      user_id: session.uid,
      place_id,
      method: 'gps',
      signal: 'yellow', // 임시값. finish 시 갱신
      started_at: new Date().toISOString(),
    })
    .select('id, started_at')
    .single();

  if (insErr || !created) {
    return NextResponse.json(
      { error: insErr?.message ?? 'insert failed' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    check_in_id: created.id,
    started_at: created.started_at,
    place_name: place.name,
  });
}
