import "server-only";
import { createServerClient, createServiceClient } from "@/lib/supabase/server";
import { loadCodeAssist, onboardUser } from "./cloudcode-client";
import { getValidAccessToken } from "./token-manager";

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

  let projectId: string | undefined;

  if (typeof codeAssist.cloudaicompanionProject === "string") {
    projectId = codeAssist.cloudaicompanionProject;
  } else if (codeAssist.cloudaicompanionProject?.id) {
    projectId = codeAssist.cloudaicompanionProject.id;
  }

  // 3. If still missing, we need to onboard the user
  if (!projectId) {
    // Pick the free tier or default tier if available
    const tiers = codeAssist.allowedTiers || [];
    const defaultTier = tiers.find((t) => t.isDefault) || tiers[0];

    if (defaultTier?.id) {
      await onboardUser(accessToken, accountId, defaultTier.id);

      // Call loadCodeAssist again to get the newly created project ID
      const newCodeAssist = await loadCodeAssist(accessToken, accountId);
      if (typeof newCodeAssist.cloudaicompanionProject === "string") {
        projectId = newCodeAssist.cloudaicompanionProject;
      } else if (newCodeAssist.cloudaicompanionProject?.id) {
        projectId = newCodeAssist.cloudaicompanionProject.id;
      }
    }
  }

  if (!projectId) {
    throw new Error("Failed to resolve Cloud Code project ID for account");
  }

  // 4. Save to DB for next time
  await supabase
    .from("google_tokens")
    .update({ project_id: projectId, updated_at: new Date().toISOString() })
    .eq("account_id", accountId);

  return projectId;
}
