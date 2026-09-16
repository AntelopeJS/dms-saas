import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  PlatformNote,
  type PlatformNoteTargetType,
  platformNotesTableName,
} from "../tables/platformNotes.table";

const DEFAULT_PAGE_SIZE = 5;
const MAX_PAGE_SIZE = 50;

export interface ListNotesOptions {
  page?: number;
  pageSize?: number;
}

export interface ListNotesResult {
  items: PlatformNote[];
  total: number;
  page: number;
  pageSize: number;
}

/** Data access for administrative platform notes. */
export class PlatformNoteModel extends BasicDataModel(
  PlatformNote,
  platformNotesTableName,
) {
  async listByTarget(
    targetType: PlatformNoteTargetType,
    targetId: string,
    options: ListNotesOptions = {},
  ): Promise<ListNotesResult> {
    const pageSize = Math.min(
      Math.max(options.pageSize ?? DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE,
    );
    const page = Math.max(options.page ?? 1, 1);
    const offset = (page - 1) * pageSize;

    const buildQuery = () =>
      this.table
        .getAll(targetId, "targetId")
        .filter((row) => row.key("targetType").eq(targetType));

    const [total, rows] = await Promise.all([
      buildQuery().count().run(),
      buildQuery().orderBy("createdAt", "desc").slice(offset, pageSize).run(),
    ]);

    const items = rows
      .map((row) => PlatformNoteModel.fromDatabase(row))
      .filter((note): note is PlatformNote => note !== undefined);

    return { items, total, page, pageSize };
  }
}
