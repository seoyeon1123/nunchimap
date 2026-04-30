type Signal = 'green' | 'yellow' | 'red' | 'gray' | null;

const STYLE: Record<Exclude<Signal, null>, { label: string; cls: string }> = {
  green: { label: '🟢 카공 환영', cls: 'bg-green-50 text-green-800 ring-green-200' },
  yellow: { label: '🟡 애매', cls: 'bg-amber-50 text-amber-800 ring-amber-200' },
  red: { label: '🔴 비추', cls: 'bg-red-50 text-red-800 ring-red-200' },
  gray: { label: '⚪ 데이터 부족', cls: 'bg-gray-50 text-gray-600 ring-gray-200' },
};

export default function SignalBadge({
  signal,
  size = 'md',
}: {
  signal: Signal;
  size?: 'sm' | 'md';
}) {
  const s = STYLE[signal ?? 'gray'];
  const sizeCls =
    size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-3 py-1';
  return (
    <span
      className={`inline-flex items-center rounded-full ring-1 ${s.cls} ${sizeCls}`}
    >
      {s.label}
    </span>
  );
}
