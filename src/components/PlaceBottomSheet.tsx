'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import SignalBadge from './SignalBadge';
import { useUiStore, type Signal } from '@/lib/store';

interface PlaceDetail {
  id: number;
  name: string;
  address: string | null;
  road_address: string | null;
  cached_signal: Signal | null;
  cached_median_duration: number | null;
  cached_checkin_count: number | null;
}

interface RecentReview {
  id: number;
  method: 'gps' | 'ocr' | 'manual';
  signal: 'green' | 'yellow' | 'red';
  duration_min: number | null;
  text_review: string | null;
  created_at: string;
}

interface TagAgg {
  code: string;
  label: string;
  yes: number;
  total: number;
}

interface PlaceResponse {
  place: PlaceDetail;
  recent_reviews: RecentReview[];
  tags: TagAgg[];
  verified_count?: number;
}

const SIGNAL_DOT: Record<RecentReview['signal'], string> = {
  green: '🟢',
  yellow: '🟡',
  red: '🔴',
};

const METHOD_LABEL: Record<RecentReview['method'], string> = {
  gps: 'GPS',
  ocr: '영수증',
  manual: '직접입력',
};

export default function PlaceBottomSheet() {
  const placeId = useUiStore((s) => s.selectedPlaceId);
  const setSelectedPlaceId = useUiStore((s) => s.setSelectedPlaceId);
  const [data, setData] = useState<PlaceResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (placeId == null) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setData(null);
    fetch(`/api/places/${placeId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: PlaceResponse | null) => {
        if (cancelled) return;
        setData(j);
      })
      .catch(() => {
        /* 네트워크 오류 무시 */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [placeId]);

  if (placeId == null) return null;

  const close = () => setSelectedPlaceId(null);
  const hours =
    data?.place.cached_median_duration != null
      ? (data.place.cached_median_duration / 60).toFixed(1)
      : '—';

  return (
    <div className="pointer-events-auto fixed inset-x-0 bottom-0 z-20 max-h-[70vh] overflow-y-auto rounded-t-3xl border-t bg-white p-5 shadow-2xl">
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className="mx-auto h-1 w-10 rounded-full bg-gray-300" aria-hidden />
        <button
          type="button"
          aria-label="닫기"
          onClick={close}
          className="absolute right-3 top-3 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          ✕
        </button>
      </div>

      {loading && (
        <div className="py-8 text-center text-sm text-gray-500">불러오는 중…</div>
      )}

      {!loading && !data && (
        <div className="py-8 text-center text-sm text-gray-500">
          정보를 불러오지 못했어요.
        </div>
      )}

      {data && (
        <>
          <h2 className="mt-2 text-lg font-bold">{data.place.name}</h2>
          <p className="mt-0.5 text-sm text-gray-600">
            {data.place.road_address ?? data.place.address ?? '주소 정보 없음'}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <SignalBadge signal={data.place.cached_signal} />
            {data.verified_count != null && data.verified_count > 0 && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700"
                title="GPS 또는 영수증으로 검증된 리뷰가 있어요"
              >
                ✓ 검증됨 {data.verified_count}건
              </span>
            )}
            <div className="text-xs text-gray-500">
              체류 중앙값 {hours === '—' ? '—' : `${hours}h`} · 리뷰{' '}
              {data.place.cached_checkin_count ?? 0}건
            </div>
          </div>
          {data.place.cached_signal === 'gray' && data.tags.length > 0 && (
            <div className="mt-2 text-xs text-gray-500">
              태그 정보는 있지만 리뷰/체크인 데이터가 아직 충분하지 않아요.
            </div>
          )}

          {data.tags.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2 text-xs">
              {data.tags.map((t) => {
                const ratio =
                  t.total === 0 ? 0 : Math.round((t.yes / t.total) * 100);
                return (
                  <li
                    key={t.code}
                    className="rounded-full bg-gray-100 px-2 py-1 text-gray-700"
                  >
                    {t.label} {ratio}%
                  </li>
                );
              })}
            </ul>
          )}

          {data.recent_reviews.length > 0 && (
            <ul className="mt-4 space-y-2 text-sm">
              {data.recent_reviews.map((r) => (
                <li key={r.id} className="border-l-2 border-gray-200 pl-3">
                  <div className="text-gray-800">
                    {SIGNAL_DOT[r.signal]} {METHOD_LABEL[r.method]}
                    {r.duration_min
                      ? ` · ${Math.round(r.duration_min / 6) / 10}h`
                      : ''}
                  </div>
                  {r.text_review && (
                    <div className="text-xs text-gray-600">{r.text_review}</div>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex gap-2">
            <Link
              href={`/places/${data.place.id}`}
              className="flex-1 rounded-full border bg-white px-4 py-2 text-center text-sm hover:bg-gray-50"
            >
              자세히 보기
            </Link>
            <Link
              href={`/check-in/${data.place.id}`}
              className="flex-1 rounded-full bg-black px-4 py-2 text-center text-sm text-white"
            >
              ✍️ 리뷰 작성
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
