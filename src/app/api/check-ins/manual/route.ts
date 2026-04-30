import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/db';
import { readSession } from '@/lib/auth';
import { recomputeAndCache } from '@/lib/signal';

/**
 * POST /api/check-ins/manual
 * Body: { place_id, duration_min, signal, tags?, text? }
 *
 * GPS 검증 없이 수동 입력. 신뢰도 0.3.
 */
export async function POST(req: NextRequest) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await req.json()) as {
    place_id?: number;
    duration_min?: number;
    signal?: 'green' | 'yellow' | 'red';
    tags?: string[];
    text?: string;
  };
  const { place_id, duration_min, signal, tags, text } = body;

  if (
    typeof place_id !== 'number' ||
    typeof duration_min !== 'number' ||
    !signal ||
    !['green', 'yellow', 'red'].includes(signal)
  ) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  if (duration_min < 0 || duration_min > 12 * 60) {
    return NextResponse.json(
      { error: 'duration_min은 0~720 사이' },
      { status: 400 },
    );
  }

  const supabase = getServiceClient();

  const { data: place, error: pErr } = await supabase
    .from('places')
    .select('id')
    .eq('id', place_id)
    .maybeSingle();
  if (pErr || !place) {
    return NextResponse.json({ error: 'place not found' }, { status: 404 });
  }

  // 동일 사용자 같은 카페 30분 내 manual 중복 차단 (도배 방지)
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: recent } = await supabase
    .from('check_ins')
    .select('id')
    .eq('user_id', session.uid)
    .eq('place_id', place_id)
    .eq('method', 'manual')
    .gte('created_at', since)
    .limit(1);
  if (recent && recent.length > 0) {
    return NextResponse.json(
      { error: '같은 카페에 30분 이내 다시 작성할 수 없어요.' },
      { status: 429 },
    );
  }

  const now = new Date();
  const insertPayload = {
    user_id: session.uid,
    place_id,
    method: 'manual' as const,
    signal,
    started_at: new Date(now.getTime() - duration_min * 60_000).toISOString(),
    ended_at: now.toISOString(),
    duration_min,
    text_review: text?.trim() || null,
    is_hidden: false,
  };
  console.log('[manual] inserting check_in', insertPayload);
  const { data: created, error: insErr } = await supabase
    .from('check_ins')
    .insert(insertPayload)
    .select('id')
    .single();

  if (insErr || !created) {
    console.error('[manual] check_in INSERT 실패', {
      error: insErr,
      session_uid: session.uid,
      place_id,
    });
    return NextResponse.json(
      { error: insErr?.message ?? 'insert failed', detail: insErr },
      { status: 500 },
    );
  }
  console.log('[manual] check_in 등록 OK', created);

  if (tags && tags.length > 0) {
    const { data: tagRows } = await supabase
      .from('tags')
      .select('id, code')
      .in('code', tags);
    if (tagRows) {
      await supabase.from('place_tag_votes').upsert(
        tagRows.map((t) => ({
          place_id,
          tag_id: t.id,
          user_id: session.uid,
          vote: true,
        })),
        { onConflict: 'place_id,tag_id,user_id' },
      );
    }
  }

  const cacheUpdated = await recomputeAndCache(supabase, place_id);
  if (!cacheUpdated) {
    console.error('[/api/check-ins/manual] recomputeAndCache failed', {
      place_id,
      check_in_id: created.id,
    });
  }

  return NextResponse.json({ ok: true, check_in_id: created.id });
}
