import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/db';
import { createSession, setSessionCookie } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
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

export async function GET(req: NextRequest) {
  try {
    const code = req.nextUrl.searchParams.get('code');
    const errParam = req.nextUrl.searchParams.get('error');

    if (errParam) {
      return NextResponse.redirect(new URL(`/?login_error=${errParam}`, req.url));
    }
    if (!code) {
      return NextResponse.redirect(new URL('/?login_error=no_code', req.url));
    }

    const clientId = process.env.KAKAO_OAUTH_CLIENT_ID;
    const clientSecret = process.env.KAKAO_OAUTH_CLIENT_SECRET ?? '';
    const redirectUri = process.env.KAKAO_OAUTH_REDIRECT_URI;
    if (!clientId || !redirectUri) {
      return NextResponse.redirect(new URL('/?login_error=env_missing', req.url));
    }
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
      console.error('JWT_SECRET 미설정 또는 너무 짧음 (16자 이상 필요)');
      return NextResponse.redirect(new URL('/?login_error=jwt_secret', req.url));
    }

    // 1. 토큰 교환
    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code,
    });
    if (clientSecret) tokenBody.set('client_secret', clientSecret);

    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody,
    });
    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      console.error('kakao token failed', tokenRes.status, t);
      return NextResponse.redirect(new URL('/?login_error=token_failed', req.url));
    }
    const token = (await tokenRes.json()) as TokenResponse;

    // 2. 사용자 정보
    const meRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!meRes.ok) {
      console.error('kakao /me failed', meRes.status, await meRes.text());
      return NextResponse.redirect(new URL('/?login_error=me_failed', req.url));
    }
    const me = (await meRes.json()) as KakaoMe;

    const kakaoId = String(me.id);
    const nickname = me.kakao_account?.profile?.nickname ?? '익명 사용자';
    const profileImage = me.kakao_account?.profile?.profile_image_url ?? null;

    // 3. users 테이블에 upsert
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
      console.error('user upsert failed', upErr);
      return NextResponse.redirect(new URL('/?login_error=user_upsert', req.url));
    }

    // 4. JWT 세션 발급
    const jwt = await createSession({
      uid: upserted.id,
      kakao_id: upserted.kakao_id,
      nickname: upserted.nickname,
    });
    setSessionCookie(jwt);

    // state 에 담긴 원래 경로로 복귀 (없으면 홈)
    const state = req.nextUrl.searchParams.get('state') ?? '/';
    const safeNext = state.startsWith('/') && !state.startsWith('//') ? state : '/';
    return NextResponse.redirect(new URL(safeNext, req.url));
  } catch (e) {
    // 어떤 예외든 홈으로 보내고 콘솔에 로그
    console.error('kakao callback uncaught error', e);
    const msg = e instanceof Error ? e.message : 'unknown';
    return NextResponse.redirect(
      new URL(`/?login_error=server&detail=${encodeURIComponent(msg.slice(0, 80))}`, req.url),
    );
  }
}
