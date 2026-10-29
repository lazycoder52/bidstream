import { useState, useEffect } from 'react';
import { useSocketStore } from '@/stores/socket.store';
import { formatDuration } from '@/lib/utils';

export interface CountdownResult {
  remainingMs: number;
  formatted: string;
  isEnded: boolean;
  isUrgent: boolean; // Under 60 seconds (anti-sniping danger zone)
}

export function useServerCountdown(targetEndTimeIso: string | null | undefined): CountdownResult {
  const serverTimeOffset = useSocketStore((state) => state.serverTimeOffset);

  const calculateRemaining = (): number => {
    if (!targetEndTimeIso) return 0;
    const target = new Date(targetEndTimeIso).getTime();
    const serverNow = Date.now() + serverTimeOffset;
    return Math.max(0, target - serverNow);
  };

  const [remainingMs, setRemainingMs] = useState<number>(calculateRemaining);

  useEffect(() => {
    setRemainingMs(calculateRemaining());

    // Faster ticker when in final minute
    const intervalMs = remainingMs < 60000 ? 250 : 1000;
    const timer = setInterval(() => {
      const rem = calculateRemaining();
      setRemainingMs(rem);
      if (rem <= 0) {
        clearInterval(timer);
      }
    }, intervalMs);

    return () => clearInterval(timer);
  }, [targetEndTimeIso, serverTimeOffset]);

  const isEnded = remainingMs <= 0;
  const isUrgent = !isEnded && remainingMs <= 60000; // <= 60 seconds

  return {
    remainingMs,
    formatted: formatDuration(remainingMs),
    isEnded,
    isUrgent,
  };
}
