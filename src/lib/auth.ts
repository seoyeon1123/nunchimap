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

export async function readSession(): Promise<SessionPayload | null> {
  const token = cookies().get(COOKIE_NAME)?.value;
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
