import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/db';
import { readSession } from '@/lib/auth';
import { expireStaleCheckIns } from '@/lib/checkins';

/**
 * GET /api/check-ins/active
 * 현재 로그인 유저의 진행 중(GPS) 체크인 — 시작했지만 아직 finish 하지 않은 것.
 * 앱이 닫혔다가 다시 열렸을 때 "마무리하러 가기" 배너에 사용.
 */
export async function GET(req: NextRequest) {
  const session = await readSession(req);
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = getServiceClient();
  await expireStaleCheckIns(supabase, session.uid);

  const { data, error } = await supabase
    .from('check_ins')
    .select('id, place_id, started_at, places(name)')
    .eq('user_id', session.uid)
    .eq('method', 'gps')
    .is('ended_at', null)
    .eq('is_hidden', false)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ active: null });
  }

  const placeRel = Array.isArray(data.places) ? data.places[0] : data.places;

  return NextResponse.json({
    active: {
      check_in_id: data.id,
      place_id: data.place_id,
      place_name: placeRel?.name ?? null,
      started_at: data.started_at,
    },
  });
}
