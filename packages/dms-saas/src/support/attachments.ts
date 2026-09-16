import { assert } from "@antelopejs/interface-api-util";
import {
  CreateReadUrl,
  type FileMetadata,
  GetFileMetadata,
  isStagedKey,
  stripStagingPrefix,
} from "@antelopejs/interface-file-storage";
import {
  SUPPORT_ATTACHMENT_MAX_SIZE,
  SUPPORT_ATTACHMENT_MIMETYPES,
} from "./config";

const HTTP_BAD_REQUEST = 400;
const CONTROL_CHARACTER_MAX = 0x1f;
const DELETE_CHARACTER = 0x7f;

export interface SupportAttachmentMetadata extends FileMetadata {
  url: string;
  expiresAt?: number;
}

export interface SupportAttachmentValidation {
  size: number;
  mimetype: string;
}

function isAllowedMimetype(mimetype: string): boolean {
  return SUPPORT_ATTACHMENT_MIMETYPES.some((allowed) => {
    if (!allowed.endsWith("/*")) return mimetype === allowed;
    return mimetype.startsWith(allowed.slice(0, -1));
  });
}

function hasControlCharacters(value: string): boolean {
  // Code-point iteration is the point here: this looks for control characters, and
  // an emoji's code points are simply not any of them.
  // oxlint-disable-next-line typescript/no-misused-spread
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= CONTROL_CHARACTER_MAX || code === DELETE_CHARACTER;
  });
}

function isSafeStoragePath(value: string): boolean {
  return (
    !value.includes("..") &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !hasControlCharacters(value)
  );
}

/** Rejects cross-tenant or unsafe staged paths before accessing storage. */
export function assertSupportAttachmentPath(key: string, path: string): void {
  const pathPrefix = `${path}/`;
  const resourceKey = stripStagingPrefix(key);
  assert(
    isStagedKey(key) &&
      isSafeStoragePath(key) &&
      resourceKey.startsWith(pathPrefix),
    HTTP_BAD_REQUEST,
    "saas.errors.support.invalid_attachments",
  );
}

/** Validates the immutable final object's actual size and MIME type. */
export function assertSupportAttachmentMetadata(
  metadata: SupportAttachmentValidation,
): void {
  assert(
    Number.isSafeInteger(metadata.size) &&
      metadata.size >= 0 &&
      metadata.size <= SUPPORT_ATTACHMENT_MAX_SIZE &&
      isAllowedMimetype(metadata.mimetype),
    HTTP_BAD_REQUEST,
    "saas.errors.support.invalid_attachments",
  );
}

export async function getSupportAttachmentMetadata(
  resourceKey: string,
  storage: string,
): Promise<SupportAttachmentMetadata> {
  assert(
    typeof storage === "string" &&
      storage.trim().length > 0 &&
      !isStagedKey(resourceKey) &&
      resourceKey === stripStagingPrefix(resourceKey) &&
      isSafeStoragePath(resourceKey),
    HTTP_BAD_REQUEST,
    "saas.errors.support.invalid_attachment",
  );
  const [metadata, read] = await Promise.all([
    GetFileMetadata(resourceKey, storage),
    CreateReadUrl(resourceKey, undefined, storage),
  ]);
  return { ...metadata, url: read.url, expiresAt: read.expiresAt };
}
