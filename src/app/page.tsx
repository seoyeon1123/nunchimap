import KakaoMap from '@/components/KakaoMap';
import SearchBar from '@/components/SearchBar';
import FilterChips from '@/components/FilterChips';
import HeaderUser from '@/components/HeaderUser';
import PlaceBottomSheet from '@/components/PlaceBottomSheet';
import LocateButton from '@/components/LocateButton';

export default function Home() {
  return (
    <main className="relative h-screen w-screen overflow-hidden isolate">
      <div className="absolute inset-0 z-0">
        <KakaoMap />
      </div>
      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col">
        <div className="pointer-events-auto flex items-start gap-2 p-3">
          <div className="flex-1">
            <SearchBar />
          </div>
          <HeaderUser />
        </div>
        <div className="flex-1" />
        <div className="pointer-events-auto flex items-end justify-between gap-2 p-3">
          <FilterChips />
          <LocateButton />
        </div>
      </div>
      <PlaceBottomSheet />
    </main>
  );
}
