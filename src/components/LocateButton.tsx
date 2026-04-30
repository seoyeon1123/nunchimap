'use client';

import { useState } from 'react';
import { useUiStore } from '@/lib/store';

export default function LocateButton() {
  const setMapTarget = useUiStore((s) => s.setMapTarget);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function locate() {
    if (!navigator.geolocation) {
      setError('이 브라우저는 위치 정보를 지원하지 않아요.');
      return;
    }
    setBusy(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        setMapTarget({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          level: 4,
        });
      },
      (err) => {
        setBusy(false);
        setError(err.code === err.PERMISSION_DENIED ? '위치 권한이 거부됨' : '위치 못 찾음');
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={locate}
        disabled={busy}
        aria-label="현재 위치로 이동"
        title="현재 위치로 이동"
        className="grid h-11 w-11 place-items-center rounded-full bg-white shadow-md ring-1 ring-gray-200 hover:bg-gray-50 disabled:opacity-60"
      >
        {busy ? (
          <span className="block h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-black" />
        ) : (
          <span aria-hidden className="text-lg">📍</span>
        )}
      </button>
      {error && (
        <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] text-red-700 shadow">
          {error}
        </span>
      )}
    </div>
  );
}
