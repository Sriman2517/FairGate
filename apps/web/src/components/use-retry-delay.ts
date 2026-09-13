"use client";

import { useEffect, useState } from "react";

export function useRetryDelay(result: { retryAfterSeconds?: number }) {
  const [remaining, setRemaining] = useState(result.retryAfterSeconds ?? 0);
  useEffect(() => {
    const seconds = result.retryAfterSeconds ?? 0;
    const end = performance.now() + seconds * 1000;
    const update = () => setRemaining(Math.max(0, Math.ceil((end - performance.now()) / 1000)));
    update();
    if (!seconds) return;
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [result]);
  return remaining;
}
