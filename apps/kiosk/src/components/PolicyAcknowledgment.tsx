import { useRef, useState, useCallback } from 'react';

interface PolicyAcknowledgmentProps {
  policyTitle: string;
  policyBody: string;
  onAcknowledge: () => void;
  onCancel: () => void;
}

export function PolicyAcknowledgment({
  policyTitle,
  policyBody,
  onAcknowledge,
  onCancel,
}: PolicyAcknowledgmentProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Consider "at bottom" when within 20px of the end
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
    if (atBottom && !hasScrolledToBottom) {
      setHasScrolledToBottom(true);
    }
  }, [hasScrolledToBottom]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-950 flex flex-col items-center justify-center text-white p-8">
      <h2 className="text-3xl font-bold mb-6">{policyTitle}</h2>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="w-full max-w-2xl h-96 overflow-y-auto bg-gray-800 rounded-2xl p-6 mb-2 border border-gray-700 text-gray-300 leading-relaxed whitespace-pre-wrap"
      >
        {policyBody}
      </div>

      {!hasScrolledToBottom && (
        <p className="text-sm text-gray-500 mb-6 flex items-center gap-2">
          <svg className="w-4 h-4 animate-bounce" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
          Scroll to the bottom to continue
        </p>
      )}

      {hasScrolledToBottom && <div className="mb-6" />}

      <div className="flex gap-4">
        <button
          onClick={onCancel}
          className="px-8 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl text-lg transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onAcknowledge}
          disabled={!hasScrolledToBottom}
          className="px-8 py-3 bg-green-700 hover:bg-green-600 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-xl text-lg font-semibold transition-colors"
        >
          I Agree
        </button>
      </div>
    </div>
  );
}
