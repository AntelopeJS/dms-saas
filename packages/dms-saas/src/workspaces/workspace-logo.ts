import type { AttachmentField } from "@antelopejs/interface-dms/attachments";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { CreateReadUrl } from "@antelopejs/interface-file-storage";
import { z } from "zod";

const LOGO_ATTACHMENT_FIELD = "saas-workspace-identity#logo";
const LOGO_STORAGE_PATH = "workspace-logos";
const LOGO_MIMETYPES = ["image/png", "image/jpeg", "image/webp"];
const LOGO_MAX_UPLOAD_BYTES = 512 * 1024;
const LOGO_DIMENSION_PX = 128;

/**
 * Public: the switcher shows the logo of every workspace of a member, and
 * the DMS file route only signs reads of the request's own workspace.
 */
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
    key: z.string(),
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
  } catch {
    return null;
  }
}
