"use client";

import { useAuth } from "@clerk/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createContext, type ReactNode, useContext } from "react";
import { useRealtimeWakeup } from "@/hooks/use-realtime-wakeup";
import { useSupabaseClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/types/database";

const RealtimeClientContext = createContext<SupabaseClient<Database> | null>(
  null,
);

/**
 * Shares one browser Supabase client across realtime hooks so channel
 * lifecycles are keyed off a single client identity (the client is memoized
 * on the Clerk session, so it can change mid-session — consumers must tear
 * down subscriptions in effect cleanup whenever the provided client changes).
 *
 * Renders children unchanged; it exists purely to stabilize client identity
 * and keep provider wiring in one place per the plan's file list.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const supabase = useSupabaseClient();
  const { userId } = useAuth();

  return (
    <RealtimeClientContext.Provider value={supabase}>
      {/* Subscriptions read the client from context, so they must render
          inside the Provider element — not in this component's body. */}
      <WakeupLogSubscriber enabled={Boolean(userId)} />
      {children}
    </RealtimeClientContext.Provider>
  );
}

/** App-global: surface scheduled/background wakeup results as they land. */
function WakeupLogSubscriber({ enabled }: { enabled: boolean }) {
  useRealtimeWakeup(enabled);
  return null;
}

export function useRealtimeClient(): SupabaseClient<Database> | null {
  return useContext(RealtimeClientContext);
}
