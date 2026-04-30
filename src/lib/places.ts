import { SupabaseClient } from '@supabase/supabase-js';
import { recomputeAndCache } from './signal';

export interface PlaceDetail {
  id: number;
  kakao_place_id?: string | null;
  name: string;
  address: string | null;
  road_address: string | null;
  lat: number;
  lng: number;
  has_outlet: boolean | null;
  has_wifi: boolean | null;
  is_quiet: boolean | null;
  cached_signal: 'green' | 'yellow' | 'red' | 'gray' | null;
  cached_median_duration: number | null;
  cached_checkin_count: number | null;
  cached_updated_at: string | null;
  is_closed: boolean;
}

export interface RecentReview {
  id: number;
  method: 'gps' | 'ocr' | 'manual';
  signal: 'green' | 'yellow' | 'red';
  duration_min: number | null;
  text_review: string | null;
  created_at: string;
}

export interface TagAgg {
  code: string;
  label: string;
  yes: number;
  total: number;
}

export interface PlaceDetailBundle {
  place: PlaceDetail;
  reviews: RecentReview[];
  tags: TagAgg[];
  verifiedCount: number;
}

/**
 * place 상세 + 최근 리뷰 5건 + 태그 집계 + GPS/OCR 검증 카운트.
 * 캐시가 최신 리뷰보다 오래됐으면 self-heal 로 recompute.
 *
 * /api/places/[id] 라우트와 /places/[id] RSC 페이지가 같은 페이로드를 쓰므로 공유.
 */
export async function loadPlaceDetail(
  supabase: SupabaseClient,
  id: number,
): Promise<PlaceDetailBundle | null> {
  const [placeRes, checkInsRes, tagVotesRes] = await Promise.all([
    supabase.from('places_view').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('check_ins')
      .select('id,method,signal,duration_min,text_review,created_at')
      .eq('place_id', id)
      .eq('is_hidden', false)
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('place_tag_votes')
      .select('vote,tags(code,label)')
      .eq('place_id', id),
  ]);
  // count 쿼리는 별도 await — head:true 가 같은 Promise.all 안에서 다른 select 응답에 새어든다.
  const verifiedRes = await supabase
    .from('check_ins')
    .select('id', { count: 'exact', head: true })
    .eq('place_id', id)
    .eq('is_hidden', false)
    .in('method', ['gps', 'ocr']);

  if (placeRes.error || !placeRes.data) return null;

  let place = placeRes.data as PlaceDetail;

  // 캐시 stale 감지 → self-heal recompute
  const latestReviewAt = checkInsRes.data?.[0]?.created_at;
  if (
    latestReviewAt &&
    (!place.cached_updated_at ||
      new Date(latestReviewAt) > new Date(place.cached_updated_at))
  ) {
    console.warn('[loadPlaceDetail] cache stale, recomputing', {
      id,
      latestReviewAt,
      cachedUpdatedAt: place.cached_updated_at,
    });
    const ok = await recomputeAndCache(supabase, id);
    if (ok) {
      const refresh = await supabase
        .from('places_view')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (!refresh.error && refresh.data) place = refresh.data as PlaceDetail;
    }
  }

  // 태그 집계
  type RawVote = {
    vote: boolean;
    tags:
      | { code: string; label: string }
      | { code: string; label: string }[]
      | null;
  };
  const tagAgg = new Map<string, TagAgg>();
  for (const raw of (tagVotesRes.data ?? []) as unknown as RawVote[]) {
    const tag = Array.isArray(raw.tags) ? raw.tags[0] : raw.tags;
    if (!tag) continue;
    const cur =
      tagAgg.get(tag.code) ??
      { code: tag.code, label: tag.label, yes: 0, total: 0 };
    cur.total += 1;
    if (raw.vote) cur.yes += 1;
    tagAgg.set(tag.code, cur);
  }

  return {
    place,
    reviews: (checkInsRes.data ?? []) as RecentReview[],
    tags: Array.from(tagAgg.values()),
    verifiedCount: verifiedRes.count ?? 0,
  };
}
