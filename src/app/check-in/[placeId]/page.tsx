'use client';

import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import LoginRequired from '@/components/LoginRequired';

type Phase = 'choosing' | 'gps_locating' | 'gps_ready' | 'starting' | 'done' | 'error';

export default function CheckInPage() {
  const router = useRouter();
  const params = useParams<{ placeId: string }>();
  const placeId = Number(params.placeId);

  const [phase, setPhase] = useState<Phase>('choosing');
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(
    null,
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (phase !== 'gps_locating') return;
    if (!navigator.geolocation) {
      setPhase('error');
      setErrorMsg('이 브라우저는 위치 정보를 지원하지 않아요.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setPhase('gps_ready');
      },
      (err) => {
        setPhase('error');
        setErrorMsg(`위치 권한이 필요해요. (${err.message})`);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }, [phase]);

  async function startCheckIn() {
    if (!coords) return;
    setPhase('starting');
    try {
      const res = await fetch('/api/check-ins/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          place_id: placeId,
          gps_lat: coords.lat,
          gps_lng: coords.lng,
          accuracy_m: coords.accuracy,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setPhase('error');
        setErrorMsg(json.error ?? '체크인 실패');
        return;
      }
      // 체크아웃 페이지로
      router.push(`/check-out/${json.check_in_id}`);
    } catch (e) {
      setPhase('error');
      setErrorMsg(e instanceof Error ? e.message : '오류');
    }
  }

  return (
    <LoginRequired>
    <main className="mx-auto max-w-md p-4">
      <Link href={`/places/${placeId}`} className="text-sm text-gray-500">
        ← 카페로
      </Link>

      <h1 className="mt-3 text-xl font-bold">리뷰 작성</h1>
      <p className="text-sm text-gray-500">
        가장 정확한 데이터를 만들 수 있는 GPS 체크인을 추천해요.
      </p>

      {phase === 'choosing' && (
        <div className="mt-6 space-y-3">
          <button
            onClick={() => setPhase('gps_locating')}
            className="w-full rounded-2xl bg-black p-4 text-left text-white"
          >
            <div className="font-semibold">📍 도착했어요 (GPS 체크인)</div>
            <div className="text-xs text-gray-300">
              가장 정확. 카페 100m 안에서 가능.
            </div>
          </button>

          <Link
            href={`/review/manual/${placeId}`}
            className="block w-full rounded-2xl border bg-white p-4 text-left"
          >
            <div className="font-semibold">✍️ 이미 다녀왔어요</div>
            <div className="text-xs text-gray-500">
              30초 직접 입력. 신뢰도는 낮음.
            </div>
          </Link>

          <Link
            href={`/review/ocr/${placeId}`}
            className="block w-full rounded-2xl border bg-white p-4 text-left"
          >
            <div className="font-semibold">🧾 영수증 인증 (준비 중)</div>
            <div className="text-xs text-gray-500">
              곧 추가됩니다.
            </div>
          </Link>
        </div>
      )}

      {phase === 'gps_locating' && (
        <div className="mt-6 rounded-2xl border bg-white p-6 text-center">
          <div className="animate-pulse text-sm text-gray-600">📍 위치 확인 중...</div>
        </div>
      )}

      {phase === 'gps_ready' && coords && (
        <div className="mt-6 space-y-3">
          <div className="rounded-2xl border bg-white p-4 text-sm">
            ✅ 위치 확인됨 (정확도 ±{Math.round(coords.accuracy)}m)
          </div>
          <button
            onClick={startCheckIn}
            className="w-full rounded-full bg-black py-3 text-white"
          >
            도착 체크인
          </button>
        </div>
      )}

      {phase === 'starting' && (
        <div className="mt-6 text-center text-sm text-gray-600">체크인 중...</div>
      )}

      {phase === 'error' && (
        <div className="mt-6 space-y-3">
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {errorMsg}
          </div>
          <button
            onClick={() => {
              setErrorMsg(null);
              setPhase('choosing');
            }}
            className="w-full rounded-full border py-3"
          >
            다시 시도
          </button>
        </div>
      )}
    </main>
    </LoginRequired>
  );
}
