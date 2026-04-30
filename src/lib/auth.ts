import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const COOKIE_NAME = 'nm_session';
const ALGO = 'HS256';
const EXPIRY = '30d';

function getKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      'JWT_SECRET 가 .env.local 에 충분히 길게 설정돼야 합니다 (16자 이상).',
    );
  }
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  uid: number;        // users.id
  kakao_id: string;
  nickname: string;
}

export async function createSession(payload: SessionPayload): Promise<string> {
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALGO })
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
    .sign(getKey());
}

/**
 * 세션 토큰 읽기.
 * - 웹 (RSC/route handler): 쿠키에서 자동 추출
 * - 앱 (네이티브): req 의 Authorization: Bearer <jwt> 헤더에서 추출
 *
 * route handler 안에서 둘 다 지원하려면 req 를 넘겨주면 됨 — 헤더 우선, 없으면 쿠키 폴백.
 */
export async function readSession(
  req?: Request,
): Promise<SessionPayload | null> {
  let token: string | undefined;
  const authHeader = req?.headers.get('authorization');
  if (authHeader?.toLowerCase().startsWith('bearer ')) {
    token = authHeader.slice(7).trim();
  }
  if (!token) {
    token = cookies().get(COOKIE_NAME)?.value;
  }
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getKey(), { algorithms: [ALGO] });
    if (typeof payload.uid !== 'number') return null;
    return {
      uid: payload.uid,
      kakao_id: String(payload.kakao_id ?? ''),
      nickname: String(payload.nickname ?? ''),
    };
  } catch {
    return null;
  }
}

export function setSessionCookie(token: string) {
  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearSessionCookie() {
  cookies().delete(COOKIE_NAME);
}
