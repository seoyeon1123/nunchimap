/**
 * 신호등 산정 로직.
 * 체크인이 추가/수정될 때 해당 카페의 cached_signal 등을 갱신.
 *
 * 가중치:
 *   메소드:  GPS=1.0, OCR=0.6, manual=0.3
 *   사용자:  신규(7일 미만) 0.5, 신고누적 0.3, 헤비유저(>=50회) 1.2
 *   시간:    반감기 60일
 *
 * 결정:
 *   유효 표본(가중합) < 5  → gray
 *   median≥90 AND green_ratio≥0.6  → green
 *   median<45 OR red_ratio≥0.4     → red
 *   그 외                           → yellow
 */

import { SupabaseClient } from '@supabase/supabase-js';

export type Signal = 'green' | 'yellow' | 'red' | 'gray';
export type Method = 'gps' | 'ocr' | 'manual';
export type CheckInSignal = 'green' | 'yellow' | 'red';

const METHOD_WEIGHT: Record<Method, number> = {
  gps: 1.0,
  ocr: 0.6,
  manual: 0.3,
};

const HALF_LIFE_DAYS = 60;
// 임계값 0 — 어떤 리뷰(manual 포함)든 1건만 있으면 신호등 표시.
// 신뢰도는 별도로 "검증됨(verified) 배지" UI 로 보여주는 방향으로 함.
// 추후 데이터가 쌓이면 노이즈 줄이기 위해 다시 1.0~5.0 으로 올릴 것.
const MIN_WEIGHTED_SAMPLE = 0;
const LOOKBACK_DAYS = 90;

interface CheckInRow {
  user_id: number;
  method: Method;
  signal: CheckInSignal;
  duration_min: number | null;
  created_at: string;
  user_trust_modifier: number | null;
}

function ageDecay(createdAt: string, now: Date): number {
  const days = (now.getTime() - new Date(createdAt).getTime()) / 86_400_000;
  return Math.pow(0.5, Math.max(days, 0) / HALF_LIFE_DAYS);
}

function weightedMedian(pairs: Array<[number, number]>): number {
  if (pairs.length === 0) return 0;
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  const totalW = sorted.reduce((s, p) => s + p[1], 0);
  let cum = 0;
  for (const [v, w] of sorted) {
    cum += w;
    if (cum >= totalW / 2) return v;
  }
  return sorted[sorted.length - 1][0];
}

export function computeSignalFromRows(rows: CheckInRow[]): {
  signal: Signal;
  median_min: number | null;
  count: number;
} {
  const now = new Date();

  // 같은 user_id는 가장 최근 1건만 사용
  const byUser = new Map<number, CheckInRow>();
  for (const r of rows) {
    const cur = byUser.get(r.user_id);
    if (!cur || new Date(r.created_at) > new Date(cur.created_at)) {
      byUser.set(r.user_id, r);
    }
  }
  const dedup = Array.from(byUser.values());

  // 가중치 계산
  type Weighted = { row: CheckInRow; w: number };
  const weighted: Weighted[] = dedup.map((r) => {
    const userMod = r.user_trust_modifier ?? 1.0;
    const w = METHOD_WEIGHT[r.method] * userMod * ageDecay(r.created_at, now);
    return { row: r, w };
  });

  const totalW = weighted.reduce((s, x) => s + x.w, 0);
  // 가중합이 임계값 이하이거나 리뷰 자체가 없으면 gray.
  // (MIN_WEIGHTED_SAMPLE=0 일 때도 빈 리뷰는 gray 로 떨어지게 ≤ 비교)
  if (dedup.length === 0 || totalW <= MIN_WEIGHTED_SAMPLE) {
    return { signal: 'gray', median_min: null, count: dedup.length };
  }

  const greenW = weighted
    .filter((x) => x.row.signal === 'green')
    .reduce((s, x) => s + x.w, 0);
  const redW = weighted
    .filter((x) => x.row.signal === 'red')
    .reduce((s, x) => s + x.w, 0);

  const greenRatio = greenW / totalW;
  const redRatio = redW / totalW;

  const durationPairs: Array<[number, number]> = weighted
    .filter((x) => typeof x.row.duration_min === 'number')
    .map((x) => [x.row.duration_min as number, x.w]);

  const median = durationPairs.length > 0 ? weightedMedian(durationPairs) : 0;

  let signal: Signal;
  if (median >= 90 && greenRatio >= 0.6) signal = 'green';
  else if (median < 45 || redRatio >= 0.4) signal = 'red';
  else signal = 'yellow';

  return { signal, median_min: Math.round(median), count: dedup.length };
}

/**
 * 카페의 신호등을 재계산하고 places 테이블에 캐시.
 * 호출 시점: 체크인 등록 직후 (비동기로 던져도 되고 await 해도 됨).
 */
export async function recomputeAndCache(
  supabase: SupabaseClient,
  placeId: number,
): Promise<boolean> {
  const since = new Date(
    Date.now() - LOOKBACK_DAYS * 86_400_000,
  ).toISOString();

  const { data, error } = await supabase
    .from('check_ins')
    .select(
      'user_id, method, signal, duration_min, created_at, users!inner(trust_modifier)',
    )
    .eq('place_id', placeId)
    .eq('is_hidden', false)
    .gte('created_at', since);

  if (error || !data) {
    console.error('[recomputeAndCache] check_ins query failed', {
      placeId,
      error,
    });
    return false;
  }

  const rows: CheckInRow[] = (data as unknown as Array<{
    user_id: number;
    method: Method;
    signal: CheckInSignal;
    duration_min: number | null;
    created_at: string;
    users: { trust_modifier: number | null } | null;
  }>).map((r) => ({
    user_id: r.user_id,
    method: r.method,
    signal: r.signal,
    duration_min: r.duration_min,
    created_at: r.created_at,
    user_trust_modifier: r.users?.trust_modifier ?? 1.0,
  }));

  const result = computeSignalFromRows(rows);

  const { error: updateErr } = await supabase
    .from('places')
    .update({
      cached_signal: result.signal,
      cached_median_duration: result.median_min,
      cached_checkin_count: result.count,
      cached_updated_at: new Date().toISOString(),
    })
    .eq('id', placeId);

  if (updateErr) {
    console.error('[recomputeAndCache] places update failed', {
      placeId,
      error: updateErr,
    });
    return false;
  }

  return true;
}
