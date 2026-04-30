import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/db';
import { readSession } from '@/lib/auth';
import { recomputeAndCache } from '@/lib/signal';

/**
 * PATCH /api/check-ins/:id/finish
 * Body: { signal: 'green'|'yellow'|'red', tags?: string[], text?: string }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await readSession(req);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const body = (await req.json()) as {
    signal?: 'green' | 'yellow' | 'red';
    tags?: string[];
    text?: string;
  };
  const { signal, tags, text } = body;
  if (!signal || !['green', 'yellow', 'red'].includes(signal)) {
    return NextResponse.json({ error: 'invalid signal' }, { status: 400 });
  }

  const supabase = getServiceClient();

  const { data: check_in, error: fetchErr } = await supabase
    .from('check_ins')
    .select('id, user_id, place_id, started_at, ended_at, method')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr || !check_in) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  if (check_in.user_id !== session.uid) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (check_in.ended_at) {
    return NextResponse.json({ error: 'already finished' }, { status: 400 });
  }

  const now = new Date();
  const startedAt = new Date(check_in.started_at);
  const durationMin = Math.max(
    0,
    Math.round((now.getTime() - startedAt.getTime()) / 60_000),
  );

  if (durationMin > 12 * 60) {
    return NextResponse.json(
      { error: '체크인이 12시간을 초과했어요. 자동으로 만료처리됩니다.' },
      { status: 400 },
    );
  }

  const { error: upErr } = await supabase
    .from('check_ins')
    .update({
      signal,
      ended_at: now.toISOString(),
      duration_min: durationMin,
      text_review: text?.trim() || null,
    })
    .eq('id', id);

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  // 태그 투표 처리
  if (tags && tags.length > 0) {
    await applyTagVotes(supabase, check_in.place_id, session.uid, tags);
  }

  // 신호등 캐시 재계산 (await — 사용자가 즉시 반영된 결과 보길 원함)
  const cacheUpdated = await recomputeAndCache(supabase, check_in.place_id);
  if (!cacheUpdated) {
    console.error('[/api/check-ins/:id/finish] recomputeAndCache failed', {
      place_id: check_in.place_id,
      check_in_id: id,
    });
  }

  return NextResponse.json({
    ok: true,
    duration_min: durationMin,
    place_id: check_in.place_id,
  });
}

async function applyTagVotes(
  supabase: ReturnType<typeof getServiceClient>,
  placeId: number,
  userId: number,
  codes: string[],
) {
  const { data: tagRows } = await supabase
    .from('tags')
    .select('id, code')
    .in('code', codes);
  if (!tagRows) return;
  const upserts = tagRows.map((t) => ({
    place_id: placeId,
    tag_id: t.id,
    user_id: userId,
    vote: true,
  }));
  await supabase
    .from('place_tag_votes')
    .upsert(upserts, { onConflict: 'place_id,tag_id,user_id' });
}
