import type { WakeupConfig } from "@/lib/types/wakeup";

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function fromMinutes(total: number): string {
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${pad(h)}:${pad(m)}`;
}

// Computes the next trigger time (as a Date) for interval/daily modes. Custom
// cron is not evaluated precisely here; callers show the cron description
// instead of an exact time.
export function getNextTriggerTime(
  config: WakeupConfig,
  from = new Date(),
): Date | null {
  if (config.scheduleMode === "interval") {
    const next = new Date(from.getTime() + config.intervalHours * 3600 * 1000);
    return next;
  }

  if (config.scheduleMode === "daily") {
    const times = config.dailyTimes.map(toMinutes).sort((a, b) => a - b);
    if (times.length === 0) return null;

    const nowMinutes = from.getHours() * 60 + from.getMinutes();
    const todayMatch = times.find((t) => t > nowMinutes);
    const target = new Date(from);

    if (todayMatch !== undefined) {
      const [h, m] =
        todayMatch >= 0
          ? fromMinutes(todayMatch).split(":").map(Number)
          : [0, 0];
      target.setHours(h, m, 0, 0);
    } else {
      // Roll over to first time tomorrow.
      const first = times[0];
      target.setDate(target.getDate() + 1);
      const [h, m] = fromMinutes(first).split(":").map(Number);
      target.setHours(h, m, 0, 0);
    }
    return target;
  }

  return null;
}

export function formatNextTrigger(
  config: WakeupConfig,
  from = new Date(),
): string {
  if (config.scheduleMode === "custom") {
    return config.cronExpression ? `Cron: ${config.cronExpression}` : "Not set";
  }
  const next = getNextTriggerTime(config, from);
  if (!next) return "No upcoming trigger";
  return `Next: ${next.toLocaleString()} (in ~${formatDuration(next.getTime() - from.getTime())})`;
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}
