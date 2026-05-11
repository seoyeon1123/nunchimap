import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/db';
import { createSession } from '@/lib/auth';

/**
 * POST /api/auth/dev
 *
 * 개발 환경 전용 — 카카오 OAuth 우회하고 테스트 유저 JWT 즉시 발급.
 * Expo Go 에서 카카오 로그인 redirect 가 막힐 때나 시뮬레이터/웹에서 빠르게 테스트할 때 사용.
 *
 * NODE_ENV=production 에선 404 반환 (배포 환경 노출 방지).
 *
 * Body (선택): { nickname?: string } — 기본값 "DEV 테스터"
 */
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
    return NextResponse.json({ error: 'jwt_secret_missing' }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as { nickname?: string };
  const nickname = body.nickname?.trim() || 'DEV 테스터';

  // 고정 kakao_id 로 동일한 테스트 유저 재사용
  const devKakaoId = 'DEV_TEST_USER_001';

  const supabase = getServiceClient();
  const { data: upserted, error } = await supabase
    .from('users')
    .upsert(
      { kakao_id: devKakaoId, nickname, profile_image: null },
      { onConflict: 'kakao_id' },
    )
    .select('id, kakao_id, nickname')
    .single();

  if (error || !upserted) {
    console.error('[auth/dev] user upsert failed', error);
    return NextResponse.json({ error: 'user_upsert' }, { status: 500 });
  }

  const token = await createSession({
    uid: upserted.id,
    kakao_id: upserted.kakao_id,
    nickname: upserted.nickname,
  });

  return NextResponse.json({
    token,
    user: { id: upserted.id, nickname: upserted.nickname },
  });
}
