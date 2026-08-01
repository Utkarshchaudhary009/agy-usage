"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type AccountActionType = "setActive" | "remove" | "refreshToken";

export interface PendingAction {
  type: AccountActionType;
  token: number;
}

interface UseAccountActionsResult {
  pending: Record<string, PendingAction>;
  setActive: (accountId: string, email: string) => Promise<void>;
  remove: (accountId: string, email: string) => Promise<void>;
  refreshToken: (accountId: string, email: string) => Promise<void>;
}

export function useAccountActions(
  accountIds: string[],
): UseAccountActionsResult {
  const router = useRouter();
  const [pending, setPending] = useState<Record<string, PendingAction>>({});
  const requestCounter = useRef(0);

  // Drop pending state for accounts that no longer exist (e.g. after a
  // router.refresh removed an account) so stale keys don't linger. Returns
  // `prev` unchanged when nothing was pruned to avoid needless re-renders.
  useEffect(() => {
    setPending((prev) => {
      const next: Record<string, PendingAction> = {};
      for (const id of accountIds) {
        if (prev[id]) next[id] = prev[id];
      }
      if (Object.keys(next).length === Object.keys(prev).length) return prev;
      return next;
    });
  }, [accountIds]);

  const run = useCallback(
    async (
      type: AccountActionType,
      accountId: string,
      url: string,
      options: RequestInit,
      successMessage: string,
    ) => {
      // Unique per-invocation token: a stale completion can only clear the
      // pending slot if it still owns it, so a newer request for the same
      // account is never clobbered.
      const token = ++requestCounter.current;
      setPending((prev) => ({ ...prev, [accountId]: { type, token } }));
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
        // DOMException (AbortError/TimeoutError) is not guaranteed to satisfy
        // `instanceof Error` in every browser, so inspect the name directly.
        const errName =
          typeof err === "object" && err !== null && "name" in err
            ? String((err as { name: unknown }).name)
            : undefined;

        if (errName === "AbortError" || errName === "TimeoutError") {
          // The server may still be completing the operation (e.g. an
          // outbound Google call); refresh so the UI picks up the result.
          toast.info("Request is taking longer than expected. Refreshing...");
          router.refresh();
        } else {
          toast.error(
            err instanceof Error ? err.message : "Unexpected error occurred",
          );
        }
      } finally {
        setPending((prev) => {
          // Never clear a newer pending action for this account.
          const current = prev[accountId];
          if (!current || current.token !== token) return prev;
          const next = { ...prev };
          delete next[accountId];
          return next;
        });
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
