/**
 * data/cafes.json → Supabase places 테이블 적재
 *
 * 카카오 로컬 검색 결과는 좌표가 이미 포함돼 있어 geocode 단계가 필요 없음.
 * (구버전: data/cafes.geocoded.json 을 읽었지만, 신버전은 cafes.json 직접 사용)
 *
 * .env.local 에 NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 필요
 * (Service Role Key는 절대 클라이언트 코드/공개 저장소에 노출 금지)
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv();

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createClient } from '@supabase/supabase-js';

interface CafeRow {
  kakao_place_id: string;
  name: string;
  road_address: string;
  jibun_address: string;
  category_name?: string;
  lat: number;
  lng: number;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('❌ Supabase 환경변수가 .env.local 에 없습니다.');
    process.exit(1);
  }
  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const inPath = path.join(process.cwd(), 'data', 'cafes.json');
  const raw = await fs.readFile(inPath, 'utf-8').catch(() => null);
  if (!raw) {
    console.error(`❌ ${inPath} 없음. npm run fetch:cafes 먼저 실행.`);
    process.exit(1);
  }

  const cafes: CafeRow[] = JSON.parse(raw);
  const valid = cafes.filter(
    (c) =>
      c.kakao_place_id &&
      isFinite(c.lat) &&
      isFinite(c.lng),
  );
  console.log(`🚀 적재 시작: 유효 ${valid.length} / 전체 ${cafes.length}`);

  const BATCH = 100;
  let inserted = 0;
  let failed = 0;

  for (let i = 0; i < valid.length; i += BATCH) {
    const slice = valid.slice(i, i + BATCH);

    // 기존에 이미 들어있는 kakao_place_id 조회 → 신/구 분리
    // (upsert 로 cached_signal='gray' 덮으면 기존 리뷰 결과가 날아감)
    const ids = slice.map((c) => c.kakao_place_id);
    const { data: existingRows, error: exErr } = await supabase
      .from('places')
      .select('kakao_place_id')
      .in('kakao_place_id', ids);
    if (exErr) {
      console.error(`  배치 ${i}~${i + slice.length} 조회 실패:`, exErr.message);
      failed += slice.length;
      continue;
    }
    const existingSet = new Set(
      (existingRows ?? []).map((r) => r.kakao_place_id),
    );

    // 기존 행: cached_signal 빼고 업데이트 (신호등 보존)
    const updates = slice.filter((c) => existingSet.has(c.kakao_place_id));
    for (const c of updates) {
      const { error: updErr } = await supabase
        .from('places')
        .update({
          name: c.name,
          address: c.jibun_address || null,
          road_address: c.road_address || null,
          location: `POINT(${c.lng} ${c.lat})`,
        })
        .eq('kakao_place_id', c.kakao_place_id);
      if (updErr) {
        console.error(`  update 실패 (${c.kakao_place_id}):`, updErr.message);
        failed += 1;
      } else {
        inserted += 1;
      }
    }

    // 신규 행: cached_signal='gray' 와 함께 INSERT
    const inserts = slice
      .filter((c) => !existingSet.has(c.kakao_place_id))
      .map((c) => ({
        kakao_place_id: c.kakao_place_id,
        name: c.name,
        address: c.jibun_address || null,
        road_address: c.road_address || null,
        location: `POINT(${c.lng} ${c.lat})`,
        cached_signal: 'gray',
      }));
    if (inserts.length > 0) {
      const { error: insErr } = await supabase.from('places').insert(inserts);
      if (insErr) {
        console.error(`  insert 실패 (${inserts.length}건):`, insErr.message);
        failed += inserts.length;
      } else {
        inserted += inserts.length;
      }
    }

    console.log(`  진행 ${inserted}/${valid.length} (신규 ${inserts.length}, 갱신 ${updates.length})`);
  }

  console.log(`\n✅ 완료: 적재=${inserted}, 실패=${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
