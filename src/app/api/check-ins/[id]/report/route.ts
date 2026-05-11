import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/db';
import { readSession } from '@/lib/auth';

/**
 * POST /api/check-ins/:id/report
 * Body: { reason?: string }
 *
 * 체크인(리뷰) 신고 — `reports` 테이블에 target_type='check_in' 으로 기록.
 * LivePost 와 동일하게 1건만 들어와도 즉시 hidden 처리 (Phase 1).
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

  const { data: ci } = await supabase
    .from('check_ins')
    .select('id, user_id, place_id, is_hidden')
    .eq('id', id)
    .maybeSingle();

  if (!ci) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  if (ci.user_id === session.uid) {
    return NextResponse.json(
      { error: '자신의 리뷰는 신고할 수 없어요.' },
      { status: 400 },
    );
  }

  const { error: repErr } = await supabase.from('reports').insert({
    target_type: 'check_in',
    target_id: id,
    reporter_id: session.uid,
    reason: reason ?? 'unspecified',
  });
  if (repErr) {
    return NextResponse.json({ error: repErr.message }, { status: 500 });
  }

  if (!ci.is_hidden) {
    await supabase
      .from('check_ins')
      .update({ is_hidden: true, hidden_reason: 'reported' })
      .eq('id', id);
  }

  return NextResponse.json({ ok: true, place_id: ci.place_id });
}
