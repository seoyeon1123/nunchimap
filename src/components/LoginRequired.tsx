'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';

interface MeResponse {
  user: { id: number; nickname: string } | null;
}

export default function LoginRequired({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { data, isLoading } = useQuery<MeResponse>({
    queryKey: ['me'],
    queryFn: async () => (await fetch('/api/me')).json(),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="mx-auto mt-12 max-w-md p-6 text-center text-sm text-gray-500">
        로딩 중…
      </div>
    );
  }

  if (!data?.user) {
    return (
      <div className="mx-auto mt-12 max-w-md rounded-2xl border bg-white p-6 text-center shadow-sm">
        <h2 className="text-lg font-semibold">로그인이 필요해요</h2>
        <p className="mt-2 text-sm text-gray-600">
          리뷰 등록은 카카오 로그인 후 가능해요.
        </p>
        <Link
          href={`/api/auth/kakao?next=${encodeURIComponent(pathname)}`}
          className="mt-4 inline-block rounded-full bg-yellow-300 px-5 py-2 text-sm font-medium text-yellow-900 shadow-sm hover:bg-yellow-400"
        >
          카카오로 로그인
        </Link>
        <div className="mt-3">
          <Link href="/" className="text-xs text-gray-400 hover:text-gray-600">
            ← 지도로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
