"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";

export type AccountActionType = "setActive" | "remove" | "refreshToken";

interface UseAccountActionsResult {
  pending: { type: AccountActionType; accountId: string } | null;
  setActive: (accountId: string, email: string) => Promise<void>;
  remove: (accountId: string, email: string) => Promise<void>;
  refreshToken: (accountId: string, email: string) => Promise<void>;
}

export function useAccountActions(): UseAccountActionsResult {
  const router = useRouter();
  const [pending, setPending] = useState<{
    type: AccountActionType;
    accountId: string;
  } | null>(null);

  const run = useCallback(
    async (
      type: AccountActionType,
      accountId: string,
      url: string,
      options: RequestInit,
      successMessage: string,
    ) => {
      setPending({ type, accountId });
      try {
        const res = await fetch(url, {
          ...options,
          // Bound the request so a stalled server cannot hang the UI.
          signal: AbortSignal.timeout(15_000),
        });
        const json = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };

        if (!res.ok) {
          const message = json.message || json.error || "Request failed";
          toast.error(message);
          return;
        }

        toast.success(successMessage);
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Unexpected error occurred",
        );
      } finally {
        setPending(null);
      }
    },
    [router],
  );

  const setActive = useCallback(
    (accountId: string, email: string) =>
      run(
        "setActive",
        accountId,
        `/api/accounts/${accountId}`,
        { method: "PATCH" },
        `${email} is now the active account`,
      ),
    [run],
  );

  const remove = useCallback(
    (accountId: string, email: string) =>
      run(
        "remove",
        accountId,
        `/api/accounts/${accountId}`,
        { method: "DELETE" },
        `${email} has been removed`,
      ),
    [run],
  );

  const refreshToken = useCallback(
    (accountId: string, email: string) =>
      run(
        "refreshToken",
        accountId,
        `/api/accounts/${accountId}/refresh-token`,
        { method: "POST" },
        `Token refreshed for ${email}`,
      ),
    [run],
  );

  return { pending, setActive, remove, refreshToken };
}
