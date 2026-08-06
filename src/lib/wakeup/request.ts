import "server-only";

import type { NextRequest, NextResponse } from "next/server";
import { errorJson } from "@/lib/api/accounts";

/** Reject payloads that are far larger than any legitimate wakeup body. */
const MAX_BODY_BYTES = 64 * 1024;

export type ParsedJsonRequest =
  | { ok: true; body: unknown }
  | { ok: false; response: NextResponse };

/**
 * Reads a JSON request body for a state-changing route.
 *
 * Enforces two things beyond `req.json()`:
 *
 * 1. An `application/json` content type. A cross-site HTML form can only send
 *    `text/plain`, `application/x-www-form-urlencoded`, or `multipart/form-data`
 *    without triggering a CORS preflight, so requiring JSON keeps these
 *    mutating endpoints out of reach of simple-request CSRF. (Clerk's session
 *    cookie is SameSite=Lax today, which already blocks it — this is the
 *    defense that survives that setting changing.)
 * 2. A body size ceiling, so an oversized payload is rejected before it is
 *    buffered and parsed.
 */
export async function requireJsonRequest(
  req: NextRequest,
): Promise<ParsedJsonRequest> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.split(";")[0].trim().toLowerCase().endsWith("/json")) {
    return {
      ok: false,
      response: errorJson(
        {
          error: "Unsupported Media Type",
          code: "UNSUPPORTED_MEDIA_TYPE",
          message: "Content-Type must be application/json.",
        },
        415,
      ),
    };
  }

  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return { ok: false, response: payloadTooLarge() };
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return { ok: false, response: invalidJson() };
  }

  // Chunked requests omit content-length, so re-check the buffered size.
  if (raw.length > MAX_BODY_BYTES) {
    return { ok: false, response: payloadTooLarge() };
  }

  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false, response: invalidJson() };
  }
}

function invalidJson() {
  return errorJson(
    {
      error: "Bad Request",
      code: "INVALID_JSON",
      message: "Request body must be valid JSON.",
    },
    400,
  );
}

function payloadTooLarge() {
  return errorJson(
    {
      error: "Payload Too Large",
      code: "PAYLOAD_TOO_LARGE",
      message: "Request body is too large.",
    },
    413,
  );
}
