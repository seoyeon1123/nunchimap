/**
 * data/cafes.json → 도로명주소 API로 좌표 변환 → data/cafes.geocoded.json
 *
 * 사용 API: 행정안전부 도로명주소 검색 (주소→영문주소API에 좌표 X)
 *           실제로는 도로명주소 좌표제공 API (https://business.juso.go.kr) 사용
 *           → 응답에 entX/entY (EPSG:5179) 포함, WGS84 변환 필요
 *
 * Note: 좌표 변환이 필요 없는 더 간단한 대안으로
 *       "VWorld 지오코더 2.0" (https://www.vworld.kr) 도 가능. WGS84 직접 반환.
 *       이 스크립트는 VWorld 사용 (간단함).
 *
 * .env.local 에 JUSO_API_KEY (= VWorld 인증키) 필요
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv();
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

interface CleanCafe {
  source_id: string;
  name: string;
  road_address: string;
  jibun_address: string;
  business_type: string;
  status: string;
}

interface GeocodedCafe extends CleanCafe {
  lat: number | null;
  lng: number | null;
  geocode_source: 'vworld' | 'failed';
}

const VWORLD_URL = 'https://api.vworld.kr/req/address';

async function geocodeVWorld(
  apiKey: string,
  address: string,
  type: 'road' | 'parcel',
): Promise<{ lat: number; lng: number } | null> {
  const params = new URLSearchParams({
    service: 'address',
    request: 'getCoord',
    version: '2.0',
    crs: 'EPSG:4326',
    address,
    refine: 'true',
    simple: 'false',
    format: 'json',
    type,
    key: apiKey,
  });

  try {
    const res = await fetch(`${VWORLD_URL}?${params.toString()}`);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      response?: {
        status?: string;
        result?: { point?: { x?: string; y?: string } };
      };
    };
    if (json.response?.status !== 'OK') return null;
    const x = json.response.result?.point?.x;
    const y = json.response.result?.point?.y;
    if (!x || !y) return null;
    return { lng: Number(x), lat: Number(y) };
  } catch {
    return null;
  }
}

async function main() {
  const apiKey = process.env.JUSO_API_KEY;
  if (!apiKey) {
    console.error('❌ JUSO_API_KEY 가 .env.local 에 없습니다 (VWorld 인증키)');
    console.error('   https://www.vworld.kr 에서 발급받으세요.');
    process.exit(1);
  }

  const inPath = path.join(process.cwd(), 'data', 'cafes.json');
  const outPath = path.join(process.cwd(), 'data', 'cafes.geocoded.json');

  const raw = await fs.readFile(inPath, 'utf-8').catch(() => null);
  if (!raw) {
    console.error(`❌ ${inPath} 가 없습니다. 먼저 npm run fetch:cafes 실행.`);
    process.exit(1);
  }

  const cafes: CleanCafe[] = JSON.parse(raw);
  console.log(`🚀 좌표 변환 시작: ${cafes.length}건`);

  const out: GeocodedCafe[] = [];
  let ok = 0;
  let fail = 0;

  for (let i = 0; i < cafes.length; i++) {
    const c = cafes[i];

    // 1) 도로명주소 우선 시도
    let coord = c.road_address ? await geocodeVWorld(apiKey, c.road_address, 'road') : null;
    // 2) 실패 시 지번주소
    if (!coord && c.jibun_address) {
      coord = await geocodeVWorld(apiKey, c.jibun_address, 'parcel');
    }

    if (coord) {
      out.push({ ...c, lat: coord.lat, lng: coord.lng, geocode_source: 'vworld' });
      ok++;
    } else {
      out.push({ ...c, lat: null, lng: null, geocode_source: 'failed' });
      fail++;
    }

    if ((i + 1) % 50 === 0) {
      console.log(`  진행 ${i + 1}/${cafes.length}  성공=${ok}  실패=${fail}`);
      // 진행상황 중간 저장 (긴 작업 보호)
      await fs.writeFile(outPath, JSON.stringify(out, null, 2), 'utf-8');
    }

    // VWorld rate limit 보호
    await new Promise((r) => setTimeout(r, 80));
  }

  await fs.writeFile(outPath, JSON.stringify(out, null, 2), 'utf-8');
  console.log(`\n✅ 완료: 성공=${ok}, 실패=${fail} → ${outPath}`);
  console.log(`   다음: npm run load:cafes`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
