/**
 * 카카오 로컬 검색 (CE7 카페) → 전국 광역시 카페 베이스 데이터 수집
 *
 * 사용법:
 *   1) .env.local 에 KAKAO_REST_API_KEY 채워넣기
 *   2) npm run fetch:cafes -- --dry-run                (서울 1/16 영역만 프로브)
 *   3) npm run fetch:cafes                              (REGIONS 전체 — 기본)
 *   4) npm run fetch:cafes -- --regions=seoul,gyeonggi  (특정 지역만)
 *
 * 카카오 로컬 검색 한도: 쿼리당 최대 675건 (45페이지 × 15건).
 *   각 지역 bbox에서 시작해, total_count 가 한도를 넘는 영역만 4분할 재귀.
 *
 * 데이터는 모두 data/cafes.json 한 파일에 머지 (kakao_place_id 로 dedup).
 * 중간에 끊겨도 30초 주기 자동저장 + 다음 실행 시 이어받기됨.
 *
 * 응답에 좌표(x=lng, y=lat)가 포함되므로 geocode 단계 불필요.
 * 다음: npm run load:cafes
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv();

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const ENDPOINT = 'https://dapi.kakao.com/v2/local/search/category.json';
const CATEGORY = 'CE7'; // 카페
const PAGE_SIZE = 15;
const MAX_PAGES = 45;
const MAX_PER_RECT = MAX_PAGES * PAGE_SIZE; // 675
const MAX_DEPTH = 7;

interface Bbox {
  sw_lng: number;
  sw_lat: number;
  ne_lng: number;
  ne_lat: number;
}

/**
 * 전국 광역시·도 BBOX 매핑.
 * 각 지역은 카카오 4분할 재귀로 알아서 세분화되므로 bbox 범위는 외곽 여유 있게 잡아도 OK.
 * 인구 밀집 지역 위주 — 산간/해상은 fetch 호출이 헛돌 뿐 데이터엔 영향 없음.
 */
const REGIONS: Record<string, Bbox> = {
  seoul:    { sw_lng: 126.760, sw_lat: 37.413, ne_lng: 127.190, ne_lat: 37.715 },
  gyeonggi: { sw_lng: 126.380, sw_lat: 36.890, ne_lng: 127.910, ne_lat: 38.300 },
  incheon:  { sw_lng: 126.380, sw_lat: 37.180, ne_lng: 126.780, ne_lat: 37.590 },
  busan:    { sw_lng: 128.760, sw_lat: 35.050, ne_lng: 129.320, ne_lat: 35.400 },
  daegu:    { sw_lng: 128.460, sw_lat: 35.700, ne_lng: 128.760, ne_lat: 35.970 },
  daejeon:  { sw_lng: 127.250, sw_lat: 36.230, ne_lng: 127.560, ne_lat: 36.510 },
  gwangju:  { sw_lng: 126.690, sw_lat: 35.090, ne_lng: 127.020, ne_lat: 35.290 },
  ulsan:    { sw_lng: 129.080, sw_lat: 35.430, ne_lng: 129.470, ne_lat: 35.690 },
  sejong:   { sw_lng: 127.150, sw_lat: 36.400, ne_lng: 127.380, ne_lat: 36.620 },
};

const ALL_REGION_KEYS = Object.keys(REGIONS);

interface KakaoDoc {
  id: string;
  place_name: string;
  category_name: string;
  road_address_name: string;
  address_name: string;
  x: string; // lng
  y: string; // lat
}

