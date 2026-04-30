'use client';

import { useEffect, useRef, useState } from 'react';
import { useFilterStore, useUiStore, Signal } from '@/lib/store';

// ── Kakao SDK 최소 타입 (any 회피용) ─────────────────────────────
type KakaoLatLng = { __brand: 'LatLng' };
type KakaoBounds = {
  getSouthWest: () => { getLat: () => number; getLng: () => number };
  getNorthEast: () => { getLat: () => number; getLng: () => number };
};
type KakaoMapInstance = {
  setCenter: (latlng: KakaoLatLng) => void;
  setLevel: (level: number) => void;
  getBounds: () => KakaoBounds;
  getLevel: () => number;
  getCenter: () => { getLat: () => number; getLng: () => number };
};
type KakaoCustomOverlay = {
  setMap: (map: KakaoMapInstance | null) => void;
};
type KakaoSize = { __brand: 'Size' };
type KakaoPoint = { __brand: 'Point' };
type KakaoMarkerImage = { __brand: 'MarkerImage' };
type KakaoMarker = {
  setMap: (m: KakaoMapInstance | null) => void;
};
type KakaoMarkerClusterer = {
  addMarkers: (ms: KakaoMarker[]) => void;
  removeMarkers: (ms: KakaoMarker[]) => void;
  clear: () => void;
  setMap: (m: KakaoMapInstance | null) => void;
};
type KakaoMapsNS = {
  load: (cb: () => void) => void;
  Map: new (
    container: HTMLElement,
    options: { center: KakaoLatLng; level: number },
  ) => KakaoMapInstance;
  LatLng: new (lat: number, lng: number) => KakaoLatLng;
  Size: new (w: number, h: number) => KakaoSize;
  Point: new (x: number, y: number) => KakaoPoint;
  MarkerImage: new (
    src: string,
    size: KakaoSize,
    opts?: { offset?: KakaoPoint },
  ) => KakaoMarkerImage;
  Marker: new (opts: {
    position: KakaoLatLng;
    image?: KakaoMarkerImage;
    map?: KakaoMapInstance;
    clickable?: boolean;
    title?: string;
  }) => KakaoMarker;
  MarkerClusterer: new (opts: {
    map?: KakaoMapInstance;
    averageCenter?: boolean;
    minLevel?: number;
    gridSize?: number;
    disableClickZoom?: boolean;
  }) => KakaoMarkerClusterer;
  CustomOverlay: new (options: {
    map?: KakaoMapInstance;
    position: KakaoLatLng;
    content: HTMLElement | string;
    yAnchor?: number;
    xAnchor?: number;
    clickable?: boolean;
  }) => KakaoCustomOverlay;
  event: {
    addListener: (
      target: KakaoMapInstance | KakaoMarker,
      type: string,
      handler: () => void,
    ) => void;
  };
};
type KakaoGlobal = { maps: KakaoMapsNS };
declare global {
  interface Window {
    kakao?: KakaoGlobal;
  }
}

// ── Constants ─────────────────────────────────────────────────────
const KAKAO_SDK_BASE = 'https://dapi.kakao.com/v2/maps/sdk.js';
const DEFAULT_CENTER = { lat: 37.4979, lng: 127.0276 }; // 강남역
const DEFAULT_LEVEL = 4;
const FETCH_DEBOUNCE_MS = 350;
const MAX_LEVEL_FOR_MARKERS = 8; // 너무 줌아웃되면 마커 X
const CLUSTER_MIN_LEVEL = 6; // 이 레벨부터만 클러스터링 동작

interface PlaceMarker {
  id: number;
  name: string;
  lat: number;
  lng: number;
  cached_signal: Signal | null;
  cached_median_duration: number | null;
  cached_checkin_count: number | null;
}

