import { NextResponse } from 'next/server';
import { readSession } from '@/lib/auth';

export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.json({ user: null });
  return NextResponse.json({
    user: {
      id: session.uid,
      nickname: session.nickname,
    },
  });
}