interface CleanCafe {
  kakao_place_id: string;
  name: string;
  road_address: string;
  jibun_address: string;
  category_name: string;
  lat: number;
  lng: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 카카오 로컬 API 의 초당 한도(약 10 QPS) 회피용. 200ms = 5 QPS.
// 환경변수 KAKAO_INTERVAL_MS 로 조정 가능.
const REQUEST_INTERVAL_MS = Number(process.env.KAKAO_INTERVAL_MS ?? 200);
const PAGE_INTERVAL_MS = Number(process.env.KAKAO_PAGE_INTERVAL_MS ?? 150);
const MAX_RETRIES = 8;

async function fetchPage(authKey: string, bbox: Bbox, page: number) {
  const rect = `${bbox.sw_lng},${bbox.sw_lat},${bbox.ne_lng},${bbox.ne_lat}`;
  const url = `${ENDPOINT}?category_group_code=${CATEGORY}&rect=${rect}&page=${page}&size=${PAGE_SIZE}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `KakaoAK ${authKey}` },
    });
    if (res.ok) {
      return (await res.json()) as {
        documents: KakaoDoc[];
        meta: { total_count: number; pageable_count: number; is_end: boolean };
      };
    }

    const body = await res.text();

    // 카카오 분류:
    //   429 → 초당 속도 제한 (재시도 의미 있음)
    //   400 + code:-10 + "API limit has been exceeded" → 일일 쿼터 소진 (재시도 무의미)
    //   기타 4xx → 즉시 실패
    const isCode10 = /"code"\s*:\s*-10/.test(body);
    const isDailyQuota =
      isCode10 ||
      /daily.*(quota|limit)|일.*한도|quota.*exceed/i.test(body);
    const isRateLimit = res.status === 429;

    if (isDailyQuota) {
      throw new Error(
        `Kakao 일일 쿼터 소진 (code:-10). 내일 00:00(KST) 리셋 후 재시도하거나 다른 REST API 키로 교체하세요.\n  status=${res.status}\n  body=${body.slice(0, 300)}`,
      );
    }
    if (isRateLimit && attempt < MAX_RETRIES) {
      const wait = Math.min(60_000, 2_000 * 2 ** attempt);
      console.error(
        `\n⚠️  초당 속도제한 (429). ${wait / 1000}초 대기 후 재시도 (${attempt + 1}/${MAX_RETRIES})`,
      );
      await sleep(wait);
      continue;
    }
    throw new Error(
      `Kakao HTTP ${res.status}\n  url=${url}\n  body=${body.slice(0, 400)}`,
    );
  }
  throw new Error('Kakao 재시도 한도 초과');
}

function quadSplit(b: Bbox): Bbox[] {
  const midLng = (b.sw_lng + b.ne_lng) / 2;
  const midLat = (b.sw_lat + b.ne_lat) / 2;
  return [
    { sw_lng: b.sw_lng, sw_lat: b.sw_lat, ne_lng: midLng, ne_lat: midLat },
    { sw_lng: midLng,    sw_lat: b.sw_lat, ne_lng: b.ne_lng, ne_lat: midLat },
    { sw_lng: b.sw_lng, sw_lat: midLat,    ne_lng: midLng,    ne_lat: b.ne_lat },
    { sw_lng: midLng,    sw_lat: midLat,    ne_lng: b.ne_lng, ne_lat: b.ne_lat },
  ];
}

function ingest(docs: KakaoDoc[], out: Map<string, CleanCafe>) {
  for (const d of docs) {
    if (!d.id || out.has(d.id)) continue;
    const lat = Number(d.y);
    const lng = Number(d.x);
    if (!isFinite(lat) || !isFinite(lng)) continue;
    out.set(d.id, {
      kakao_place_id: d.id,
      name: d.place_name,
      road_address: d.road_address_name ?? '',
      jibun_address: d.address_name ?? '',
      category_name: d.category_name ?? '',
      lat,
      lng,
    });
  }
}

async function collect(
  authKey: string,
  bbox: Bbox,
  depth: number,
  out: Map<string, CleanCafe>,
  stats: { calls: number },
) {
  stats.calls++;
  const first = await fetchPage(authKey, bbox, 1);

  // total_count 가 45페이지 한도 초과면 영역 분할
  if (first.meta.total_count > MAX_PER_RECT && depth < MAX_DEPTH) {
    for (const sub of quadSplit(bbox)) {
      await collect(authKey, sub, depth + 1, out, stats);
      await sleep(REQUEST_INTERVAL_MS);
    }
    return;
  }

  ingest(first.documents, out);
  let isEnd = first.meta.is_end;
  let page = 2;
  while (!isEnd && page <= MAX_PAGES) {
    await sleep(PAGE_INTERVAL_MS);
    stats.calls++;
    const r = await fetchPage(authKey, bbox, page);
    ingest(r.documents, out);
    isEnd = r.meta.is_end;
    page++;
  }

  process.stdout.write(
    `  depth=${depth} total=${first.meta.total_count} 누적=${out.size} calls=${stats.calls}      \r`,
  );
}

function parseRegionsArg(): string[] {
  const arg = process.argv.find((a) => a.startsWith('--regions='));
  if (!arg) return ALL_REGION_KEYS;
  const list = arg
    .slice('--regions='.length)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const unknown = list.filter((r) => !REGIONS[r]);
  if (unknown.length > 0) {
    console.error(`❌ 알 수 없는 지역: ${unknown.join(', ')}`);
    console.error(`   가능한 값: ${ALL_REGION_KEYS.join(', ')}`);
    process.exit(1);
  }
  return list;
}

async function main() {
  const authKey = process.env.KAKAO_REST_API_KEY;
  const dryRun = process.argv.includes('--dry-run');
  const regions = parseRegionsArg();

  if (!authKey) {
    console.error('❌ KAKAO_REST_API_KEY 가 .env.local 에 설정되지 않았습니다.');
    console.error('   https://developers.kakao.com 에서 REST API 키 발급 후 추가하세요.');
    process.exit(1);
  }

  console.log(
    `🚀 카카오 로컬 검색 (CE7 카페) 시작 (dryRun=${dryRun}, interval=${REQUEST_INTERVAL_MS}ms)`,
  );
  if (!dryRun) {
    console.log(`   대상 지역(${regions.length}): ${regions.join(', ')}`);
  }

  const outDir = path.join(process.cwd(), 'data');
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, dryRun ? 'cafes.dryrun.json' : 'cafes.json');

  // 체크포인트: 기존 cafes.json 이 있으면 이어받기
  const out = new Map<string, CleanCafe>();
  if (!dryRun) {
    const existing = await fs.readFile(outPath, 'utf-8').catch(() => null);
    if (existing) {
      try {
        const prev = JSON.parse(existing) as CleanCafe[];
        for (const c of prev) {
          if (c.kakao_place_id) out.set(c.kakao_place_id, c);
        }
        console.log(`📂 기존 ${out.size}건 이어받기 (data/cafes.json)`);
      } catch {
        console.warn('⚠️  기존 cafes.json 파싱 실패, 새로 시작');
      }
    }
  }

  const stats = { calls: 0 };

  // 진행 중 끊겨도 부분 결과는 살리기 위한 자동 저장
  let saveTimer: NodeJS.Timeout | null = null;
  if (!dryRun) {
    saveTimer = setInterval(async () => {
      await fs.writeFile(
        outPath,
        JSON.stringify(Array.from(out.values()), null, 2),
        'utf-8',
      );
    }, 30_000);
  }

  try {
    if (dryRun) {
      // 서울 좌상단 1/16 영역만 프로브 (북서쪽 — 종로/은평 부근)
      const sub = quadSplit(quadSplit(REGIONS.seoul)[2])[2];
      await collect(authKey, sub, 0, out, stats);
    } else {
      for (const key of regions) {
        const before = out.size;
        const startedAt = Date.now();
        console.log(`\n📍 ${key} 시작 (현재 누적 ${before}건)`);
        await collect(authKey, REGIONS[key], 0, out, stats);
        const added = out.size - before;
        const sec = Math.round((Date.now() - startedAt) / 1000);
        console.log(`\n   ${key} 완료: +${added}건 (${sec}s)`);
      }
    }
  } finally {
    if (saveTimer) clearInterval(saveTimer);
    const dedup = Array.from(out.values());
    await fs.writeFile(outPath, JSON.stringify(dedup, null, 2), 'utf-8');
    console.log(`\n✅ 저장: ${dedup.length}건 (API 호출 ${stats.calls}회) → ${outPath}`);
    console.log(`   다음: npm run load:cafes`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
