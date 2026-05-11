import { SupabaseClient } from '@supabase/supabase-js';

export const LIVE_POST_TTL_MIN = 30;
export const LIVE_POST_MAX_LEN = 60;

// 체크아웃 후에도 30분간 작성 허용 — 카페에서 막 나온 사용자가 가장 작성 의지가 높음
export const POST_CHECKIN_GRACE_MIN = 30;

export type Occupancy = 1 | 2 | 3;

export interface LivePostRow {
  id: number;
  place_id: number;
  user_id: number;
  text: string | null;
  occupancy: Occupancy;
  photo_url: string | null;
  created_at: string;
  expires_at: string;
}

export interface LivePostPublic {
  id: number;
  text: string | null;
  occupancy: Occupancy;
  photo_url: string | null;
  created_at: string;
  minutes_ago: number;
}

export interface LiveSummary {
  count: number;                    // 활성 라이브 글 수 (30분 윈도우)
  occupancy_mean: number | null;    // 1.0~3.0
  last_at: string | null;
  active_count: number;             // 진행 중 GPS 체크인 수 (4시간 윈도우)
}

// "지금 카페 안에 있는 사람" 의 보수적 정의:
// - GPS 체크인 시작 후 4시간 이내
// - 아직 체크아웃 안 함
// - is_hidden=false
// 평균 카공 4시간 기준 — 더 길게 잡으면 깜빡 미체크아웃 노이즈가 끼어듦.
export const ACTIVE_CHECKIN_WINDOW_HOURS = 4;

// 욕설/광고 1차 사전 — 운영하면서 늘리는 단순 키워드 필터.
// 정교한 필터는 추후 외부 사전·ML 로 교체 예정.
const BAD_WORDS = [
  '시발', '씨발', '개새', '병신', '좆', '존나',
  // 광고성
  '카톡문의', '디엠', '문의주세요', 'http://', 'https://', 'www.',
];

export function containsBadWord(text: string): boolean {
  const normalized = text.toLowerCase().replace(/\s+/g, '');
  return BAD_WORDS.some((w) => normalized.includes(w));
}

export function minutesBetween(later: Date, earlier: Date): number {
  return Math.max(0, Math.floor((later.getTime() - earlier.getTime()) / 60_000));
}

/**
 * 사용자가 해당 카페에 라이브 작성 자격이 있는지 검증.
 * - 같은 place_id 의 본인 체크인이 존재하고
 * - 활성(미완료)이거나
 * - 종료 후 POST_CHECKIN_GRACE_MIN 이내
 *
 * 자격이 없으면 null 반환.
 */
export async function findEligibleCheckIn(
  supabase: SupabaseClient,
  userId: number,
  placeId: number,
): Promise<{ id: number; ended_at: string | null } | null> {
  const { data } = await supabase
    .from('check_ins')
    .select('id, started_at, ended_at')
    .eq('user_id', userId)
    .eq('place_id', placeId)
    .eq('is_hidden', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  // 진행 중 체크인이면 통과
  if (!data.ended_at) return { id: data.id, ended_at: null };

  // 종료된 체크인이면 grace 안에 있을 때만 통과
  const grace = POST_CHECKIN_GRACE_MIN * 60_000;
  const endedAt = new Date(data.ended_at);
  if (Date.now() - endedAt.getTime() <= grace) {
    return { id: data.id, ended_at: data.ended_at };
  }
  return null;
}

/**
 * 카페별 활성 라이브 글 + 좌석 요약.
 * (만료된 글은 WHERE 절로 자동 제외)
 *
 * summary 는 활성 글 전체 기준, posts 는 limit 만큼 반환.
 * 활성 글은 30분 윈도우라 카페당 보통 0~10개 — 50개 cap 으로 충분.
 */
const ACTIVE_FETCH_CAP = 50;

export async function loadLiveForPlace(
  supabase: SupabaseClient,
  placeId: number,
  limit = 10,
): Promise<{ posts: LivePostPublic[]; summary: LiveSummary }> {
  const nowIso = new Date().toISOString();
  const cutoffIso = new Date(
    Date.now() - ACTIVE_CHECKIN_WINDOW_HOURS * 3600_000,
  ).toISOString();

  const [livePostsRes, activeRes] = await Promise.all([
    supabase
      .from('live_posts')
      .select('id, text, occupancy, photo_url, created_at')
      .eq('place_id', placeId)
      .is('hidden_at', null)
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(ACTIVE_FETCH_CAP),
    supabase
      .from('check_ins')
      .select('id', { count: 'exact', head: true })
      .eq('place_id', placeId)
      .eq('is_hidden', false)
      .is('ended_at', null)
      .gt('started_at', cutoffIso),
  ]);

  const activeCount = activeRes.count ?? 0;

  if (livePostsRes.error || !livePostsRes.data) {
    return {
      posts: [],
      summary: {
        count: 0,
        occupancy_mean: null,
        last_at: null,
        active_count: activeCount,
      },
    };
  }

  const now = new Date();
  const allActive: LivePostPublic[] = livePostsRes.data.map((r) => ({
    id: r.id,
    text: r.text,
    occupancy: r.occupancy as Occupancy,
    photo_url: r.photo_url,
    created_at: r.created_at,
    minutes_ago: minutesBetween(now, new Date(r.created_at)),
  }));

  const occSum = allActive.reduce((acc, p) => acc + p.occupancy, 0);
  const summary: LiveSummary = {
    count: allActive.length,
    occupancy_mean: allActive.length ? occSum / allActive.length : null,
    last_at: allActive[0]?.created_at ?? null,
    active_count: activeCount,
  };

  return { posts: allActive.slice(0, limit), summary };
}

/**
 * 여러 카페에 대한 진행 중 체크인 수 일괄 집계.
 * 지도 bbox 응답에 마커별 active_count 를 채우는 용도.
 * 0인 카페는 결과 Map 에서 제외 — 호출자는 ?? 0 로 처리.
 */
export async function countActiveCheckInsByPlace(
  supabase: SupabaseClient,
  placeIds: number[],
): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (placeIds.length === 0) return result;

  const cutoffIso = new Date(
    Date.now() - ACTIVE_CHECKIN_WINDOW_HOURS * 3600_000,
  ).toISOString();

  const { data, error } = await supabase
    .from('check_ins')
    .select('place_id')
    .in('place_id', placeIds)
    .eq('is_hidden', false)
    .is('ended_at', null)
    .gt('started_at', cutoffIso);

  if (error || !data) return result;

  for (const row of data as { place_id: number }[]) {
    result.set(row.place_id, (result.get(row.place_id) ?? 0) + 1);
  }
  return result;
}
