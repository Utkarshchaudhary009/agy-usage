"use client";

import { useEffect, useState } from "react";

interface CountdownTimerProps {
  resetTime?: string;
  onReset?: () => void;
}

export function CountdownTimer({ resetTime, onReset }: CountdownTimerProps) {
  const [timeLeft, setTimeLeft] = useState<string>("Calculating...");

  useEffect(() => {
    if (!resetTime) {
      setTimeLeft("No reset time");
      return;
    }

    const resetDate = new Date(resetTime).getTime();
    if (Number.isNaN(resetDate)) {
      setTimeLeft("Invalid date");
      return;
    }

    let interval: NodeJS.Timeout;

    const updateTimer = () => {
      const now = Date.now();
      const distance = resetDate - now;

      if (distance <= 0) {
        setTimeLeft("Resetting...");
        if (interval) clearInterval(interval);
        if (onReset) onReset();
        return;
      }

      const hours = Math.floor(
        (distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
      );
      const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((distance % (1000 * 60)) / 1000);

      setTimeLeft(`${hours > 0 ? `${hours}h ` : ""}${minutes}m ${seconds}s`);
    };

    updateTimer();
    interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [resetTime, onReset]);

  return <span className="font-mono tabular-nums">{timeLeft}</span>;
}
