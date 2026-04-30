import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/auth/kakao?next=/some/path
 * 카카오 OAuth 인증 시작 — 카카오 로그인 페이지로 redirect.
 * `next` 파라미터로 로그인 후 돌아갈 경로를 OAuth state 에 실어보냄.
 */
export async function GET(req: NextRequest) {
  const clientId = process.env.KAKAO_OAUTH_CLIENT_ID;
  const redirectUri = process.env.KAKAO_OAUTH_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: 'KAKAO_OAUTH_CLIENT_ID / KAKAO_OAUTH_REDIRECT_URI 미설정' },
      { status: 500 },
    );
  }

  // next 는 로컬 경로만 허용 (open redirect 방지)
  const rawNext = req.nextUrl.searchParams.get('next') ?? '/';
  const safeNext =
    rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'profile_nickname,profile_image',
    state: safeNext,
  });

  const url = `https://kauth.kakao.com/oauth/authorize?${params.toString()}`;
  return NextResponse.redirect(url);
}
