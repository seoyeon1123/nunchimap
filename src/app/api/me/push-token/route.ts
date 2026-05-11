import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/db';
import { readSession } from '@/lib/auth';
import { isExpoPushToken } from '@/lib/push';

export const dynamic = 'force-dynamic';

/**
 * POST /api/me/push-token
 * Body: { token: string, platform?: 'ios'|'android'|'web', device_id?: string }
 *
 * Expo Push 토큰 등록/갱신.
 * 토큰은 사용자 + 토큰 unique — 동일 사용자가 같은 토큰을 다시 등록하면 updated_at 만 갱신.
 */
export async function POST(req: NextRequest) {
  const session = await readSession(req);
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    token?: string;
    platform?: string;
    device_id?: string;
  };

  const token = body.token?.trim();
  if (!token || !isExpoPushToken(token)) {
    return NextResponse.json(
      { error: 'Expo Push 토큰 형식이 아니에요.' },
      { status: 400 },
    );
  }

  const platform =
    body.platform === 'ios' || body.platform === 'android' || body.platform === 'web'
      ? body.platform
      : null;

  const supabase = getServiceClient();
  const { error } = await supabase
    .from('push_tokens')
    .upsert(
      {
        user_id: session.uid,
        token,
        platform,
        device_id: body.device_id?.trim() || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,token' },
    );

  if (error) {
    console.error('[push-token] upsert failed', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/me/push-token?token=...
 *
 * 로그아웃 시 해당 토큰을 즉시 정리. body 대신 query param 으로 받음 (DELETE 와 body 호환성).
 */
export async function DELETE(req: NextRequest) {
  const session = await readSession(req);
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const token = req.nextUrl.searchParams.get('token')?.trim();
  if (!token) {
    return NextResponse.json({ error: 'token is required' }, { status: 400 });
  }

  const supabase = getServiceClient();
  await supabase
    .from('push_tokens')
    .delete()
    .eq('user_id', session.uid)
    .eq('token', token);

  return NextResponse.json({ ok: true });
}
