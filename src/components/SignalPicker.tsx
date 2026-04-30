'use client';

const OPTIONS: Array<{
  code: 'green' | 'yellow' | 'red';
  emoji: string;
  label: string;
  hint: string;
  ringCls: string;
  bgCls: string;
}> = [
  {
    code: 'green',
    emoji: '🟢',
    label: '환영',
    hint: '눈치 안 보임',
    ringCls: 'ring-green-300',
    bgCls: 'bg-green-50',
  },
  {
    code: 'yellow',
    emoji: '🟡',
    label: '애매',
    hint: '시간대에 따라',
    ringCls: 'ring-amber-300',
    bgCls: 'bg-amber-50',
  },
  {
    code: 'red',
    emoji: '🔴',
    label: '비추',
    hint: '눈치 보임',
    ringCls: 'ring-red-300',
    bgCls: 'bg-red-50',
  },
];

export default function SignalPicker({
  value,
  onChange,
}: {
  value: 'green' | 'yellow' | 'red' | null;
  onChange: (v: 'green' | 'yellow' | 'red') => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {OPTIONS.map((o) => {
        const on = value === o.code;
        return (
          <button
            key={o.code}
            type="button"
            onClick={() => onChange(o.code)}
            className={`flex flex-col items-center rounded-2xl border p-3 transition ${
              on ? `ring-2 ${o.ringCls} ${o.bgCls}` : 'bg-white hover:bg-gray-50'
            }`}
          >
            <span className="text-2xl">{o.emoji}</span>
            <span className="mt-1 text-sm font-semibold">{o.label}</span>
            <span className="text-[11px] text-gray-500">{o.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
