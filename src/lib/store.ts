import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type Signal = 'green' | 'yellow' | 'red' | 'gray';

interface FilterState {
  // 보이는 신호등 — 기본은 4색 전부 (데이터 없는 회색 카페도 위치는 보이게)
  visibleSignals: Set<Signal>;
  // 추후 사용할 태그 필터
  requiredTags: Set<string>;
  toggleSignal: (s: Signal) => void;
  toggleTag: (code: string) => void;
}

export const useFilterStore = create<FilterState>((set) => ({
  visibleSignals: new Set<Signal>(['green', 'yellow', 'red', 'gray']),
  requiredTags: new Set<string>(),
  toggleSignal: (s) =>
    set((state) => {
      const next = new Set(state.visibleSignals);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return { visibleSignals: next };
    }),
  toggleTag: (code) =>
    set((state) => {
      const next = new Set(state.requiredTags);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return { requiredTags: next };
    }),
}));

// ── UI 상태 ────────────────────────────────────────────────────
// 검색 결과 클릭/마커 클릭 시 지도 이동·바텀시트 표시를 다루기 위한 store.
interface MapTarget {
  lat: number;
  lng: number;
  level?: number;
  // 같은 좌표를 다시 선택해도 effect가 재실행되도록 timestamp 부여
  ts: number;
}

// 카페 상세 다녀와도 지도 위치/줌 유지하기 위한 마지막 뷰 상태
interface MapView {
  lat: number;
  lng: number;
  level: number;
}

interface UiState {
  mapTarget: MapTarget | null;
  selectedPlaceId: number | null;
  lastView: MapView | null;
  setMapTarget: (t: Omit<MapTarget, 'ts'> | null) => void;
  setSelectedPlaceId: (id: number | null) => void;
  setLastView: (v: MapView) => void;
}

// lastView 만 sessionStorage 에 영속화 — 새로고침해도 보던 지점 유지.
// mapTarget·selectedPlaceId 는 일회성이라 영속화 불필요.
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      mapTarget: null,
      selectedPlaceId: null,
      lastView: null,
      setMapTarget: (t) =>
        set({ mapTarget: t ? { ...t, ts: Date.now() } : null }),
      setSelectedPlaceId: (selectedPlaceId) => set({ selectedPlaceId }),
      setLastView: (lastView) => set({ lastView }),
    }),
    {
      name: 'nm-ui',
      storage: createJSONStorage(() => {
        // SSR 동안엔 영속화 스킵 — 클라이언트 마운트 시 자동 hydrate.
        if (typeof window === 'undefined') {
          return {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          };
        }
        return sessionStorage;
      }),
      partialize: (state) => ({ lastView: state.lastView }),
    },
  ),
);
