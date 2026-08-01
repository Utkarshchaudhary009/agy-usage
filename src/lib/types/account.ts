import type { QuotaSnapshot } from "./quota";

export type TokenStatus = "active" | "expired" | "revoked";

export interface LinkedAccount {
  id: string;
  email: string;
  displayName: string | null;
  isActive: boolean;
  tokenStatus: TokenStatus;
  addedAt: string;
  lastUsedAt: string;
  quota: QuotaSnapshot | null;
}
