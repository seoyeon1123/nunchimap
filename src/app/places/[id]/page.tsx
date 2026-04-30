import Link from 'next/link';
import { notFound } from 'next/navigation';
import SignalBadge from '@/components/SignalBadge';
import { getServiceClient } from '@/lib/db';
import { loadPlaceDetail } from '@/lib/places';

export const dynamic = 'force-dynamic';

const METHOD_LABEL = {
  gps: 'GPS',
  ocr: '영수증',
  manual: '직접입력',
} as const;

const SIGNAL_DOT = {
  green: '🟢',
  yellow: '🟡',
  red: '🔴',
} as const;

export default async function PlaceDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) notFound();

  const supabase = getServiceClient();
  const data = await loadPlaceDetail(supabase, id);
  if (!data) notFound();

  const { place, reviews, tags, verifiedCount } = data;
  const hours =
    place.cached_median_duration != null
      ? (place.cached_median_duration / 60).toFixed(1)
      : '—';

  return (
    <main className="mx-auto max-w-xl p-4 pb-24">
      <Link href="/" className="text-sm text-gray-500">
        ← 지도로
      </Link>

      <h1 className="mt-3 text-xl font-bold">{place.name}</h1>
      <p className="text-sm text-gray-600">
        {place.road_address ?? place.address ?? '주소 정보 없음'}
      </p>

      <section className="mt-6 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <SignalBadge signal={place.cached_signal} />
          {verifiedCount > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700"
              title="GPS 또는 영수증으로 검증된 리뷰"
            >
              ✓ 검증됨 {verifiedCount}건
            </span>
          )}
        </div>
        {place.cached_signal === 'gray' && tags.length > 0 && (
          <p className="mt-2 text-xs text-gray-500">
            태그 정보는 있지만 카페 신호등을 계산할 충분한 리뷰/체크인 데이터가 아직 없어요.
          </p>
        )}
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-gray-500">체류 중앙값</dt>
            <dd className="font-medium">
              {hours === '—' ? '—' : `${hours}h`}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">리뷰</dt>
            <dd className="font-medium">{place.cached_checkin_count ?? 0}건</dd>
          </div>
        </dl>
      </section>

      <section className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-700">빠른 정보</h2>
        <ul className="mt-2 space-y-1 text-sm text-gray-600">
          {tags.length === 0 && <li>아직 정보가 모이지 않았어요.</li>}
          {tags.map((t) => {
            const ratio = t.total === 0 ? 0 : Math.round((t.yes / t.total) * 100);
            return (
              <li key={t.code}>
                {t.label} — {ratio}% 동의 ({t.yes}/{t.total})
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-700">최근 리뷰</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {reviews.length === 0 && (
            <li className="text-gray-500">아직 데이터가 없어요.</li>
          )}
          {reviews.map((r) => (
            <li key={r.id} className="border-l-2 border-gray-200 pl-3">
              <div className="text-gray-800">
                {SIGNAL_DOT[r.signal]} {METHOD_LABEL[r.method]}
                {r.duration_min ? ` · ${Math.round(r.duration_min / 6) / 10}h` : ''}
              </div>
              {r.text_review && (
                <div className="text-xs text-gray-600">{r.text_review}</div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <Link
        href={`/check-in/${place.id}`}
        className="fixed bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black px-6 py-3 text-sm text-white shadow-lg"
      >
        ✍️ 리뷰 작성하기
      </Link>
    </main>
  );
}
