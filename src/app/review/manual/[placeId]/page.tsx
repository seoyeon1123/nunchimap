'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import SignalPicker from '@/components/SignalPicker';
import TagPicker from '@/components/TagPicker';
import LoginRequired from '@/components/LoginRequired';

const DURATIONS = [
  { value: 30, label: '30분 이하' },
  { value: 60, label: '1시간' },
  { value: 120, label: '2시간' },
  { value: 180, label: '3시간 이상' },
];

export default function ManualReviewPage() {
  const params = useParams<{ placeId: string }>();
  const router = useRouter();
  const placeId = Number(params.placeId);

  const [duration, setDuration] = useState<number>(120);
  const [signal, setSignal] = useState<'green' | 'yellow' | 'red' | null>(null);
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function submit() {
    if (!signal) {
      setErrorMsg('신호등을 선택해주세요.');
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/check-ins/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          place_id: placeId,
          duration_min: duration,
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
      router.push(`/places/${placeId}`);
      router.refresh();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '오류');
      setSubmitting(false);
    }
  }

  return (
    <LoginRequired>
    <main className="mx-auto max-w-md p-4 pb-32">
      <Link href={`/check-in/${placeId}`} className="text-sm text-gray-500">
        ← 뒤로
      </Link>

      <h1 className="mt-3 text-xl font-bold">직접 입력 리뷰</h1>
      <p className="text-xs text-gray-500">
        ⓘ GPS 체크인보다 신뢰도가 낮게 반영돼요.
      </p>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">얼마나 있었어요?</h2>
        <div className="grid grid-cols-2 gap-2">
          {DURATIONS.map((d) => (
            <button
              key={d.value}
              onClick={() => setDuration(d.value)}
              className={`rounded-2xl border p-3 text-sm transition ${
                duration === d.value
                  ? 'border-black bg-black text-white'
                  : 'bg-white hover:bg-gray-50'
              }`}
            >
              {d.label}
            </button>
          ))}
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
        {submitting ? '제출 중...' : '등록'}
      </button>
    </main>
    </LoginRequired>
  );
}
