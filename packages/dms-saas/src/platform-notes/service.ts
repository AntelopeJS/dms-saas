import { assert } from "@antelopejs/interface-api-util";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { UserModel } from "@antelopejs/interface-dms/auth/db";
import { TenantModel } from "@antelopejs/interface-dms/db";
import {
  type PlatformNote,
  PlatformNoteModel,
  type PlatformNoteTargetType,
} from "../db";

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;

/** The longest note, in characters after trimming. */
export const PLATFORM_NOTE_MAX_LENGTH = 4000;

/** The author id of a note a procedure wrote. */
export const AUTOMATION_AUTHOR_PREFIX = "automation:";

/** A note to add, and the id it must have when its writer retries. */
export interface PlatformNoteDraft {
  targetType: PlatformNoteTargetType;
  targetId: string;
  authorId: string;
  content: string;
  noteId?: string;
}

/** The stored note, and whether this call wrote it. */
export interface AddedPlatformNote {
  note: PlatformNote;
  created: boolean;
}

/** Refuses a note about a user or a workspace that does not exist. */
export async function assertPlatformNoteTarget(
  targetType: PlatformNoteTargetType,
  targetId: string,
): Promise<void> {
  const lookups = {
    user: () => GetModel(UserModel).get(targetId),
    workspace: () => GetModel(TenantModel).get(targetId),
  } satisfies Record<
    PlatformNoteTargetType,
    () => PromiseLike<object | undefined>
  >;
  const target = await lookups[targetType]();
  assert(target, HTTP_NOT_FOUND, "saas.errors.platform_notes.target_not_found");
}

/** Trims a note and refuses an empty or too long one. */
export function normalizePlatformNoteContent(content: string): string {
  const trimmed = content.trim();
  assert(
    trimmed.length > 0 && trimmed.length <= PLATFORM_NOTE_MAX_LENGTH,
    HTTP_BAD_REQUEST,
    "saas.errors.platform_notes.invalid_content",
  );
  return trimmed;
}

async function insertNote(
  model: PlatformNoteModel,
  draft: PlatformNoteDraft,
  now: Date,
): Promise<string | undefined> {
  const row = {
    targetType: draft.targetType,
    targetId: draft.targetId,
    authorId: draft.authorId,
    content: draft.content,
    createdAt: now,
    updatedAt: now,
  };
  if (!draft.noteId) return (await model.insert([row]))[0];
  try {
    await model.insert([{ ...row, _id: draft.noteId }]);
    return draft.noteId;
  } catch (error) {
    if (await model.get(draft.noteId)) return undefined;
    throw error;
  }
}

/**
 * Adds a note once its target is checked. With a `noteId`, a note already
 * stored under it is answered as not created.
 */
export async function addPlatformNote(
  draft: PlatformNoteDraft,
): Promise<AddedPlatformNote> {
  await assertPlatformNoteTarget(draft.targetType, draft.targetId);
  const model = GetModel(PlatformNoteModel);
  const insertedId = await insertNote(model, draft, new Date());
  const note = await model.get(insertedId ?? draft.noteId ?? "");
  assert(note, HTTP_NOT_FOUND, "saas.errors.platform_notes.creation_failed");
  return { note, created: insertedId !== undefined };
}
