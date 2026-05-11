/**
 * 개발용: 사용자 좌표 근처에 테스트 카페 3개 시드.
 * 실 데이터(카카오 동기화) 와 충돌 안 나도록 kakao_place_id 에 'TEST_' prefix.
 *
 * 실행: npx tsx scripts/seed-test-cafes.ts <lat> <lng>
 *  예:  npx tsx scripts/seed-test-cafes.ts 37.39307324253613 126.97257976141556
 *
 * 같은 좌표로 다시 실행하면 upsert (kakao_place_id 기준).
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv();

import { createClient } from '@supabase/supabase-js';

async function main() {
  const [latArg, lngArg] = process.argv.slice(2);
  const lat = Number(latArg);
  const lng = Number(lngArg);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    console.error('❌ 사용법: npx tsx scripts/seed-test-cafes.ts <lat> <lng>');
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('❌ Supabase 환경변수가 .env.local 에 없습니다.');
    process.exit(1);
  }
  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  // 1m ≈ 0.000009 lat / 0.0000113 lng (37° 부근)
  const M_LAT = 1 / 111_000;
  const M_LNG = 1 / (111_000 * Math.cos((lat * Math.PI) / 180));

  const cafes = [
    {
      kakao_place_id: 'TEST_NUNCHIMAP_001',
      name: '테스트 카페 (현위치)',
      offsetLat: 0,
      offsetLng: 0,
    },
    {
      kakao_place_id: 'TEST_NUNCHIMAP_002',
      name: '테스트 카페 (50m 동쪽)',
      offsetLat: 0,
      offsetLng: 50 * M_LNG,
    },
    {
      kakao_place_id: 'TEST_NUNCHIMAP_003',
      name: '테스트 카페 (80m 북쪽)',
      offsetLat: 80 * M_LAT,
      offsetLng: 0,
    },
  ];

  for (const c of cafes) {
    const cLat = lat + c.offsetLat;
    const cLng = lng + c.offsetLng;

    const { data: existing } = await supabase
      .from('places')
      .select('id')
      .eq('kakao_place_id', c.kakao_place_id)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from('places')
        .update({
          name: c.name,
          address: '경기 안양시 (테스트)',
          road_address: '경기 안양시 (테스트)',
          location: `POINT(${cLng} ${cLat})`,
        })
        .eq('id', existing.id);
      if (error) console.error(`  ❌ 업데이트 실패 (${c.name}):`, error.message);
      else console.log(`  ↻ ${c.name} (id=${existing.id}) 좌표 갱신: ${cLat.toFixed(6)}, ${cLng.toFixed(6)}`);
    } else {
      const { data, error } = await supabase
        .from('places')
        .insert({
          kakao_place_id: c.kakao_place_id,
          name: c.name,
          address: '경기 안양시 (테스트)',
          road_address: '경기 안양시 (테스트)',
          location: `POINT(${cLng} ${cLat})`,
          cached_signal: 'gray',
        })
        .select('id')
        .single();
      if (error) console.error(`  ❌ 삽입 실패 (${c.name}):`, error.message);
      else console.log(`  ＋ ${c.name} (id=${data.id}) 신규: ${cLat.toFixed(6)}, ${cLng.toFixed(6)}`);
    }
  }

  console.log('\n✅ 시드 완료. 앱에서 새로고침하면 지도에 보임.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
