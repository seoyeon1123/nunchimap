import Link from 'next/link';
import { redirect } from 'next/navigation';
import { readSession } from '@/lib/auth';
import { getServiceClient } from '@/lib/db';
import { expireStaleCheckIns } from '@/lib/checkins';

interface MyCheckIn {
  id: number;
  place_id: number;
  method: 'gps' | 'ocr' | 'manual';
  signal: 'green' | 'yellow' | 'red';
  duration_min: number | null;
  created_at: string;
  places?: { name: string } | null;
}

const SIGNAL_DOT = { green: '🟢', yellow: '🟡', red: '🔴' } as const;
const METHOD_LABEL = { gps: 'GPS', ocr: '영수증', manual: '직접입력' } as const;

export default async function MyPage() {
  const session = await readSession();
  if (!session) {
    redirect('/api/auth/kakao');
  }

  const supabase = getServiceClient();
  // 12h+ 미완료 체크인 자동 정리 — /me 진입할 때마다 청소
  await expireStaleCheckIns(supabase, session.uid);
  const { data: checkIns } = await supabase
    .from('check_ins')
    .select('id,place_id,method,signal,duration_min,created_at,places(name)')
    .eq('user_id', session.uid)
    .order('created_at', { ascending: false })
    .limit(50);

  const list = (checkIns ?? []) as unknown as MyCheckIn[];

  return (
    <main className="mx-auto max-w-xl p-4">
      <Link href="/" className="text-sm text-gray-500">
        ← 지도로
      </Link>

      <header className="mt-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{session.nickname}</h1>
          <p className="text-xs text-gray-500">
            체크인 {list.length}건
          </p>
        </div>
        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            className="rounded-full border px-3 py-1.5 text-xs"
          >
            로그아웃
          </button>
        </form>
      </header>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">내 체크인</h2>
        {list.length === 0 ? (
          <p className="text-sm text-gray-500">
            아직 작성한 리뷰가 없어요.
          </p>
        ) : (
          <ul className="divide-y rounded-2xl border bg-white">
            {list.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/places/${c.place_id}`}
                  className="block px-4 py-3 hover:bg-gray-50"
                >
                  <div className="flex items-center justify-between text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">
                        {c.places?.name ?? `카페 #${c.place_id}`}
                      </div>
                      <div className="text-xs text-gray-500">
                        {SIGNAL_DOT[c.signal]} {METHOD_LABEL[c.method]}
                        {c.duration_min
                          ? ` · ${(c.duration_min / 60).toFixed(1)}h`
                          : ''}
                      </div>
                    </div>
                    <div className="text-xs text-gray-400">
                      {new Date(c.created_at).toLocaleDateString('ko-KR')}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
