import "server-only";

export class CloudCodeAuthError extends Error {
  constructor(
    message: string,
    public accountId: string,
  ) {
    super(message);
    this.name = "CloudCodeAuthError";
  }
}

export class CloudCodeRateLimitError extends Error {
  constructor(
    message: string,
    public retryAfterMs?: number,
  ) {
    super(message);
    this.name = "CloudCodeRateLimitError";
  }
}

export class CloudCodeServerError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = "CloudCodeServerError";
  }
}
