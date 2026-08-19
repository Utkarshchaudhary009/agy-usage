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

// PGRST116 = ".single()" got zero or multiple rows. A genuine not-found is the
// zero-rows case; multiple rows is a data-integrity problem that must NOT be
// masked as not-found, so we require the error details to report "0 rows".
export function isRowNotFound(
  error: PostgrestError | null | undefined,
): boolean {
  return error?.code === "PGRST116" && (error.details ?? "").includes("0 rows");
}
