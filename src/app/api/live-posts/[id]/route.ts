import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/db';
import { readSession } from '@/lib/auth';

/**
 * DELETE /api/live-posts/:id
 * 본인이 작성한 라이브 글을 즉시 숨김(soft delete) 처리.
 */
export async function DELETE(
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

  const supabase = getServiceClient();
  const { data: post } = await supabase
    .from('live_posts')
    .select('id, user_id, hidden_at')
    .eq('id', id)
    .maybeSingle();

  if (!post) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  if (post.user_id !== session.uid) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (post.hidden_at) {
    return NextResponse.json({ ok: true });
  }

  const { error } = await supabase
    .from('live_posts')
    .update({ hidden_at: new Date().toISOString(), hidden_reason: 'user' })
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
