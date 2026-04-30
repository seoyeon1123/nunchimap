'use client';

import { useFilterStore, Signal } from '@/lib/store';

const SIGNAL_CHIPS: Array<{ signal: Signal; label: string }> = [
  { signal: 'green', label: '🟢 카공 OK' },
  { signal: 'yellow', label: '🟡 애매' },
  { signal: 'red', label: '🔴 비추' },
  { signal: 'gray', label: '⚪ 데이터 없음' },
];

const TAG_CHIPS = [
  { code: 'outlet', label: '🔌 콘센트' },
  { code: 'quiet', label: '🔇 조용' },
  { code: 'long_stay', label: '⏱ 2시간+' },
  { code: 'spacious', label: '💺 자리 넉넉' },
];

export default function FilterChips() {
  const visibleSignals = useFilterStore((s) => s.visibleSignals);
  const requiredTags = useFilterStore((s) => s.requiredTags);
  const toggleSignal = useFilterStore((s) => s.toggleSignal);
  const toggleTag = useFilterStore((s) => s.toggleTag);

  return (
    <div className="mx-auto flex w-full max-w-xl gap-2 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden">
      {SIGNAL_CHIPS.map((c) => {
        const on = visibleSignals.has(c.signal);
        return (
          <button
            key={c.signal}
            onClick={() => toggleSignal(c.signal)}
            className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs shadow-sm transition ${
              on
                ? 'border-black bg-black text-white'
                : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            {c.label}
          </button>
        );
      })}

      <div className="mx-1 w-px self-stretch bg-gray-200" />

      {TAG_CHIPS.map((c) => {
        const on = requiredTags.has(c.code);
        return (
          <button
            key={c.code}
            onClick={() => toggleTag(c.code)}
            className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs shadow-sm transition ${
              on
                ? 'border-black bg-black text-white'
                : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
