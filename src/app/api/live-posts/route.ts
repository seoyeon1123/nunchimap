import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/db';
import { readSession } from '@/lib/auth';
import {
  LIVE_POST_MAX_LEN,
  LIVE_POST_TTL_MIN,
  containsBadWord,
  findEligibleCheckIn,
} from '@/lib/live';
import { sendExpoPush } from '@/lib/push';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * POST /api/live-posts
 * Body: { place_id, occupancy: 1|2|3, text?, check_in_id? }
 *
 * 검증:
 *  - 로그인 필수
 *  - 본인이 해당 place_id 에 활성 체크인 중이거나 종료 후 30분 이내여야 함
 *  - 텍스트 60자 이하, 욕설/광고 키워드 없음
 *  - 카페당 1인 1라이브 (재게시 시 기존 글은 hidden 처리)
 */
export async function POST(req: NextRequest) {
  const session = await readSession(req);
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as {
    place_id?: number;
    occupancy?: number;
    text?: string;
    check_in_id?: number;
    photo_url?: string;
  };
  const { place_id, occupancy, text, check_in_id, photo_url } = body;

  if (typeof place_id !== 'number') {
    return NextResponse.json({ error: 'invalid place_id' }, { status: 400 });
  }
  if (occupancy !== 1 && occupancy !== 2 && occupancy !== 3) {
    return NextResponse.json({ error: 'invalid occupancy' }, { status: 400 });
  }

  const trimmedText = text?.trim() ?? '';
  if (trimmedText.length > LIVE_POST_MAX_LEN) {
    return NextResponse.json(
      { error: `한 줄은 ${LIVE_POST_MAX_LEN}자 이하여야 해요.` },
      { status: 400 },
    );
  }
  if (trimmedText && containsBadWord(trimmedText)) {
    return NextResponse.json(
      { error: '부적절한 표현이 포함돼 게시할 수 없어요.' },
      { status: 400 },
    );
  }

  // photo_url 검증: 우리 storage public URL 만 허용 (외부 임의 URL 차단)
  let validatedPhotoUrl: string | null = null;
  if (photo_url) {
    const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supaUrl) {
      return NextResponse.json(
        { error: 'storage 가 설정되지 않았어요.' },
        { status: 500 },
      );
    }
    const expectedPrefix = `${supaUrl}/storage/v1/object/public/live-photos/`;
    if (!photo_url.startsWith(expectedPrefix)) {
      return NextResponse.json(
        { error: '잘못된 photo_url 이에요.' },
        { status: 400 },
      );
    }
    validatedPhotoUrl = photo_url;
  }

  const supabase = getServiceClient();

  // 작성 자격 확인 — 본인 체크인 + 30분 grace
  const eligible = await findEligibleCheckIn(supabase, session.uid, place_id);
  if (!eligible) {
    return NextResponse.json(
      { error: '카페에서 체크인한 사용자만 라이브 글을 쓸 수 있어요.' },
      { status: 403 },
    );
  }

  // check_in_id 가 본문에 있으면 본인 체크인인지 한 번 더 검증
  if (typeof check_in_id === 'number' && check_in_id !== eligible.id) {
    return NextResponse.json(
      { error: 'check_in_id 가 본인 것이 아닙니다.' },
      { status: 403 },
    );
  }

  // 동일 카페 기존 활성 글이 있으면 먼저 hidden 처리 (덮어쓰기)
  await supabase
    .from('live_posts')
    .update({ hidden_at: new Date().toISOString(), hidden_reason: 'user' })
    .eq('place_id', place_id)
    .eq('user_id', session.uid)
    .is('hidden_at', null);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + LIVE_POST_TTL_MIN * 60_000);

  const { data: created, error: insErr } = await supabase
    .from('live_posts')
    .insert({
      place_id,
      user_id: session.uid,
      check_in_id: eligible.id,
      text: trimmedText || null,
      occupancy,
      photo_url: validatedPhotoUrl,
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    })
    .select('id, expires_at')
    .single();

  if (insErr || !created) {
    return NextResponse.json(
      { error: insErr?.message ?? 'insert failed' },
      { status: 500 },
    );
  }

  // 즐겨찾기한 사용자에게 푸시 — 응답 지연 방지 위해 fire-and-forget
  notifyFavoritesOfLivePost(supabase, place_id, session.uid, trimmedText).catch(
    (e) => console.error('[live-post push] failed', e),
  );

  return NextResponse.json({
    id: created.id,
    expires_at: created.expires_at,
  });
}

const PUSH_COOLDOWN_MIN = 30; // 같은 사용자에게 같은 카페 알림은 30분 간격

async function notifyFavoritesOfLivePost(
  supabase: SupabaseClient,
  placeId: number,
  authorUid: number,
  text: string,
) {
  // 1) 이 카페를 즐겨찾기한 사용자들 (작성자 제외)
  const { data: favs } = await supabase
    .from('place_favorites')
    .select('user_id')
    .eq('place_id', placeId)
    .neq('user_id', authorUid);
  if (!favs || favs.length === 0) return;

  const targetUids = favs.map((f) => f.user_id as number);

  // 2) 쿨다운 — 최근 30분 안에 이 카페로 알림 받은 사용자 제외
  const sinceIso = new Date(Date.now() - PUSH_COOLDOWN_MIN * 60_000).toISOString();
  const { data: recent } = await supabase
    .from('push_log')
    .select('user_id')
    .eq('place_id', placeId)
    .gt('sent_at', sinceIso)
    .in('user_id', targetUids);
  const recentSet = new Set((recent ?? []).map((r) => r.user_id as number));
  const finalUids = targetUids.filter((u) => !recentSet.has(u));
  if (finalUids.length === 0) return;

  // 3) 푸시 토큰 모으기
  const { data: tokens } = await supabase
    .from('push_tokens')
    .select('token, user_id')
    .in('user_id', finalUids);
  if (!tokens || tokens.length === 0) return;

  // 4) 카페 이름 조회 (메시지에 사용)
  const { data: place } = await supabase
    .from('places')
    .select('name')
    .eq('id', placeId)
    .maybeSingle();
  const placeName = place?.name ?? '카페';

  const body = text || '실시간 좌석 상태가 올라왔어요.';
  const tokenStrings = tokens.map((t) => t.token as string);

  await sendExpoPush(
    tokenStrings,
    {
      title: `${placeName} · LIVE`,
      body,
      data: { type: 'live_post', place_id: placeId },
    },
    { supabase, cleanInvalid: true },
  );

  // 5) 로그 — 쿨다운용
  const sentUids = Array.from(new Set(tokens.map((t) => t.user_id as number)));
  await supabase.from('push_log').insert(
    sentUids.map((uid) => ({
      user_id: uid,
      place_id: placeId,
      reason: 'favorite_live_post',
    })),
  );
}
