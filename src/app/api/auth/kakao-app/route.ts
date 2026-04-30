import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/db';
import { createSession } from '@/lib/auth';

/**
 * POST /api/auth/kakao-app
 *
 * 모바일 앱(Expo) 용 카카오 OAuth 토큰 교환.
 * 두 가지 입력 모두 지원:
 *   1) { code, redirect_uri }       — expo-auth-session 으로 받은 인증코드
 *   2) { kakao_access_token }       — @react-native-seoul/kakao-login SDK 가 준 토큰
 *
 * 응답: { token, user } — 앱은 token 을 AsyncStorage 에 저장 후 Authorization: Bearer 로 사용.
 * (웹의 /api/auth/kakao/callback 과 달리 쿠키를 안 굽는다.)
 */
interface AppLoginBody {
  code?: string;
  redirect_uri?: string;
  kakao_access_token?: string;
}

interface KakaoTokenResponse {
  access_token: string;
}
interface KakaoMe {
  id: number;
  kakao_account?: {
    profile?: {
      nickname?: string;
      profile_image_url?: string;
    };
  };
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as AppLoginBody;
  const { code, redirect_uri, kakao_access_token } = body;

  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
    return NextResponse.json({ error: 'jwt_secret_missing' }, { status: 500 });
  }

  // 1. 카카오 access_token 확보
  let accessToken: string | undefined = kakao_access_token;
  if (!accessToken && code && redirect_uri) {
    const clientId = process.env.KAKAO_OAUTH_CLIENT_ID;
    const clientSecret = process.env.KAKAO_OAUTH_CLIENT_SECRET ?? '';
    if (!clientId) {
      return NextResponse.json({ error: 'env_missing' }, { status: 500 });
    }
    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      redirect_uri,
      code,
    });
    if (clientSecret) tokenBody.set('client_secret', clientSecret);

    const tr = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody,
    });
    if (!tr.ok) {
      const t = await tr.text();
      console.error('[kakao-app] token exchange failed', tr.status, t);
      return NextResponse.json(
        { error: 'token_exchange_failed', detail: t.slice(0, 200) },
        { status: 401 },
      );
    }
    const tj = (await tr.json()) as KakaoTokenResponse;
    accessToken = tj.access_token;
  }

  if (!accessToken) {
    return NextResponse.json(
      { error: 'either {code, redirect_uri} or {kakao_access_token} required' },
      { status: 400 },
    );
  }

  // 2. 카카오 /v2/user/me
  const meRes = await fetch('https://kapi.kakao.com/v2/user/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!meRes.ok) {
    console.error('[kakao-app] /me failed', meRes.status, await meRes.text());
    return NextResponse.json({ error: 'kakao_me_failed' }, { status: 401 });
  }
  const me = (await meRes.json()) as KakaoMe;

  const kakaoId = String(me.id);
  const nickname = me.kakao_account?.profile?.nickname ?? '익명 사용자';
  const profileImage = me.kakao_account?.profile?.profile_image_url ?? null;

  // 3. users upsert
  const supabase = getServiceClient();
  const { data: upserted, error: upErr } = await supabase
    .from('users')
    .upsert(
      { kakao_id: kakaoId, nickname, profile_image: profileImage },
      { onConflict: 'kakao_id' },
    )
    .select('id, kakao_id, nickname')
    .single();
  if (upErr || !upserted) {
    console.error('[kakao-app] user upsert failed', upErr);
    return NextResponse.json({ error: 'user_upsert' }, { status: 500 });
  }

  // 4. JWT 발급 후 JSON 반환 (쿠키 X)
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
