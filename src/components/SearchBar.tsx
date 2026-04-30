'use client';

import { useEffect, useRef, useState } from 'react';
import SignalBadge from './SignalBadge';
import { useUiStore, type Signal } from '@/lib/store';

interface SearchResult {
  id: number;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  cached_signal: Signal | null;
  cached_median_duration: number | null;
  cached_checkin_count: number | null;
}

const DEBOUNCE_MS = 250;

export default function SearchBar({ initial }: { initial?: string }) {
  const [q, setQ] = useState(initial ?? '');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const setMapTarget = useUiStore((s) => s.setMapTarget);
  const setSelectedPlaceId = useUiStore((s) => s.setSelectedPlaceId);

  // 디바운스 검색. lastView 는 store 에서 즉석 read — 지도 panning 마다
  // 검색을 재실행하고 싶지는 않으므로 effect deps 에는 안 넣는다.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = q.trim();
    if (!trimmed) {
      setResults([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: trimmed, limit: '20' });
        const lv = useUiStore.getState().lastView;
        if (lv) params.set('near', `${lv.lat},${lv.lng}`);
        const res = await fetch(`/api/places/search?${params.toString()}`);
        if (res.ok) {
          const json = (await res.json()) as { places: SearchResult[] };
          setResults(json.places ?? []);
          setOpen(true);
        }
      } catch {
        // 네트워크 오류는 조용히 무시
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q]);

  // 바깥 클릭 시 드롭다운 닫기
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function selectResult(p: SearchResult) {
    setMapTarget({ lat: p.lat, lng: p.lng, level: 3 });
    setSelectedPlaceId(p.id);
    setQ(p.name);
    setOpen(false);
  }

  function clear() {
    setQ('');
    setResults([]);
    setOpen(false);
  }

  return (
    <div ref={wrapRef} className="relative mx-auto w-full max-w-xl">
      <div className="flex items-center gap-2 rounded-full bg-white px-4 py-2 shadow-md">
        <span aria-hidden>🔍</span>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="카페·동네 검색"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400"
        />
        {loading && <span className="text-xs text-gray-400">…</span>}
        {q && (
          <button
            type="button"
            onClick={clear}
            aria-label="지우기"
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        )}
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-2 max-h-[60vh] overflow-y-auto rounded-2xl border bg-white shadow-lg">
          {results.length === 0 && !loading && (
            <div className="px-4 py-3 text-sm text-gray-500">
              결과가 없어요.
            </div>
          )}
          {results.length > 0 && (
            <ul className="divide-y">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => selectResult(p)}
                    className="block w-full px-4 py-3 text-left hover:bg-gray-50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{p.name}</div>
                        <div className="truncate text-xs text-gray-500">
                          {p.address ?? '주소 없음'}
                        </div>
                      </div>
                      <SignalBadge signal={p.cached_signal} size="sm" />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
