import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/db';
import { readSession } from '@/lib/auth';

/**
 * POST /api/places/:id/favorite — 즐겨찾기 추가
 * DELETE /api/places/:id/favorite — 즐겨찾기 제거
 */

async function getPlaceId(params: { id: string }) {
  const id = Number(params.id);
  return Number.isFinite(id) ? id : null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await readSession(req);
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const placeId = await getPlaceId(params);
  if (placeId == null) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const supabase = getServiceClient();
  const { error } = await supabase
    .from('place_favorites')
    .upsert(
      { user_id: session.uid, place_id: placeId },
      { onConflict: 'user_id,place_id', ignoreDuplicates: true },
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, favorited: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await readSession(req);
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const placeId = await getPlaceId(params);
  if (placeId == null) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const supabase = getServiceClient();
  const { error } = await supabase
    .from('place_favorites')
    .delete()
    .eq('user_id', session.uid)
    .eq('place_id', placeId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, favorited: false });
}
