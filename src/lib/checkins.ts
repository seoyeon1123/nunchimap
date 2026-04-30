import { SupabaseClient } from '@supabase/supabase-js';

const STALE_AFTER_MS = 12 * 3600 * 1000;

/**
 * 12시간+ 미완료 체크인을 자동 만료(is_hidden=true)로 정리.
 * 호출 시점: /api/check-ins/start, /me 페이지 진입, 추후 cron 등.
 *
 * userId 가 주어지면 해당 유저 것만, 없으면 전체.
 * 영향받은 place_id 들을 반환 — 호출자가 필요하면 recompute 트리거 가능.
 */
export async function expireStaleCheckIns(
  supabase: SupabaseClient,
  userId?: number,
): Promise<{ expired: number }> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();
  let q = supabase
    .from('check_ins')
    .update({ is_hidden: true, hidden_reason: 'auto_expired' })
    .is('ended_at', null)
    .lt('started_at', cutoff)
    .select('id');
  if (typeof userId === 'number') q = q.eq('user_id', userId);

  const { data, error } = await q;
  if (error) {
    console.error('[expireStaleCheckIns] update failed', { userId, error });
    return { expired: 0 };
  }
  return { expired: data?.length ?? 0 };
}
