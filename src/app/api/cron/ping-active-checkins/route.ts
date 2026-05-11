import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/db';
import { sendExpoPush } from '@/lib/push';

export const dynamic = 'force-dynamic';

const MIN_AGE_MIN = 60;           // 체크인 후 1시간 지나야 첫 핑
const MAX_AGE_MIN = 4 * 60 + 30;  // 4시간 30분 지나면 그만 — 최대 4회 핑
const DEDUP_MIN = 50;             // 같은 시간 cron 재실행 시 중복 방지

/**
 * GET /api/cron/ping-active-checkins
 *
 * Vercel Cron 으로 매시간 실행. 활성 GPS 체크인 중 시작 후 1~4시간 30분 사이인 사용자에게
 * "아직 카공 중이세요?" 푸시를 보낸다. 푸시 후 last_pinged_at 갱신.
 *
 * 인증: Vercel 이 자동으로 `Authorization: Bearer ${CRON_SECRET}` 헤더를 붙임.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = getServiceClient();
  const now = Date.now();
  const minStarted = new Date(now - MAX_AGE_MIN * 60_000).toISOString();
  const maxStarted = new Date(now - MIN_AGE_MIN * 60_000).toISOString();
  const dedupCutoff = new Date(now - DEDUP_MIN * 60_000).toISOString();

  // 핑 보낼 대상 체크인 찾기
  const { data: targets, error: tErr } = await supabase
    .from('check_ins')
    .select('id, user_id, place_id, started_at, last_pinged_at')
    .eq('method', 'gps')
    .eq('is_hidden', false)
    .is('ended_at', null)
    .gte('started_at', minStarted)
    .lte('started_at', maxStarted)
    .or(`last_pinged_at.is.null,last_pinged_at.lt.${dedupCutoff}`);

  if (tErr) {
    console.error('[cron/ping] target query failed', tErr);
    return NextResponse.json({ error: tErr.message }, { status: 500 });
  }

  if (!targets || targets.length === 0) {
    return NextResponse.json({ ok: true, pinged: 0 });
  }

  // 카페 이름 일괄 조회
  const placeIds = Array.from(new Set(targets.map((t) => t.place_id as number)));
  const { data: places } = await supabase
    .from('places')
    .select('id, name')
    .in('id', placeIds);
  const placeNameById = new Map<number, string>(
    (places ?? []).map((p) => [p.id as number, p.name as string]),
  );

  // 사용자별 푸시 토큰 일괄 조회
  const userIds = Array.from(new Set(targets.map((t) => t.user_id as number)));
  const { data: tokenRows } = await supabase
    .from('push_tokens')
    .select('token, user_id')
    .in('user_id', userIds);

  const tokensByUser = new Map<number, string[]>();
  for (const t of tokenRows ?? []) {
    const uid = t.user_id as number;
    const arr = tokensByUser.get(uid) ?? [];
    arr.push(t.token as string);
    tokensByUser.set(uid, arr);
  }

  let pinged = 0;
  const pingedIds: number[] = [];

  for (const ci of targets) {
    const tokens = tokensByUser.get(ci.user_id as number) ?? [];
    if (tokens.length === 0) continue;

    const placeName = placeNameById.get(ci.place_id as number) ?? '카페';
    const startedAt = new Date(ci.started_at as string).getTime();
    const elapsedH = Math.max(1, Math.round((now - startedAt) / 3_600_000));

    const result = await sendExpoPush(
      tokens,
      {
        title: `${placeName} · ${elapsedH}시간째 카공 중`,
        body: '아직 머무는 중이세요? 마무리하려면 탭하세요.',
        data: {
          type: 'checkin_ping',
          check_in_id: ci.id,
          place_id: ci.place_id,
          place_name: placeName,
        },
      },
      { supabase, cleanInvalid: true },
    );

    if (result.sent > 0) {
      pinged++;
      pingedIds.push(ci.id as number);
    }
  }

  // last_pinged_at 일괄 업데이트
  if (pingedIds.length > 0) {
    await supabase
      .from('check_ins')
      .update({ last_pinged_at: new Date().toISOString() })
      .in('id', pingedIds);
  }

  return NextResponse.json({
    ok: true,
    scanned: targets.length,
    pinged,
  });
}
