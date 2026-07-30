import "server-only";
import { randomUUID } from "node:crypto";
import type {
  FetchAvailableModelsResponse,
  GenerateResponse,
  LoadCodeAssistResponse,
  OnboardResponse,
} from "@/lib/types/cloudcode";
import {
  CloudCodeAuthError,
  CloudCodeRateLimitError,
  CloudCodeServerError,
} from "./errors";

const BASE_URLS = [
  "https://cloudcode-pa.googleapis.com",
  "https://daily-cloudcode-pa.sandbox.googleapis.com",
];
const USER_AGENT = "antigravity";
const STREAM_PATH = "/v1internal:streamGenerateContent?alt=sse";
const SYSTEM_PROMPT =
  "You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding. You are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.**Absolute paths only****Proactiveness**";

const METADATA = {
  ideType: "ANTIGRAVITY",
  platform: "PLATFORM_UNSPECIFIED",
  pluginType: "GEMINI",
};

async function request<T>(
  endpoint: string,
  accessToken: string,
  accountId: string, // for CloudCodeAuthError
  body?: unknown,
  baseUrl = BASE_URLS[0],
): Promise<T> {
  const url = `${baseUrl}${endpoint}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401 || response.status === 403) {
    throw new CloudCodeAuthError(
      "Authentication failed. Token may be revoked.",
      accountId,
    );
  }

  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after");
    const retryMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : undefined;
    throw new CloudCodeRateLimitError("Rate limited by Google API", retryMs);
  }

  if (response.status >= 500) {
    throw new CloudCodeServerError(
      `Server error: ${response.status}`,
      response.status,
    );
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API request failed: ${response.status} - ${errorText}`);
  }

  return response.json() as Promise<T>;
}

export async function loadCodeAssist(
  accessToken: string,
  accountId: string,
): Promise<LoadCodeAssistResponse> {
  return request<LoadCodeAssistResponse>(
    "/v1internal:loadCodeAssist",
    accessToken,
    accountId,
    { metadata: METADATA },
  );
}

export async function fetchAvailableModels(
  accessToken: string,
  accountId: string,
  projectId?: string,
): Promise<FetchAvailableModelsResponse> {
  const body = projectId ? { project: projectId } : {};
  return request<FetchAvailableModelsResponse>(
    "/v1internal:fetchAvailableModels",
    accessToken,
    accountId,
    body,
  );
}

export async function onboardUser(
  accessToken: string,
  accountId: string,
  tierId: string,
): Promise<OnboardResponse> {
  return request<OnboardResponse>(
    "/v1internal:onboardUser",
    accessToken,
    accountId,
    {
      tierId,
      metadata: METADATA,
    },
  );
}

export async function streamGenerateContent(
  accessToken: string,
  accountId: string,
  projectId: string | undefined,
  modelId: string,
  prompt: string,
  maxOutputTokens?: number,
): Promise<GenerateResponse> {
  const requestId = randomUUID();
  const sessionId = randomUUID();
  const systemInstruction = {
    parts: [{ text: SYSTEM_PROMPT }],
  };

  const generationConfig: Record<string, unknown> = { temperature: 0 };
  if (maxOutputTokens && maxOutputTokens > 0) {
    generationConfig.maxOutputTokens = maxOutputTokens;
  }

  const body: Record<string, unknown> = {
    requestId,
    model: modelId,
    userAgent: "antigravity",
    requestType: "agent",
    request: {
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      session_id: sessionId,
      systemInstruction,
      generationConfig,
    },
  };

  if (projectId) {
    body.project = projectId;
  }

  const parseSSEResponse = (
    sseText: string,
  ): {
    text: string;
    tokensUsed?: { prompt: number; completion: number; total: number };
  } => {
    let fullText = "";
    let tokensUsed:
      | { prompt: number; completion: number; total: number }
      | undefined;

    for (const line of sseText.split("\n")) {
      if (line.startsWith("data: ")) {
        const jsonStr = line.substring(6);
        if (jsonStr.trim() === "[DONE]") continue;

        try {
          const data = JSON.parse(jsonStr);
          const responseData = data.response || data;
          const candidateText =
            responseData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (candidateText) {
            fullText += candidateText;
          }
          if (responseData.usageMetadata) {
            tokensUsed = {
              prompt: responseData.usageMetadata.promptTokenCount || 0,
              completion: responseData.usageMetadata.candidatesTokenCount || 0,
              total: responseData.usageMetadata.totalTokenCount || 0,
            };
          }
        } catch {
          // Ignore parse errors
        }
      }
    }

    return { text: fullText, tokensUsed };
  };

  const getBackoffDelay = (attempt: number): number => {
    const raw = 500 * 2 ** (attempt - 2);
    const jitter = Math.random() * 100;
    return Math.min(raw + jitter, 4000);
  };

  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));
  const MAX_TRIGGER_ATTEMPTS = 3;

  for (const baseUrl of BASE_URLS) {
    for (let attempt = 1; attempt <= MAX_TRIGGER_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        await sleep(getBackoffDelay(attempt));
      }

      const url = `${baseUrl}${STREAM_PATH}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "User-Agent": USER_AGENT,
            "Content-Type": "application/json",
            "Accept-Encoding": "gzip",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (response.status === 401 || response.status === 403) {
          throw new CloudCodeAuthError(
            "Authentication failed. Token may be revoked.",
            accountId,
          );
        }

        if (response.status === 429) {
          if (attempt === MAX_TRIGGER_ATTEMPTS) break;
          continue;
        }

        if (response.status >= 500) {
          if (attempt === MAX_TRIGGER_ATTEMPTS) break;
          continue;
        }

        if (response.ok && response.body) {
          // Read SSE chunks until we get the first candidate text to abort early
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let sseText = "";

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              sseText += decoder.decode(value, { stream: true });
              const parsed = parseSSEResponse(sseText);

              // If we've successfully parsed some text, we can abort to save tokens
              if (parsed.text.length > 0) {
                controller.abort();
                return parsed as GenerateResponse;
              }
            }
          } catch (e: unknown) {
            if (e instanceof Error && e.name === "AbortError") {
              // We intentionally aborted, parse what we have
              return parseSSEResponse(sseText) as GenerateResponse;
            }
            throw e;
          }

          return parseSSEResponse(sseText) as GenerateResponse;
        }

        const text = await response.text();
        throw new Error(`API request failed: ${response.status} - ${text}`);
      } catch (err: unknown) {
        if (err instanceof CloudCodeAuthError) throw err;
        if (
          err instanceof Error &&
          !err.message.startsWith("API request failed")
        ) {
          if (attempt === MAX_TRIGGER_ATTEMPTS) break;
          continue;
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }
    }
  }

  throw new Error("All trigger attempts failed across all base URLs");
}
