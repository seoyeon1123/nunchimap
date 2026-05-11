import { NextRequest, NextResponse } from 'next/server';
import { readSession } from '@/lib/auth';
import { getServiceClient } from '@/lib/db';
import { expireStaleCheckIns } from '@/lib/checkins';

export const dynamic = 'force-dynamic';

/**
 * GET /api/me/check-ins?limit=50
 * 현재 로그인 유저의 최근 체크인.
 * 모바일 앱의 "내정보" 탭에서 사용. 웹의 /me 페이지가 RSC 에서 직접 supabase 를 부르던 것과 동일.
 */
export async function GET(req: NextRequest) {
  const session = await readSession(req);
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 50, 200);

  const supabase = getServiceClient();
  await expireStaleCheckIns(supabase, session.uid);

  const { data, error } = await supabase
    .from('check_ins')
    .select('id,place_id,method,signal,duration_min,created_at,places(name)')
    .eq('user_id', session.uid)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = {
    id: number;
    place_id: number;
    method: 'gps' | 'ocr' | 'manual';
    signal: 'green' | 'yellow' | 'red';
    duration_min: number | null;
    created_at: string;
    places: { name: string } | { name: string }[] | null;
  };

  const checkIns = (data ?? []).map((c: Row) => {
    const placeRel = Array.isArray(c.places) ? c.places[0] : c.places;
    return {
      id: c.id,
      place_id: c.place_id,
      place_name: placeRel?.name ?? null,
      method: c.method,
      signal: c.signal,
      duration_min: c.duration_min,
      created_at: c.created_at,
    };
  });

  return NextResponse.json({ check_ins: checkIns });
}
