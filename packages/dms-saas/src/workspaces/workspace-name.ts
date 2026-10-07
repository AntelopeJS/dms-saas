import { assert } from "@antelopejs/interface-api-util";

const HTTP_BAD_REQUEST = 400;

/** Longest workspace name the creation and rename forms accept. */
export const WORKSPACE_NAME_MAX_LENGTH = 60;

/**
 * The trimmed workspace name, refused when empty or longer than the forms
 * allow.
 *
 * @throws 400 `saas.errors.workspace.name_required` or `name_too_long`
 */
export function normalizeWorkspaceName(name: string | undefined): string {
  const trimmed = name?.trim() ?? "";
  assert(trimmed, HTTP_BAD_REQUEST, "saas.errors.workspace.name_required");
  assert(
    trimmed.length <= WORKSPACE_NAME_MAX_LENGTH,
    HTTP_BAD_REQUEST,
    "saas.errors.workspace.name_too_long",
  );
  return trimmed;
}
