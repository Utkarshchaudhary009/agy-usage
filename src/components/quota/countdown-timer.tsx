"use client";

import { useEffect, useRef, useState } from "react";

interface CountdownTimerProps {
  resetTime?: string;
  onReset?: () => void;
}

/**
 * Counts down to a model's quota reset. Recomputes from the ISO `resetTime`
 * every second so data refreshes (realtime or polling) immediately re-anchor
 * the countdown. First paint is a static string so SSR and hydration match.
 */
export function CountdownTimer({ resetTime, onReset }: CountdownTimerProps) {
  const [timeLeft, setTimeLeft] = useState<string>("Calculating...");
  const [isResetting, setIsResetting] = useState(false);
  // Ref keeps the reset callback stable across parent re-renders so the
  // interval is not torn down and recreated on every render.
  const onResetRef = useRef(onReset);
  useEffect(() => {
    onResetRef.current = onReset;
  }, [onReset]);

  useEffect(() => {
    if (!resetTime) {
      setTimeLeft("No reset time");
      setIsResetting(false);
      return;
    }

    const resetDate = new Date(resetTime).getTime();
    if (Number.isNaN(resetDate)) {
      setTimeLeft("Invalid date");
      setIsResetting(false);
      return;
    }

    let interval: ReturnType<typeof setInterval>;

    const updateTimer = () => {
      const distance = resetDate - Date.now();

      if (distance <= 0) {
        setTimeLeft("Resetting...");
        setIsResetting(true);
        clearInterval(interval);
        onResetRef.current?.();
        return;
      }

      const hours = Math.floor(
        (distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
      );
      const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((distance % (1000 * 60)) / 1000);

      setIsResetting(false);
      setTimeLeft(`${hours > 0 ? `${hours}h ` : ""}${minutes}m ${seconds}s`);
    };

    updateTimer();
    interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [resetTime]);

  return (
    <span
      className={`font-mono tabular-nums${isResetting ? " animate-pulse" : ""}`}
    >
      {timeLeft}
    </span>
  );
}
