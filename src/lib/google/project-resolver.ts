import "server-only";
import { createServerClient, createServiceClient } from "@/lib/supabase/server";
import { loadCodeAssist, onboardUser } from "./cloudcode-client";
import { getValidAccessToken } from "./token-manager";

function extractProjectId(
  project: string | { id?: string } | undefined,
): string | undefined {
  if (typeof project === "string") return project;
  return project?.id;
}

const onboardingLocks = new Map<string, Promise<string>>();

export async function resolveProjectId(
  accountId: string,
  options?: { asBackgroundJob?: boolean },
): Promise<string> {
  const supabase = options?.asBackgroundJob
    ? createServiceClient()
    : await createServerClient();

  // 1. Check if we already have it cached
  const { data: tokenData, error } = await supabase
    .from("google_tokens")
    .select("project_id")
    .eq("account_id", accountId)
    .single();

  if (!error && tokenData?.project_id) {
    return tokenData.project_id;
  }

  // Need to resolve it via API
  const accessToken = await getValidAccessToken(accountId, options);

  // 2. Call loadCodeAssist to see if user has a project
  const codeAssist = await loadCodeAssist(accessToken, accountId);

  let projectId = extractProjectId(codeAssist.cloudaicompanionProject);

  // 3. If still missing, we need to onboard the user
  if (!projectId) {
    if (onboardingLocks.has(accountId)) {
      projectId = await onboardingLocks.get(accountId);
    } else {
      const onboardPromise = (async () => {
        // Pick the free tier or default tier if available
        const tiers = codeAssist.allowedTiers || [];
        const defaultTier = tiers.find((t) => t.isDefault) || tiers[0];

        if (defaultTier?.id) {
          await onboardUser(accessToken, accountId, defaultTier.id);

          // Call loadCodeAssist again to get the newly created project ID
          const newCodeAssist = await loadCodeAssist(accessToken, accountId);
          return extractProjectId(newCodeAssist.cloudaicompanionProject);
        }
        return undefined;
      })();

      onboardingLocks.set(accountId, onboardPromise as Promise<string>);
      try {
        projectId = await onboardPromise;
      } finally {
        onboardingLocks.delete(accountId);
      }
    }
  }

  if (!projectId) {
    throw new Error("Failed to resolve Cloud Code project ID for account");
  }

  // 4. Save to DB for next time
  const { error: updateError } = await supabase
    .from("google_tokens")
    .update({ project_id: projectId, updated_at: new Date().toISOString() })
    .eq("account_id", accountId);

  if (updateError) {
    throw new Error(`Failed to cache project ID: ${updateError.message}`);
  }

  return projectId;
}
