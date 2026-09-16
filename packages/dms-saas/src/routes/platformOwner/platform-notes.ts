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
import { TenantModel } from "@antelopejs/interface-dms/db";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import { type User, UserModel } from "@antelopejs/interface-dms/auth/db";
import {
  PLATFORM_NOTE_TARGET_TYPES,
  type PlatformNote,
  PlatformNoteModel,
  type PlatformNoteTargetType,
} from "../../db";
import { parsePositiveInt } from "../../utils";

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_FORBIDDEN = 403;
const MAX_CONTENT_LENGTH = 4000;

interface CreateNoteBody {
  content: string;
}

interface PlatformNoteWithAuthor {
  _id: string;
  targetType: PlatformNoteTargetType;
  targetId: string;
  authorId: string;
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

const VALID_TARGET_TYPES = new Set<PlatformNoteTargetType>(
  PLATFORM_NOTE_TARGET_TYPES,
);

function assertTargetType(value: string): PlatformNoteTargetType {
  assert(
    VALID_TARGET_TYPES.has(value as PlatformNoteTargetType),
    HTTP_BAD_REQUEST,
    "saas.errors.platform_notes.invalid_target",
  );
  return value as PlatformNoteTargetType;
}

async function ensureTargetExists(
  targetType: PlatformNoteTargetType,
  targetId: string,
  userModel: UserModel,
  tenantModel: TenantModel,
): Promise<void> {
  const lookups: Record<PlatformNoteTargetType, () => PromiseLike<unknown>> = {
    user: () => userModel.get(targetId),
    workspace: () => tenantModel.get(targetId),
  };
  const target = await lookups[targetType]();
  assert(target, HTTP_NOT_FOUND, "saas.errors.platform_notes.target_not_found");
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

  @Model(TenantModel)
  declare tenantModel: TenantModel;

  @Get("/:targetType/:targetId")
  async list(
    @AuthOwnerOnly() _user: User,
    @Parameter("targetType") targetType: string,
    @Parameter("targetId") targetId: string,
    @Parameter("page", "query") page?: string,
    @Parameter("pageSize", "query") pageSize?: string,
  ): Promise<ListNotesResponse> {
    const type = assertTargetType(targetType);
    await ensureTargetExists(type, targetId, this.userModel, this.tenantModel);
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
    const content = (body.content ?? "").trim();
    assert(
      content.length > 0 && content.length <= MAX_CONTENT_LENGTH,
      HTTP_BAD_REQUEST,
      "saas.errors.platform_notes.invalid_content",
    );
    await ensureTargetExists(type, targetId, this.userModel, this.tenantModel);
    const now = new Date();
    const inserted = await this.noteModel.insert([
      {
        targetType: type,
        targetId,
        authorId: author._id,
        content,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const created = await this.noteModel.get(inserted[0]);
    assert(
      created,
      HTTP_NOT_FOUND,
      "saas.errors.platform_notes.creation_failed",
    );
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
