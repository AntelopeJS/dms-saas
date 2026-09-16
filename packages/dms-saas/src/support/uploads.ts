import { createHash } from "node:crypto";
import { assert } from "@antelopejs/interface-api-util";
import {
  BasicDataModel,
  Field,
  GetModel,
  Index,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import {
  CreateUploadUrl,
  type PresignedUploadResponse,
} from "@antelopejs/interface-file-storage";
import { CORE_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";
import { getSupportStorage } from "../config";
import {
  assertSupportAttachmentMetadata,
  assertSupportAttachmentPath,
} from "./attachments";
import {
  SUPPORT_ATTACHMENT_MAX_SIZE,
  SUPPORT_ATTACHMENT_MIMETYPES,
  tenantSupportAttachmentPath,
} from "./config";

const HTTP_BAD_REQUEST = 400;
const HTTP_UNAVAILABLE = 503;
const MAX_FILENAME_LENGTH = 255;

export interface SupportUploadInput {
  filename: string;
  size: number;
  mimetype: string;
}

interface SupportUploadBody {
  filename?: unknown;
  size?: unknown;
  mimetype?: unknown;
}

/** Records server-issued private uploads before their capabilities reach the client. */
@RegisterTable("support_uploads", CORE_SCHEMA_NAME)
export class SupportUpload extends Table {
  @Field("string")
  declare _id: string;
  @Index()
  @Field("string")
  declare stagedKey: string;
  @Field("string")
  declare storage: string;
  @Field("string")
  declare tenantId: string;
}

/** Retains issuance provenance independently of later support operations. */
export class SupportUploadModel extends BasicDataModel(SupportUpload) {
  /** Confirms durable routing before exposing the upload capability. */
  async record(candidate: SupportUpload): Promise<void> {
    try {
      await this.insert(candidate);
    } catch {
      // Reconcile a lost insertion acknowledgement before exposing the upload capability.
    }
    const stored = await this.get(candidate._id);
    assert(
      stored?.storage === candidate.storage &&
        stored.stagedKey === candidate.stagedKey &&
        stored.tenantId === candidate.tenantId,
      HTTP_UNAVAILABLE,
      "saas.errors.support.attachment_pending",
    );
  }
}

/** Identifies one source under a retained, immutable named-storage definition. */
export function supportUploadId(storage: string, stagedKey: string): string {
  return createHash("sha256")
    .update(JSON.stringify([storage, stagedKey]))
    .digest("hex");
}

/** Parses only upload data; storage, path and visibility are always server-selected. */
export function parseSupportUpload(body: unknown): SupportUploadInput {
  const value: SupportUploadBody = body && typeof body === "object" ? body : {};
  assert(
    typeof value.filename === "string" &&
      value.filename.length > 0 &&
      value.filename.length <= MAX_FILENAME_LENGTH &&
      // Uploaded filenames must exclude control bytes as well as path separators.
      // oxlint-disable-next-line eslint/no-control-regex
      !/[\\/\x00-\x1f\x7f]/u.test(value.filename),
    HTTP_BAD_REQUEST,
    "saas.errors.support.invalid_attachment",
  );
  assert(
    typeof value.size === "number" &&
      Number.isSafeInteger(value.size) &&
      value.size >= 0 &&
      typeof value.mimetype === "string",
    HTTP_BAD_REQUEST,
    "saas.errors.support.invalid_attachment",
  );
  const input = {
    filename: value.filename,
    size: value.size,
    mimetype: value.mimetype,
  };
  assertSupportAttachmentMetadata(input);
  return input;
}

/** Issues a private staged upload and durably pins its tenant and named storage. */
export async function createSupportUpload(
  tenantId: string,
  input: SupportUploadInput,
): Promise<PresignedUploadResponse> {
  const storage = getSupportStorage();
  const path = tenantSupportAttachmentPath(tenantId);
  const response = await CreateUploadUrl(
    {
      ...input,
      path,
      staging: true,
      visibility: "private",
      metadata: { filename: input.filename },
    },
    {
      maxSize: SUPPORT_ATTACHMENT_MAX_SIZE,
      allowedMimetypes: [...SUPPORT_ATTACHMENT_MIMETYPES],
    },
    storage,
  );
  assertSupportAttachmentPath(response.resourceKey, path);
  await GetModel(SupportUploadModel).record({
    _id: supportUploadId(storage, response.resourceKey),
    stagedKey: response.resourceKey,
    storage,
    tenantId,
  });
  return response;
}

/** Resolves only an issued tenant upload, without consulting today's storage selection. */
export async function getSupportUpload(
  tenantId: string,
  stagedKey: string,
): Promise<SupportUpload> {
  const uploads = await GetModel(SupportUploadModel).getBy(
    "stagedKey",
    stagedKey,
  );
  assert(
    uploads.length === 1 && uploads[0].tenantId === tenantId,
    HTTP_BAD_REQUEST,
    "saas.errors.support.invalid_attachments",
  );
  return uploads[0];
}
