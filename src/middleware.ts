import { NextRequest, NextResponse } from 'next/server';

/**
 * /api/* 경로에 CORS 헤더를 붙여 RN 앱(Expo dev/스토어 빌드)에서 호출 가능하게 한다.
 * 웹 자체 fetch 는 same-origin 이라 영향 없음.
 *
 * 운영 시엔 NEXT_PUBLIC_APP_ORIGIN 같은 환경변수로 화이트리스트 좁히는 걸 권장.
 * 현재는 개발 편의를 위해 모든 origin 허용 + Authorization 헤더 통과만 보장.
 */
export function middleware(req: NextRequest) {
  const origin = req.headers.get('origin') ?? '*';

  // OPTIONS preflight: 즉시 응답
  if (req.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      },
    });
  }

  const res = NextResponse.next();
  res.headers.set('Access-Control-Allow-Origin', origin);
  res.headers.set('Access-Control-Allow-Credentials', 'true');
  res.headers.set('Access-Control-Expose-Headers', 'Content-Type');
  res.headers.set('Vary', 'Origin');
  return res;
}

export const config = {
  matcher: ['/api/:path*'],
};
