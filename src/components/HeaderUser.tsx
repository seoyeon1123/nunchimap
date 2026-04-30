'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

interface MeResponse {
  user: { id: number; nickname: string } | null;
}

export default function HeaderUser() {
  const { data, isLoading } = useQuery<MeResponse>({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await fetch('/api/me');
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return <div className="h-9 w-9 rounded-full bg-gray-100" />;
  }

  if (!data?.user) {
    return (
      <Link
        href="/api/auth/kakao"
        className="rounded-full bg-yellow-300 px-3 py-1.5 text-xs font-medium text-yellow-900 shadow-sm"
      >
        카카오 로그인
      </Link>
    );
  }

  return (
    <Link
      href="/me"
      className="flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs shadow-sm"
    >
      <span aria-hidden>👤</span>
      <span className="max-w-[80px] truncate">{data.user.nickname}</span>
    </Link>
  );
}
