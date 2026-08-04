"use client";

import Link from "next/link";
import { useCallback, useId } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { WakeupAccountOption } from "@/lib/types/wakeup";

interface AccountSelectorProps {
  accounts: WakeupAccountOption[];
  selectedAccountIds: string[];
  onChange: (selectedAccountIds: string[]) => void;
  disabled?: boolean;
  /** True when the account list could not be loaded (not "no accounts"). */
  loadFailed?: boolean;
}

export function AccountSelector({
  accounts,
  selectedAccountIds,
  onChange,
  disabled = false,
  loadFailed = false,
}: AccountSelectorProps) {
  const groupId = useId();

  const toggle = useCallback(
    (accountId: string, checked: boolean) => {
      if (checked) {
        if (selectedAccountIds.includes(accountId)) return;
        onChange([...selectedAccountIds, accountId]);
      } else {
        onChange(selectedAccountIds.filter((id) => id !== accountId));
      }
    },
    [selectedAccountIds, onChange],
  );

  if (loadFailed) {
    return (
      <p className="text-sm text-muted-foreground">
        We could not load your linked accounts. Refresh the page to try again -
        your existing selection is unchanged.
      </p>
    );
  }

  if (accounts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No linked Google accounts yet.{" "}
        <Link
          href="/accounts"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Link an account
        </Link>{" "}
        to schedule wakeups.
      </p>
    );
  }

  return (
    <fieldset className="flex flex-col gap-3" disabled={disabled}>
      <legend className="sr-only">Accounts to trigger</legend>
      {accounts.map((account) => {
        const inputId = `${groupId}-${account.id}`;
        return (
          <div key={account.id} className="flex items-center gap-3">
            <Checkbox
              id={inputId}
              checked={selectedAccountIds.includes(account.id)}
              onCheckedChange={(checked) =>
                toggle(account.id, checked === true)
              }
              disabled={disabled}
            />
            <Label htmlFor={inputId} className="min-w-0 font-normal">
              <span className="truncate">{account.email}</span>
              {account.displayName && (
                <span className="truncate text-xs text-muted-foreground">
                  {account.displayName}
                </span>
              )}
              {account.tokenStatus !== "active" && (
                <Badge variant="destructive">{account.tokenStatus}</Badge>
              )}
            </Label>
          </div>
        );
      })}
    </fieldset>
  );
}
