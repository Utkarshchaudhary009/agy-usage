"use client";

import {
  Calendar,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AccountActionType } from "@/hooks/use-account-actions";
import type { LinkedAccount } from "@/lib/types/account";
import { RemoveDialog } from "./remove-dialog";

interface AccountCardProps {
  account: LinkedAccount;
  pending: Record<string, AccountActionType>;
  onSetActive: (accountId: string, email: string) => void;
  onRefreshToken: (accountId: string, email: string) => void;
  onRemove: (accountId: string, email: string) => Promise<void>;
}

const TOKEN_STATUS_LABELS: Record<LinkedAccount["tokenStatus"], string> = {
  active: "Token OK",
  expired: "Token Expired",
  revoked: "Revoked",
};

const TOKEN_BADGE_VARIANTS: Record<
  LinkedAccount["tokenStatus"],
  "default" | "outline" | "destructive"
> = {
  active: "default",
  expired: "outline",
  revoked: "destructive",
};

export function AccountCard({
  account,
  pending,
  onSetActive,
  onRefreshToken,
  onRemove,
}: AccountCardProps) {
  const [removeOpen, setRemoveOpen] = useState(false);
  // Formatted in an effect so SSR and hydration both render in the
  // client's locale/timezone (matches account-header.tsx pattern).
  const [addedDate, setAddedDate] = useState("");
  const [lastUsedDate, setLastUsedDate] = useState("");

  useEffect(() => {
    const format = (iso: string) =>
      new Date(iso).toLocaleDateString([], {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    setAddedDate(format(account.addedAt));
    setLastUsedDate(format(account.lastUsedAt));
  }, [account.addedAt, account.lastUsedAt]);

  const pendingType = pending[account.id];
  // Any in-flight mutation for this account blocks all of its actions,
  // including Set Active / Refresh Token while a remove is pending.
  const isBusy = pendingType !== undefined;

  const exhaustedCount = account.quota
    ? account.quota.models.filter((m) => m.isExhausted).length
    : 0;
  const totalModels = account.quota?.models.length ?? 0;

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-semibold">
            {account.displayName?.charAt(0).toUpperCase() ||
              account.email.charAt(0).toUpperCase()}
          </div>
          <div>
            <CardTitle className="break-all">{account.email}</CardTitle>
            <CardDescription>
              {account.displayName || "No display name"}
            </CardDescription>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {account.isActive && <Badge>Active</Badge>}
          <Badge
            variant={TOKEN_BADGE_VARIANTS[account.tokenStatus]}
            className={
              account.tokenStatus === "active"
                ? "text-emerald-600 dark:text-emerald-400"
                : account.tokenStatus === "expired"
                  ? "text-amber-600 dark:text-amber-400"
                  : undefined
            }
          >
            {TOKEN_STATUS_LABELS[account.tokenStatus]}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" />
            Added {addedDate}
          </span>
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="h-3.5 w-3.5" />
            Last used {lastUsedDate}
          </span>
        </div>

        <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Quota summary</span>
          {account.quota ? (
            <span className="font-medium">
              {totalModels} models
              {exhaustedCount > 0 && (
                <span className="text-destructive">
                  {" "}
                  · {exhaustedCount} exhausted
                </span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">No data yet</span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {!account.isActive && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onSetActive(account.id, account.email)}
              disabled={isBusy}
            >
              <UserCheck />
              {pendingType === "setActive" ? "Setting..." : "Set as Active"}
            </Button>
          )}

          {account.tokenStatus === "revoked" && (
            <Button asChild size="sm" variant="outline">
              <a href="/api/auth/google/link">
                <KeyRound />
                Re-authenticate
              </a>
            </Button>
          )}

          {account.tokenStatus === "expired" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onRefreshToken(account.id, account.email)}
              disabled={isBusy}
            >
              <RefreshCw
                className={
                  pendingType === "refreshToken" ? "animate-spin" : undefined
                }
              />
              {pendingType === "refreshToken"
                ? "Refreshing..."
                : "Refresh Token"}
            </Button>
          )}

          <Button
            size="sm"
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => setRemoveOpen(true)}
            disabled={pendingType === "remove"}
          >
            <Trash2 />
            Remove
          </Button>
        </div>
      </CardContent>

      <RemoveDialog
        email={account.email}
        isOpen={removeOpen}
        onOpenChange={setRemoveOpen}
        isPending={pendingType === "remove"}
        onConfirm={async () => {
          // Keep the dialog open (with a busy confirm button) until the
          // request settles, so the pending state is actually visible.
          await onRemove(account.id, account.email);
          setRemoveOpen(false);
        }}
      />
    </Card>
  );
}
