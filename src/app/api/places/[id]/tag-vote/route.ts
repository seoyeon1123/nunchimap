import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/db';
import { readSession } from '@/lib/auth';

/**
 * POST /api/places/:id/tag-vote
 * Body: { tag_code: string, vote: boolean }
 *
 * 사용자가 카페 상세에서 태그 투표 (yes/no 토글).
 * 같은 user/place/tag 조합이면 upsert. 체크인 흐름과 별개로 직접 투표 가능.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await readSession(req);
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const placeId = Number(params.id);
  if (!Number.isFinite(placeId)) {
    return NextResponse.json({ error: 'invalid place id' }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    tag_code?: string;
    vote?: boolean;
  };
  if (!body.tag_code || typeof body.vote !== 'boolean') {
    return NextResponse.json(
      { error: 'tag_code and vote required' },
      { status: 400 },
    );
  }

  const supabase = getServiceClient();

  const { data: tag } = await supabase
    .from('tags')
    .select('id, code')
    .eq('code', body.tag_code)
    .maybeSingle();
  if (!tag) {
    return NextResponse.json({ error: 'unknown tag' }, { status: 404 });
  }

  const { error } = await supabase.from('place_tag_votes').upsert(
    {
      place_id: placeId,
      tag_id: tag.id,
      user_id: session.uid,
      vote: body.vote,
    },
    { onConflict: 'place_id,tag_id,user_id' },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