// ── SDK Loader ────────────────────────────────────────────────────
function loadKakaoSdk(appkey: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.kakao?.maps) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const onReady = () => {
      if (!window.kakao) {
        reject(new Error('Kakao SDK loaded but window.kakao missing'));
        return;
      }
      window.kakao.maps.load(() => resolve());
    };

    const existing = document.getElementById('kakao-sdk') as HTMLScriptElement | null;
    if (existing) {
      if (window.kakao?.maps) {
        onReady();
        return;
      }
      existing.remove();
    }

    const script = document.createElement('script');
    script.id = 'kakao-sdk';
    script.async = true;
    script.src = `${KAKAO_SDK_BASE}?appkey=${appkey}&autoload=false&libraries=services,clusterer`;
    script.onload = onReady;
    script.onerror = () =>
      reject(
        new Error(
          'Kakao SDK 로드 실패. 카카오 디벨로퍼스 → 앱 설정 → 플랫폼 → Web에 ' +
            'http://localhost:3000 이 등록돼있는지, JavaScript 키가 맞는지 확인하세요.',
        ),
      );
    document.head.appendChild(script);
  });
}

// ── 마커 아이콘 (SVG data URL) ────────────────────────────────────
const SIGNAL_HEX: Record<Signal, { fill: string; stroke: string }> = {
  green: { fill: '#22c55e', stroke: '#ffffff' },
  yellow: { fill: '#facc15', stroke: '#ffffff' },
  red: { fill: '#ef4444', stroke: '#ffffff' },
  gray: { fill: '#ffffff', stroke: '#9ca3af' },
};

