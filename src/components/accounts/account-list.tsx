"use client";

import { AlertCircle, CheckCircle2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAccountActions } from "@/hooks/use-account-actions";
import type { LinkedAccount } from "@/lib/types/account";
import { AccountCard } from "./account-card";

interface AccountListProps {
  accounts: LinkedAccount[];
  errorMessage?: string | null;
  successMessage?: string | null;
}

export function AccountList({
  accounts,
  errorMessage,
  successMessage,
}: AccountListProps) {
  const { pending, setActive, remove, refreshToken } = useAccountActions();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <p className="text-sm text-muted-foreground">
          {accounts.length} linked account{accounts.length === 1 ? "" : "s"}
        </p>
        <Button asChild>
          <a href="/api/auth/google/link">
            <Plus />
            Link New Account
          </a>
        </Button>
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/50 p-4 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {successMessage && (
        <div
          aria-live="polite"
          className="flex items-start gap-2 rounded-lg border border-emerald-500/50 p-4 text-sm text-emerald-600 dark:text-emerald-400"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border bg-card p-8 text-center min-h-[400px]">
          <h2 className="mb-2 text-2xl font-semibold">No Accounts Linked</h2>
          <p className="mb-6 max-w-md text-muted-foreground">
            Link a Google account to view your Cloud Code AI quota. The first
            account you link becomes your active account.
          </p>
          <Button asChild>
            <a href="/api/auth/google/link">
              <Plus />
              Link Google Account
            </a>
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {accounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              pending={pending}
              onSetActive={setActive}
              onRefreshToken={refreshToken}
              onRemove={remove}
            />
          ))}
        </div>
      )}
    </div>
  );
}
