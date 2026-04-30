/**
 * 특정 place 또는 최근 24h 체크인 진단.
 * 사용:
 *   npx tsx scripts/debug-signal.ts          # 최근 24h
 *   npx tsx scripts/debug-signal.ts 114      # 특정 place_id
 */
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv();

import { createClient } from '@supabase/supabase-js';
import { recomputeAndCache, computeSignalFromRows } from '../src/lib/signal';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const arg = process.argv[2];
  const placeIds: number[] = [];

  if (arg) {
    placeIds.push(Number(arg));
  } else {
    console.log('=== 최근 24h 체크인 ===');
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data: ci } = await sb
      .from('check_ins')
      .select('id, user_id, place_id, method, signal, duration_min, is_hidden, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(20);
    console.table(ci);
    const seen = new Set<number>();
    for (const r of ci ?? []) {
      if (!seen.has(r.place_id)) {
        seen.add(r.place_id);
        placeIds.push(r.place_id);
      }
    }
  }

  for (const pid of placeIds) {
    console.log(`\n=== place_id=${pid} ===`);
    const { data: place } = await sb
      .from('places')
      .select('id, name, cached_signal, cached_median_duration, cached_checkin_count, cached_updated_at')
      .eq('id', pid)
      .maybeSingle();
    console.log('places row:', place);

    const { data: rawCi } = await sb
      .from('check_ins')
      .select('id, user_id, method, signal, duration_min, is_hidden, created_at')
      .eq('place_id', pid)
      .order('created_at', { ascending: false });
    console.log(`check_ins (${rawCi?.length ?? 0}건):`);
    console.table(rawCi);

    const { data: joined, error: jErr } = await sb
      .from('check_ins')
      .select('user_id, method, signal, duration_min, created_at, users!inner(trust_modifier)')
      .eq('place_id', pid)
      .eq('is_hidden', false);
    console.log('JOIN 결과 (recompute 가 보는 데이터):');
    if (jErr) console.error('  JOIN 에러:', jErr);
    console.log(JSON.stringify(joined, null, 2));

    if (joined && joined.length > 0) {
      const rows = (joined as unknown as Array<{ user_id: number; method: 'gps'|'ocr'|'manual'; signal: 'green'|'yellow'|'red'; duration_min: number|null; created_at: string; users: { trust_modifier: number|null } | null }>)
        .map((r) => ({
          user_id: r.user_id,
          method: r.method,
          signal: r.signal,
          duration_min: r.duration_min,
          created_at: r.created_at,
          user_trust_modifier: r.users?.trust_modifier ?? 1.0,
        }));
      const result = computeSignalFromRows(rows);
      console.log('compute 결과:', result);
    }

    console.log('\n→ recompute 다시 돌려보기');
    const ok = await recomputeAndCache(sb, pid);
    console.log('  결과:', ok);
    const { data: after } = await sb
      .from('places')
      .select('cached_signal, cached_median_duration, cached_checkin_count, cached_updated_at')
      .eq('id', pid)
      .maybeSingle();
    console.log('after:', after);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