function dotSvgUrl(signal: Signal): string {
  const { fill, stroke } = SIGNAL_HEX[signal];
  // 18x18 SVG, drop shadow 흉내내려고 살짝 두꺼운 stroke
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 18 18'>` +
    `<circle cx='9' cy='9' r='6.5' fill='${fill}' stroke='${stroke}' stroke-width='2'/>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// 이미지 캐시 — 같은 색은 한 번만 만들어 재사용
let markerImageCache: Partial<Record<Signal, KakaoMarkerImage>> | null = null;
function getMarkerImage(signal: Signal): KakaoMarkerImage {
  if (!window.kakao) throw new Error('kakao not loaded');
  if (!markerImageCache) markerImageCache = {};
  const cached = markerImageCache[signal];
  if (cached) return cached;
  const { Size, Point, MarkerImage } = window.kakao.maps;
  const img = new MarkerImage(dotSvgUrl(signal), new Size(18, 18), {
    offset: new Point(9, 9),
  });
  markerImageCache[signal] = img;
  return img;
}

// ── 선택 강조 오버레이 (라벨 + 펄스 ring) ───────────────────────
function createSelectedOverlayEl(p: PlaceMarker): HTMLElement {
  const colorMap: Record<Signal, string> = {
    green: 'bg-green-500 border-white',
    yellow: 'bg-amber-400 border-white',
    red: 'bg-red-500 border-white',
    gray: 'bg-white border-gray-400',
  };
  const sig: Signal = p.cached_signal ?? 'gray';

  const wrap = document.createElement('div');
  wrap.className = 'relative flex flex-col items-center';
  wrap.style.zIndex = '50';

  const label = document.createElement('div');
  label.textContent = p.name;
  label.className =
    'mb-1 max-w-[180px] truncate rounded-full bg-black px-2 py-0.5 text-[11px] font-medium text-white shadow-lg';
  wrap.appendChild(label);

  const dot = document.createElement('div');
  dot.setAttribute('aria-label', `${p.name} (선택됨, ${sig})`);
  dot.className =
    'block h-7 w-7 rounded-full border-[3px] shadow-xl ring-4 ring-black/30 animate-[pulse_1.6s_ease-in-out_infinite]';
  dot.classList.add(...colorMap[sig].split(' '));
  wrap.appendChild(dot);
  return wrap;
}

// ── Component ─────────────────────────────────────────────────────
export default function KakaoMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<KakaoMapInstance | null>(null);
  const markersRef = useRef<KakaoMarker[]>([]);
  const clustererRef = useRef<KakaoMarkerClusterer | null>(null);
  const selectedOverlayRef = useRef<KakaoCustomOverlay | null>(null);
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleSignals = useFilterStore((s) => s.visibleSignals);
  const requiredTags = useFilterStore((s) => s.requiredTags);
  const setSelectedPlaceId = useUiStore((s) => s.setSelectedPlaceId);
  const selectedPlaceId = useUiStore((s) => s.selectedPlaceId);
  const mapTarget = useUiStore((s) => s.mapTarget);
  const setLastView = useUiStore((s) => s.setLastView);
  const setMapTarget = useUiStore((s) => s.setMapTarget);
  const initialViewRef = useRef(useUiStore.getState().lastView);
  const lastPlacesRef = useRef<PlaceMarker[]>([]);
  const selectedPlaceIdRef = useRef<number | null>(null);
  selectedPlaceIdRef.current = selectedPlaceId;
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState<number>(0);

  // 선택된 카페만 별도 CustomOverlay 로 라벨·펄스 표시
  function renderSelectedOverlay(places: PlaceMarker[]) {
    if (!window.kakao || !mapRef.current) return;
    selectedOverlayRef.current?.setMap(null);
    selectedOverlayRef.current = null;
    const selId = selectedPlaceIdRef.current;
    if (selId == null) return;
    const place = places.find((p) => p.id === selId);
    if (!place) return;
    const { LatLng, CustomOverlay } = window.kakao.maps;
    selectedOverlayRef.current = new CustomOverlay({
      map: mapRef.current,
      position: new LatLng(place.lat, place.lng),
      content: createSelectedOverlayEl(place),
      yAnchor: 1,
      xAnchor: 0.5,
      clickable: false,
    });
  }

  // bbox 결과를 마커 + 클러스터러로 렌더
  function renderMarkers(places: PlaceMarker[]) {
    if (!window.kakao || !mapRef.current || !clustererRef.current) return;
    const { LatLng, Marker, event } = window.kakao.maps;

    lastPlacesRef.current = places;

    // 기존 마커 제거
    if (markersRef.current.length > 0) {
      clustererRef.current.removeMarkers(markersRef.current);
      for (const m of markersRef.current) m.setMap(null);
      markersRef.current = [];
    }

    const newMarkers: KakaoMarker[] = [];
    for (const p of places) {
      const sig: Signal = p.cached_signal ?? 'gray';
      const marker = new Marker({
        position: new LatLng(p.lat, p.lng),
        image: getMarkerImage(sig),
        title: p.name,
        clickable: true,
      });
      event.addListener(marker, 'click', () => setSelectedPlaceId(p.id));
      newMarkers.push(marker);
    }
    clustererRef.current.addMarkers(newMarkers);
    markersRef.current = newMarkers;

    renderSelectedOverlay(places);
    setCount(places.length);
  }

  async function refetchBbox() {
    if (!mapRef.current) return;
    const level = mapRef.current.getLevel();
    if (level > MAX_LEVEL_FOR_MARKERS) {
      // 너무 줌아웃 — 마커 비우기
      if (clustererRef.current) clustererRef.current.clear();
      for (const m of markersRef.current) m.setMap(null);
      markersRef.current = [];
      selectedOverlayRef.current?.setMap(null);
      selectedOverlayRef.current = null;
      setCount(0);
      return;
    }

    const bounds = mapRef.current.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const bbox = `${sw.getLng()},${sw.getLat()},${ne.getLng()},${ne.getLat()}`;
    const signals = Array.from(visibleSignals).join(',');
    const tags = Array.from(requiredTags).join(',');

    try {
      const params = new URLSearchParams({ bbox, signal: signals });
      if (tags) params.set('tags', tags);
      const res = await fetch(`/api/places?${params.toString()}`);
      if (!res.ok) return;
      const json = (await res.json()) as { places: PlaceMarker[] };
      renderMarkers(json.places ?? []);
    } catch (e) {
      console.error('places fetch failed', e);
    }
  }

  function scheduleRefetch() {
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
    fetchTimerRef.current = setTimeout(refetchBbox, FETCH_DEBOUNCE_MS);
  }

  // 초기 SDK 로드 + 지도 생성
  useEffect(() => {
    const appkey = process.env.NEXT_PUBLIC_KAKAO_MAP_JS_KEY;
    if (!appkey) {
      setError('NEXT_PUBLIC_KAKAO_MAP_JS_KEY 가 설정되지 않았습니다.');
      return;
    }

    let cancelled = false;

    loadKakaoSdk(appkey)
      .then(() => {
        if (cancelled || !containerRef.current || !window.kakao) return;
        const { Map, LatLng, MarkerClusterer, event } = window.kakao.maps;
        const initialView = initialViewRef.current;
        const center = initialView
          ? new LatLng(initialView.lat, initialView.lng)
          : new LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng);
        const level = initialView?.level ?? DEFAULT_LEVEL;
        const map = new Map(containerRef.current, { center, level });
        mapRef.current = map;

        clustererRef.current = new MarkerClusterer({
          map,
          averageCenter: true,
          minLevel: CLUSTER_MIN_LEVEL,
          gridSize: 60,
          disableClickZoom: false,
        });

        event.addListener(map, 'idle', () => {
          const c = map.getCenter();
          setLastView({ lat: c.getLat(), lng: c.getLng(), level: map.getLevel() });
          scheduleRefetch();
        });

        // GPS 가 SDK 로딩보다 먼저 해결돼서 mapTarget 이 이미 들어와있을 수 있음 — 즉시 반영.
        const pending = useUiStore.getState().mapTarget;
        if (pending) {
          map.setCenter(new LatLng(pending.lat, pending.lng));
          if (pending.level != null) map.setLevel(pending.level);
        }

        scheduleRefetch();
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      });

    return () => {
      cancelled = true;
      if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
      clustererRef.current?.clear();
      clustererRef.current = null;
      for (const m of markersRef.current) m.setMap(null);
      markersRef.current = [];
      selectedOverlayRef.current?.setMap(null);
      selectedOverlayRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 필터(신호등·태그) 변경 시 즉시 다시 fetch
  useEffect(() => {
    if (mapRef.current) scheduleRefetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleSignals, requiredTags]);

  // 처음 진입(저장된 lastView 없음)이고 GPS 가 가능하면 자동으로 현재 위치로 이동.
  // setMapTarget 경유 — LocateButton 과 같은 경로라 SDK 로딩/Strict 더블마운트 영향을 안 받음.
  useEffect(() => {
    if (initialViewRef.current) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        setMapTarget({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          level: 4,
        });
      },
      () => {
        /* 거부/타임아웃 시 강남 유지 */
      },
      { timeout: 8000, enableHighAccuracy: true },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 검색 결과 클릭 등으로 mapTarget 이 바뀌면 지도 이동
  useEffect(() => {
    if (!mapTarget || !mapRef.current || !window.kakao) return;
    const { LatLng } = window.kakao.maps;
    mapRef.current.setCenter(new LatLng(mapTarget.lat, mapTarget.lng));
    if (mapTarget.level != null) mapRef.current.setLevel(mapTarget.level);
  }, [mapTarget]);

  // 선택된 카페가 바뀌면 강조 오버레이만 갱신 (마커는 그대로)
  useEffect(() => {
    if (!mapRef.current) return;
    if (lastPlacesRef.current.length > 0) {
      renderSelectedOverlay(lastPlacesRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlaceId]);

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gray-100 p-6 text-center">
        <div>
          <h2 className="mb-2 text-lg font-bold text-red-600">지도 로드 실패</h2>
          <p className="text-sm text-gray-700 whitespace-pre-line">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-white/90 px-3 py-1 text-xs text-gray-600 shadow">
        {count}곳 표시
      </div>
    </>
  );
}
