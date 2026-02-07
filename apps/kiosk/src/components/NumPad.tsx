interface NumPadProps {
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
}

export function NumPad({ value, onChange, maxLength = 10 }: NumPadProps) {
  const press = (digit: string) => {
    if (value.length < maxLength) onChange(value + digit);
  };

  return (
    <div className="grid grid-cols-3 gap-3 max-w-xs mx-auto">
      {['1','2','3','4','5','6','7','8','9','','0',''].map((d, i) => (
        d ? (
          <button key={i} onClick={() => press(d)}
            className="h-16 text-2xl font-bold bg-gray-700 hover:bg-gray-600 rounded-xl text-white transition-colors">
            {d}
          </button>
        ) : i === 11 ? (
          <button key={i} onClick={() => onChange(value.slice(0, -1))}
            className="h-16 text-xl bg-red-900 hover:bg-red-800 rounded-xl text-white transition-colors">
            DEL
          </button>
        ) : <div key={i} />
      ))}
    </div>
  );
}
