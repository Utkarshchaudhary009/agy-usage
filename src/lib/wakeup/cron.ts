export function isValidCronField(field: string): boolean {
  if (field.length === 0) return false;

  for (const part of field.split(",")) {
    const [range, step] = part.split("/");

    if (step !== undefined && !/^\d+$/.test(step)) return false;
    if (range === "*" || range === "?") continue;
    if (!/^\d+(-\d+)?$/.test(range)) return false;
  }

  return true;
}

export function isValidCronExpression(expression: string): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  return fields.every(isValidCronField);
}
