/**
 * 카카오 로컬 검색 (CE7 카페) → 서울 카페 베이스 데이터 수집
 *
 * 사용법:
 *   1) .env.local 에 KAKAO_REST_API_KEY 채워넣기
 *   2) npm run fetch:cafes -- --dry-run  (서울 1/16 영역만 프로브)
 *   3) npm run fetch:cafes               (전체 서울)
 *
 * 카카오 로컬 검색 한도: 쿼리당 최대 675건 (45페이지 × 15건).
 *   서울 전체 bbox에서 시작해, total_count 가 한도를 넘는 영역만 4분할 재귀.
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

// 서울 외곽 대략 bbox
const SEOUL_BBOX: Bbox = {
  sw_lng: 126.760,
  sw_lat: 37.413,
  ne_lng: 127.190,
  ne_lat: 37.715,
};

interface Bbox {
  sw_lng: number;
  sw_lat: number;
  ne_lng: number;
  ne_lat: number;
}

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
    const isQuota = res.status === 429 || /limit has been exceeded/i.test(body);
    if (isQuota && attempt < MAX_RETRIES) {
      const wait = Math.min(60_000, 2_000 * 2 ** attempt); // 2s, 4s, 8s, 16s, 32s
      console.error(
        `\n⚠️  쿼터/속도 제한 감지 (status=${res.status}). ${wait / 1000}초 대기 후 재시도 (${attempt + 1}/${MAX_RETRIES})`,
      );
      await sleep(wait);
      continue;
    }
    throw new Error(`Kakao HTTP ${res.status}: ${body.slice(0, 300)}`);
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
    `  depth=${depth} total=${first.meta.total_count} 누적=${out.size}      \r`,
  );
}

async function main() {
  const authKey = process.env.KAKAO_REST_API_KEY;
  const dryRun = process.argv.includes('--dry-run');

  if (!authKey) {
    console.error('❌ KAKAO_REST_API_KEY 가 .env.local 에 설정되지 않았습니다.');
    console.error('   https://developers.kakao.com 에서 REST API 키 발급 후 추가하세요.');
    process.exit(1);
  }

  console.log(`🚀 카카오 로컬 검색 (CE7 카페) 시작 (dryRun=${dryRun}, interval=${REQUEST_INTERVAL_MS}ms)`);

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
      await fs.writeFile(outPath, JSON.stringify(Array.from(out.values()), null, 2), 'utf-8');
    }, 30_000);
  }

  try {
    if (dryRun) {
      // 서울 좌상단 1/16 영역만 프로브 (북서쪽 — 종로/은평 부근)
      const sub = quadSplit(quadSplit(SEOUL_BBOX)[2])[2];
      await collect(authKey, sub, 0, out, stats);
    } else {
      await collect(authKey, SEOUL_BBOX, 0, out, stats);
    }
  } finally {
    if (saveTimer) clearInterval(saveTimer);
    const dedup = Array.from(out.values());
    await fs.writeFile(outPath, JSON.stringify(dedup, null, 2), 'utf-8');
    console.log(`\n✅ 저장: ${dedup.length}건 (API 호출 ${stats.calls}회) → ${outPath}`);
    console.log(`   다음: npm run load:cafes  (geocode 단계는 건너뛰어도 됨)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
