import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/db';
import { readSession } from '@/lib/auth';

/**
 * POST /api/live-posts/:id/report
 * Body: { reason?: string }
 *
 * 신고 1건이라도 들어오면 즉시 hidden 처리 (Phase 1 운영 단순화).
 * 운영 안정화 후엔 N건 임계값 + 신고자 trust 가중치 도입 예정.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await readSession(req);
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  let reason: string | null = null;
  try {
    const body = (await req.json()) as { reason?: string };
    reason = body.reason?.trim() || null;
  } catch {
    // 본문 없어도 OK
  }

  const supabase = getServiceClient();

  const { data: post } = await supabase
    .from('live_posts')
    .select('id, user_id, hidden_at')
    .eq('id', id)
    .maybeSingle();

  if (!post) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // 본인 글 신고 차단
  if (post.user_id === session.uid) {
    return NextResponse.json(
      { error: '자신의 글은 신고할 수 없어요.' },
      { status: 400 },
    );
  }

  // 신고 기록 (중복 신고는 unique 인덱스로 차단됨 → 무시)
  const { error: repErr } = await supabase.from('live_post_reports').insert({
    live_post_id: id,
    reporter_id: session.uid,
    reason,
  });
  // 23505 = unique_violation (중복 신고) — 무시하고 계속 진행
  if (repErr && repErr.code !== '23505') {
    return NextResponse.json({ error: repErr.message }, { status: 500 });
  }

  // 아직 활성이면 즉시 hidden 처리
  if (!post.hidden_at) {
    await supabase
      .from('live_posts')
      .update({ hidden_at: new Date().toISOString(), hidden_reason: 'reported' })
      .eq('id', id);
  }

  return NextResponse.json({ ok: true });
}
