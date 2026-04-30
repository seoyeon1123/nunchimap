/**
 * 체크인이 있는 모든 places 의 cached_signal 을 다시 계산.
 * 과거 load:cafes 가 cached_signal 을 'gray' 로 덮어쓴 사고를 수습하는 일회성 스크립트.
 *
 * 사용: npx tsx scripts/fix-cached-signals.ts
 */
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv();

import { createClient } from '@supabase/supabase-js';
import { recomputeAndCache } from '../src/lib/signal';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // 체크인이 있는 distinct place_id 모으기
  const { data: rows, error } = await sb
    .from('check_ins')
    .select('place_id')
    .eq('is_hidden', false);
  if (error) {
    console.error('check_ins 조회 실패:', error);
    process.exit(1);
  }
  const placeIds = Array.from(new Set((rows ?? []).map((r) => r.place_id)));
  console.log(`대상 places: ${placeIds.length}곳`);

  let ok = 0;
  let fail = 0;
  for (const pid of placeIds) {
    const success = await recomputeAndCache(sb, pid);
    if (success) {
      ok++;
      console.log(`  ✅ place_id=${pid}`);
    } else {
      fail++;
      console.log(`  ❌ place_id=${pid}`);
    }
  }
  console.log(`\n완료: 성공 ${ok}, 실패 ${fail}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
