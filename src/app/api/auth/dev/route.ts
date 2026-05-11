import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/db';
import { createSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/dev
 *
 * 카카오 OAuth 우회하고 테스트 유저 JWT 즉시 발급.
 * Expo Go 에서 카카오 redirect 가 막힐 때 / 베타 테스터가 빠르게 들어와볼 때 사용.
 *
 * 활성화 조건:
 *   - NODE_ENV=development                  (로컬 npm run dev)
 *   - 또는 ENABLE_DEV_LOGIN=true            (Vercel 등 프로덕션 빌드에서도 명시적으로 켤 때)
 * 둘 다 아니면 404 — 배포 환경 노출 방지.
 *
 * Body (선택): { nickname?: string } — 기본값 "DEV 테스터"
 */
export async function POST(req: NextRequest) {
  const isLocalDev = process.env.NODE_ENV !== 'production';
  const explicitlyEnabled = process.env.ENABLE_DEV_LOGIN === 'true';
  if (!isLocalDev && !explicitlyEnabled) {
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
