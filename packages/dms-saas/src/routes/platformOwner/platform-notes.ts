import {
  Controller,
  Delete,
  Get,
  JSONBody,
  Parameter,
  Post,
} from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { Model } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import { type User, UserModel } from "@antelopejs/interface-dms/auth/db";
import {
  PLATFORM_NOTE_TARGET_TYPES,
  type PlatformNote,
  PlatformNoteModel,
  type PlatformNoteTargetType,
} from "../../db";
import {
  AUTOMATION_AUTHOR_PREFIX,
  addPlatformNote,
  assertPlatformNoteTarget,
  normalizePlatformNoteContent,
} from "../../platform-notes/service";
import { parsePositiveInt } from "../../utils";
import type { QueryParameterValue } from "../../utils/query-parameter";

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_FORBIDDEN = 403;

interface CreateNoteBody {
  content: string;
}

interface PlatformNoteWithAuthor {
  _id: string;
  targetType: PlatformNoteTargetType;
  targetId: string;
  authorId: string;
  authorKind: "user" | "automation";
  authorName: string | null;
  authorEmail: string | null;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

interface ListNotesResponse {
  items: PlatformNoteWithAuthor[];
  total: number;
  page: number;
  pageSize: number;
}

interface DeletedNoteResult {
  _id: string;
}

function assertTargetType(value: string): PlatformNoteTargetType {
  const targetType = PLATFORM_NOTE_TARGET_TYPES.find((type) => type === value);
  assert(
    targetType !== undefined,
    HTTP_BAD_REQUEST,
    "saas.errors.platform_notes.invalid_target",
  );
  return targetType;
}

async function decorateWithAuthors(
  notes: PlatformNote[],
  userModel: UserModel,
): Promise<PlatformNoteWithAuthor[]> {
  const uniqueAuthorIds = Array.from(new Set(notes.map((n) => n.authorId)));
  const authors = await Promise.all(
    uniqueAuthorIds.map((id) => userModel.get(id)),
  );
  const authorsById = new Map(
    authors
      .filter((author): author is User => !!author)
      .map((author) => [author._id, author]),
  );
  return notes.map((note) => {
    const author = authorsById.get(note.authorId);
    return {
      _id: note._id,
      targetType: note.targetType,
      targetId: note.targetId,
      authorId: note.authorId,
      authorKind: note.authorId.startsWith(AUTOMATION_AUTHOR_PREFIX)
        ? "automation"
        : "user",
      authorName: author?.name ?? null,
      authorEmail: author?.email ?? null,
      content: note.content,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    };
  });
}

export class SaasPlatformNotesController extends Controller(
  "/api/saas/platform-notes",
) {
  @Model(PlatformNoteModel)
  declare noteModel: PlatformNoteModel;

  @Model(UserModel)
  declare userModel: UserModel;

  @Get("/:targetType/:targetId")
  async list(
    @AuthOwnerOnly() _user: User,
    @Parameter("targetType") targetType: string,
    @Parameter("targetId") targetId: string,
    @Parameter("page", "query") page: QueryParameterValue,
    @Parameter("pageSize", "query") pageSize: QueryParameterValue,
  ): Promise<ListNotesResponse> {
    const type = assertTargetType(targetType);
    await assertPlatformNoteTarget(type, targetId);
    const result = await this.noteModel.listByTarget(type, targetId, {
      page: parsePositiveInt(page),
      pageSize: parsePositiveInt(pageSize),
    });
    return {
      items: await decorateWithAuthors(result.items, this.userModel),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  @Post("/:targetType/:targetId")
  async create(
    @AuthOwnerOnly() author: User,
    @Parameter("targetType") targetType: string,
    @Parameter("targetId") targetId: string,
    @JSONBody() body: CreateNoteBody,
  ): Promise<PlatformNoteWithAuthor> {
    const type = assertTargetType(targetType);
    const content = normalizePlatformNoteContent(body.content ?? "");
    const { note: created } = await addPlatformNote({
      targetType: type,
      targetId,
      authorId: author._id,
      content,
    });
    const [decorated] = await decorateWithAuthors([created], this.userModel);
    return decorated;
  }

  @Delete("/:id")
  async remove(
    @AuthOwnerOnly() actor: User,
    @Parameter("id") id: string,
  ): Promise<DeletedNoteResult> {
    const note = await this.noteModel.get(id);
    assert(note, HTTP_NOT_FOUND, "saas.errors.platform_notes.not_found");
    const canDelete = note.authorId === actor._id || actor.owner;
    assert(canDelete, HTTP_FORBIDDEN, "saas.errors.platform_notes.forbidden");
    await this.noteModel.delete(id);
    return { _id: id };
  }
}
