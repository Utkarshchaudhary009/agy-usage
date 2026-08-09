export interface CronValidationResult {
  valid: boolean;
  error?: string;
  description?: string;
}

// A pragmatic 5-field cron validator (minute hour day-of-month month
// day-of-week). It does not support ranges across month/day-of-week boundaries
// beyond standard comma/step syntax, which is sufficient for user-entered
// schedules. Returns a short human-readable description on success.
export function validateCronExpression(expr: string): CronValidationResult {
  const trimmed = expr.trim();
  const parts = trimmed.split(/\s+/);

  if (parts.length !== 5) {
    return {
      valid: false,
      error:
        "Cron must have 5 fields: minute hour day-of-month month day-of-week.",
    };
  }

  const bounds: Array<[number, number, string]> = [
    [0, 59, "minute"],
    [0, 23, "hour"],
    [1, 31, "day-of-month"],
    [1, 12, "month"],
    [0, 7, "day-of-week"],
  ];

  for (let i = 0; i < parts.length; i++) {
    const field = parts[i];
    const [min, max, name] = bounds[i];

    if (field === "*") continue;

    // Allow "*/step" on its own.
    const stepMatch = /^(\*)\/(\d+)$/.exec(field);
    if (stepMatch) {
      const step = Number(stepMatch[2]);
      if (step < 1 || step > max) {
        return { valid: false, error: `Invalid step for ${name}.` };
      }
      continue;
    }

    for (const segment of field.split(",")) {
      const res = validateCronSegment(segment, min, max, name);
      if (!res.valid) return res;
    }
  }

  return { valid: true, description: describeCron(trimmed) };
}

function validateCronSegment(
  segment: string,
  min: number,
  max: number,
  name: string,
): CronValidationResult {
  // range with optional step: a-b/s
  const rangeStep = /^(\d+)-(\d+)(?:\/(\d+))?$/.exec(segment);
  if (rangeStep) {
    const lo = Number(rangeStep[1]);
    const hi = Number(rangeStep[2]);
    if (lo < min || hi > max || lo > hi) {
      return { valid: false, error: `Invalid ${name} range: ${segment}` };
    }
    if (rangeStep[3] && Number(rangeStep[3]) < 1) {
      return { valid: false, error: `Invalid step in ${name}: ${segment}` };
    }
    return { valid: true };
  }

  // single value with optional step (e.g. 5/15)
  const valStep = /^(\d+)(?:\/(\d+))?$/.exec(segment);
  if (valStep) {
    const val = Number(valStep[1]);
    if (val < min || val > max) {
      return { valid: false, error: `Invalid ${name}: ${segment}` };
    }
    if (valStep[2] && Number(valStep[2]) < 1) {
      return { valid: false, error: `Invalid step in ${name}: ${segment}` };
    }
    return { valid: true };
  }

  // names like JAN-DEC or MON-SUN
  if (/^[A-Za-z]+$/.test(segment)) {
    return {
      valid: false,
      error: `Named values are not supported for ${name}. Use numbers (${min}-${max}).`,
    };
  }

  return { valid: false, error: `Invalid ${name} field: ${segment}` };
}

function describeCron(expr: string): string {
  const [minute, hour, , , dow] = expr.split(/\s+/);
  const timeOfDay = `${pad(hour)}:${pad(minute)}`;

  if (dow === "*") {
    return `At ${timeOfDay} every day.`;
  }
  return `At ${timeOfDay} on ${dow.replace(/\*/g, "every")}.`;
}

function pad(value: string): string {
  if (value === "*") return "**:**";
  return value;
}
