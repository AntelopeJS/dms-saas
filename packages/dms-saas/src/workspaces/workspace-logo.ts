import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { AttachmentField } from "@antelopejs/interface-dms/attachments";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import {
  CreateReadUrl,
  DeleteFile,
  FileNotFoundError,
} from "@antelopejs/interface-file-storage";
import { z } from "zod";
import { WorkspaceBrandingModel } from "./db/workspace-branding.model";

const LOGO_ATTACHMENT_FIELD = "saas-workspace-identity#logo";
const LOGO_STORAGE_PATH = "workspace-logos";
const LOGO_MIMETYPES = ["image/png", "image/jpeg", "image/webp"];
const LOGO_MAX_UPLOAD_BYTES = 512 * 1024;
const LOGO_DIMENSION_PX = 128;

const LOGO_VISIBILITY = "public";

/** The logo field of the workspace identity form. */
export const workspaceLogoType = new DefaultDataTypes.ImageType({
  path: LOGO_STORAGE_PATH,
  attachmentField: LOGO_ATTACHMENT_FIELD,
  visibility: LOGO_VISIBILITY,
  constraints: {
    allowedMimetypes: LOGO_MIMETYPES,
    maxSize: LOGO_MAX_UPLOAD_BYTES,
  },
  resize: {
    maxWidth: LOGO_DIMENSION_PX,
    maxHeight: LOGO_DIMENSION_PX,
    fit: "contain",
  },
});

/** The server side of `workspaceLogoType`, for `SaveComponentFiles`. */
export const workspaceLogoAttachmentFields: AttachmentField[] = [
  {
    id: LOGO_ATTACHMENT_FIELD,
    key: "logo",
    kind: "image",
    visibility: LOGO_VISIBILITY,
    constraints: {
      allowedMimetypes: LOGO_MIMETYPES,
      maxSize: LOGO_MAX_UPLOAD_BYTES,
    },
  },
];

/** A submitted logo once its file is promoted: an image, or null to remove it. */
export const workspaceLogoInput = z
  .object({
    key: z.string().min(1),
    alt: z.string().optional(),
    principal: z.boolean().optional(),
  })
  .nullable();

/**
 * The URL the switcher shows a logo with. A storage that cannot answer
 * leaves the workspace's initial in place rather than failing the switcher.
 */
export async function workspaceLogoUrl(
  logo: DefaultDataTypes.ImageValue | null,
): Promise<string | null> {
  if (!logo) return null;
  try {
    return (await CreateReadUrl(logo.key)).url;
  } catch (error) {
    Logging.Error(
      `[dms-saas:workspace-logo] no read URL for ${logo.key}`,
      error,
    );
    return null;
  }
}

/**
 * Deletes a workspace's logo file, then its branding row, once the workspace
 * itself is deleted. A file already gone counts as deleted, so a deletion
 * that failed half-way runs again to the same end.
 */
export async function deleteWorkspaceLogo(tenantId: string): Promise<void> {
  const branding = GetModel(WorkspaceBrandingModel, tenantId);
  const logo = await branding.getLogo(tenantId);
  if (logo) {
    await DeleteFile(logo.key).catch((error: unknown) => {
      if (!(error instanceof FileNotFoundError)) throw error;
    });
  }
  await branding.delete(tenantId);
}
