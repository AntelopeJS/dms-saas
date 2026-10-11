/** The metadata a block shows in the roles editor: what it is, what it lets one do. */
export interface BlockPermissionMeta {
  name: string;
  description: string;
  icon: string;
}

/**
 * A block's name and description in the roles editor, read from
 * `<prefix>.<key>` and `<prefix>.<key>_description`.
 *
 * @param prefix The `$`-prefixed key family of the page's permissions
 * @param key The block's key in it
 * @param icon The block's icon
 */
export function blockMeta(
  prefix: string,
  key: string,
  icon: string,
): BlockPermissionMeta {
  return {
    name: `${prefix}.${key}`,
    description: `${prefix}.${key}_description`,
    icon,
  };
}

/** Row actions of a read-only table: none of the stock ones. */
export const NO_ROW_ACTIONS = {
  add: false,
  delete: false,
  edit: false,
  details: false,
  duplicate: false,
  archive: false,
  copyLink: false,
} as const;
