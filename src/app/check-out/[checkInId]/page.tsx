'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import SignalPicker from '@/components/SignalPicker';
import TagPicker from '@/components/TagPicker';

export default function CheckOutPage() {
  const params = useParams<{ checkInId: string }>();
  const router = useRouter();
  const checkInId = params.checkInId;

  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [now, setNow] = useState<Date>(new Date());
  const [signal, setSignal] = useState<'green' | 'yellow' | 'red' | null>(null);
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    // 시작 시각 fetch (서버에 있음. 간단히 client에서 받아오기 위해 별도 endpoint 없이
    // localStorage 또는 단순 추정으로 처리. 여기선 단순화: 진입 시점 = 현재로 두고
    // 실제 duration은 서버가 started_at 기준으로 계산)
    setStartedAt(new Date());
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const elapsedMin = startedAt
    ? Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 60_000))
    : 0;

  async function submit() {
    if (!signal) {
      setErrorMsg('신호등을 선택해주세요.');
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/check-ins/${checkInId}/finish`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signal,
          tags: Array.from(tags),
          text: text.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error ?? '제출 실패');
        setSubmitting(false);
        return;
      }
      router.push(`/places/${json.place_id}`);
      router.refresh();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '오류');
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-md p-4 pb-32">
      <h1 className="text-xl font-bold">체크아웃</h1>
      <p className="text-sm text-gray-500">이번 방문 어땠어요?</p>

      <section className="mt-4 rounded-2xl border bg-white p-4">
        <div className="text-2xl font-bold">
          {Math.floor(elapsedMin / 60)}시간 {elapsedMin % 60}분
        </div>
        <div className="text-xs text-gray-500">
          ※ 정확한 체류시간은 서버가 도착 체크인 기록 기준으로 계산합니다.
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">신호등 *</h2>
        <SignalPicker value={signal} onChange={setSignal} />
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">태그 (선택)</h2>
        <TagPicker value={tags} onChange={setTags} />
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">한 줄 (선택)</h2>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={140}
          rows={3}
          placeholder="예: 콘센트 많고 자리 넉넉했어요"
          className="w-full resize-none rounded-2xl border p-3 text-sm"
        />
        <div className="text-right text-xs text-gray-400">{text.length}/140</div>
      </section>

      {errorMsg && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      <button
        onClick={submit}
        disabled={submitting || !signal}
        className="fixed bottom-4 left-1/2 z-10 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-full bg-black py-3 text-white disabled:bg-gray-300"
      >
        {submitting ? '제출 중...' : '체크아웃 · 등록'}
      </button>
    </main>
  );
}
