'use client';

const TAGS = [
  { code: 'outlet', label: '🔌 콘센트 충분' },
  { code: 'wifi', label: '📶 와이파이 빠름' },
  { code: 'quiet', label: '🔇 조용함' },
  { code: 'spacious', label: '💺 자리 넉넉' },
  { code: 'long_stay', label: '⏱ 장시간 OK' },
  { code: 'open_24h', label: '🌙 24시간' },
];

export default function TagPicker({
  value,
  onChange,
}: {
  value: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  function toggle(code: string) {
    const next = new Set(value);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onChange(next);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {TAGS.map((t) => {
        const on = value.has(t.code);
        return (
          <button
            type="button"
            key={t.code}
            onClick={() => toggle(t.code)}
            className={`rounded-full border px-3 py-1.5 text-xs transition ${
              on
                ? 'border-black bg-black text-white'
                : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
