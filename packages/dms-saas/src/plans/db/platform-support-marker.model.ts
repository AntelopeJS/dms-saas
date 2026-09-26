import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  PlatformSupportMarker,
  platformSupportMarkersTableName,
} from "./platform-support-marker.table";

/** Support markers of one workspace, read through `GetModel(model, tenantId)`. */
export class PlatformSupportMarkerModel extends BasicDataModel(
  PlatformSupportMarker,
  platformSupportMarkersTableName,
) {
  async listUserIds(): Promise<Set<string>> {
    const rows = await this.table.pluck("_id").run();
    return new Set(
      rows.map((row) => row._id).filter((id): id is string => !!id),
    );
  }

  /** Idempotent: a concurrent or replayed marking leaves a single row. */
  async mark(userId: string): Promise<void> {
    if (await this.get(userId)) return;
    try {
      await this.insert({ _id: userId });
    } catch (error) {
      if (!(await this.get(userId))) throw error;
    }
  }

  async unmark(userIds: string[]): Promise<void> {
    await Promise.all(userIds.map((userId) => this.delete(userId)));
  }
}
