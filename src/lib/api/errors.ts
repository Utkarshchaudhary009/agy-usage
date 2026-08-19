import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export interface ApiErrorBody {
  error: string;
  code: string;
  message: string;
}

export function errorJson(
  body: ApiErrorBody,
  status: number,
  headers?: Record<string, string>,
) {
  return NextResponse.json(body, { status, headers });
}

export function unauthorized(message: string) {
  return errorJson(
    { error: "Unauthorized", code: "UNAUTHORIZED", message },
    401,
  );
}

export function badRequest(code: string, message: string) {
  return errorJson({ error: "Bad Request", code, message }, 400);
}

export function validationError(message: string) {
  return errorJson(
    { error: "Validation Error", code: "VALIDATION_ERROR", message },
    400,
  );
}

export function internalError(action: string, cause?: unknown) {
  console.error(`Failed to ${action}:`, cause);
  return errorJson(
    {
      error: "Internal Server Error",
      code: "INTERNAL_ERROR",
      message: `Failed to ${action}`,
    },
    500,
  );
}

// PGRST116 = no rows matched, either because the row does not exist or RLS
// filtered it out. Both cases are a genuine not-found to the caller.
export function isRowNotFound(
  error: PostgrestError | null | undefined,
): boolean {
  return error?.code === "PGRST116";
}
