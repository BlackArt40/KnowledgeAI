// Persistence barrel: domain implementations live in ./persist/*.
// `deleteUserFromDb` stays here because it spans every domain.
import { getDb, isDbEnabled } from "./prisma";
import { log } from "@/lib/obs/log";
import { bestEffort } from "./persist/core";
import { deleteSecurityStateFromDb } from "./persist/identity";
import { deleteApiKeyFromDb, deleteAgentTasksByUserFromDb, deleteConversationsByUserFromDb } from "./persist/content";
import { deleteBillingDataFromDb, deleteWorkspaceFromDb } from "./persist/billing-team";
import { deleteModelConfigFromDb, deleteNotificationFromDb, deleteWebhookSubscriptionFromDb, deleteBotIntegrationFromDb, deleteEntityFromDb, deleteRelationFromDb } from "./persist/integrations";

export * from "./persist/identity";
export * from "./persist/content";
export * from "./persist/billing-team";
export * from "./persist/integrations";

export async function deleteUserFromDb(userId: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const tables = [
      "notification",
      "notificationPrefs",
      "modelConfig",
      "webhookSubscription",
      "botIntegration",
      "subscription",
      "invoice",
      "order",
      "conversation",
      "agentTask",
    ];
    const d = db as unknown as Record<string, {
      deleteMany?: (o: unknown) => Promise<unknown>;
    }>;
    await Promise.all(
      tables.map((name) => {
        const p = d[name]?.deleteMany?.({ where: { userId } });
        return p ? p.catch((err: unknown) => bestEffort(err)) : Promise.resolve();
      })
    );
    await db.user.delete({ where: { id: userId } }).catch((err: unknown) => bestEffort(err));
  } catch (err) {
    log.error({ err }, "[db] deleteUserFromDb error");
  }
}

/** Persist a KB create/update to DB. */
