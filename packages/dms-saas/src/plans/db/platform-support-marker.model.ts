import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import { getRowInstance } from "../../utils/row-instance";
import {
  PlatformSupportMarker,
  platformSupportMarkerId,
  platformSupportMarkersTableName,
} from "./platform-support-marker.table";

export interface LegacyPlatformSupportMarker {
  tenantId: string;
  userId: string;
}

/** Support markers of one workspace, read through `GetModel(model, tenantId)`. */
export class PlatformSupportMarkerModel extends BasicDataModel(
  PlatformSupportMarker,
  platformSupportMarkersTableName,
) {
  async listUserIds(): Promise<Set<string>> {
    const rows = await this.table.pluck("userId").run();
    return new Set(
      rows.map((row) => row.userId).filter((id): id is string => !!id),
    );
  }

  /** Idempotent: a concurrent or replayed marking leaves a single row. */
  async mark(tenantId: string, userId: string): Promise<void> {
    const id = platformSupportMarkerId(tenantId, userId);
    if (await this.get(id)) return;
    try {
      await this.insert({ _id: id, userId });
    } catch (error) {
      if (!(await this.get(id))) throw error;
    }
  }

  /** Also drops a marker still keyed by the user id alone. */
  async unmark(userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    await this.table.getAll(userIds, "userId").delete().run();
    await Promise.all(userIds.map((userId) => this.delete(userId)));
  }

  /**
   * Markers written before they were keyed per workspace carry the user id
   * as their `_id` and no `userId` field. Read across every workspace.
   */
  async listLegacyKeyed(): Promise<LegacyPlatformSupportMarker[]> {
    const rows = await this.table.run();
    return rows
      .filter((row) => !row.userId && !!row._id)
      .map((row) => ({ tenantId: getRowInstance(row), userId: row._id }));
  }

  /** Moves a legacy marker of this workspace to its per-workspace key. */
  async rekeyLegacy(tenantId: string, userId: string): Promise<void> {
    await this.mark(tenantId, userId);
    await this.delete(userId);
  }
}
