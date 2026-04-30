import Link from 'next/link';
import SearchBar from '@/components/SearchBar';
import SignalBadge from '@/components/SignalBadge';
import { getServiceClient } from '@/lib/db';

interface SearchResult {
  id: number;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  cached_signal: 'green' | 'yellow' | 'red' | 'gray' | null;
  cached_median_duration: number | null;
  cached_checkin_count: number | null;
}

async function searchPlaces(q: string): Promise<SearchResult[]> {
  if (!q) return [];
  const supabase = getServiceClient();
  // 파라미터 바인딩 RPC — q 에 ,()% 같은 문자 들어와도 안전.
  const { data, error } = await supabase.rpc('search_places', {
    q,
    max_results: 50,
  });
  if (error) {
    console.error('[search] search_places RPC failed:', error);
    return [];
  }
  return (data as SearchResult[]) ?? [];
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const q = searchParams.q?.trim() ?? '';
  const results = await searchPlaces(q);

  return (
    <main className="mx-auto max-w-xl p-4">
      <div className="mb-4">
        <Link href="/" className="text-sm text-gray-500">
          ← 지도로
        </Link>
      </div>

      <SearchBar initial={q} />

      <div className="mt-4">
        {q === '' && (
          <p className="text-sm text-gray-500">검색어를 입력해주세요.</p>
        )}
        {q !== '' && results.length === 0 && (
          <p className="text-sm text-gray-500">
            &quot;{q}&quot; 검색 결과가 없어요.
          </p>
        )}
        {results.length > 0 && (
          <ul className="divide-y rounded-2xl border bg-white">
            {results.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/places/${p.id}`}
                  className="block px-4 py-3 hover:bg-gray-50"
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{p.name}</div>
                      <div className="truncate text-xs text-gray-500">
                        {p.address ?? '주소 없음'}
                      </div>
                    </div>
                    <SignalBadge signal={p.cached_signal} size="sm" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
