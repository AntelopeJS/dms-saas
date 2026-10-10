import { Logging } from "@antelopejs/interface-core/logging";
import { PublishMessage } from "@antelopejs/interface-dms/realtime";

/**
 * Topic the plan migration pages listen on: every block of a migration's
 * detail reads its route again when a migration moves a workspace, finishes
 * or is settled by hand.
 */
export const PLAN_MIGRATION_TOPIC = "saas:plan-migrations";
const CHANGED_EVENT = "plan-migration.changed";

/**
 * Tells the open migration pages that `migrationId` changed. Best effort: a
 * page missing the event still reads the migration again on its next refresh,
 * so a broker failure never fails the move that triggered it.
 *
 * @param migrationId The migration that changed
 */
export async function publishMigrationChange(
  migrationId: string,
): Promise<void> {
  try {
    await PublishMessage(PLAN_MIGRATION_TOPIC, CHANGED_EVENT, {
      payload: { migrationId },
    });
  } catch (error) {
    Logging.Warn("Plan migration change was not published", migrationId, error);
  }
}
