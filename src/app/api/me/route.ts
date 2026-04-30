import { NextRequest, NextResponse } from 'next/server';
import { readSession } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const session = await readSession(req);
  if (!session) return NextResponse.json({ user: null });
  return NextResponse.json({
    user: {
      id: session.uid,
      nickname: session.nickname,
    },
  });
}
