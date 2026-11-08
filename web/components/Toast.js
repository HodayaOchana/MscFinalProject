"use client";

// A small message at the bottom of the screen that fades away by itself.
//   const [toast, showToast] = useToast();   showToast("Saved");   <Toast toast={toast} />
import { useCallback, useEffect, useRef, useState } from "react";

export function useToast(ms = 3500) {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const show = useCallback((text) => {
    clearTimeout(timer.current);
    setToast({ text, key: Date.now() });
    timer.current = setTimeout(() => setToast(null), ms);
  }, [ms]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [toast, show];
}

export default function Toast({ toast }) {
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 lg:bottom-6 flex justify-center px-4">
      {toast && (
        <div key={toast.key} className="toast rounded-md border border-line-strong bg-cream px-5 py-3 text-sm font-medium text-ink shadow-[0_12px_30px_rgba(60,35,15,0.3)]">
          {toast.text}
        </div>
      )}
    </div>
  );
}
