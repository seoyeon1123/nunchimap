import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/db';
import { readSession } from '@/lib/auth';
import { recomputeAndCache } from '@/lib/signal';

/**
 * DELETE /api/check-ins/:id
 * 본인이 작성한 체크인만 삭제 가능. 삭제 후 카페 시그널 캐시 재계산.
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

  const { data: row, error: fetchErr } = await supabase
    .from('check_ins')
    .select('id, user_id, place_id')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr || !row) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  if (row.user_id !== session.uid) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { error: delErr } = await supabase
    .from('check_ins')
    .delete()
    .eq('id', id);

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  await recomputeAndCache(supabase, row.place_id);

  return NextResponse.json({ ok: true, place_id: row.place_id });
}
